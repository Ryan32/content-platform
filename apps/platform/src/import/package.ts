import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const sourceKey = z.string().regex(/^wordpress:dbr:post:\d+$/)
const jsonObject = z.record(z.string(), z.unknown())
const seed = z.object({
  sourceKey, sourceHash: hash, title: z.string().min(1), description: z.string(), body: z.string(),
  format: z.enum(['article', 'pdf', 'video', 'audio', 'slides', 'document']), state: z.literal('intake'),
  accessProfile: z.null(), acceptedTags: z.array(z.never()), evidenceVersion: z.literal('unprocessed'),
  passages: z.array(z.never()), vimeoId: z.string().regex(/^\d+$/).optional(),
  originalPublishedAt: z.iso.datetime().optional(), originalUpdatedAt: z.iso.datetime().optional(),
  moreVideos: z.array(z.object({ vimeoId: z.string().regex(/^\d+$/) }).strict()).max(20).optional(),
}).strict()
const statuses = {
  asset: ['verified_local'], 'asset-reference': ['captured', 'external', 'missing', 'ambiguous', 'zero_bytes', 'unsafe_path', 'unresolved'],
  attachment: ['captured', 'unresolved'], vimeo: ['reference_only'], taxonomy: ['captured_not_accepted'],
  parent: ['in_package', 'outside_package'], 'linked-package': ['in_package', 'outside_package'],
} as const
export type RelationshipKind = keyof typeof statuses
const schema = z.object({
  schema: z.literal('ae-wordpress-intake/1'), packageId: hash, provenance: jsonObject,
  content: z.array(z.object({ sourceKey, sourceHash: hash, initialContent: seed,
    selectionReason: z.string(), descriptionSource: z.string().nullable(), formats: z.array(z.string()), issues: z.array(z.string()),
    policy: z.object({ resolution: z.literal('restricted_intake_pending_policy_mapping'), grants: z.array(z.never()) }).strict(),
  }).strict()).min(1).max(200),
  sourceSnapshots: z.array(z.object({ sourceKey, sourceHash: hash, snapshot: z.object({
    sourceKey, raw: z.object({ post: z.record(z.string(), z.string().nullable()), metadata: z.array(jsonObject) }).strict(),
    manifest: jsonObject, attachments: z.array(jsonObject), verifiedFiles: z.record(z.string(), z.object({ sha256: hash, bytes: z.number().int().positive() }).strict()),
  }).strict() }).strict()).max(200),
  blobs: z.array(z.object({ id: z.string(), sha256: hash, bytes: z.number().int().positive(), localPaths: z.array(z.string()).min(1), delivery: z.literal('not_uploaded') }).strict()).max(5000),
  providerAssets: z.array(z.object({ id: z.string(), provider: z.literal('vimeo'), providerId: z.string().regex(/^\d+$/), access: z.literal('not_validated_by_importer') }).strict()),
  sourceTaxonomy: z.array(z.object({ id: z.string(), source: jsonObject, mappingStatus: z.literal('unreviewed') }).strict()),
  relationships: z.array(z.object({ id: hash, from: sourceKey, to: z.string(), kind: z.enum(Object.keys(statuses) as [RelationshipKind, ...RelationshipKind[]]), field: z.string(), status: z.string() }).strict()).max(20000),
  skipped: z.array(z.object({ sourceKey, reason: z.enum(['outside_requested_subset', 'source_not_eligible']), negativeControl: z.boolean() }).strict()),
}).strict()
export type IntakePackage = z.infer<typeof schema>

export class ImportError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'ImportError' }
}
export function assertImport(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ImportError(code)
}

