// A5 G8: turn recorded WAVs (one per spoken text, named by voiceKey) into small mono MP3s under public/assets/voice
// and write src/ui/voiceManifest.json { key: file }. Texts come from src/ui/voiceTexts.ts (bundled with esbuild).
// Missing recordings are reported, never invented; at runtime they fall back to system speech.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const wavDir = process.argv[2] || '/tmp/voice/wav'
const outDir = resolve(root, 'public/assets/voice'); mkdirSync(outDir, { recursive: true })
const tmp = '/tmp/voice-enum.mjs'
writeFileSync('/tmp/voice-enum.ts', `import { allVoiceTexts, voiceKey } from '${root}/src/ui/voiceTexts'\nconsole.log(JSON.stringify(allVoiceTexts().map(r => ({ ...r, key: voiceKey(r.text) }))))\n`)
execFileSync(resolve(root, 'node_modules/.bin/esbuild'), ['/tmp/voice-enum.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${tmp}`, '--log-level=error'])
const rows = JSON.parse(execFileSync('node', [tmp]).toString())
const manifest = {}; const missing = []
for (const r of rows) {
  const wav = resolve(wavDir, `${r.key}.wav`); const mp3 = resolve(outDir, `${r.key}.mp3`)
  if (!existsSync(mp3)) {
    if (!existsSync(wav)) { missing.push(r.id); continue }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-18:TP=-2', '-ac', '1', '-ar', '24000', '-b:a', '40k', mp3])
  }
  manifest[r.key] = `${r.key}.mp3`
}
const path = resolve(root, 'src/ui/voiceManifest.json')
const prev = existsSync(path) ? readFileSync(path, 'utf8') : ''
const next = JSON.stringify(manifest, null, 1) + '\n'
if (prev !== next) writeFileSync(path, next)
console.log(`[voice] ${Object.keys(manifest).length}/${rows.length} recorded${missing.length ? `; missing: ${missing.join(', ')}` : ''}`)
