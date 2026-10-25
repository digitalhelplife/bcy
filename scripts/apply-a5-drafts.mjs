#!/usr/bin/env node
// A5 G5: merge content-src/plant_card_drafts.json into content/plant_cards.json and content/observations.json.
// Idempotent. Only fills fields that are placeholders (or morphology the drafts explicitly replace); every touched
// item stays reviewStatus "pending" — this script never approves content.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('..', import.meta.url).pathname
const load = p => JSON.parse(readFileSync(root + p, 'utf8'))
const save = (p, v) => writeFileSync(root + p, JSON.stringify(v, null, 1) + '\n')
const drafts = load('content-src/plant_card_drafts.json')
const cards = load('content/plant_cards.json')
const obs = load('content/observations.json')
const PLACEHOLDER = /待|补充|审核后|占位|TODO/
const isPlaceholder = v => typeof v !== 'string' || v.trim() === '' || PLACEHOLDER.test(v) || v.length < 8

const addRefs = (item, refs) => {
  // Drop empty placeholder refs (no url) for the same plant once a real source exists.
  const real = (refs || []).filter(r => r.url)
  if (real.length) item.sourceRefs = item.sourceRefs.filter(r => r.url)
  for (const r of real) if (!item.sourceRefs.some(x => x.id === r.id)) item.sourceRefs.push(r)
}
const stats = { cardFields: 0, morphology: 0, observations: 0, missing: [] }

for (const [plantId, d] of Object.entries(drafts.cards)) {
  const c = cards.items.find(i => i.plantId === plantId)
  if (!c) { stats.missing.push(plantId); continue }
  let touched = false
  for (const k of ['light', 'water']) {
    if (d.homeGrowing?.[k] && isPlaceholder(c.homeGrowing?.[k])) { c.homeGrowing[k] = d.homeGrowing[k]; stats.cardFields++; touched = true }
  }
  for (const k of ['dailyScenes', 'cultureStory']) {
    if (d[k] && isPlaceholder(c[k])) { c[k] = d[k]; stats.cardFields++; touched = true }
  }
  if (d.morphology && c.morphology !== d.morphology && (c.morphology || '').length < 20) { c.morphology = d.morphology; stats.morphology++; touched = true }
  if (d.kidLine && c.kidLine !== d.kidLine) { c.kidLine = d.kidLine; stats.cardFields++; touched = true }
  if (touched) { addRefs(c, d.sourceRefs); c.reviewStatus = 'pending'; c.reviewer = null; c.reviewedAt = null }
}

for (const o of drafts.observations) {
  const m = /plantId=(\w+) \+ stages\[stage=(\d+)\]\.text/.exec(o.locator)
  if (!m) { stats.missing.push(o.locator); continue }
  const item = obs.items.find(i => i.plantId === m[1])
  const st = item?.stages.find(s => s.stage === Number(m[2]))
  if (!st) { stats.missing.push(o.locator); continue }
  if (st.text === o.old) { st.text = o.new; stats.observations++; addRefs(item, o.sourceRefs); item.reviewStatus = 'pending'; item.reviewer = null; item.reviewedAt = null }
  else if (st.text !== o.new) stats.missing.push(`${o.locator} (text changed; not applied)`)
}

save('content/plant_cards.json', cards)
save('content/observations.json', obs)
console.log(JSON.stringify(stats))
