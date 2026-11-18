import { describe, expect, it, vi } from 'vitest'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { TranscribeClient } from '@aws-sdk/client-transcribe'
import { S3Client } from '@aws-sdk/client-s3'
import { classify, getVimeoCaptions, transcribeMedia } from '../src/processing/providers'
import { validateProposal } from '../src/processing/schema'

const track = { type: 'captions', active: true, link: 'https://captions.cloud.vimeo.com/mock.vtt' }
const page = (tracks: unknown[]) => Response.json({ data: tracks, paging: { next: null } })
const extraction = { processorVersion: 'test/1', warnings: [], passages: [{ id: 'e1', text: 'Untrusted synthetic source', locator: 'Page 1' }] }
const taxonomy = [{ id: 3, label: 'Example' }]
const proposal = { summary: 'Example', tags: [{ termId: 3, confidence: 0.8, evidenceIds: ['e1'] }], takeaways: [], warnings: [] }
function mockSend<T extends { send: unknown }>(client: T) {
  const send = vi.fn<(command: { input: unknown }) => Promise<unknown>>()
  client.send = send as T['send']
  return send
}
describe('read-only Vimeo captions', () => {
  it('sends bearer only on the fixed API origin and revalidates redirects', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([track]))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://vod.vimeocdn.com/mock' } }))
      .mockResolvedValueOnce(new Response('WEBVTT\n\n00:01.000 --> 00:03.000\nEvidence'))
    expect((await getVimeoCaptions('987', 'synthetic', fetcher))?.passages[0].text).toBe('Evidence')
    expect(fetcher.mock.calls.map(([url, options]) => [new URL(String(url)).hostname, new Headers(options?.headers).get('authorization'), options?.redirect]))
      .toEqual([['api.vimeo.com', 'Bearer synthetic', 'manual'], ['captions.cloud.vimeo.com', null, 'manual'], ['vod.vimeocdn.com', null, 'manual']])
  })
  it('blocks arbitrary links and private destinations at every hop', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page([track]))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'http://127.0.0.1/' } }))
    await expect(getVimeoCaptions('987', 'synthetic', fetcher)).rejects.toThrow('untrusted_caption_url')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const foreign = vi.fn<typeof fetch>().mockResolvedValue(page([{ ...track, link: 'https://vimeo.com.untrusted.example/' }]))
    await expect(getVimeoCaptions('987', 'synthetic', foreign)).rejects.toThrow('untrusted_caption_url')
    expect(foreign).toHaveBeenCalledTimes(1)
  })
  it('reports missing tracks, handles rate limiting, and skips network without credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page([])).mockResolvedValueOnce(new Response(null, { status: 429 }))
    expect(await getVimeoCaptions('987', 'synthetic', fetcher)).toBeNull()
    await expect(getVimeoCaptions('987', 'synthetic', fetcher)).rejects.toMatchObject({ code: 'vimeo_http_429', retryable: true })
    await expect(getVimeoCaptions('987', '', fetcher)).rejects.toThrow('vimeo_configuration_required')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('private Transcribe lifecycle', () => {
  const jobKey = 'a'.repeat(64), bucket = 'dev-example'
  const input = { bucket, jobKey, inputKey: 'content/5/' + 'b'.repeat(64) + '.mp4', outputPrefix: 'processing/transcribe/' }
  const clients = () => {
    const speech = new TranscribeClient({}), s3 = new S3Client({})
    const transcribe = mockSend(speech), objects = mockSend(s3)
    return { speech, s3, transcribe, objects }
  }
  it('starts one deterministic job, resumes it, and reads only its chosen S3 key', async () => {
    const aws = clients()
    aws.transcribe.mockRejectedValueOnce(Object.assign(new Error("The requested job couldn't be found."), { name: 'BadRequestException' }))
      .mockResolvedValueOnce({})
    expect(await transcribeMedia(input, aws)).toEqual({ status: 'pending' })
    const start = aws.transcribe.mock.calls[1][0].input as { TranscriptionJobName: string; OutputKey: string; Media: { MediaFileUri: string } }
    expect(start).toMatchObject({ OutputBucketName: bucket, Media: { MediaFileUri: 's3://' + bucket + '/' + input.inputKey } })
    const job = { TranscriptionJobName: start.TranscriptionJobName, Media: start.Media }
    aws.transcribe.mockResolvedValueOnce({ TranscriptionJob: { ...job, TranscriptionJobStatus: 'IN_PROGRESS' } })
      .mockResolvedValueOnce({ TranscriptionJob: { ...job, TranscriptionJobStatus: 'COMPLETED', Transcript: { TranscriptFileUri: 'https://unused.example/' } } })
    expect(await transcribeMedia(input, aws)).toEqual({ status: 'pending' })
    expect(aws.objects).not.toHaveBeenCalled()
    aws.objects.mockResolvedValueOnce({ Body: { transformToWebStream: () => Response.json({ jobName: start.TranscriptionJobName,
      results: { audio_segments: [{ start_time: '0.15', end_time: '2.0', transcript: 'Synthetic speech.' }] } }).body } })
    const result = await transcribeMedia(input, aws)
    expect(result).toMatchObject({ status: 'complete', extraction: { passages: [{ text: 'Synthetic speech.', locator: '0.15s – 2.0s' }] } })
    expect(aws.objects.mock.calls[0][0].input).toEqual({ Bucket: bucket, Key: start.OutputKey })
    expect(aws.transcribe.mock.calls.map(call => call[0].constructor.name)).toEqual(['GetTranscriptionJobCommand', 'StartTranscriptionJobCommand', 'GetTranscriptionJobCommand', 'GetTranscriptionJobCommand'])
  })
  it('refuses public or unrelated sources, a mismatched provider job, and failed jobs', async () => {
    const aws = clients()
    for (const inputKey of ['https://vimeo.com/1234', 'source/private.mp4', 'content/../private.mp4']) {
      await expect(transcribeMedia({ ...input, inputKey }, aws)).rejects.toThrow('invalid_transcribe_input')
    }
    expect(aws.transcribe).not.toHaveBeenCalled()
    aws.transcribe.mockResolvedValueOnce({ TranscriptionJob: { TranscriptionJobName: 'different', TranscriptionJobStatus: 'COMPLETED' } })
    await expect(transcribeMedia(input, aws)).rejects.toThrow('transcribe_job_mismatch')
    const name = (aws.transcribe.mock.calls[0][0].input as { TranscriptionJobName: string }).TranscriptionJobName
    aws.transcribe.mockResolvedValueOnce({ TranscriptionJob: { TranscriptionJobName: name, Media: { MediaFileUri: 's3://' + bucket + '/' + input.inputKey }, TranscriptionJobStatus: 'FAILED' } })
    await expect(transcribeMedia(input, aws)).rejects.toThrow('transcribe_job_failed')
    expect(aws.objects).not.toHaveBeenCalled()
  })
})

describe('editorial proposals', () => {
  it('forces a single response schema and separates untrusted evidence from the system role', async () => {
    const client = new BedrockRuntimeClient({})
    const send = mockSend(client).mockResolvedValueOnce({ stopReason: 'tool_use', output: { message: { content: [{ toolUse: { name: 'submit_proposal', input: proposal } }] } } })
    expect(await classify(extraction, taxonomy, 'synthetic-model', client)).toEqual(proposal)
    expect(send.mock.calls[0][0].input).toMatchObject({ modelId: 'synthetic-model', system: [{ text: expect.stringContaining('untrusted data') }],
      messages: [{ role: 'user', content: [{ text: expect.stringContaining('Untrusted synthetic source') }] }],
      toolConfig: { toolChoice: { tool: { name: 'submit_proposal' } } } })
  })
  it('rejects invented evidence or terms, empty references, access fields and unstructured model replies', async () => {
    for (const value of [{ ...proposal, access: 'public' }, { ...proposal, tags: [{ ...proposal.tags[0], evidenceIds: ['e999'] }] },
      { ...proposal, tags: [{ ...proposal.tags[0], termId: 99 }] }, { ...proposal, takeaways: [{ text: 'Claim', evidenceIds: [] }] }]) {
      expect(() => validateProposal(value, extraction, [3])).toThrow()
    }
    const client = new BedrockRuntimeClient({})
    mockSend(client).mockResolvedValueOnce({ stopReason: 'end_turn', output: { message: { content: [{ text: '{}' }] } } })
    await expect(classify(extraction, taxonomy, 'synthetic-model', client)).rejects.toThrow('invalid_model_response')
  })
})
