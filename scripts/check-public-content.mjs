import { execFileSync } from 'node:child_process'

// Scan the index that will be committed; never print a matched sensitive value.
const names = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const findings = []
if (process.argv.includes('--commit')) {
  for (const key of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    const identity = execFileSync('git', ['var', key], { encoding: 'utf8' })
    const email = identity.match(/<([^<>]+)>/)?.[1] ?? ''
    if (!email.endsWith('@users.noreply.github.com')) findings.push({ file: key, kind: 'use-github-noreply-email' })
  }
}
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|sk-[A-Za-z0-9_-]{20,}|ya29\.[\w.-]+|GOCSPX-[\w-]{10,}|xox[baprs]-[\w-]{15,})/,
  /\b\d{8,}-[\w-]+\.apps\.googleusercontent\.com/,
]
const privatePath = /(?:^|\/)(?:private|secrets|data|artifacts|tmp|\.ssh)\/|(?:^|\/)\.env$|\.env$|\.(?:pem|key|p12|pfx|bundle|db(?:-wal|-shm)?|sqlite(?:3|\.gz(?:\.json)?)?)$|(?:^|\/)(?:rclone\.conf|id_rsa[^/]*|id_ed25519[^/]*|client_secret[^/]*\.json|credentials[^/]*\.json|oauth[^/]*\.json)$/
const exampleEmail = /(?:@users\.noreply\.github\.com|@(?:[\w-]+\.)*example\.(?:com|org|net)|\.(?:test|example|invalid))$/i
const publicHosts = new Set([
  'github.com', 'raw.githubusercontent.com', 'registry.npmjs.org',
  'nodejs.org', 'eslint.org',
  'www.autodl.com', 'www.alipan.com', 'alibaba.github.io',
  'developers.cloudflare.com', 'dash.cloudflare.com', 'trycloudflare.com',
  'developers.google.com', 'www.googleapis.com', 'oauth2.googleapis.com', 'myaccount.google.com',
])
const exampleHost = /^(?:localhost|(?:[\w-]+\.)*example\.(?:com|org|net)|(?:[\w-]+\.)*(?:test|example|invalid))$/i
for (const name of names) {
  if (name !== '.env.example' && privatePath.test(name)) findings.push({ file: name, kind: 'private-file' })
  const bytes = execFileSync('git', ['show', `:${name}`], { maxBuffer: 16 * 1024 * 1024 })
  if (bytes.includes(0)) { findings.push({ file: name, kind: 'binary-file-needs-review' }); continue }
  const fixture = /^(?:apps\/server\/tests\/|e2e\/)/.test(name)
  for (const [offset, line] of bytes.toString('utf8').split(/\r?\n/).entries()) {
    const at = { file: name, line: offset + 1 }
    if (secretPatterns.some((pattern) => pattern.test(line))) findings.push({ ...at, kind: 'secret-or-oauth-identity' })
    if (/[A-Z]:[\\/]Users[\\/][^\s"'`]+/i.test(line)) findings.push({ ...at, kind: 'personal-path' })
    for (const match of line.matchAll(/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g)) {
      if (!['127.0.0.1', '0.0.0.0'].includes(match[0]) && !/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\./.test(match[0])) findings.push({ ...at, kind: 'non-example-ip' })
    }
    if (name !== 'pnpm-lock.yaml') {
      for (const match of line.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g)) {
        if (!exampleEmail.test(match[0])) findings.push({ ...at, kind: 'personal-email-or-ssh-host' })
      }
    }
    if (!fixture && /(?:https?|ssh|postgres|mysql|mongodb):\/\/[^\s/]+:[^\s/@]+@/i.test(line)) findings.push({ ...at, kind: 'credentials-in-url' })
    // Review hostnames without assuming any deployed hostname is public configuration.
    for (const match of line.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const host = match[1].toLowerCase()
      if (/^\d[\d.]*$/.test(host)) continue // Handled by IP validation above.
      if (!fixture && !publicHosts.has(host) && !exampleHost.test(host)) findings.push({ ...at, kind: 'deployment-host-needs-review' })
    }
  }
}
if (findings.length) {
  for (const finding of findings) process.stderr.write(`${finding.file}${finding.line ? `:${finding.line}` : ''}: ${finding.kind}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Privacy check passed for ${names.length} indexed files.\n`)
}
