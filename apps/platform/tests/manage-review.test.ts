import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addMonths, applyReviewSchedule, canRenew, dueDate, reviewStatus } from '../src/domain/review'
import { Content } from '../src/collections'

const editorMock = vi.hoisted(() => ({ editorContext: vi.fn() }))
vi.mock('../src/server/editor', () => editorMock)
vi.mock('../src/payload.config', () => ({ default: {} }))
const browserMock = vi.hoisted(() => ({ allowsBrowserSession: vi.fn(() => true) }))
vi.mock('../src/auth/browser', async importOriginal => ({ ...await importOriginal<typeof import('../src/auth/browser')>(), allowsBrowserSession: browserMock.allowsBrowserSession }))

const now = new Date('2026-11-18T12:00:00.000Z')

describe('REQ-GOV-01: review windows hide lapsed items until a person renews them', () => {
  it('computes due dates from the window and last review, clamping month ends', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(dueDate('quarterly', '2026-11-18T12:00:00.000Z')).toBe('2027-02-18T12:00:00.000Z')
    expect(dueDate('biennial', '2026-11-18T12:00:00.000Z')).toBe('2028-11-18T12:00:00.000Z')
    expect(dueDate('annual', null)).toBeNull()
    expect(dueDate('fixedDate', '2026-11-18T12:00:00.000Z', '2027-03-01T12:00:00.000Z')).toBe('2027-03-01T12:00:00.000Z')
  })
  it('treats publishing as a review and ignores review dates sent by ordinary edits', () => {
    const published = applyReviewSchedule({ state: 'published' }, { state: 'draft', reviewWindow: 'monthly' }, { renewal: false, now })
    expect(published.lastReviewedAt).toBe(now.toISOString())
    expect(published.reviewDueAt).toBe('2026-12-18T12:00:00.000Z')
    const forged = applyReviewSchedule({ lastReviewedAt: '2030-01-01T00:00:00.000Z', title: 'x' },
      { state: 'published', reviewWindow: 'annual', lastReviewedAt: '2025-01-01T00:00:00.000Z' }, { renewal: false, now })
    expect(forged.lastReviewedAt).toBeUndefined()
    expect(forged.reviewDueAt).toBe('2026-01-01T00:00:00.000Z')
    const renewed = applyReviewSchedule({}, { state: 'published', reviewWindow: 'annual', lastReviewedAt: '2025-01-01T00:00:00.000Z' }, { renewal: true, now })
    expect(renewed.reviewDueAt).toBe('2027-11-18T12:00:00.000Z')
  })
  it('requires a future date for set-date reviews', () => {
    expect(() => applyReviewSchedule({ state: 'published', reviewWindow: 'fixedDate' }, { state: 'draft' }, { renewal: false, now })).toThrow('review date')
    expect(() => applyReviewSchedule({ reviewWindow: 'fixedDate', reviewOn: '2026-01-01T00:00:00.000Z' }, { state: 'draft' }, { renewal: false, now })).toThrow('future')
  })
  it('runs inside the content hook and reports status', async () => {
    const hook = Content.hooks!.beforeChange![0]
    const created = await hook({ operation: 'create', originalDoc: {}, data: { title: 'New', reviewWindow: 'monthly' } } as any)
    expect(created.reviewDueAt).toBeNull()
    expect(reviewStatus('2026-11-18T12:00:00.000Z', now)).toBe('overdue')
    expect(reviewStatus('2026-12-01T00:00:00.000Z', now)).toBe('soon')
    expect(reviewStatus('2027-06-01T00:00:00.000Z', now)).toBe('ok')
  })
  it('lets only owners and administrators renew', () => {
    expect(canRenew({ isAdmin: true, userId: 1, owner: null })).toBe(true)
    expect(canRenew({ isAdmin: false, userId: 5, owner: 5 })).toBe(true)
    expect(canRenew({ isAdmin: false, userId: 5, owner: { id: 5 } })).toBe(true)
    expect(canRenew({ isAdmin: false, userId: 5, owner: 6 })).toBe(false)
    expect(canRenew({ isAdmin: false, userId: 5, owner: null })).toBe(false)
  })
})

describe('REQ-GOV-02: the renew route', () => {
  const origin = 'https://library.synthetic.example'
  const update = vi.fn()
  const doc = (extra: object) => ({ id: 9, title: 'Item', state: 'published', reviewWindow: 'annual', owner: 6, ...extra })
  const call = async (role: string, item: object, form: Record<string, string> = {}) => {
    editorMock.editorContext.mockResolvedValue({ user: { id: 5, collection: 'users', roles: [role], active: true }, payload: { findByID: vi.fn(async () => doc(item)), update } })
    const { POST } = await import('../src/app/library-api/content/[id]/review/route')
    const body = new FormData(); for (const [k, v] of Object.entries(form)) body.set(k, v)
    const response = await POST(new Request(`${origin}/library-api/content/9/review`, { method: 'POST', body, headers: { origin } }), { params: Promise.resolve({ id: '9' }) })
    return new URL(response.headers.get('location')!).searchParams.get('outcome')
  }
  beforeEach(() => { vi.stubEnv('PLATFORM_ORIGIN', origin); update.mockReset() })
  afterEach(() => vi.unstubAllEnvs())

  it('refuses editors who do not own the item', async () => {
    expect(await call('editor', {})).toBe('not_owner'); expect(update).not.toHaveBeenCalled()
  })
  it('renews for the owner with the renewal flag', async () => {
    expect(await call('editor', { owner: 5 })).toBe('renewed')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 9, context: { reviewRenewal: true } }))
  })
  it('requires a new future date for set-date items', async () => {
    expect(await call('admin', { reviewWindow: 'fixedDate' })).toBe('date_required')
    expect(await call('admin', { reviewWindow: 'fixedDate' }, { reviewOn: '2099-01-02' })).toBe('renewed')
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { reviewOn: '2099-01-02T12:00:00.000Z' } }))
  })
})
