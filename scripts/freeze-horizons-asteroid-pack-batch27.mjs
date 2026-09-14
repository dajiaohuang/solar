// Freeze one bounded NASA/JPL Horizons SPK response per target.
// The raw response and binary hashes are retained as integration inputs.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH27_CACHE ?? '.cache/horizons-centaur-batch27-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH27_REFRESH === '1'
const targets = [
  ['damocles', '5335 Damocles', '5335', 20005335],
  ['elatus', '31824 Elatus (1999 UG5)', '31824', 20031824],
  ['thereus', '32532 Thereus (2001 PT13)', '32532', 20032532],
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
