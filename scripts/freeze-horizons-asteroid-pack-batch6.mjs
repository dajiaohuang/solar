// Freeze a bounded, reproducible NASA/JPL Horizons SPK response pack.
// Responses are retained with raw-response and binary hashes before the
// integration script crops the original type-21 records.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH6_CACHE ?? '.cache/horizons-asteroids-batch6-20260909'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH6_REFRESH === '1'
const targets = [
  ['sn263-2001', '2001 SN263', '153591', 20153591],
  ['yu55-2005', '2005 YU55', '308635', 20308635],
  ['sd220-2003', '2003 SD220', '163899', 20163899],
  ['bl86-2004', '2004 BL86', '357439', 20357439],
  ['duende', 'Duende', '367943', 20367943],
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
