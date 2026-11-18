import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('..', import.meta.url))
const next = join(app, '.next')
const standalone = join(next, 'standalone')

function requireCheck(condition, message) {
  if (!condition) throw new Error(message)
}

function requireFile(file) {
  const stat = statSync(file, { throwIfNoEntry: false })
  requireCheck(stat?.isFile() && stat.size > 0, `Missing or empty file ${file}`)
  return file
}

function read(file) {
  return readFileSync(requireFile(file), 'utf8')
}

function readJson(file) {
  const source = read(file)
  try {
    return JSON.parse(source)
  } catch {
    throw new Error(`Invalid JSON in ${file}`)
  }
}

function checkRoutes() {
  requireFile(join(standalone, 'server.js'))
  const buildId = read(join(next, 'BUILD_ID')).trim()
  const runtime = join(standalone, '.next')
  requireCheck(buildId === read(join(runtime, 'BUILD_ID')).trim(), 'Standalone server build does not match .next/BUILD_ID')
  const routes = readJson(join(next, 'app-path-routes-manifest.json'))
  const compiled = readJson(join(next, 'server', 'app-paths-manifest.json'))
  const runtimeRoutes = readJson(join(runtime, 'app-path-routes-manifest.json'))
  const runtimeCompiled = readJson(join(runtime, 'server', 'app-paths-manifest.json'))
  const required = [
    '/', '/health', '/resources/[id]', '/files/[id]', '/review', '/review/[id]', '/review/[id]/decision',
    '/admin/[[...segments]]', '/api/[...slug]',
    '/auth/login', '/auth/callback', '/auth/logout', '/mcp', '/.well-known/oauth-protected-resource/mcp',
  ]
  for (const path of required) {
    const entry = Object.keys(routes).find(key => routes[key] === path)
    requireCheck(entry && compiled[entry] && runtimeRoutes[entry] === path && runtimeCompiled[entry] === compiled[entry],
      `Required route missing from the production or standalone manifest: ${path}`)
    requireFile(join(next, 'server', compiled[entry]))
    requireFile(join(runtime, 'server', compiled[entry]))
  }

  const build = readJson(join(next, 'build-manifest.json'))
  requireCheck(build.rootMainFiles?.length > 0, 'Missing Next.js client runtime assets')
  for (const path of build.rootMainFiles) requireFile(join(next, path))
  return Object.keys(routes).find(key => routes[key] === '/admin/[[...segments]]')
}

function checkAdminCss(entry) {
  const manifestFile = `app${entry}_client-reference-manifest.js`
  const source = read(join(next, 'server', manifestFile))
  const runtimeSource = read(join(standalone, '.next', 'server', manifestFile))
  requireCheck(source === runtimeSource, 'Standalone admin client manifest differs from the production build')
  // Next emits the client-reference manifest as a JSON assignment. Inspect it without executing JavaScript.
  const prefix = `globalThis.__RSC_MANIFEST[${JSON.stringify(entry)}] = `
  const assignment = source.split('\n').find(line => line.startsWith(prefix))
  requireCheck(assignment, 'Cannot locate the admin route client-reference manifest assignment')
  const manifest = JSON.parse(assignment.slice(prefix.length).trim().replace(/;$/, ''))
  const adminAssets = Object.entries(manifest.entryCSSFiles ?? {})
    .filter(([name]) => name.endsWith('/app/(payload)/layout') || name.endsWith(`/app${entry}`))
    .flatMap(([, assets]) => assets)
  const css = new Set(adminAssets.filter(asset => !asset.inlined).map(asset => asset.path))
  requireCheck(css.size > 0, 'Admin route has no emitted CSS assets')
  const styles = [...css].map(path => {
    requireCheck(/^static\/.+\.css$/.test(path), 'Admin route contains an unexpected CSS asset path')
    return read(join(next, path))
  }).join('\n')
  requireCheck(/--base-px\s*:/.test(styles) && /--theme-elevation-100\s*:/.test(styles) && styles.includes('.template-default'),
    'Payload theme definitions and admin layout styles are missing from the admin route CSS')
  return css.size
}

function checkMigrations() {
  const directory = join(app, 'src', 'migrations')
  const index = read(join(directory, 'index.ts'))
  const modules = new Map([...index.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]\.\/(\w+)['"]/g)]
    .map(([, binding, name]) => [binding, name]))
  const entries = [...index.matchAll(/\{\s*up:\s*(\w+)\.up,\s*down:\s*(\w+)\.down,\s*name:\s*['"](\w+)['"]\s*,?\s*\}/g)]
  requireCheck(entries.length > 0 && entries.length === modules.size, 'Migration index must register each imported migration')
  const indexed = entries.map(([, up, down, name]) => {
    requireCheck(up === down && modules.get(up) === name, `Migration index bindings do not match ${name}`)
    requireFile(join(directory, `${name}.ts`))
    return `${name}.ts`
  })
  const files = readdirSync(directory).filter(name => /^\d.*\.ts$/.test(name)).sort()
  requireCheck(JSON.stringify(indexed) === JSON.stringify(files), 'Migration index must list every migration once in filename order')
  return indexed.length
}

try {
  const admin = checkRoutes()
  const css = checkAdminCss(admin)
  const migrations = checkMigrations()
  console.log(`Production and standalone routes verified, including ${css} admin CSS assets and ${migrations} indexed migrations.`)
} catch (error) {
  console.error(`Production build check failed. ${error.message}`)
  process.exitCode = 1
}
