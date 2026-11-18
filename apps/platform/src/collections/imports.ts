import type { CollectionConfig, Field } from 'payload'
import { admin, deny } from './access'

// Private immutable source/audit records. Only the local operations task writes
// with overrideAccess; neither REST, MCP nor ordinary admin CRUD can mutate them.
const access = { read: admin, create: deny, update: deny, delete: deny }
const key: Field = { name: 'key', type: 'text', required: true, unique: true, index: true }
const json = (name: string): Field => ({ name, type: 'json', required: true })
const content: Field = { name: 'content', type: 'relationship', relationTo: 'content', required: true }

export const ImportArtifacts: CollectionConfig = {
  slug: 'import-artifacts', access, admin: { useAsTitle: 'identity', group: 'Source imports' },
  fields: [key, { name: 'identity', type: 'text', required: true, index: true },
    { name: 'kind', type: 'select', required: true, options: ['blob', 'vimeo', 'taxonomy', 'attachment', 'reference'] }, json('data')],
}
export const SourceSnapshots: CollectionConfig = {
  slug: 'source-snapshots', access, admin: { useAsTitle: 'sourceKey', group: 'Source imports' },
  fields: [key, content, { name: 'sourceKey', type: 'text', required: true, index: true },
    { name: 'sourceHash', type: 'text', required: true }, { name: 'packageId', type: 'text', required: true },
    { name: 'disposition', type: 'select', required: true, options: ['initial-intake', 'staged-for-review'] },
    json('snapshot'), json('proposedContent'), json('issues')],
}
export const SourceRelations: CollectionConfig = {
  slug: 'source-relations', access, admin: { group: 'Source imports' },
  fields: [key, content, { name: 'snapshot', type: 'relationship', relationTo: 'source-snapshots', required: true },
    { name: 'artifact', type: 'relationship', relationTo: 'import-artifacts' },
    { name: 'targetSourceKey', type: 'text', required: true, index: true },
    { name: 'kind', type: 'text', required: true }, { name: 'status', type: 'text', required: true }, json('edge')],
}
export const ImportReviews: CollectionConfig = {
  slug: 'import-reviews', access, admin: { group: 'Source imports' },
  fields: [key, content, { name: 'packageId', type: 'text', required: true },
    { name: 'reason', type: 'select', required: true, options: ['source-ineligible'] }, json('sourceEvidence')],
}
export const ImportRuns: CollectionConfig = {
  slug: 'import-runs', access, admin: { useAsTitle: 'packageId', group: 'Source imports' },
  fields: [key, { name: 'packageId', type: 'text', required: true, unique: true },
    { name: 'state', type: 'select', required: true, options: ['completed'] },
    json('provenance'), json('result')],
}
