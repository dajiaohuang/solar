// Freeze three bounded NASA/JPL Horizons SPK responses for high-diameter TNO primaries.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH35_CACHE ?? '.cache/horizons-tno-batch35-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH35_REFRESH === '1'
const targets = [
  ['1993-sb', '15789 (1993 SB)', '15789', 20015789],
  ['2002-xu93', '127546 (2002 XU93)', '127546', 20127546],
  ['2010-wg9', '762135 (2010 WG9)', '762135', 20762135],
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
