import type { CollectionConfig, Field } from 'payload'
import { createHash, randomUUID } from 'node:crypto'
import { admin, deny, editor, readContent } from './access'
import { allowsBrowserSession, readSession } from '../auth/browser'
import { isAdminUser, isStaffUser } from './visibility'
import { CONTENT_KINDS, PAGE_OPTIONS, SECTION_OPTIONS, TOPIC_OPTIONS } from '../domain/navigation'
import { REVIEW_WINDOWS, applyReviewSchedule } from '../domain/review'

export const vimeoSourceHash = (id: unknown) => id ? createHash('sha256').update(`vimeo:${id}`).digest('hex') : undefined
const locked = { create: admin, read: admin, update: admin, delete: deny }
const option = (value: string, label: string) => ({ value, label })

/** Membership and rule scopes must name an active Audience, so a typo cannot silently block or widen access. */
const audienceScope: Field = {
  name: 'scope', type: 'text', required: true, label: 'Audience',
  validate: async (value: unknown, options: { req?: { payload?: { find: Function } }; previousValue?: unknown }) => {
    if (typeof value !== 'string' || !value.trim()) return 'Choose an audience.'
    // Existing values may predate the Audiences list; only new or changed values are checked.
    if (value === options.previousValue || !options.req?.payload) return true
    const found = await options.req.payload.find({ collection: 'audiences', overrideAccess: true, depth: 0, limit: 1,
      where: { and: [{ key: { equals: value } }, { active: { equals: true } }] } })
    return found.docs.length ? true : 'Choose an active audience from People & access → Audiences.'
  },
  admin: { components: { Field: '/components/AudienceSelect' } },
}

export const Audiences: CollectionConfig = {
  slug: 'audiences', labels: { singular: 'Audience', plural: 'Audiences' },
  access: { read: editor, create: admin, update: admin, delete: deny },
  admin: { group: 'People & access', useAsTitle: 'label', defaultColumns: ['label', 'kind', 'key', 'active'],
    hidden: ({ user }) => !isAdminUser(user),
    description: 'The approved list of groups that content can be shared with: firms, business lines, internal teams, programs, or plans. People are placed into audiences (under People → Library access), and access profile rules grant content to audiences. Picking from this list prevents typos that would silently block access.' },
  fields: [
    { name: 'label', type: 'text', required: true, label: 'Name', admin: { description: 'e.g. "Annuity business line" or "AE employees".' } },
    { name: 'kind', type: 'select', required: true, label: 'Type', defaultValue: 'business-line',
      options: [option('business-line', 'Business line'), option('firm', 'Firm'), option('internal', 'Internal team'), option('program', 'Program'), option('plan', 'Plan or status'), option('other', 'Other')] },
    { name: 'key', type: 'text', required: true, unique: true, index: true, label: 'Stable key', access: { update: () => false },
      validate: (value: unknown) => typeof value === 'string' && /^[a-z0-9][a-z0-9:._-]{1,99}$/.test(value) || 'Use lowercase letters, numbers and : . _ - (e.g. business-line:annuity).',
      admin: { description: 'Permanent identifier stored on memberships and rules, e.g. business-line:annuity. It cannot be changed after saving; create a new audience and deactivate this one instead.' } },
    { name: 'description', type: 'textarea', label: 'Who belongs here' },
    { name: 'active', type: 'checkbox', defaultValue: true, label: 'Available to choose', admin: { position: 'sidebar', components: { Cell: '/components/YesNoCell' }, description: 'Inactive audiences cannot be newly assigned. Existing assignments keep working until removed.' } },
  ],
}

