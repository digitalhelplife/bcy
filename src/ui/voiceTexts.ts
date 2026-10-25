// A5 G8: every string the game reads aloud is built here, so recorded clips (keyed by text hash) and the UI
// can never drift apart. If reviewed wording changes, the hash changes and playback falls back to system TTS.
import tipsJson from '../../content/parent_tips.json'
import { LEVELS, PLANTS, SCENES } from '../shared/content'
import type { LevelId, PlantId, SceneId } from '../shared/types'

type Tip = { contentKind: string; contentId: string; childText: string }
const TIP = new Map((tipsJson.items as unknown as Tip[]).map(t => [`${t.contentKind}:${t.contentId}`, t.childText]))

export const sceneCallText = (sceneId: SceneId) => `找一找：${SCENES[sceneId].targets.map(x => x.label).join('、')}`
export const plantTipText = (plantId: PlantId) => TIP.get(`plant:${plantId}`) ?? ''
export function levelTipRows(levelId: LevelId): { title: string; text: string }[] {
  const lv = LEVELS[levelId]
  if (lv.kind === 'find') return SCENES[lv.sceneId].targets.flatMap(t => { const x = TIP.get(`find_target:${t.targetId}`); return x ? [{ title: t.label, text: x }] : [] })
  const x = TIP.get(`puzzle:${levelId}`)
  return x ? [{ title: lv.name, text: x }] : []
}
const endStop = (t: string) => (/[。！？]$/.test(t) ? t : `${t}。`)
export const levelTipText = (levelId: LevelId) => levelTipRows(levelId).map(r => `${r.title}。${endStop(r.text)}`).join('')

/** FNV-1a 32-bit, hex. Stable across browsers and Node. */
export function voiceKey(text: string): string {
  let h = 0x811c9dc5
  for (const ch of text) { const c = ch.codePointAt(0)!; h ^= c & 0xff; h = Math.imul(h, 0x01000193); if (c > 0xff) { h ^= c >>> 8; h = Math.imul(h, 0x01000193) } }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function allVoiceTexts(): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = []
  for (const sid of Object.keys(SCENES) as SceneId[]) out.push({ id: `scene_${sid}`, text: sceneCallText(sid) })
  for (const lid of Object.keys(LEVELS) as LevelId[]) { const t = levelTipText(lid); if (t) out.push({ id: `level_${lid}`, text: t }) }
  for (const pid of Object.keys(PLANTS) as PlantId[]) { const t = plantTipText(pid); if (t) out.push({ id: `plant_${pid}`, text: t }) }
  return out
}
