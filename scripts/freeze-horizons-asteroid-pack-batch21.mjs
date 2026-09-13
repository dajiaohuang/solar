// Freeze a bounded, reproducible NASA/JPL Horizons SPK response pack.
// Responses are fetched serially and retained with raw-response and binary
// hashes before integration crops the original type-21 records.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH21_CACHE ?? '.cache/horizons-asteroids-batch21-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH21_REFRESH === '1'
const targets = [
  ['aw197', '2002 AW197', '55565', 20055565],
  ['ms4', '2002 MS4', '307261', 20307261],
  ['az84', '2003 AZ84', '208996', 20208996],
  ['gv9', '2004 GV9', '120132', 20120132],
  ['tx300', '2002 TX300', '55636', 20055636],
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