const entitlements: Field = {
  name: 'entitlements', type: 'array', labels: { singular: 'Requirement', plural: 'Requirements' },
  admin: { description: 'Every requirement listed here must be held (AND). Leave empty if the scope alone is enough. Example: plan:full-active.' },
  fields: [{ name: 'value', type: 'text', required: true, label: 'Requirement' }],
}

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'Person', plural: 'People' },
  admin: {
    group: 'People & access', useAsTitle: 'name', defaultColumns: ['name', 'email', 'roles', 'active', 'lastSignInAt'],
    listSearchableFields: ['name', 'email'],
    description: 'Everyone who can sign in to AE Library. Add a person with their work email and role; their account links automatically the first time they sign in with that email. Roles control what they can do here; memberships control which library content they can see.',
  },
  auth: { disableLocalStrategy: true, strategies: [{ name: 'auth0', authenticate: async ({ headers, payload }) => {
    // MCP access tokens are never full Payload/admin sessions, even for an admin.
    // MCP resolves its principal in the read-only repository, not this strategy.
    if (headers.has('authorization')) return { user: null }
    const identity = allowsBrowserSession(headers) ? await readSession(headers.get('cookie')) : null
    if (!identity) return { user: null }
    // Identity provisioning is explicitly separate; never auto-grant on first login.
    const result = await payload.find({ collection: 'users', overrideAccess: true, depth: 0, limit: 1,
      where: { and: [{ subject: { equals: identity.subject } }, { issuer: { equals: identity.issuer } }, { active: { equals: true } }] } })
    return { user: result.docs[0] ? { ...result.docs[0], collection: 'users' as const } : null }
  } }] },
  access: { ...locked, admin: editor },
  hooks: { beforeValidate: [({ data }) => {
    if (!data) return data
    if (typeof data.email === 'string') data.email = data.email.trim().toLowerCase() || null
    if (typeof data.name === 'string') data.name = data.name.trim()
    if (!data.name && data.email) data.name = data.email
    if (!data.issuer && process.env.AUTH0_ISSUER) data.issuer = process.env.AUTH0_ISSUER
    return data
  }, ({ data, originalDoc }) => {
    if (!(data?.email ?? originalDoc?.email) && !(data?.subject ?? originalDoc?.subject)) throw new Error('Enter the person\'s work email.')
    return data
  }] },
  fields: [
    { name: 'name', type: 'text', label: 'Name', admin: { description: 'Shown throughout the admin. Filled in from their sign-in profile if left blank.' } },
    { name: 'email', type: 'email', label: 'Work email', unique: true, index: true,
      admin: { description: 'The email they sign in with. Their account links to this record the first time they sign in with this verified email.' } },
    { name: 'active', type: 'checkbox', label: 'Can sign in', defaultValue: true,
      admin: { position: 'sidebar', components: { Cell: '/components/YesNoCell' }, description: 'Turn off to block access immediately without deleting the person.' } },
    { name: 'roles', type: 'select', label: 'Roles', hasMany: true, defaultValue: ['reader'],
      options: [option('reader', 'Reader'), option('editor', 'Editor'), option('admin', 'Administrator')],
      admin: { position: 'sidebar', description: 'Reader: browses the library. Editor: adds and edits content and reviews AI suggestions. Administrator: also manages people, access, publishing, and automation. Only editors and administrators can open this admin.' } },
    { name: 'lastSignInAt', type: 'date', label: 'Last sign-in', access: { create: () => false, update: () => false },
      admin: { position: 'sidebar', readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
    { name: 'memberships', type: 'array', label: 'Library access (memberships)', labels: { singular: 'Membership', plural: 'Memberships' },
      admin: { description: 'Which audiences this person belongs to. A reader sees an item only when one of its access profile rules matches a membership here. Choose audiences from the approved list (People & access → Audiences).' },
      fields: [{ ...audienceScope, admin: { ...audienceScope.admin, description: 'The audience this person belongs to.' } }, entitlements] },
    { type: 'collapsible', label: 'Sign-in identity (technical)', admin: { initCollapsed: true, position: 'sidebar' }, fields: [
      { name: 'subject', type: 'text', label: 'Auth0 user ID', index: true, access: { update: admin },
        admin: { readOnly: true, description: 'Linked automatically at first sign-in. Leave blank when inviting someone.' } },
      { name: 'issuer', type: 'text', label: 'Identity provider', admin: { readOnly: true } },
    ] },
  ], indexes: [{ fields: ['issuer', 'subject'], unique: true }],
}

export const AccessProfiles: CollectionConfig = {
  slug: 'access-profiles', labels: { singular: 'Access profile', plural: 'Access profiles' },
  access: { ...locked, readVersions: admin }, versions: { maxPerDoc: 50 },
  admin: { group: 'People & access', useAsTitle: 'name', defaultColumns: ['name', 'active', 'updatedAt'],
    hidden: ({ user }) => !isAdminUser(user),
    description: 'Reusable audience rules attached to library items, such as "Annuity advisors" or "AE employees". Each rule grants one action (view, AI retrieval, or download) to people whose memberships match its scope and requirements. An item with no profile is visible to no reader.' },
  fields: [
    { name: 'name', type: 'text', required: true, label: 'Profile name', admin: { description: 'Describe the audience, e.g. "AEWM advisors — full active".' } },
    { name: 'active', type: 'checkbox', defaultValue: false, label: 'In effect', admin: { position: 'sidebar', components: { Cell: '/components/YesNoCell' }, description: 'Inactive profiles grant nothing, even if attached to items.' } },
    { name: 'grants', type: 'array', label: 'Rules', labels: { singular: 'Rule', plural: 'Rules' },
      admin: { description: 'A person qualifies if ANY rule matches one of their memberships. View is required for every other action.' },
      fields: [
        { type: 'row', fields: [
          { name: 'action', type: 'select', required: true, label: 'Allows', options: [option('view', 'View in the library'), option('retrieve', 'AI assistant retrieval (MCP)'), option('download', 'Download original file')] },
          { ...audienceScope, admin: { ...audienceScope.admin, description: 'Who the rule applies to.' } },
        ] }, entitlements,
      ] },
  ],
}

export const Taxonomy: CollectionConfig = {
  slug: 'taxonomy', labels: { singular: 'Tag', plural: 'Tags & topics' },
  access: { create: editor, update: editor, delete: deny, read: editor },
  admin: { group: 'Library', useAsTitle: 'label', defaultColumns: ['label', 'dimension', 'key'],
    description: 'The approved vocabulary for describing content. AI tagging can only suggest tags from this list, and editors confirm them in Review. Tags help people find content; they never grant access.' },
  fields: [
    { name: 'label', type: 'text', required: true, label: 'Tag name' },
    { name: 'dimension', type: 'select', required: true, label: 'Category',
      options: [option('business-line', 'Business line'), option('topic', 'Topic'), option('audience', 'Audience'), option('format', 'Format'), option('program', 'Program'), option('entity', 'Organization or product')] },
    { name: 'definition', type: 'textarea', label: 'When to use it', admin: { description: 'One or two sentences. The AI reads this to decide when the tag applies.' } },
    { name: 'key', type: 'text', required: true, unique: true, label: 'Stable key', admin: { description: 'Lowercase identifier that never changes, e.g. topic:tax-planning.' } },
  ],
}

export const Content: CollectionConfig = {
  slug: 'content', labels: { singular: 'Library item', plural: 'Library items' }, disableDuplicate: true, versions: { maxPerDoc: 50 },
  admin: { group: 'Library', useAsTitle: 'title', defaultColumns: ['thumbnailVersion', 'title', 'format', 'state', 'updatedAt'],
    description: 'Every article, document, and video in AE Library. To add one: create it with a title and format, save, then upload its file or enter a Vimeo ID in the Processing panel. Text extraction     and AI tagging run automatically, and suggestions appear in Review. An administrator publishes it with an access profile.' },
  access: { read: readContent, readVersions: editor, create: editor, update: editor, delete: deny },
  fields: [
    { name: 'title', type: 'text', required: true, index: true, label: 'Title' },
    { name: 'format', type: 'select', required: true, label: 'Format',
      options: [option('article', 'Article'), option('pdf', 'PDF'), option('video', 'Video'), option('audio', 'Audio'), option('slides', 'Slides'), option('document', 'Document')] },
    { name: 'description', type: 'textarea', label: 'Summary', admin: { description: 'Two or three sentences readers see in search results. AI tagging proposes one you can edit in Review.' } },
    { name: 'kind', type: 'select', required: true, defaultValue: 'resource', label: 'Type', options: CONTENT_KINDS.map(k => ({ ...k })),
      admin: { description: 'How-to articles are instructional pages written here. They appear in their section like any other item, with a How-to badge and filter.' } },
    { type: 'collapsible', label: 'Where it appears', admin: { description: 'Where readers find this item in the Library menu. Tags help people find content; they never grant access.' }, fields: [
      { name: 'section', type: 'select', label: 'Section', options: SECTION_OPTIONS, index: true },
      { name: 'topics', type: 'select', hasMany: true, label: 'Topics', options: TOPIC_OPTIONS,
        admin: { description: 'Pick topics from the item\'s section. An item can sit in more than one topic.' } },
      { name: 'pages', type: 'select', hasMany: true, label: 'Pages you know', options: PAGE_OPTIONS,
        admin: { description: 'Familiar pages from the old resource site (for example Commission Schedules) that should list this item.' } },
    ] },
    { name: 'vimeoId', type: 'text', label: 'Vimeo video ID', validate: (value: unknown) => !value || /^\d+$/.test(String(value)) || 'Use the number at the end of the Vimeo link, e.g. 123456789.',
      admin: { condition: data => ['video', 'audio'].includes(data?.format), description: 'The number from the Vimeo link. Captions are used when available; otherwise the audio is transcribed.' } },
    { name: 'processing', type: 'ui', label: 'Processing', admin: { components: { Field: '/components/ContentProcessing' } } },
    // Thumbnail storage key stays editor-only; the version (a content hash) is safe for readers and busts caches.
    { name: 'thumbnailVersion', type: 'text', label: 'Preview', access: { create: () => false, update: () => false },
      admin: { readOnly: true, condition: () => false, components: { Cell: '/components/ThumbnailCell' } } },
    { type: 'collapsible', label: 'Thumbnail (technical)', admin: { initCollapsed: true, condition: () => false }, fields: [
      { name: 'thumbnailKey', type: 'text', access: { read: editor, create: () => false, update: () => false } },
      { name: 'thumbnailSource', type: 'select', options: ['upload', 'vimeo', 'pdf', 'unavailable'], access: { create: () => false, update: () => false } },
      { name: 'thumbnailFor', type: 'text', access: { read: editor, create: () => false, update: () => false } },
    ] },
    { name: 'body', type: 'textarea', label: 'Reading text', admin: { description: 'Plain text shown to readers. Filled from the extracted file when you accept its suggestion in Review; editing it by hand clears citations until re-reviewed.' } },
    { name: 'acceptedTags', type: 'relationship', relationTo: 'taxonomy', hasMany: true, label: 'Tags', admin: { description: 'Confirmed tags from Tags & topics.' } },
    { name: 'coverImage', type: 'ui', label: 'Cover image', admin: { position: 'sidebar', components: { Field: '/components/CoverImage' } } },
    { name: 'publishChecklist', type: 'ui', label: 'Ready to publish?', admin: { position: 'sidebar', components: { Field: '/components/PublishChecklist' } } },
    { name: 'state', type: 'select', label: 'Status', defaultValue: 'intake', required: true, access: { create: admin, update: admin },
      options: [option('intake', 'Intake — new, not reviewed'), option('draft', 'Draft — reviewed, not published'), option('published', 'Published — visible to its audience'), option('archived', 'Archived — hidden')],
      admin: { position: 'sidebar', description: 'Only administrators change status. Editing a published item returns it to draft for re-approval.' } },
    { name: 'accessProfile', type: 'relationship', relationTo: 'access-profiles', label: 'Audience (access profile)', access: { create: admin, update: admin },
      admin: { position: 'sidebar', description: 'Who can see this item once published. Required to publish.' } },
    { name: 'availableAt', type: 'date', label: 'Available from', access: { create: admin, update: admin }, admin: { position: 'sidebar', description: 'Optional embargo.' } },
    { name: 'expiresAt', type: 'date', label: 'Expires', access: { create: admin, update: admin }, admin: { position: 'sidebar', description: 'Optional. Hidden from readers and AI after this date.' } },
    { type: 'collapsible', label: 'Review schedule', admin: { position: 'sidebar' }, fields: [
      { name: 'reviewWindow', type: 'select', label: 'Review every', defaultValue: 'annual', required: true, options: REVIEW_WINDOWS.map(w => ({ value: w.id, label: w.label })),
        admin: { description: 'When the review date passes, the item is hidden from readers, search and AI until someone renews it.' } },
      { name: 'reviewOn', type: 'date', label: 'Review on', admin: { condition: data => data?.reviewWindow === 'fixedDate', description: 'The date this item must be reviewed by.' } },
      { name: 'owner', type: 'relationship', relationTo: 'users', label: 'Owner', admin: { description: 'Who renews this item. Owners and administrators can renew.' } },
      { name: 'reviewDueAt', type: 'date', label: 'Next review due', index: true, access: { create: () => false, update: () => false },
        admin: { readOnly: true, description: 'Set automatically from the schedule and the last review.' } },
      { name: 'lastReviewedAt', type: 'date', label: 'Last reviewed', access: { create: () => false, update: () => false },
        admin: { readOnly: true, description: 'Publishing and renewing count as a review.' } },
    ] },
    { type: 'collapsible', label: 'Source and citations (technical)', admin: { initCollapsed: true, condition: (_data, _sibling, { user }) => isStaffUser(user) }, fields: [
      { name: 'sourceKey', type: 'text', unique: true, index: true, label: 'Source record', access: { create: admin, update: admin, read: editor },
        admin: { readOnly: true, description: 'Where this item came from, e.g. wordpress:dbr:post:1 or manual:42.' } },
      { name: 'sourceHash', type: 'text', label: 'Source version', access: { create: admin, update: admin, read: editor }, admin: { readOnly: true } },
      { name: 'evidenceVersion', type: 'text', required: true, defaultValue: 'unprocessed', label: 'Citation version', access: { create: admin, update: () => false }, admin: { readOnly: true } },
      { name: 'passages', type: 'array', label: 'Citable passages', access: { create: admin, update: () => false },
        admin: { readOnly: true, description: 'Installed from reviewed extraction. Used for citations in the reader and AI assistants.' }, fields: [
          { name: 'citationId', type: 'text', required: true }, { name: 'version', type: 'text', required: true },
          { name: 'text', type: 'textarea', required: true }, { name: 'locator', type: 'text', required: true },
        ] },
    ] },
  ],
  hooks: { beforeChange: [({ data, originalDoc, context, operation }) => {
    // Manually created items get a source identity from their Vimeo ID so the worker can process them.
    // Imported items keep their WordPress identity; an uploaded file replaces a manual identity (see server/processing).
    const vimeo = data.vimeoId ?? originalDoc?.vimeoId
    const sourceKey = data.sourceKey ?? originalDoc?.sourceKey
    const manual = !sourceKey || String(sourceKey).startsWith('manual:')
    const currentHash = data.sourceHash ?? originalDoc?.sourceHash
    if (manual && vimeo && /^\d+$/.test(String(vimeo)) && (!currentHash || currentHash === vimeoSourceHash(originalDoc?.vimeoId))) {
      data.sourceKey = sourceKey ?? `manual:${randomUUID()}`
      data.sourceHash = vimeoSourceHash(vimeo)
    }
    if (operation === 'create') {
      // Payload supplies {} for a normal create and the source record for a
      // duplicate. Never compare defaulted create fields with an empty record.
      if (originalDoc?.id !== undefined) throw new Error('Content duplication requires a separate reviewed source')
      data.evidenceVersion = 'unprocessed'
      data.passages = []
      if (data.state === 'published') data.state = 'draft'
      applyReviewSchedule(data, undefined, { renewal: false })
      return data
    }
    const textChanged = originalDoc && ['title', 'description', 'body', 'vimeoId', 'format', 'sourceKey', 'sourceHash'].some(key => key in data && data[key] !== originalDoc[key])
    const evidenceChanged = originalDoc && ['passages', 'evidenceVersion'].some(key => key in data && JSON.stringify(data[key]) !== JSON.stringify(originalDoc[key]))
    if (evidenceChanged && !context?.reviewedEvidence) throw new Error('Evidence changes require the reviewed extraction workflow')
    if (textChanged && !context?.reviewedEvidence) { data.evidenceVersion = 'unprocessed'; data.passages = [] }
    if (originalDoc?.state === 'published' && data.state !== 'archived') {
      // Edits invalidate evidence/publication. Reapproval is a separate admin operation.
      if (textChanged || evidenceChanged) {
        data.state = 'draft'
        if (!context?.reviewedEvidence) data.evidenceVersion = 'unprocessed'
      }
    }
    if (data.state === 'published' && !(data.accessProfile ?? originalDoc?.accessProfile)) throw new Error('Publication requires an access profile')
    applyReviewSchedule(data, originalDoc, { renewal: Boolean(context?.reviewRenewal) })
    return data
  }] },
}

export const Assets: CollectionConfig = {
  slug: 'assets', labels: { singular: 'File', plural: 'Files' }, access: { ...locked, create: deny, read: editor },
  admin: { group: 'Library', useAsTitle: 'mimeType', defaultColumns: ['content', 'mimeType', 'createdAt'],
    description: 'Original files attached to library items, stored privately and never changed once uploaded. Upload files from a library item\'s Processing panel; this list is for reference.' },
  // Metadata only; raw storage keys never reach reader APIs. No public upload route.
  fields: [{ name: 'content', type: 'relationship', relationTo: 'content', required: true, label: 'Library item' },
    { name: 'mimeType', type: 'text', required: true, label: 'File type' },
    { name: 'objectKey', type: 'text', required: true, label: 'Storage location', admin: { readOnly: true } },
    { name: 'sha256', type: 'text', required: true, label: 'Fingerprint (SHA-256)', admin: { readOnly: true } },
    { name: 'version', type: 'text', required: true, label: 'Source version', admin: { readOnly: true } }],
}

export const Suggestions: CollectionConfig = {
  slug: 'suggestions', labels: { singular: 'AI suggestion', plural: 'AI suggestions' },
  access: { create: deny, update: deny, read: editor, delete: deny },
  admin: { group: 'Review & automation', useAsTitle: 'model', defaultColumns: ['content', 'decision', 'model', 'createdAt'],
    description: 'Summaries and tags proposed by AI tagging. Nothing here changes content until an editor accepts it. Open Review (/review) to read the evidence, edit, and accept or reject each one.' },
  fields: [{ name: 'content', type: 'relationship', relationTo: 'content', required: true, label: 'Library item' },
    { name: 'decision', type: 'select', label: 'Decision', options: [option('pending', 'Waiting for review'), option('accepted', 'Accepted'), option('rejected', 'Rejected')], defaultValue: 'pending' },
    { name: 'model', type: 'text', required: true, label: 'AI model' },
    { name: 'reviewNote', type: 'textarea', label: 'Reviewer note' },
    { name: 'reviewedBy', type: 'relationship', relationTo: 'users', label: 'Reviewed by' }, { name: 'reviewedAt', type: 'date', label: 'Reviewed at' },
    { type: 'collapsible', label: 'Technical details', admin: { initCollapsed: true }, fields: [
      { name: 'jobKey', type: 'text', unique: true, label: 'Job key' },
      { name: 'sourceVersion', type: 'text', required: true, label: 'Source version' },
      { name: 'proposal', type: 'json', required: true, label: 'Raw proposal', access: { create: admin, update: admin } },
      { name: 'reviewAttempt', type: 'text', label: 'Review attempt' },
    ] }],
}

export const Jobs: CollectionConfig = {
  slug: 'processing-jobs', labels: { singular: 'Processing job', plural: 'Processing jobs' },
  access: { create: deny, update: deny, delete: deny, read: editor },
  admin: { group: 'Review & automation', useAsTitle: 'stage', defaultColumns: ['content', 'stage', 'state', 'errorCode', 'updatedAt'],
    description: 'The automatic work queue: text extraction, captions, transcription, and AI tagging. Jobs are created when files are uploaded or a Vimeo ID is set, and run in the background. Failures and retries are managed on the Automation status page.' },
  fields: [
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, label: 'Library item' },
    { name: 'stage', type: 'select', required: true, label: 'Step', options: [option('extract', 'Text extraction'), option('transcribe', 'Transcription'), option('classify', 'AI tagging'), option('index', 'Search indexing')] },
    { name: 'state', type: 'select', defaultValue: 'queued', label: 'Status', options: [option('queued', 'Waiting'), option('running', 'Running'), option('succeeded', 'Done'), option('failed', 'Failed')] },
    { name: 'errorCode', type: 'text', label: 'Failure reason' },
    { name: 'attempts', type: 'number', defaultValue: 0, label: 'Attempts' },
    { type: 'collapsible', label: 'Technical details', admin: { initCollapsed: true }, fields: [
      { name: 'idempotencyKey', type: 'text', unique: true, required: true, label: 'Job key' },
      { name: 'sourceVersion', type: 'text', required: true, label: 'Source version' },
      { name: 'input', type: 'json', label: 'Input' }, { name: 'result', type: 'json', label: 'Result' },
      { name: 'processorVersion', type: 'text', label: 'Processor version' }, { name: 'leaseToken', type: 'text', label: 'Lease token' },
      { name: 'leaseUntil', type: 'date', label: 'Lease until' }, { name: 'nextRunAt', type: 'date', label: 'Next run' },
      { name: 'deadlineAt', type: 'date', label: 'Deadline' },
    ] },
  ],
}
