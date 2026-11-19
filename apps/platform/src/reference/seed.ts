import type { Payload } from 'payload'
import { z } from 'zod'
import { AUDIENCE_SEED, PROFILE_ACTIONS, PROFILE_SEED } from '../domain/access-seed'
import { LINES } from '../domain/navigation'

/** Carriers and tags built from the WordPress backup by scripts/build_reference_seed.py (reviewed, then applied). */
export const wordpressReference = z.object({
  schema: z.literal('ae-library-reference/1'),
  carriers: z.array(z.object({ name: z.string().trim().min(1).max(120), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    lines: z.array(z.enum(LINES.map(l => l.value) as [string, ...string[]])).max(6) }).strict()).max(500),
  tags: z.array(z.object({ key: z.string().regex(/^[a-z-]+:[a-z0-9][a-z0-9-]{0,98}$/), label: z.string().trim().min(2).max(80),
    dimension: z.enum(['topic', 'business-line', 'audience', 'program', 'entity']), definition: z.string().trim().min(1).max(400) }).strict()).max(2000),
}).strict()

/**
 * Creates what is missing; never edits or deletes what exists (people may have refined it). Audiences before profiles,
 * because profile rules may only name active audiences. Idempotent: a rerun reports zero created.
 */
export async function seedReference(payload: Payload, reference?: z.infer<typeof wordpressReference>) {
  const created = { audiences: 0, profiles: 0, carriers: 0, tags: 0 }
  const exists = async (collection: 'audiences' | 'access-profiles' | 'carriers' | 'taxonomy', field: string, value: string) =>
    (await payload.count({ collection, overrideAccess: true, where: { [field]: { equals: value } } })).totalDocs > 0
  for (const a of AUDIENCE_SEED) {
    if (await exists('audiences', 'key', a.key)) continue
    await payload.create({ collection: 'audiences', overrideAccess: true, data: { ...a, active: true } as never }); created.audiences++
  }
  for (const p of PROFILE_SEED) {
    if (await exists('access-profiles', 'name', p.name)) continue
    await payload.create({ collection: 'access-profiles', overrideAccess: true, data: { name: p.name, active: true,
      grants: p.scopes.flatMap(scope => PROFILE_ACTIONS.map(action => ({ action, scope, entitlements: [] }))) } as never }); created.profiles++
  }
  for (const c of reference?.carriers ?? []) {
    if (await exists('carriers', 'slug', c.slug)) continue
    await payload.create({ collection: 'carriers', overrideAccess: true, data: { name: c.name, slug: c.slug, lines: c.lines } as never }); created.carriers++
  }
  for (const t of reference?.tags ?? []) {
    if (await exists('taxonomy', 'key', t.key)) continue
    await payload.create({ collection: 'taxonomy', overrideAccess: true, data: t as never }); created.tags++
  }
  return created
}
