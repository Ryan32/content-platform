import type { CollectionConfig, Field } from 'payload'
import { admin, deny } from './access'

// Private immutable source/audit records. Only the local operations task writes
// with overrideAccess; neither REST, MCP nor ordinary admin CRUD can mutate them.
const access = { read: admin, create: deny, update: deny, delete: deny }
const group = 'WordPress import (technical)'
// Written only by the separate one-time WordPress migration and kept for provenance; not managed in the admin.
const key: Field = { name: 'key', type: 'text', required: true, unique: true, index: true }
const json = (name: string): Field => ({ name, type: 'json', required: true })
const content: Field = { name: 'content', type: 'relationship', relationTo: 'content', required: true }

export const ImportArtifacts: CollectionConfig = {
  slug: 'import-artifacts', access, labels: { singular: 'Imported asset reference', plural: 'Imported asset references' },
  admin: { useAsTitle: 'identity', group, hidden: true, description: 'Read-only record of each file, video, or taxonomy reference found in the WordPress export. Written only by the import tool; used to trace where content came from.' },
  fields: [key, { name: 'identity', type: 'text', required: true, index: true },
    { name: 'kind', type: 'select', required: true, options: ['blob', 'vimeo', 'taxonomy', 'attachment', 'reference'] }, json('data')],
}
export const SourceSnapshots: CollectionConfig = {
  slug: 'source-snapshots', access, labels: { singular: 'WordPress snapshot', plural: 'WordPress snapshots' },
  admin: { useAsTitle: 'sourceKey', group, hidden: true, description: 'Read-only copy of each WordPress post exactly as imported, kept separate from the edited library item so the original is never lost.' },
  fields: [key, content, { name: 'sourceKey', type: 'text', required: true, index: true },
    { name: 'sourceHash', type: 'text', required: true }, { name: 'packageId', type: 'text', required: true },
    { name: 'disposition', type: 'select', required: true, options: ['initial-intake', 'staged-for-review'] },
    json('snapshot'), json('proposedContent'), json('issues')],
}
export const SourceRelations: CollectionConfig = {
  slug: 'source-relations', access, labels: { singular: 'WordPress link', plural: 'WordPress links' },
  admin: { group, hidden: true, description: 'Read-only links between imported posts and their files, videos, and related posts, preserved from WordPress.' },
  fields: [key, content, { name: 'snapshot', type: 'relationship', relationTo: 'source-snapshots', required: true },
    { name: 'artifact', type: 'relationship', relationTo: 'import-artifacts' },
    { name: 'targetSourceKey', type: 'text', required: true, index: true },
    { name: 'kind', type: 'text', required: true }, { name: 'status', type: 'text', required: true }, json('edge')],
}
export const ImportReviews: CollectionConfig = {
  slug: 'import-reviews', access, labels: { singular: 'Held import', plural: 'Held imports' },
  admin: { group, hidden: true, description: 'WordPress posts the import held back because their source permissions could not be confirmed. They stay restricted until the source owner decides.' },
  fields: [key, content, { name: 'packageId', type: 'text', required: true },
    { name: 'reason', type: 'select', required: true, options: ['source-ineligible'] }, json('sourceEvidence')],
}
export const ImportRuns: CollectionConfig = {
  slug: 'import-runs', access, labels: { singular: 'Import run', plural: 'Import runs' },
  admin: { useAsTitle: 'packageId', group, hidden: true, description: 'Receipt for each completed WordPress import package, with counts and provenance. Re-running the same package changes nothing.' },
  fields: [key, { name: 'packageId', type: 'text', required: true, unique: true },
    { name: 'state', type: 'select', required: true, options: ['completed'] },
    json('provenance'), json('result')],
}
