#!/usr/bin/env node
// Ingest tracked-link clicks from nginx access logs into promo_clicks_daily.
// Only requests carrying ?l=<link code> are counted; in-game attribution is not implemented.
//
// Usage:
//   ADMIN_DATABASE_URL=postgresql://... node scripts/admin-ingest-clicks.mjs /var/log/nginx/access.log
//   zcat access.log.1.gz | ADMIN_DATABASE_URL=... node scripts/admin-ingest-clicks.mjs -
//   ... --dry-run --since 2026-10-01
//
// Idempotency: for each (link, day) the stored value is max(existing, observed). Re-running a complete
// log file does not double count. If you rotate logs, pass every file for the day in one run.
import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import pg from 'pg'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const sinceIndex = args.indexOf('--since')
const since = sinceIndex >= 0 ? args[sinceIndex + 1] : null
const files = args.filter(a => !a.startsWith('--') && a !== since)
if (!files.length) {
  console.error('usage: node scripts/admin-ingest-clicks.mjs <access.log|-> [--dry-run] [--since YYYY-MM-DD]')
  process.exit(2)
}
const dsn = process.env.ADMIN_DATABASE_URL
if (!dsn) { console.error('ADMIN_DATABASE_URL is required'); process.exit(2) }

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
const TIME_RE = /\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/
const REQUEST_RE = /"([A-Z]+) ([^"]*?) HTTP\/[\d.]+"/
const STATUS_RE = /"\s+(\d{3})\s/

function dayFromLine(line) {
  const m = TIME_RE.exec(line)
  if (!m) return null
  const [, dd, mon, yyyy] = m
  const mm = MONTHS[mon]
  return mm ? `${yyyy}-${mm}-${dd}` : null
}

function linkFromLine(line) {
  const m = REQUEST_RE.exec(line)
  if (!m) return null
  const raw = m[2]
  try {
    const u = new URL(raw, 'http://local')
    const code = u.searchParams.get('l')
    return code ? code.toLowerCase() : null
  } catch { return null }
}

function statusFromLine(line) {
  const m = STATUS_RE.exec(line)
  return m ? Number(m[1]) : null
}

async function main() {
  const pool = new pg.Pool({ connectionString: dsn, max: 2 })
  const links = (await pool.query(
    `select l.id, l.code, c.id campaign_id, ch.id channel_id
     from promo_links l join promo_campaigns c on c.id=l.campaign_id join promo_channels ch on ch.id=c.channel_id
     where l.game_id='bencaoyou'`
  )).rows
  const byCode = new Map(links.map(l => [l.code.toLowerCase(), l]))

  const counts = new Map()
  let lines = 0, matched = 0, unknown = 0, skippedStatus = 0
  for (const file of files) {
    const input = file === '-' ? process.stdin : createReadStream(file)
    if (file !== '-' && !existsSync(file)) { console.error(`[ingest] file not found: ${file}`); continue }
    const rl = createInterface({ input, crlfDelay: Infinity })
    for await (const line of rl) {
      lines++
      const day = dayFromLine(line)
      if (!day || (since && day < since)) continue
      const code = linkFromLine(line)
      if (!code) continue
      const status = statusFromLine(line)
      if (status !== null && status >= 400) { skippedStatus++; continue }
      const link = byCode.get(code)
      if (!link) { unknown++; continue }
      matched++
      const key = `${link.id}\u0000${day}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const rows = [...counts.entries()].map(([key, clicks]) => {
    const [linkId, day] = key.split('\u0000')
    const link = links.find(l => l.id === linkId)
    return { day, linkId, channelId: link.channel_id, campaignId: link.campaign_id, clicks }
  })
  console.log(`[ingest] lines=${lines} matched=${matched} unknown_code=${unknown} skipped_status=${skippedStatus} link_days=${rows.length}`)
  if (dryRun) {
    for (const r of rows.slice(0, 50)) console.log(`  ${r.day} ${r.linkId.slice(0, 8)} ${r.clicks}`)
    console.log('[ingest] dry run: nothing written')
    await pool.end()
    return
  }
  for (const r of rows) {
    await pool.query(
      `insert into promo_clicks_daily (game_id,day,channel_id,campaign_id,link_id,clicks)
       values ('bencaoyou',$1,$2,$3,$4,$5)
       on conflict (game_id,day,link_id) do update set clicks=greatest(promo_clicks_daily.clicks, excluded.clicks)`,
      [r.day, r.channelId, r.campaignId, r.linkId, r.clicks]
    )
  }
  console.log(`[ingest] wrote ${rows.length} link/day row(s)`)
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
