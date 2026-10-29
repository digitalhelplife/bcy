#!/usr/bin/env node
// Build the read-only admin snapshot: review ledger, assets, versions, and preflight blockers.
// Usage: node scripts/build-admin-snapshot.mjs [--out admin-snapshot.json]
// The content pipeline stays file-based; this script never writes content or approves entries.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(new URL('..', import.meta.url).pathname)
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outPath = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(root, 'admin-snapshot.json')
const missingSources = []

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { missingSources.push(relative(root, path)); return fallback }
}
function walkFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walkFiles(p))
    else out.push(p)
  }
  return out
}

/* ---------------- review ledger ---------------- */
const signoff = readJson(join(root, 'content-src/review_signoff.json'), null)
const reviewEntries = Array.isArray(signoff?.entries) ? signoff.entries : []
const review = {
  reviewer: signoff?.reviewer ?? null,
  reviewedAt: signoff?.reviewedAt ?? null,
  method: signoff?.method ?? null,
  dimensions: signoff?.dimensions ?? [],
  counts: signoff?.counts ?? { total: reviewEntries.length, approved: reviewEntries.filter(e => e.reviewStatus === 'approved').length, pending: reviewEntries.filter(e => e.reviewStatus !== 'approved').length },
}
const entries = reviewEntries.map((e, i) => ({
  id: `${e.file || 'entry'}#${e.id || e.path || i}`,
  file: e.file || '',
  sourceId: e.id || '',
  path: e.path || '',
  status: e.reviewStatus || 'pending',
  reviewer: e.reviewer || null,
  reviewedAt: e.reviewedAt || null,
  dimensions: e.reviewDimensions || [],
  note: e.reviewNote || '',
  sources: e.sourceIds || [],
}))

/* ---------------- content files ---------------- */
const contentDir = join(root, 'content')
const contentFiles = existsSync(contentDir) ? readdirSync(contentDir).filter(f => f.endsWith('.json')).sort() : []
const contentIndex = contentFiles.map(file => {
  const data = readJson(join(contentDir, file), {})
  const list = data?.plants || data?.items || data?.occurrences || data?.crafts || data?.quizzes || data?.cards || data?.tips || data?.visitors || data?.questions || data?.sets || []
  return { file, count: Array.isArray(list) ? list.length : Array.isArray(data) ? data.length : 0 }
})

/* ---------------- assets ---------------- */
const manifestPath = join(root, '..', 'docs/assets_docs/config/asset_manifest.json')
const manifest = readJson(manifestPath, null)
const runtimeFiles = walkFiles(join(root, 'public'))
  .filter(f => /\.(webp|png|jpg|jpeg|svg|mp3)$/i.test(f))
const runtimeByBase = new Map()
for (const f of runtimeFiles) runtimeByBase.set(basename(f).replace(/\.[^.]+$/, ''), relative(join(root, 'public'), f))
const assets = (manifest?.assets ?? []).map(a => {
  const base = basename(a.path || '').replace(/\.[^.]+$/, '')
  const runtimePath = runtimeByBase.get(base) || null
  return {
    id: a.id, name: a.name, group: a.group, path: a.path, runtimePath,
    width: a.width ?? null, height: a.height ?? null, format: a.format ?? null,
    status: a.status ?? null,
    provenance: a.source ? 'manifest' : null,
    licence: a.licence || a.license || null,
    aiGenerated: a.aiGenerated ?? a.ai_generated ?? null,
    derivation: a.derivation ?? null,
  }
})
const assetCoverage = {
  total: assets.length,
  withProvenance: assets.filter(a => a.provenance).length,
  withLicence: assets.filter(a => a.licence).length,
  aiLabelled: assets.filter(a => a.aiGenerated !== null && a.aiGenerated !== undefined).length,
  withRuntimeFile: assets.filter(a => a.runtimePath).length,
  runtimeFileCount: runtimeFiles.length,
  missingRuntime: assets.filter(a => !a.runtimePath).length,
  groups: manifest?.groups ?? {},
  packStatus: manifest?.status ?? null,
}

/* ---------------- versions ---------------- */
const contentTs = existsSync(join(root, 'src/shared/content.ts')) ? readFileSync(join(root, 'src/shared/content.ts'), 'utf8') : ''
const versionOf = (name, fallback) => contentTs.match(new RegExp(`${name} = '([^']+)'`))?.[1] ?? fallback
const pkg = readJson(join(root, 'package.json'), {})
const manifestTxt = existsSync(join(root, '..', 'MANIFEST.txt')) ? readFileSync(join(root, '..', 'MANIFEST.txt'), 'utf8').trim() : null
const versions = {
  clientBuild: versionOf('CLIENT_BUILD', null),
  configVersion: versionOf('CONFIG_VERSION', null),
  packageVersion: pkg.version ?? null,
  sourceManifest: manifestTxt,
}

/* ---------------- preflight ---------------- */
let preflight = null
try {
  const r = spawnSync(process.execPath, [join(root, 'scripts/release-preflight.mjs'), '--json'], { cwd: root, encoding: 'utf8', timeout: 30_000 })
  if (r.stdout) preflight = JSON.parse(r.stdout)
} catch (e) {
  missingSources.push(`preflight: ${e.message}`)
}
const stage = preflight?.stage ?? process.env.VITE_RELEASE_STAGE ?? 'S0'

const snapshot = {
  generatedAt: new Date().toISOString(),
  commit: manifestTxt?.match(/([0-9a-f]{40})/)?.[1] ?? null,
  stage,
  versions,
  review,
  entries,
  content: { files: contentIndex, total: contentIndex.reduce((a, x) => a + x.count, 0) },
  assets: { ...assetCoverage, items: assets },
  release: {
    stage,
    preflight: preflight ? { generatedAt: preflight.generatedAt, pass: preflight.pass, blockers: preflight.blockers ?? [], warnings: preflight.warnings ?? [], authMode: preflight.authMode } : null,
  },
  missingSources,
}

writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n')
console.log(`[admin-snapshot] ${relative(root, outPath)}: entries=${entries.length}, assets=${assets.length}, blockers=${snapshot.release.preflight?.blockers?.length ?? 'n/a'}, missing=${missingSources.length}`)
