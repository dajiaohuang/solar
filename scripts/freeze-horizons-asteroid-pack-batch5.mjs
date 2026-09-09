// Freeze a bounded, reproducible NASA/JPL Horizons SPK response pack.
// Responses are fetched serially and retained with raw-response and binary
// hashes before the integration script crops the original type-21 records.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH5_CACHE ?? '.cache/horizons-asteroids-batch5-20260909'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH5_REFRESH === '1'
const targets = [
  ['arrokoth', 'Arrokoth', '486958', 20486958],
  ['apl', 'APL', '132524', 20132524],
  ['dinkinesh', 'Dinkinesh', '152830', 20152830],
  ['ev5-2008', '2008 EV5', '341843', 20341843],
  ['kamo-oalewa', 'Kamoʻoalewa', '469219', 20469219],
  ['et70-2000', '2000 ET70', '162421', 20162421],
]

await mkdir(cache, { recursive: true })
for (const [slug, name, designation, target] of targets) {
  const binaryPath = join(cache, `${slug}.bsp`)
  const evidencePath = join(cache, `${slug}.json`)
  if (!refresh) {
    try {
      await readFile(binaryPath)
      await readFile(evidencePath)
      console.log(`${name}: retained existing frozen response`)
      continue
    } catch {}
  }
  const result = await fetchHorizonsSpk({ designation, target, from: '2020-01-01', to: '2031-01-01' })
  await writeFile(binaryPath, result.buffer)
  await writeFile(evidencePath, `${JSON.stringify({ source: result.source }, null, 2)}\n`)
  console.log(`${name}: ${result.source.bytes} bytes; binary ${result.source.sha256}; response ${result.source.responseSha256}`)
}
