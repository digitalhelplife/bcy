import { useSyncExternalStore } from 'react'
// Device-local UI preferences. Parent mode (F14) has no server RPC: it only changes presentation.
const subs = new Set<() => void>()
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* ignore */ } subs.forEach(f => f()) }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const PARENT_KEY = 'bcy.pref.parentMode'
export function useParentMode(): [boolean, (on: boolean) => void] {
  const v = useSyncExternalStore(subscribe, () => read(PARENT_KEY) === '1')
  return [v, (on: boolean) => { write(PARENT_KEY, on ? '1' : null); document.documentElement.classList.toggle('parent-mode', on) }]
}
export const readParentMode = () => read(PARENT_KEY) === '1'
/** A6-B4: child age band for parent mode. '3-6' (default) keeps the short tips; '7-12' adds one open “想一想” question. */
const AGE_KEY = 'bcy.pref.kidAge'
export type KidAge = '3-6' | '7-12'
export const readKidAge = (): KidAge => (read(AGE_KEY) === '7-12' ? '7-12' : '3-6')
export function useKidAge(): [KidAge, (v: KidAge) => void] {
  return [useSyncExternalStore(subscribe, readKidAge), (v: KidAge) => write(AGE_KEY, v === '7-12' ? '7-12' : null)]
}
export const applyParentModeClass = () => document.documentElement.classList.toggle('parent-mode', read(PARENT_KEY) === '1')
/** P50: local record of the accepted privacy version, checked before ANY network request. */
const CONSENT_KEY = 'bcy.consent'
export type LocalConsent = { privacyVersion: string; telemetry: boolean; acceptedAtMs: number }
export const readConsent = (): LocalConsent | null => { const r = read(CONSENT_KEY); try { return r ? JSON.parse(r) : null } catch { return null } }
export const writeConsent = (c: LocalConsent) => write(CONSENT_KEY, JSON.stringify(c))

// A5 G8: sound effects default ON (low volume); parent-mode voice default ON. Stored as '0' when switched off.
const SOUND_KEY = 'bcy.pref.sound'
const VOICE_KEY = 'bcy.pref.voice'
export const readSound = () => read(SOUND_KEY) !== '0'
/** A6-C1: ambient sound beds — OFF by default (opt-in), independent of the short sound effects. */
const AMBIENT_KEY = 'bcy.pref.ambient'
export const readAmbient = () => read(AMBIENT_KEY) === '1'
export function useAmbient(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, readAmbient), (on: boolean) => write(AMBIENT_KEY, on ? '1' : null)]
}
export const readVoice = () => read(VOICE_KEY) !== '0'
export function useSound(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, readSound), (on: boolean) => write(SOUND_KEY, on ? null : '0')]
}
export function useVoice(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, readVoice), (on: boolean) => write(VOICE_KEY, on ? null : '0')]
}
