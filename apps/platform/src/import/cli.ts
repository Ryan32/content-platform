import { loadPackage, ImportError, assertImport } from './package'
import { importPackage } from './adapter'

// payload run forwards positional arguments. No credentials or source data in CLI
// arguments; DB and secrets come from the dedicated operations-task environment.
let destroy: (() => Promise<void>) | undefined
try {
  const [mode, directory, expectedTarget, expectedPackageId, ...extra] = process.argv.slice(2)
  assertImport(['check', 'preview', 'apply', 'attach'].includes(mode) && directory && !extra.length, 'usage_check_preview_or_apply_package_directory_target_package_id')
  const p = await loadPackage(directory)
  if (mode === 'check') {
    assertImport(!expectedTarget && !expectedPackageId, 'unexpected_check_arguments')
    console.log(JSON.stringify({ status: 'validated', packageId: p.packageId, records: p.content.length, relationships: p.relationships.length }))
  } else {
    assertImport(mode === 'preview' || mode === 'apply' || mode === 'attach', 'invalid_mode')
    assertImport(process.env.IMPORT_ENVIRONMENT === 'development', 'development_environment_required')
    assertImport(process.env.DATABASE_URI && process.env.PAYLOAD_SECRET, 'database_configuration_required')
    const db = new URL(process.env.DATABASE_URI)
    assertImport(['postgresql:', 'postgres:'].includes(db.protocol), 'postgres_required')
    assertImport(expectedTarget === `${db.hostname}${db.port ? ':' + db.port : ''}${db.pathname}`, 'database_target_mismatch')
    assertImport(expectedPackageId === p.packageId, 'expected_package_id_mismatch')
    const { getPayload } = await import('payload')
    const { default: config } = await import('../payload.config')
    const resolved = await config
    // Avoid underlying driver/validation errors echoing private payloads or URLs.
    // SanitizedConfig makes optional Pino options deeply required in its type;
    // the logger factory still accepts ordinary Pino options at runtime.
    resolved.logger = { options: { level: 'silent' } } as typeof resolved.logger
    const payload = await getPayload({ config: resolved })
    destroy = () => payload.destroy()
    if (mode === 'attach') {
      assertImport(process.env.CONTENT_BUCKET, 'content_bucket_required')
      const { attachFiles } = await import('./attach')
      const { payloadAttachDeps } = await import('./attach-store')
      const result = await attachFiles(p, payloadAttachDeps(payload, process.env.CONTENT_BUCKET))
      console.log(JSON.stringify({ status: 'attached', ...result }))
    } else {
      const { payloadStore } = await import('./payload-store')
      const result = await importPackage(p, payloadStore(payload), mode)
      console.log(JSON.stringify({ status: mode === 'apply' ? 'committed' : 'preview',
        packageId: result.packageId, alreadyCompleted: result.alreadyCompleted, counts: result.counts }))
    }
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: error instanceof ImportError ? error.code : 'import_failed',
    message: 'No success asserted. Resolve the error and rerun the same package; do not expose raw driver errors or source data.' }))
  process.exitCode = 1
} finally {
  try { await destroy?.() } catch { process.exitCode = 1 }
}
// Payload's run wrapper exits 0 after returning; ensure failures retain their code.
if (process.exitCode) process.exit(process.exitCode)