// Python ensure_ascii=False / sort_keys=True compatibility, including numeric
// object keys and supplementary Unicode. Numbers in this contract are integers.
export function canonical(value: unknown, depth = 0): string {
  assertImport(depth < 100, 'json_depth_limit')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    assertImport(Number.isSafeInteger(value) && !Object.is(value, -0), 'unsupported_json_number')
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(v => canonical(v, depth + 1)).join(',')}]`
  assertImport(typeof value === 'object' && value !== null, 'unsupported_json_value')
  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort((a, b) => {
    const x = Array.from(a, c => c.codePointAt(0)!), y = Array.from(b, c => c.codePointAt(0)!)
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]
    return x.length - y.length
  })
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(object[key], depth + 1)}`).join(',')}}`
}
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const digest = (value: unknown) => sha256(canonical(value))
export function unique<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>()
  for (const row of rows) { const id = key(row); assertImport(!map.has(id), 'duplicate_identity'); map.set(id, row) }
  return map
}
function safeRelative(value: string) {
  return value.startsWith('wp-content/') && !/[\\:\x00]/.test(value) && !value.split('/').some(p => p === '..' || p === '.')
}

export function validatePackage(input: unknown): IntakePackage {
  const parsed = schema.safeParse(input)
  assertImport(parsed.success, 'invalid_package_schema')
  const p = parsed.data
  const { packageId, ...rest } = p
  assertImport(packageId === digest(rest), 'package_hash_mismatch')
  const content = unique(p.content, c => c.sourceKey), snapshots = unique(p.sourceSnapshots, s => s.sourceKey)
  const blobs = unique(p.blobs, b => b.id), providers = unique(p.providerAssets, a => a.id), taxonomy = unique(p.sourceTaxonomy, t => t.id)
  unique(p.relationships, e => e.id); unique(p.skipped, s => s.sourceKey)
  assertImport(content.size === snapshots.size, 'snapshot_count_mismatch')
  for (const item of p.content) {
    const s = snapshots.get(item.sourceKey)
    assertImport(s && s.sourceHash === item.sourceHash && digest(s.snapshot) === s.sourceHash, 'snapshot_hash_mismatch')
    assertImport(s.snapshot.sourceKey === item.sourceKey && `wordpress:dbr:post:${s.snapshot.raw.post.ID}` === item.sourceKey, 'snapshot_identity_mismatch')
    assertImport(item.initialContent.sourceKey === item.sourceKey && item.initialContent.sourceHash === item.sourceHash, 'seed_identity_mismatch')
    for (const [relative, file] of Object.entries(s.snapshot.verifiedFiles)) {
      assertImport(safeRelative(relative) && blobs.has(`sha256:${file.sha256}`), 'invalid_verified_file')
      assertImport(blobs.get(`sha256:${file.sha256}`)?.bytes === file.bytes, 'blob_size_mismatch')
    }
  }
  for (const s of p.skipped) assertImport(!content.has(s.sourceKey), 'included_and_skipped_source')
  for (const b of p.blobs) assertImport(b.id === `sha256:${b.sha256}` && b.localPaths.every(safeRelative), 'invalid_blob')
  for (const a of p.providerAssets) assertImport(a.id === `vimeo:video:${a.providerId}`, 'invalid_provider')
  for (const t of p.sourceTaxonomy) assertImport(t.id === `wordpress:dbr:term:${t.source.taxonomy}:${t.source.term_id}`, 'invalid_taxonomy_identity')
  for (const edge of p.relationships) {
    const { id, ...data } = edge
    assertImport(content.has(edge.from) && id === digest(data) && (statuses[edge.kind] as readonly string[]).includes(edge.status), 'invalid_relationship')
    const targets = edge.kind === 'asset' ? blobs : edge.kind === 'vimeo' ? providers : edge.kind === 'taxonomy' ? taxonomy : null
    if (targets) assertImport(targets.has(edge.to), 'dangling_relationship')
    if (edge.kind === 'parent' || edge.kind === 'linked-package') {
      assertImport(/^wordpress:dbr:post:\d+$/.test(edge.to), 'invalid_content_reference')
      assertImport(content.has(edge.to) === (edge.status === 'in_package'), 'incorrect_relationship_status')
    }
    const source = snapshots.get(edge.from)!.snapshot
    if (edge.kind === 'attachment' && edge.status === 'captured') assertImport(source.attachments.some(a => `wordpress:dbr:attachment:${a.source_id}` === edge.to), 'missing_attachment_metadata')
    if (edge.kind === 'asset-reference') assertImport(Array.isArray(source.manifest.assets) && source.manifest.assets.some(a => `reference:${digest(a)}` === edge.to), 'missing_reference_metadata')
  }
  return p
}

async function boundedRead(filename: string, maxBytes: number) {
  const info = await stat(filename)
  assertImport(info.isFile() && info.size <= maxBytes, 'package_file_size_limit')
  const bytes = await readFile(filename)
  assertImport(bytes.length <= maxBytes, 'package_file_size_limit')
  return bytes
}
export async function loadPackage(directory: string) {
  const marker = JSON.parse((await boundedRead(path.join(directory, 'complete.json'), 16384)).toString('utf8'))
  const names = ['package.json', 'summary.json', 'dry-run.json']
  assertImport(marker.schema === 'ae-wordpress-intake/1' && marker.files && Object.keys(marker.files).sort().join('|') === [...names].sort().join('|'), 'incomplete_package')
  let value: unknown
  for (const name of names) {
    const bytes = await boundedRead(path.join(directory, name), name === 'package.json' ? 32 * 1024 * 1024 : 2 * 1024 * 1024)
    assertImport(sha256(bytes) === marker.files[name], 'artifact_checksum_mismatch')
    if (name === 'package.json') value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  return validatePackage(value)
}
