// A5 G8: tiny synthesized sound effects (WebAudio, no audio files) and parent-mode voice (pre-recorded clips, system TTS fallback).
import { readParentMode, readSound, readVoice } from './prefs'
import voiceManifest from './voiceManifest.json'
import { voiceKey } from './voiceTexts'

export type Sfx = 'tap' | 'found' | 'snap' | 'complete' | 'ready' | 'claim' | 'miss'
type Note = [freq: number, startS: number, durS: number, type?: OscillatorType]
const SOUNDS: Record<Sfx, Note[]> = {
  tap: [[880, 0, 0.05, 'triangle']],
  miss: [[330, 0, 0.09, 'sine']],
  found: [[784, 0, 0.09, 'triangle'], [1175, 0.08, 0.14, 'triangle']],
  snap: [[523, 0, 0.06, 'square'], [784, 0.05, 0.08, 'triangle']],
  complete: [[523, 0, 0.12, 'triangle'], [659, 0.11, 0.12, 'triangle'], [784, 0.22, 0.12, 'triangle'], [1047, 0.33, 0.28, 'triangle']],
  ready: [[659, 0, 0.1, 'sine'], [988, 0.09, 0.18, 'sine']],
  claim: [[784, 0, 0.08, 'triangle'], [988, 0.07, 0.08, 'triangle'], [1319, 0.14, 0.2, 'triangle']],
}
const VOLUME = 0.08 // deliberately quiet: many players are next to a sleeping baby
let ctx: AudioContext | null = null

export function play(kind: Sfx) {
  if (!readSound()) return
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx = ctx ?? new AC()
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime + 0.01
    for (const [f, s, d, type] of SOUNDS[kind]) {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = type ?? 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0, t0 + s)
      g.gain.linearRampToValueAtTime(VOLUME, t0 + s + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + s + d)
      o.connect(g).connect(ctx.destination)
      o.start(t0 + s); o.stop(t0 + s + d + 0.02)
    }
  } catch { /* audio is optional */ }
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
/** Reads short child-facing lines aloud in Mandarin (system voice). Parent mode + voice switch only. */
const BASE: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/'
const RECORDED = voiceManifest as Record<string, string>
let clip: HTMLAudioElement | null = null
/** True when this exact text has a pre-recorded Mandarin clip (A5 G8). */
export const hasRecording = (text: string) => Boolean(RECORDED[voiceKey(text)])
function systemSpeak(text: string) {
  if (!canSpeak()) return false
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'; u.rate = 0.92; u.pitch = 1.05
    const zh = synth.getVoices().find(v => /zh[-_]CN/i.test(v.lang)) ?? synth.getVoices().find(v => /^zh/i.test(v.lang))
    if (zh) u.voice = zh
    synth.speak(u)
    return true
  } catch { return false }
}
/**
 * Reads short child-facing lines aloud. Prefers the pre-recorded clip for this exact text (loaded on demand, never in
 * the first-screen bundle); if wording changed after review (no clip for its hash) or playback fails, uses the system voice.
 * Parent mode + voice switch only, unless `force` (an explicit tap on 读给孩子听).
 */
export function speak(text: string, opts: { force?: boolean } = {}) {
  if (!readVoice() || (!opts.force && !readParentMode())) return false
  stopSpeaking()
  const file = RECORDED[voiceKey(text)]
  if (file && typeof Audio !== 'undefined') {
    try {
      clip = new Audio(`${BASE}assets/voice/${file}`)
      clip.volume = 0.9
      const p = clip.play()
      if (p && typeof p.catch === 'function') p.catch(() => { if (opts.force) systemSpeak(text) })
      return true
    } catch { /* fall through */ }
  }
  return systemSpeak(text)
}
export const stopSpeaking = () => {
  try { if (clip) { clip.pause(); clip = null } } catch { /* ignore */ }
  try { if (canSpeak()) window.speechSynthesis.cancel() } catch { /* ignore */ }
}
