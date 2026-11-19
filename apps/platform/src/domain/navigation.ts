/**
 * Reader navigation (design handoff, docs/design): Home plus six task-based sections, ordered by real use.
 * Each section lists its topics and the familiar WordPress-era pages advisors already know. Until content is
 * filed into sections (phase 1), topic and page links run a library search for that name.
 */
export type SectionId = 'products' | 'operations' | 'marketing' | 'planning' | 'coaching' | 'events'
export type Section = { id: SectionId; label: string; blurb: string; icon: SectionId; topics: string[]; familiar: string[] }

export const SECTIONS: readonly Section[] = [
  { id: 'products', label: 'Products & Carriers', icon: 'products', blurb: 'Commission schedules, rates, carrier snapshots and AEWM strategies, organized by carrier.',
    topics: ['Carriers A–Z', 'Commission Schedules', 'Rates & Performance', 'AEWM Strategies', 'Product Changes', 'Carrier Snapshots'],
    familiar: ['Commission Schedules', 'Annuity Carrier Information', 'Annuity Rate Watch', 'AEWM Strategy Menu'] },
  { id: 'operations', label: 'Forms & Operations', icon: 'operations', blurb: 'Forms, sample applications, new business, transfers, custodians and compliance.',
    topics: ['Forms', 'Sample Applications', 'New Business & NIGO', 'Transfers', 'Schwab & Fidelity', 'Compliance'],
    familiar: ['Suitability Quick Reference Matrix', 'Transfer Company List', 'AEWM Forms', 'Sample Applications'] },
  { id: 'marketing', label: 'Marketing & Seminars', icon: 'marketing', blurb: 'Seminar kits, campaigns, print on demand, scripts and client-ready pieces.',
    topics: ['Seminar Kits', 'Recorded Seminars', 'Campaigns & Print on Demand', 'Scripts & Appointments', 'Client Events & Invites', 'Digital & Social'],
    familiar: ['Recorded Seminars', 'Turnkey Seminars & Webinars', 'Real Wins', 'Print on Demand'] },
  { id: 'planning', label: 'Planning & Advanced Markets', icon: 'planning', blurb: 'Tax, income, estate, long-term care and high-net-worth concepts for client cases.',
    topics: ['Retirement Income', 'Tax, RMDs & IRAs', 'Social Security', 'Estate & Legacy', 'Long-Term Care', 'High Net Worth'],
    familiar: ['Advanced Markets', 'Ask the Experts', 'High Net Worth', 'Whitepapers'] },
  { id: 'coaching', label: 'Coaching & Training', icon: 'coaching', blurb: 'Practice management, hiring, team training, leadership and coaching programs.',
    topics: ['Practice Management', 'Hiring & HR Hub', 'Onboard Your Staff', 'Team Training', 'Leadership', 'Coaching Programs'],
    familiar: ['HR Hub', 'Advisor Talent Solutions', 'Onboard Your Staff', 'STRETCH Leadership'] },
  { id: 'events', label: 'Events', icon: 'events', blurb: 'The Journey, WSOS, AExchange, forums and webinar replays.',
    topics: ['Upcoming Events', 'The Journey', 'World Series of Success', 'AExchange', 'Forums & Summits', 'Webinar Replays'],
    familiar: ['The Journey', 'World Series of Success', 'Ops Connect', 'Live Events Calendar'] },
]

export const sectionHref = (id: SectionId) => `/sections/${id}`
/** Interim destination for a topic or familiar page: a ranked library search for its name. */
export const searchHref = (term: string) => `/search?${new URLSearchParams({ q: term.replace(/[–&,]/g, ' ').replace(/\s+/g, ' ').trim() })}`

export function sectionById(id: string): Section | undefined {
  return SECTIONS.find(s => s.id === id)
}

/** The section the current page belongs to, for highlighting and expanding it in the sidebar. */
export function sectionFromPath(pathname: string): SectionId | null {
  const match = /^\/sections\/([a-z]+)(?:\/|$)/.exec(pathname)
  return match && sectionById(match[1]) ? match[1] as SectionId : null
}

/** Reading pages get the narrow icon sidebar so documents, video and articles have the width. */
export const isReadingPath = (pathname: string) => pathname.startsWith('/resources/')

/** Stable key for a topic or familiar page name, e.g. "Tax, RMDs & IRAs" → "tax-rmds-iras". */
export const slugify = (label: string) => label.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Stored value for a topic or familiar page: "<section>:<slug>". Section is part of the key so names can repeat across sections. */
export const tagValue = (section: SectionId, label: string) => `${section}:${slugify(label)}`

/** Carriers A–Z is its own page; every other topic is a filtered section listing. */
export const topicHref = (section: SectionId, label: string) => slugify(label) === 'carriers-a-z' ? '/carriers' : `${sectionHref(section)}?${new URLSearchParams({ topic: slugify(label) })}`
export const pageHref = (section: SectionId, label: string) => `${sectionHref(section)}?${new URLSearchParams({ page: slugify(label) })}`

/** Options for the content fields that file an item into topics and familiar pages, labelled "Section — Name". */
export const TOPIC_OPTIONS = SECTIONS.flatMap(s => s.topics.map(t => ({ value: tagValue(s.id, t), label: `${s.label} — ${t}` })))
export const PAGE_OPTIONS = SECTIONS.flatMap(s => s.familiar.map(f => ({ value: tagValue(s.id, f), label: `${s.label} — ${f}` })))
export const SECTION_OPTIONS = SECTIONS.map(s => ({ value: s.id, label: s.label }))

/** Resolves a topic or page slug from the URL to its display name; null when it doesn't belong to the section. */
export function topicName(section: Section, slug: string | undefined) { return slug ? section.topics.find(t => slugify(t) === slug) ?? null : null }
export function pageName(section: Section, slug: string | undefined) { return slug ? section.familiar.find(f => slugify(f) === slug) ?? null : null }

/** Content type shown as a badge and filter. How-to articles live in the normal sections; they have no section of their own. */
export const CONTENT_KINDS = [{ value: 'resource', label: 'Resource' }, { value: 'howto', label: 'How-to article' },
  { value: 'news', label: 'AE Today story' }, { value: 'bulletin', label: 'Bulletin' }] as const

/** Descriptive filters (design handoff). They help people find things; they never grant access. */
export const AUDIENCES = [{ value: 'advisor', label: 'Advisor-facing' }, { value: 'client', label: 'Client-ready' }] as const
export const LICENSING = [{ value: 'insurance', label: 'Insurance' }, { value: 'investment', label: 'Investment (IAR-RIA)' }] as const
export const LINES = [{ value: 'annuity', label: 'Annuity' }, { value: 'life', label: 'Life Insurance' }, { value: 'wealth', label: 'Wealth (AEWM)' },
  { value: 'medicare', label: 'Medicare' }, { value: 'hnw', label: 'High Net Worth' }] as const
export const PROGRAMS = [{ value: 'seminar-success', label: 'Seminar Success' }, { value: 'real-wins', label: 'Real Wins' },
  { value: 'second-half-playbook', label: 'Second Half Playbook' }, { value: 'ae-marketing-hub', label: 'AE Marketing Hub' },
  { value: 'express-lane', label: 'Express Lane' }, { value: 'the-journey', label: 'The Journey' },
  { value: 'advisor-talent-solutions', label: 'Advisor Talent Solutions' }, { value: 'next-gen-coaching', label: 'Next Gen Coaching' }] as const
export const labelOf = (list: readonly { value: string; label: string }[], value?: string | null) => list.find(o => o.value === value)?.label ?? value ?? ''
export type ContentKind = typeof CONTENT_KINDS[number]['value']
