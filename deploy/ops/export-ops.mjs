#!/usr/bin/env node
// Read-only ops export for the two Nakama collections that have no admin UI:
//   game_feedback  -> acceptedAtMs + text + status + clientBuild (contact is deliberately omitted)
//   game_telemetry -> event names/counts + whitelisted fields (owner id is omitted)
//
// Usage:
//   NAKAMA_DB_URL=postgresql://... node deploy/ops/export-ops.mjs [--out /tmp/bencaoyou-ops.json]
//
// The output is written with mode 0600. Feedback text can contain user-provided words; treat the file as
// controlled operational data, not as public content.
import { writeFileSync } from 'node:fs'
import pg from 'pg'

const dsn = process.env.NAKAMA_DB_URL || process.env.DATABASE_URL
if (!dsn) {
  console.error('NAKAMA_DB_URL (or DATABASE_URL) is required')
  process.exit(2)
}
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const out = outIndex >= 0 ? args[outIndex + 1] : '/tmp/bencaoyou-ops.json'
if (!out) {
  console.error('--out requires a path')
  process.exit(2)
}

const pool = new pg.Pool({ connectionString: dsn, max: 2 })
const asJson = v => (typeof v === 'string' ? JSON.parse(v) : v)

try {
  const feedbackRows = (await pool.query("select value from storage where collection = 'game_feedback' order by update_time desc")).rows
  const telemetryRows = (await pool.query("select value from storage where collection = 'game_telemetry' order by update_time desc")).rows
  const feedback = []
  const counts = {}
  const telemetry = []
  for (const row of feedbackRows) {
    const v = asJson(row.value)
    feedback.push({ atMs: v.atMs, text: v.text, status: v.status ?? 'NEW', clientBuild: v.clientBuild ?? null })
  }
  for (const row of telemetryRows) {
    const v = asJson(row.value)
    for (const e of v.events ?? []) {
      if (!e || typeof e.eventName !== 'string') continue
      counts[e.eventName] = (counts[e.eventName] ?? 0) + 1
      telemetry.push({ atMs: v.atMs, dayKey: v.dayKey, eventName: e.eventName, fields: e.fields ?? {} })
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    feedback: { count: feedback.length, rows: feedback },
    telemetry: { eventCounts: counts, rows: telemetry },
  }
  writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(`[ops-export] wrote ${out}: feedback=${feedback.length}, telemetryRows=${telemetry.length}, events=${Object.values(counts).reduce((a, b) => a + b, 0)}`)
} finally {
  await pool.end()
}
