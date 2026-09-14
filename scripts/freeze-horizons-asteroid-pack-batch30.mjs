// Freeze three bounded NASA/JPL Horizons SPK responses for named Centaurs.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH30_CACHE ?? '.cache/horizons-centaur-batch30-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH30_REFRESH === '1'
const targets = [
  ['narcissus', '37117 Narcissus', '37117', 20037117],
  ['crantor', '83982 Crantor', '83982', 20083982],
  ['rhiphonos', '346889 Rhiphonos', '346889', 20346889],
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
