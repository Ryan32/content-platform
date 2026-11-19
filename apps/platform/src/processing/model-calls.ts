import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime'
import { createHash } from 'node:crypto'
import type { ModelCall, ModelRecorder } from './evidence'

/** Prompt versions travel with every recorded call so ML work can tell prompts apart. Bump when a prompt changes. */
export const PROMPT_VERSIONS = { analysis: 'analysis-prompt/2026-11-18', classification: 'classify-prompt/2026-11-18', vision: 'vision-prompt/2026-11-18' } as const

/** Replaces image bytes with their fingerprint: the picture itself is already kept as the original file. */
function redact(input: ConverseCommandInput): unknown {
  return JSON.parse(JSON.stringify(input, (key, value) => {
    if (key === 'bytes' && value && typeof value === 'object') {
      const bytes = Buffer.from(Object.values(value as Record<string, number>))
      return { sha256: createHash('sha256').update(bytes).digest('hex'), length: bytes.length }
    }
    return value
  }))
}

/** One Bedrock Converse call, recorded in full (request, response, usage, latency) when a recorder is given. */
export async function converse(client: BedrockRuntimeClient, input: ConverseCommandInput, purpose: ModelCall['purpose'], record?: ModelRecorder): Promise<ConverseCommandOutput> {
  const started = Date.now()
  const response = await client.send(new ConverseCommand(input))
  record?.({ purpose, promptVersion: PROMPT_VERSIONS[purpose], modelId: String(input.modelId), request: redact(input),
    response: response.output, stopReason: response.stopReason, usage: response.usage as ModelCall['usage'], latencyMs: Date.now() - started })
  return response
}
