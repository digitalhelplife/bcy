import { main } from './server'
import { hashPassword } from './admin'

// `node bencao-auth.mjs hash-password` reads a password from stdin and prints its scrypt hash
// (for AUTH_ADMIN_PASSWORD_HASH). The password itself is never printed or logged.
if (process.argv[2] === 'hash-password') {
  let buf = ''
  process.stdin.setEncoding('utf8').on('data', c => { buf += c }).on('end', () => {
    const pw = buf.replace(/\r?\n$/, '')
    if (pw.length < 12) { console.error('password must be at least 12 characters'); process.exit(2) }
    console.log(hashPassword(pw))
  })
} else {
  main().catch(e => { console.error('bencao-auth failed to start:', (e as Error).message); process.exit(1) })
}
