/** Plain-language explanations for processing reason codes. Codes are fixed strings; never raw provider messages. */
const MESSAGES: Record<string, string> = {
  paid_processing_disabled: 'Paid processing is switched off for this environment.',
  transcription_turned_off: 'Transcription is turned off in Automation settings.',
  tagging_turned_off: 'AI tagging is turned off in Automation settings.',
  documents_turned_off: 'Text extraction is turned off in Automation settings.',
  daily_paid_limit_reached: 'The daily limit for paid jobs was reached. It resumes as the 24-hour window clears, or raise the limit in Automation settings.',
  model_not_approved: 'The selected AI model is not approved for this environment.',
  no_tags_defined: 'No tags exist yet in the selected categories. The AI will propose new tags for approval in Review.',
  unsupported_file_type: 'This file type cannot be processed. Use PDF, Word, PowerPoint, Excel, VTT, text, or common audio/video files.',
  invalid_upload: 'The file is empty, too large (over 50 MB), or not a supported type.',
  input_size_limit: 'The file is larger than the 50 MB processing limit.',
  no_extractable_text: 'No readable text was found. Scanned PDFs need OCR, which is not available yet.',
  encrypted_document: 'The document is password-protected or encrypted.',
  source_version_mismatch: 'The item changed after this job was queued. A new job is queued for the current version automatically.',
  asset_version_mismatch: 'The file belongs to an older version of this item.',
  source_hash_mismatch: 'The stored file did not match its fingerprint. Upload it again.',
  vimeo_configuration_required: 'Vimeo access is not configured for the worker.',
  vimeo_id_required: 'Enter a numeric Vimeo ID on the item.',
  vimeo_source_changed: 'The Vimeo ID changed after this job was queued.',
  vimeo_http_404: 'Vimeo could not find this video, or our account cannot access it.',
  vimeo_http_403: 'Our Vimeo account is not allowed to access this video.',
  vimeo_http_429: 'Vimeo is rate-limiting requests. The job retries automatically.',
  vimeo_connection_failed: 'Could not reach Vimeo. The job retries automatically.',
  vimeo_media_too_large: 'The video has no captions and its smallest download is over 2 GB, so it cannot be transcribed.',
  authorized_media_unavailable_or_too_large: 'The video has no captions, and Vimeo offers no downloadable file under 2 GB for our account.',
  media_size_limit: 'The media file is larger than the 2 GB transcription limit.',
  nothing_to_analyze: 'There is no text to analyze yet: no article text, and no file or video could be read.',
  source_jobs_changed: 'The item\'s processed files changed while it was being analyzed. A new analysis is queued automatically.',
  invalid_mp4: 'The downloaded video was not a valid MP4 file.',
  vimeo_download_failed: 'The video file could not be downloaded from Vimeo. The job can be retried.',
  pdf_requires_ocr: 'This PDF is a scanned image with no text layer. OCR is not available yet; upload a text-based PDF or add the text manually.',
  pdf_page_limit: 'The PDF has more pages than the processing limit.',
  invalid_pdf: 'The PDF could not be read. It may be damaged.',
  invalid_document: 'The document could not be read. It may be damaged or in an unsupported format.',
  invalid_office_archive: 'The Office file could not be opened. It may be damaged or not a real Office file.',
  extracted_text_limit: 'The document has more text than the processing limit.',
  invalid_captions: 'The captions file could not be read.',
  content_bucket_required: 'File storage is not configured for the worker.',
  unknown_taxonomy: 'A tag offered to the AI no longer exists.',
  invalid_proposal: 'The AI suggestion failed validation and was discarded. Retry, or try a different model.',
  invalid_proposal_reference: 'The AI cited text or tags that were not in the source. The suggestion was discarded; retry the job.',
  transcribe_job_failed: 'Amazon Transcribe could not transcribe the audio.',
  invalid_model_response: 'The AI returned a response that failed validation. Retry, or try a different model.',
  classification_input_limit: 'The text is too long for a single AI tagging request.',
  provider_temporarily_unavailable: 'An AWS service was temporarily unavailable. The job retries automatically.',
  provider_retryable_failure: 'A temporary provider error occurred. The job retries automatically.',
  provider_or_extraction_failed: 'The file or provider returned an error that needs investigation.',
  retry_or_deadline_exhausted: 'The job did not finish after 5 attempts or within 24 hours.',
  lease_lost: 'The worker was interrupted. The job retries automatically.',
  processing_failed: 'An unexpected error occurred.',
}
export const explain = (code?: string | null) => {
  if (!code) return ''
  if (MESSAGES[code]) return MESSAGES[code]
  if (code.startsWith('vimeo_http_')) return `Vimeo returned an error (${code.slice(11)}).`
  return `Unexpected condition (${code}).`
}

export const STEP_LABEL: Record<string, string> = { extract: 'Text extraction', transcribe: 'Transcription', classify: 'AI tagging', index: 'Search indexing' }
export const STATE_LABEL: Record<string, string> = { queued: 'Waiting', running: 'Running', succeeded: 'Done', failed: 'Failed' }
export function jobLabel(stage: string, input: unknown) {
  const kind = input && typeof input === 'object' && 'kind' in input ? String((input as { kind: unknown }).kind) : ''
  return kind === 'vimeo' ? 'Vimeo captions / transcription' : STEP_LABEL[stage] ?? stage
}
