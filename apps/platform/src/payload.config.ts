import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Users, Audiences, AccessProfiles, Taxonomy, Content, Assets, Suggestions, Jobs, Carriers, Kits, Saved, Feedback } from './collections'
import { ImportArtifacts, SourceSnapshots, SourceRelations, ImportReviews, ImportRuns } from './collections/imports'
import { AutomationSettings } from './globals/AutomationSettings'

const baseDir = path.dirname(fileURLToPath(import.meta.url))
export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || '',
  admin: { user: 'users', importMap: { baseDir, importMapFile: path.join(baseDir, 'app/(payload)/admin/importMap.ts') },
    meta: { titleSuffix: ' · AE Library admin' },
    components: { beforeLogin: ['/components/AdminSignIn'],
      afterNavLinks: ['/components/AdminNavLinks'], logout: { Button: '/components/AdminUserMenu' },
      views: {
        dashboard: { Component: '/components/manage/ManageHome' },
        library: { Component: '/components/manage/LibraryList', path: '/library', exact: true, meta: { title: 'Content' } },
        addContent: { Component: '/components/manage/AddContent', path: '/add-content', exact: true, meta: { title: 'Add content' } },
        reviewPolicies: { Component: '/components/manage/ReviewPolicies', path: '/review-policies', exact: true, meta: { title: 'Review policies' } },
        automation: { Component: '/components/AutomationStatus', path: '/automation', exact: true, meta: { title: 'Automation status' } },
        review: { Component: '/components/ReviewView', path: '/review', meta: { title: 'Review AI suggestions' } },
        bulkAdd: { Component: '/components/BulkAddView', path: '/bulk-add', exact: true, meta: { title: 'Add many files' } },
        dueForReview: { Component: '/components/DueForReview', path: '/due-for-review', exact: true, meta: { title: 'Due for review' } },
      } } },
  // Order sets the admin menu: Library first, then review and automation, then people and access.
  collections: [Content, Carriers, Kits, Taxonomy, Assets, Suggestions, Jobs, Feedback, Saved, Users, Audiences, AccessProfiles, ImportArtifacts, SourceSnapshots, SourceRelations, ImportReviews, ImportRuns],
  globals: [AutomationSettings],
  db: postgresAdapter({
    push: false,
    pool: {
      connectionString: process.env.DATABASE_URI,
      ssl: { rejectUnauthorized: true, ...(process.env.DATABASE_CA_FILE ? { ca: readFileSync(process.env.DATABASE_CA_FILE, 'utf8') } : {}) },
    },
    migrationDir: path.join(baseDir, 'migrations'),
  }),
  typescript: { outputFile: path.join(baseDir, 'payload-types.ts') },
  graphQL: { disable: true },
})
