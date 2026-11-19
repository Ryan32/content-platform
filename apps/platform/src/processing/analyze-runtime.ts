import type { Pool } from 'pg'
import { createHash } from 'node:crypto'
import { analyze, analysisEnvelope, ANALYSIS_VERSION, type AnalysisEnvelope, type CurrentRecord } from './analysis'
import { EvidenceBuilder } from './extract'
import { ProcessingError, type Job } from './jobs'
import { extractionSchema } from './review'

const SOURCE_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word document', doc: 'Word document (old format)', pptx: 'Slides', ppt: 'Slides (old format)',
  xlsx: 'Spreadsheet', xlsm: 'Spreadsheet', xls: 'Spreadsheet (old format)', zip: 'Zip packet', vtt: 'Captions', txt: 'Text file' }

/** Current editorial record as the model and the review screen see it. */
export async function currentRecord(db: Pool, contentId: number): Promise<CurrentRecord & { evidenceVersion: string }> {
  const { rows: [c] } = await db.query(`SELECT title, COALESCE(description,'') AS description, COALESCE(body,'') AS body, kind, section, audience, program,
    evidence_version, source_key FROM content WHERE id=$1`, [contentId])
  if (!c) throw new ProcessingError('source_version_mismatch')
  const many = async (table: string) => (await db.query(`SELECT value FROM ${table} WHERE parent_id=$1 AND value IS NOT NULL ORDER BY "order"`, [contentId])).rows.map(r => String(r.value))
  const [topics, pages, licensing, lines, rels, takeaways, categories] = await Promise.all([
    many('content_topics'), many('content_pages'), many('content_licensing'), many('content_lines'),
    db.query('SELECT path, taxonomy_id, carriers_id FROM content_rels WHERE parent_id=$1 ORDER BY "order"', [contentId]),
    db.query('SELECT text FROM content_takeaways WHERE _parent_id=$1 ORDER BY _order', [contentId]),
    // WordPress categories recorded at import: hints for the model, never accepted tags.
    db.query(`SELECT DISTINCT a.data->'source'->>'name' AS name FROM source_relations r JOIN import_artifacts a ON a.id=r.artifact_id
      WHERE r.content_id=$1 AND r.kind='taxonomy' AND a.data->'source'->>'name' IS NOT NULL LIMIT 100`, [contentId]),
  ])
  return {
    title: c.title, description: c.description, body: c.body, kind: c.kind, section: c.section, audience: c.audience, program: c.program,
    topics, pages, licensing, lines,
    tags: rels.rows.filter(r => r.path === 'acceptedTags' && r.taxonomy_id).map(r => Number(r.taxonomy_id)),
    carriers: rels.rows.filter(r => r.path === 'carriers' && r.carriers_id).map(r => Number(r.carriers_id)),
    takeaways: takeaways.rows.map(r => String(r.text)),
    migrated: String(c.source_key ?? '').startsWith('wordpress:'),
    sourceCategories: categories.rows.map(r => String(r.name)),
    evidenceVersion: c.evidence_version,
  }
}

/** Builds the combined evidence for one item and asks the model for a reconciled proposal. */
export async function analyzeItem(db: Pool, job: Job, run = analyze): Promise<AnalysisEnvelope> {
  const input = job.input
  if (input.kind !== 'analyze') throw new ProcessingError('wrong_job_stage')
  const { evidenceVersion, ...current } = await currentRecord(db, job.content_id)
  const { rows } = await db.query(`SELECT id, stage, state, input, result FROM processing_jobs
    WHERE id = ANY($1::int[]) AND content_id=$2 AND source_version=$3 ORDER BY id`, [input.sourceJobIds, job.content_id, job.source_version])
  if (rows.length !== input.sourceJobIds.length) throw new ProcessingError('source_jobs_changed')

  const passages: AnalysisEnvelope['passages'] = [], sources: AnalysisEnvelope['sources'] = []
  const add = (label: string, list: { id: string; text: string; locator: string }[], n: number, assetId?: number) => {
    let used = 0
    for (const p of list) {
      if (passages.length >= 4000) break
      passages.push({ id: `s${n}-${p.id}`, text: p.text, locator: `${label} · ${p.locator}`.slice(0, 200), ...(assetId ? { assetId } : {}) }); used++
    }
    sources.push({ id: `s${n}`, ...(assetId ? { assetId } : {}), label, passages: used, status: used < list.length ? 'truncated' : 'used' })
  }
  // Migrated or hand-written article text is a source too, unless it is itself an earlier accepted extraction.
  let n = 0
  if (current.body.trim() && evidenceVersion === 'unprocessed') {
    const text = new EvidenceBuilder('ae-article-text/1'); text.add(current.body, 'Article text')
    add('Article text', text.result.passages, ++n)
  }
  // Sources are labelled by their real names so citations and Review say which file or video a passage came from.
  const assetIds = rows.map(r => Number(r.input?.assetId)).filter(Number.isFinite)
  const [names, videos] = await Promise.all([
    assetIds.length ? db.query('SELECT id, file_name FROM assets WHERE id = ANY($1::int[]) AND content_id=$2', [assetIds, job.content_id]) : { rows: [] },
    db.query(`SELECT vimeo_id, title FROM content_more_videos WHERE _parent_id=$1 ORDER BY _order`, [job.content_id]),
  ])
  const fileName = new Map(names.rows.map(r => [Number(r.id), r.file_name ? String(r.file_name) : '']))
  const videoTitle = new Map(videos.rows.map((r, i) => [String(r.vimeo_id), r.title ? String(r.title) : `Video ${i + 2}`]))
  let files = 0
  for (const row of rows) {
    const named = fileName.get(Number(row.input?.assetId))
    const label = row.input?.kind === 'vimeo' ? (videoTitle.has(row.input.videoId) ? `Vimeo: ${videoTitle.get(row.input.videoId)}` : 'Vimeo video')
      : named ? named.slice(0, 120)
      : row.stage === 'transcribe' ? `Audio/video file ${++files}`
      : row.input?.kind === 'image' ? `Picture ${++files}`
      : `${SOURCE_LABEL[row.input?.format] ?? 'File'} ${++files}`
    const assetId = Number.isFinite(Number(row.input?.assetId)) ? Number(row.input.assetId) : undefined
    if (row.state !== 'succeeded') { sources.push({ ...(assetId ? { assetId } : {}), label, passages: 0, status: 'failed' }); continue }
    add(label, extractionSchema.parse(row.result).passages, ++n, assetId)
  }
  if (!passages.length) throw new ProcessingError('nothing_to_analyze')

  const fileSources = sources.filter(s => s.assetId && s.id && s.status !== 'failed').map(s => ({ id: s.id!, label: s.label }))
  const { analysis, truncated } = await run({ current, passages, taxonomy: input.taxonomy, carriers: input.carriers, fileSources }, input.modelId)
  if (truncated) analysis.warnings.push('Long sources: the AI read a sample of each source, not every page. Check the source text below.')
  return analysisEnvelope.parse({
    analysisVersion: ANALYSIS_VERSION, ...(input.videoId ? { sourceVimeoId: input.videoId } : {}), sources, passages, current, analysis,
    taxonomy: input.taxonomy, taxonomyIds: input.taxonomy.map(t => t.id),
    taxonomyVersion: createHash('sha256').update(JSON.stringify(input.taxonomy)).digest('hex'), carriers: input.carriers,
  })
}
