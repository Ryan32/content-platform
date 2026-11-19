import type { GlobalConfig } from 'payload'
import { admin, editor } from '../collections/access'

/** Approved Bedrock inference profiles for AI tagging. The worker also checks BEDROCK_MODEL_IDS. */
export const TAGGING_MODELS = [
  { value: 'us.anthropic.claude-haiku-5-5', label: 'Claude Haiku 5.5 — fast, lowest cost (recommended)' },
  { value: 'us.anthropic.claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — higher quality, higher cost' },
]
export const DIMENSIONS = [
  { value: 'topic', label: 'Topic' }, { value: 'business-line', label: 'Business line' }, { value: 'audience', label: 'Audience' },
  { value: 'format', label: 'Format' }, { value: 'program', label: 'Program' }, { value: 'entity', label: 'Organization or product' },
]

export const AutomationSettings: GlobalConfig = {
  slug: 'automation-settings',
  label: 'Automation settings',
  access: { read: editor, update: admin },
  admin: { group: 'Review & automation',
    description: 'Controls what happens automatically after content is added. Free steps (text extraction, Vimeo captions) and paid steps (transcription, AI tagging) can be switched on or off independently. Nothing here publishes content or grants access: every AI result waits in Review for an editor. The background worker picks up changes within a minute. See Automation status for the queue and failures.' },
  fields: [
    { name: 'paused', type: 'checkbox', defaultValue: false, label: 'Pause all automation',
      admin: { description: 'Stops the background worker from starting new work. Queued jobs wait and resume when unpaused.' } },
    { type: 'collapsible', label: 'Getting text out of content (free)', fields: [
      { name: 'documentsEnabled', type: 'checkbox', defaultValue: true, label: 'Extract text from uploaded files',
        admin: { description: 'PDF, Word, PowerPoint, Excel, caption (VTT) and text files. Scanned PDFs without a text layer are reported, not guessed.' } },
      { name: 'vimeoEnabled', type: 'checkbox', defaultValue: true, label: 'Use Vimeo captions',
        admin: { description: 'When a library item has a Vimeo ID, its existing captions become the reading text and citations.' } },
      { name: 'thumbnailsEnabled', type: 'checkbox', defaultValue: true, label: 'Create thumbnails automatically',
        admin: { description: 'Uses the Vimeo video thumbnail, or a picture of the first page of a PDF, when an item has no uploaded cover image.' } },
    ] },
    { type: 'collapsible', label: 'Transcription (paid — Amazon Transcribe)', fields: [
      { name: 'transcriptionEnabled', type: 'checkbox', defaultValue: true, label: 'Transcribe audio and video without captions',
        admin: { description: 'Uploaded audio/video, and Vimeo videos with no captions, are transcribed with timestamps. Roughly $0.024 per minute of audio. Files are limited to 50 MB.' } },
    ] },
    { type: 'collapsible', label: 'AI tagging and summaries (paid — Amazon Bedrock)', fields: [
      { name: 'taggingEnabled', type: 'checkbox', defaultValue: true, label: 'Suggest a summary and tags after text is extracted',
        admin: { description: 'The AI reads the extracted text and proposes a summary, key takeaways, and tags chosen only from Tags & topics. Editors accept, edit, or reject each suggestion in Review.' } },
      { name: 'migrationAutopilot', type: 'checkbox', defaultValue: true, label: 'Apply AI details to migrated WordPress items automatically',
        admin: { description: 'For items imported from the old site only: keeps every value your team set, fills in what is missing, sets the audience from the WordPress access mapping and moves the item to Draft. Nothing is published; approve drafts in bulk under Approve drafts. New tags the AI proposes are never created automatically. Turn off to review each suggestion in Review instead.' } },
      { name: 'taggingModel', type: 'select', defaultValue: TAGGING_MODELS[0].value, options: TAGGING_MODELS, label: 'AI model', required: true },
      { name: 'taggingDimensions', type: 'select', hasMany: true, options: DIMENSIONS, label: 'Tag categories the AI may suggest',
        defaultValue: ['topic', 'business-line', 'audience', 'program', 'entity'],
        admin: { description: 'Only tags in these categories are offered to the AI. At least one tag must exist in Tags & topics.' } },
    ] },
    { type: 'collapsible', label: 'Spending limit', fields: [
      { name: 'dailyPaidJobLimit', type: 'number', defaultValue: 200, min: 0, max: 5000, required: true, label: 'Maximum paid jobs per 24 hours',
        admin: { description: 'Transcription and AI tagging jobs started in the last 24 hours. When reached, new paid work waits until the window clears. Set 0 to stop paid work.' } },
    ] },
  ],
}
