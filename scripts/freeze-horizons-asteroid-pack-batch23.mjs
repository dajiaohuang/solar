// Freeze a bounded, reproducible NASA/JPL Horizons SPK response pack.
// Responses are fetched serially and retained with raw-response and binary
// hashes before integration crops the original type-21 records.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH23_CACHE ?? '.cache/horizons-asteroids-batch23-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH23_REFRESH === '1'
const targets = [
  ['rr245', '523794 2015 RR245', '523794', 20523794],
  ['vp113', '2012 VP113', 'DES=50666516', 50666516],
  ['uz224', '2014 UZ224', 'DES=50760674', 50760674],
  ['chiminigagua', '532037 Chiminigagua (2013 FY27)', 'DES=20532037', 20532037],
  ['leleakuhonua', '541132 Leleakuhonua (2015 TG387)', 'DES=20541132', 20541132],
  ['sy99', '2013 SY99', 'DES=50773852', 50773852],
  ['xr190', '612911 (2004 XR190)', 'DES=20612911', 20612911],
  ['dziewanna', '471143 Dziewanna (2010 EK139)', 'DES=20471143', 20471143],
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
