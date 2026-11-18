import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Users, AccessProfiles, Taxonomy, Content, Assets, Suggestions, Jobs } from './collections'
import { ImportArtifacts, SourceSnapshots, SourceRelations, ImportReviews, ImportRuns } from './collections/imports'

const baseDir = path.dirname(fileURLToPath(import.meta.url))
export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || '',
  admin: { user: 'users', importMap: { baseDir } },
  collections: [Users, AccessProfiles, Taxonomy, Content, Assets, Suggestions, Jobs, ImportArtifacts, SourceSnapshots, SourceRelations, ImportReviews, ImportRuns],
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
