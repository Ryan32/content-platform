import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig, type Access } from 'payload'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const administratorsOnly: Access = ({ req }) => Boolean(req.user)

export default buildConfig({
  admin: {
    user: 'users',
    importMap: { baseDir: here },
  },
  collections: [
    {
      slug: 'users',
      auth: true,
      admin: { useAsTitle: 'email' },
      access: {
        create: administratorsOnly,
        read: administratorsOnly,
        update: administratorsOnly,
        delete: administratorsOnly,
      },
      fields: [],
    },
  ],
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL },
    migrationDir: path.join(here, 'migrations'),
    push: false,
  }),
  graphQL: { disable: true },
  secret: process.env.PAYLOAD_SECRET ?? '',
  sharp,
})
