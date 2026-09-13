// Freeze a bounded, reproducible NASA/JPL Horizons SPK response pack.
// Responses are fetched serially and retained with raw-response and binary
// hashes before integration crops the original type-21 records.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH19_CACHE ?? '.cache/horizons-asteroids-batch19-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH19_REFRESH === '1'
const targets = [
  ['sedna', 'Sedna', '90377', 20090377],
  ['arawn', 'Arawn', '15810', 20015810],
  ['ixion', 'Ixion', '28978', 20028978],
  ['gonggong', 'Gonggong', '225088', 20225088],
  ['varda', 'Varda', '174567', 20174567],
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
