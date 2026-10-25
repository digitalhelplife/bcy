// A6-C1 背景环境音: three procedural WebAudio beds (no audio files): water for 都江堰, forest for 青城山, town for 街子.
// Off by default and very quiet; stops when the level unmounts, the page is hidden, or the switch is turned off.
import { readAmbient } from './prefs'
import type { SceneId } from '../shared/types'

export type AmbientKind = 'water' | 'forest' | 'town'
export const AMBIENT_FOR: Record<SceneId, AmbientKind> = { dujiangyan: 'water', qingcheng: 'forest', jiezi: 'town' }
const LEVEL = 0.035
let ctx: AudioContext | null = null
let stopFn: (() => void) | null = null

function noiseBuffer(c: AudioContext, seconds = 2) {
  const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate)
  const d = b.getChannelData(0)
  let last = 0
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5 } // brown-ish noise
  return b
}
function chirp(c: AudioContext, out: AudioNode, t: number, f: number, dur: number, type: OscillatorType = 'sine', vol = 0.5) {
  const o = c.createOscillator(); const g = c.createGain()
  o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.25, t + dur * 0.6)
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05)
}
export function startAmbient(kind: AmbientKind): () => void {
  stopAmbient()
  if (!readAmbient()) return () => undefined
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return () => undefined
    ctx = ctx ?? new AC()
    const c = ctx
    if (c.state === 'suspended') void c.resume()
    const master = c.createGain(); master.gain.setValueAtTime(0, c.currentTime); master.gain.linearRampToValueAtTime(LEVEL, c.currentTime + 1.5)
    master.connect(c.destination)
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c); src.loop = true
    const filt = c.createBiquadFilter()
    filt.type = kind === 'water' ? 'bandpass' : 'lowpass'
    filt.frequency.value = kind === 'water' ? 700 : kind === 'forest' ? 500 : 300
    filt.Q.value = kind === 'water' ? 0.6 : 0.3
    const bed = c.createGain(); bed.gain.value = kind === 'town' ? 0.35 : 0.8
    src.connect(filt).connect(bed).connect(master); src.start()
    // Slow swell so the bed breathes instead of hissing.
    const lfo = c.createOscillator(); const lfoG = c.createGain(); lfo.frequency.value = kind === 'water' ? 0.15 : 0.07; lfoG.gain.value = 0.25
    lfo.connect(lfoG).connect(bed.gain); lfo.start()
    const timer = window.setInterval(() => {
      const t = c.currentTime + 0.05
      if (kind === 'forest' && Math.random() < 0.5) { const f = 2200 + Math.random() * 1400; chirp(c, master, t, f, 0.12, 'sine', 0.6); chirp(c, master, t + 0.16, f * 1.1, 0.1, 'sine', 0.5) }
      if (kind === 'town' && Math.random() < 0.3) chirp(c, master, t, [1568, 1760, 2093][Math.floor(Math.random() * 3)], 1.6, 'triangle', 0.35) // eave bell
      if (kind === 'water' && Math.random() < 0.25) chirp(c, master, t, 500 + Math.random() * 300, 0.08, 'sine', 0.25)
    }, 1800)
    const onHide = () => { if (document.hidden) stopAmbient() }
    document.addEventListener('visibilitychange', onHide)
    stopFn = () => {
      window.clearInterval(timer); document.removeEventListener('visibilitychange', onHide)
      try { master.gain.cancelScheduledValues(c.currentTime); master.gain.setTargetAtTime(0, c.currentTime, 0.2); src.stop(c.currentTime + 0.8); lfo.stop(c.currentTime + 0.8) } catch { /* already stopped */ }
    }
  } catch { stopFn = null }
  return stopAmbient
}
export function stopAmbient() { const f = stopFn; stopFn = null; f?.() }
