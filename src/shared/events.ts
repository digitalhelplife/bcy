import eventsJson from '../../content/events.json'
import type { PlantId, SceneId, TermId } from './types'

export type GameEvent = {
  eventId: string; title: string; startsAt: string; endsAt: string; dateNote: string
  dateSource: { title: string; publisher: string; url: string; accessedAt: string }
  route: { sceneId: SceneId; line: string }[]
  termIds: TermId[]
  gardenIdea: { title: string; plants: PlantId[]; items: string[]; line: string }
  journalTitle: string
}
export const EVENTS = eventsJson.items as unknown as GameEvent[]
/** A6-A2: the event running at `nowMs` (inclusive window), or null. Display only — never changes rewards. */
export function activeEvent(nowMs: number, list: GameEvent[] = EVENTS): GameEvent | null {
  return list.find(e => Date.parse(e.startsAt) <= nowMs && nowMs <= Date.parse(e.endsAt)) ?? null
}
