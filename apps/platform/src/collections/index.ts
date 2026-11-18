import type { CollectionConfig, Field } from 'payload'
import { admin, deny, editor, readContent } from './access'
import { verifyBearer } from '../auth/verify'

const entitlements: Field = { name: 'entitlements', type: 'array', fields: [{ name: 'value', type: 'text', required: true }] }
const locked = { create: admin, read: admin, update: admin, delete: deny }

export const Users: CollectionConfig = {
  slug: 'users', admin: { useAsTitle: 'email' },
  auth: { disableLocalStrategy: true, strategies: [{ name: 'auth0', authenticate: async ({ headers, payload }) => {
    const identity = await verifyBearer(headers.get('authorization'))
    if (!identity) return { user: null }
    // Identity provisioning is explicitly separate; never auto-grant on first login.
    const result = await payload.find({ collection: 'users', overrideAccess: true, depth: 0, limit: 1,
      where: { and: [{ subject: { equals: identity.subject } }, { issuer: { equals: identity.issuer } }, { active: { equals: true } }] } })
    return { user: result.docs[0] ? { ...result.docs[0], collection: 'users' as const } : null }
  } }] },
  access: locked,
  fields: [
    { name: 'subject', type: 'text', required: true, index: true },
    { name: 'issuer', type: 'text', required: true },
    { name: 'active', type: 'checkbox', defaultValue: false },
    { name: 'roles', type: 'select', hasMany: true, options: ['reader', 'editor', 'admin'], defaultValue: ['reader'] },
    { name: 'memberships', type: 'array', fields: [{ name: 'scope', type: 'text', required: true }, entitlements] },
  ], indexes: [{ fields: ['issuer', 'subject'], unique: true }],
}

export const AccessProfiles: CollectionConfig = {
  slug: 'access-profiles', access: locked, admin: { useAsTitle: 'name' }, versions: { maxPerDoc: 50 },
  fields: [{ name: 'name', type: 'text', required: true }, { name: 'active', type: 'checkbox', defaultValue: false },
    { name: 'grants', type: 'array', fields: [
      { name: 'action', type: 'select', required: true, options: ['view', 'retrieve', 'download'] },
      { name: 'scope', type: 'text', required: true }, entitlements,
    ] }],
}

export const Taxonomy: CollectionConfig = {
  slug: 'taxonomy', access: { create: editor, update: editor, delete: deny, read: editor },
  admin: { useAsTitle: 'label' },
  fields: [{ name: 'key', type: 'text', required: true, unique: true },
    { name: 'label', type: 'text', required: true }, { name: 'definition', type: 'textarea' },
    { name: 'dimension', type: 'select', required: true, options: ['business-line', 'topic', 'audience', 'format', 'program', 'entity'] }],
}

export const Content: CollectionConfig = {
  slug: 'content', admin: { useAsTitle: 'title' }, versions: { maxPerDoc: 50 },
  access: { read: readContent, readVersions: editor, create: editor, update: editor, delete: deny },
  fields: [
    { name: 'title', type: 'text', required: true, index: true }, { name: 'description', type: 'textarea' },
    { name: 'body', type: 'textarea', admin: { description: 'Plain text in the first slice; no untrusted HTML rendering.' } },
    { name: 'format', type: 'select', required: true, options: ['article', 'pdf', 'video', 'audio', 'slides', 'document'] },
    { name: 'state', type: 'select', options: ['intake', 'draft', 'published', 'archived'], defaultValue: 'intake', required: true,
      access: { create: admin, update: admin } },
    { name: 'accessProfile', type: 'relationship', relationTo: 'access-profiles', access: { create: admin, update: admin } },
    { name: 'availableAt', type: 'date', access: { create: admin, update: admin } },
    { name: 'expiresAt', type: 'date', access: { create: admin, update: admin } },
    { name: 'acceptedTags', type: 'relationship', relationTo: 'taxonomy', hasMany: true },
    { name: 'sourceKey', type: 'text', unique: true, index: true, access: { create: admin, update: admin, read: editor } },
    { name: 'sourceHash', type: 'text', access: { create: admin, update: admin, read: editor } },
    { name: 'evidenceVersion', type: 'text', required: true, defaultValue: 'unprocessed', access: { create: admin, update: admin } },
    { name: 'passages', type: 'array', access: { create: admin, update: admin }, fields: [
      { name: 'citationId', type: 'text', required: true }, { name: 'version', type: 'text', required: true },
      { name: 'text', type: 'textarea', required: true }, { name: 'locator', type: 'text', required: true },
    ] },
    { name: 'vimeoId', type: 'text', validate: (value: unknown) => !value || /^\d+$/.test(String(value)) || 'Use a numeric Vimeo ID.' },
  ],
  hooks: { beforeChange: [({ data, originalDoc }) => {
    if (originalDoc?.state === 'published' && data.state !== 'archived') {
      // Edits invalidate evidence/publication. Reapproval is a separate admin operation.
      const evidenceFields = ['title', 'description', 'body', 'vimeoId', 'format']
      if (evidenceFields.some(key => key in data && data[key] !== originalDoc[key])) {
        data.state = 'draft'
        data.evidenceVersion = 'unprocessed'
      }
    }
    if (data.state === 'published' && !(data.accessProfile ?? originalDoc?.accessProfile)) throw new Error('Publication requires an access profile')
    return data
  }] },
}

export const Assets: CollectionConfig = {
  slug: 'assets', access: { ...locked, read: editor },
  // Metadata only; raw storage keys never reach reader APIs. No public upload route.
  fields: [{ name: 'content', type: 'relationship', relationTo: 'content', required: true },
    { name: 'objectKey', type: 'text', required: true }, { name: 'sha256', type: 'text', required: true },
    { name: 'mimeType', type: 'text', required: true }, { name: 'version', type: 'text', required: true }],
}

export const Suggestions: CollectionConfig = {
  slug: 'suggestions', access: { create: admin, update: editor, read: editor, delete: deny },
  fields: [{ name: 'content', type: 'relationship', relationTo: 'content', required: true },
    { name: 'sourceVersion', type: 'text', required: true }, { name: 'model', type: 'text', required: true },
    { name: 'proposal', type: 'json', required: true, access: { create: admin, update: admin } },
    { name: 'decision', type: 'select', options: ['pending', 'accepted', 'rejected'], defaultValue: 'pending' },
    { name: 'reviewNote', type: 'textarea' }],
}

export const Jobs: CollectionConfig = {
  slug: 'processing-jobs', access: { ...locked, read: editor },
  fields: [{ name: 'idempotencyKey', type: 'text', unique: true, required: true },
    { name: 'content', type: 'relationship', relationTo: 'content', required: true },
    { name: 'sourceVersion', type: 'text', required: true },
    { name: 'stage', type: 'select', required: true, options: ['extract', 'transcribe', 'classify', 'index'] },
    { name: 'state', type: 'select', defaultValue: 'queued', options: ['queued', 'running', 'succeeded', 'failed'] },
    { name: 'attempts', type: 'number', defaultValue: 0 }, { name: 'errorCode', type: 'text' }],
}
