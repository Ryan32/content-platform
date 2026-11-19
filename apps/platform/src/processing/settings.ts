import type { Pool, PoolClient } from 'pg'
import { TAGGING_MODELS } from '../globals/AutomationSettings'

export interface AutomationSettings {
  paused: boolean; documentsEnabled: boolean; vimeoEnabled: boolean; thumbnailsEnabled: boolean; transcriptionEnabled: boolean
  taggingEnabled: boolean; taggingModel: string; taggingDimensions: string[]; dailyPaidJobLimit: number
}
// Used until an administrator first saves the settings page.
export const DEFAULT_SETTINGS: AutomationSettings = {
  paused: false, documentsEnabled: true, vimeoEnabled: true, thumbnailsEnabled: true, transcriptionEnabled: true, taggingEnabled: true,
  taggingModel: TAGGING_MODELS[0].value, taggingDimensions: ['topic', 'business-line', 'audience', 'program', 'entity'], dailyPaidJobLimit: 200,
}

export async function readSettings(db: Pool | PoolClient): Promise<AutomationSettings> {
  const { rows } = await db.query(`SELECT id, paused, documents_enabled, vimeo_enabled, thumbnails_enabled, transcription_enabled, tagging_enabled,
    tagging_model, daily_paid_job_limit FROM automation_settings ORDER BY id LIMIT 1`)
  const row = rows[0]
  if (!row) return DEFAULT_SETTINGS
  const dims = await db.query('SELECT value FROM automation_settings_tagging_dimensions WHERE parent_id=$1 ORDER BY "order"', [row.id])
  const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback
  return {
    paused: bool(row.paused, false), documentsEnabled: bool(row.documents_enabled, true), vimeoEnabled: bool(row.vimeo_enabled, true), thumbnailsEnabled: bool(row.thumbnails_enabled, true),
    transcriptionEnabled: bool(row.transcription_enabled, true), taggingEnabled: bool(row.tagging_enabled, true),
    taggingModel: row.tagging_model ?? DEFAULT_SETTINGS.taggingModel,
    taggingDimensions: dims.rows.map(r => String(r.value)),
    dailyPaidJobLimit: row.daily_paid_job_limit != null && Number.isFinite(Number(row.daily_paid_job_limit)) ? Number(row.daily_paid_job_limit) : DEFAULT_SETTINGS.dailyPaidJobLimit,
  }
}

/** The deployment ceiling: paid providers only when this environment allows them. */
export const paidAllowedByEnvironment = () => process.env.ALLOW_PAID_PROCESSING === 'true'
export function approvedModels() {
  return (process.env.BEDROCK_MODEL_IDS ?? process.env.BEDROCK_MODEL_ID ?? '').split(',').map(value => value.trim()).filter(Boolean)
}

export async function paidJobsLastDay(db: Pool | PoolClient) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM processing_jobs WHERE created_at > now() - interval '24 hours'
    AND (stage IN ('transcribe','classify') OR (input->>'kind'='vimeo' AND result->>'processorVersion'='ae-transcribe/1')
      OR result->>'processorVersion' IN ('ae-textract/1','ae-vision/1'))`)
  return rows[0].n as number
}

export type PaidStep = 'transcription' | 'tagging'
/**
 * Returns null when the step may run, otherwise a fixed reason code shown on the status page. Queueing counts the new
 * job against the limit; at run time the job is already counted, so only an exceeded limit blocks it.
 */
export async function paidBlock(db: Pool | PoolClient, step: PaidStep, settings?: AutomationSettings, atRuntime = false): Promise<string | null> {
  if (!paidAllowedByEnvironment()) return 'paid_processing_disabled'
  const current = settings ?? await readSettings(db)
  if (step === 'transcription' && !current.transcriptionEnabled) return 'transcription_turned_off'
  if (step === 'tagging' && !current.taggingEnabled) return 'tagging_turned_off'
  const used = await paidJobsLastDay(db)
  if (atRuntime ? used > current.dailyPaidJobLimit : used >= current.dailyPaidJobLimit) return 'daily_paid_limit_reached'
  return null
}
