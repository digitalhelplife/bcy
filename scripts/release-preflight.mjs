#!/usr/bin/env node
// Production-release preflight. This is intentionally read-only: it never approves content and never
// invents legal/identity/provider values. It prints every blocker and exits 1 until a human supplies them.
//
// Usage: node scripts/release-preflight.mjs [--json]
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const contentDir = join(root, 'content')
const json = Object.fromEntries(readdirSync(contentDir).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(join(contentDir, f), 'utf8'))]))
const blockers = []
const warnings = []
const add = (code, msg) => blockers.push({ code, msg })
const warn = (code, msg) => warnings.push({ code, msg })

function envFromFiles(key) {
  if (process.env[key] !== undefined) return process.env[key]
  for (const f of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    const p = join(root, f); if (!existsSync(p)) continue
    const m = readFileSync(p, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

// 1. Every reviewStatus entry must be signed off with reviewer/date/source.
const review = []
function walk(o) {
  if (Array.isArray(o)) { for (const v of o) walk(v); return }
  if (!o || typeof o !== 'object') return
  if ('reviewStatus' in o) review.push(o)
  for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v)
}
for (const v of Object.values(json)) walk(v)
const pending = review.filter(o => o.reviewStatus !== 'approved')
if (pending.length) add('CONTENT_REVIEW', `${pending.length}/${review.length} content entries are not approved; run \`pnpm review:packet\` and have a named reviewer sign each one`)
for (const o of review.filter(o => o.reviewStatus === 'approved')) {
  if (!o.reviewer || !o.reviewedAt || !(Array.isArray(o.sourceRefs) && o.sourceRefs.length)) add('CONTENT_SIGNOFF', `approved entry ${o.plantId || o.sceneId || o.termId || o.id || '?'} lacks reviewer/reviewedAt/sourceRefs`)
}

// 2. Legal/publication fields.
const comp = json['compliance.json']
for (const k of ['copyrightOwner', 'publishingServiceUnit', 'approvalNo', 'publicationNo']) {
  if (!comp?.publicationInfo?.[k]) add('PUBLICATION', `compliance.publicationInfo.${k} is empty`)
}
if (comp?.ageRating?.assessmentStatus !== 'approved') add('AGE_RATING', `compliance.ageRating.assessmentStatus is ${comp?.ageRating?.assessmentStatus ?? 'missing'} (must be approved)`)
if (!envFromFiles('VITE_ICP_NO')) add('ICP', 'VITE_ICP_NO is not configured')

// 3. Release stage/auth mode.
const stage = (envFromFiles('VITE_RELEASE_STAGE') || 'S0').toUpperCase()
if (stage !== 'S2' && stage !== 'S3') add('RELEASE_STAGE', `VITE_RELEASE_STAGE=${stage}; public launch requires S2 or S3`)
if ((envFromFiles('AUTH_MODE') || '') !== 'realname') add('AUTH_MODE', 'AUTH_MODE must be realname for public launch')

// 4. Identity providers. The generic HTTP adapters are acceptable gateways, but real credentials are mandatory.
const authEnv = envFromFiles('AUTH_ENV')
if (authEnv !== 'production') add('AUTH_ENV', `AUTH_ENV=${authEnv ?? 'unset'}; production requires AUTH_ENV=production`)
for (const [name, urlKey, tokenKey] of [
  ['SMS', 'AUTH_SMS_HTTP_URL', 'AUTH_SMS_HTTP_TOKEN'],
  ['REALNAME', 'AUTH_REALNAME_HTTP_URL', 'AUTH_REALNAME_HTTP_TOKEN'],
  ['BEHAVIOR', 'AUTH_BEHAVIOR_HTTP_URL', 'AUTH_BEHAVIOR_HTTP_TOKEN'],
]) {
  const provider = envFromFiles(`AUTH_${name}_PROVIDER`) || (name === 'BEHAVIOR' ? 'none' : 'mock')
  if (provider === 'mock' || provider === 'none' || !provider) add(`PROVIDER_${name}`, `${name} provider is ${provider}; production refuses mock/none`)
  if (provider === 'http' && !envFromFiles(urlKey)) add(`PROVIDER_${name}_URL`, `${urlKey} is not configured`)
  if (provider === 'http' && !envFromFiles(tokenKey)) warn(`PROVIDER_${name}_TOKEN`, `${tokenKey} is empty; confirm the gateway does not need a bearer token`)
}
// The official NPPA protocol/credentials are only available after onboarding; require an explicit operator attestation.
if (envFromFiles('AUTH_NPPA_OFFICIAL_CONFIRMED') !== '1') {
  add('NPPA_OFFICIAL', 'NPPA official onboarding is not confirmed (set AUTH_NPPA_OFFICIAL_CONFIRMED=1 only after official protocol/credentials are in place)')
}

// 5. Physical-device test is a human/operations checklist item, not something this script can prove.
warn('PHYSICAL_DEVICE', 'physical iPhone/iPad matrix is not verifiable by this script; record the device, OS and screenshots in the release checklist')

const report = { generatedAt: new Date().toISOString(), stage, authMode: envFromFiles('AUTH_MODE') ?? null, blockers, warnings, pass: blockers.length === 0 }
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`[preflight] stage=${stage} authMode=${report.authMode ?? 'unset'} reviews=${review.length - pending.length}/${review.length} approved`)
  for (const b of blockers) console.log(`  BLOCK ${b.code}: ${b.msg}`)
  for (const w of warnings) console.log(`  WARN  ${w.code}: ${w.msg}`)
  console.log(blockers.length ? `[preflight] BLOCKED: ${blockers.length} blocker(s)` : '[preflight] PASS')
}
process.exit(blockers.length ? 1 : 0)
