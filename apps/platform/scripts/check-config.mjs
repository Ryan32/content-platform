const problems = []
const required = [
  'DATABASE_URI', 'PAYLOAD_SECRET', 'PLATFORM_ORIGIN', 'AUTH0_ISSUER', 'AUTH0_AUDIENCE',
  'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH_SESSION_SECRET',
]

const values = Object.fromEntries(required.map(name => [name, process.env[name]]))
for (const [name, value] of Object.entries(values)) {
  if (!value?.trim()) problems.push(`${name} is required`)
  else if (value !== value.trim()) problems.push(`${name} has leading or trailing whitespace`)
}
for (const name of ['PAYLOAD_SECRET', 'AUTH_SESSION_SECRET']) {
  if (values[name]?.trim() && values[name].length < 32) problems.push(`${name} must be at least 32 characters`)
}

if (values.DATABASE_URI?.trim()) {
  const database = URL.parse(values.DATABASE_URI)
  if (!database || !['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || database.pathname.length < 2) {
    problems.push('DATABASE_URI must be a PostgreSQL connection URI with a host and database name')
  }
}

if (values.AUTH0_ISSUER?.trim()) {
  const issuer = URL.parse(values.AUTH0_ISSUER)
  if (!issuer || issuer.protocol !== 'https:' || values.AUTH0_ISSUER !== `${issuer.origin}/`) {
    problems.push('AUTH0_ISSUER must be the exact HTTPS Auth0 issuer with a trailing slash')
  }
}

if (values.PLATFORM_ORIGIN?.trim()) {
  const origin = URL.parse(values.PLATFORM_ORIGIN)
  const loopback = origin?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if (!origin || (origin.protocol !== 'https:' && !loopback) || ![origin.origin, `${origin.origin}/`].includes(values.PLATFORM_ORIGIN)) {
    problems.push('PLATFORM_ORIGIN must be an HTTPS origin or an HTTP loopback origin')
  } else if (values.AUTH0_AUDIENCE?.trim() && values.AUTH0_AUDIENCE !== new URL('/mcp', origin).href) {
    problems.push('AUTH0_AUDIENCE must exactly match the platform MCP resource URL')
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem)
  process.exitCode = 1
} else {
  console.log('Runtime configuration format verified using the current environment.')
}
