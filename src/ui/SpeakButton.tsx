import { canSpeak, hasRecording, speak } from './sfx'
import { useVoice } from './prefs'

/** A5 G8: "读给孩子听" — pre-recorded Mandarin clip (system voice fallback); hidden when voice is off or nothing can play. */
export function SpeakButton({ text }: { text: string }) {
  const [voice] = useVoice()
  if (!voice || (!hasRecording(text) && !canSpeak())) return null
  return <button className="btn btn-soft btn-sm speak-btn" onClick={() => speak(text, { force: true })} aria-label="读给孩子听" data-testid="speak">读给孩子听</button>
}
