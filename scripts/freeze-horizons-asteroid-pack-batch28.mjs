// Freeze one bounded NASA/JPL Horizons SPK response per target.
// The raw response and binary hashes are retained as integration inputs.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH28_CACHE ?? '.cache/horizons-centaur-batch28-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH28_REFRESH === '1'
const targets = [
  ['29981', '29981 (1999 TD10)', '29981', 20029981],
  ['okyrhoe', '52872 Okyrhoe (1998 SG35)', '52872', 20052872],
  ['cyllarus', '52975 Cyllarus (1998 TF35)', '52975', 20052975],
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
