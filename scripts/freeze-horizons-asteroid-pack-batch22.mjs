// Freeze a bounded, reproducible NASA/JPL Horizons SPK response pack.
// Responses are fetched serially and retained with raw-response and binary
// hashes before integration crops the original type-21 records.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH22_CACHE ?? '.cache/horizons-asteroids-batch22-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH22_REFRESH === '1'
const targets = [
  ['albion', '15760 Albion', '15760', 20015760],
  ['chaos', '19521 Chaos', '19521', 20019521],
  ['rhadamanthus', '38083 Rhadamanthus', '38083', 20038083],
  ['huya', '38628 Huya', '38628', 20038628],
  ['deucalion', '53311 Deucalion', '53311', 20053311],
]

await mkdir(cache, { recursive: true })
for (const [slug, name, designation, target] of targets) {
  const binaryPath = join(cache, `${slug}.bsp`)
  const evidencePath = join(cache, `${slug}.json`)
  if (!refresh) {
    try {
      await readFile(binaryPath)
      await readFile(evidencePath)
      console.log(`${name}: retained ${binaryPath}`)
      continue
    } catch {}
  }
  const result = await fetchHorizonsSpk({ designation, target, from: '2020-01-01', to: '2031-01-01' })
  await writeFile(binaryPath, result.buffer)
  await writeFile(evidencePath, `${JSON.stringify({ source: result.source }, null, 2)}\n`)
  console.log(`${name}: ${result.source.bytes} bytes; binary ${result.source.sha256}; response ${result.source.responseSha256}`)
}
