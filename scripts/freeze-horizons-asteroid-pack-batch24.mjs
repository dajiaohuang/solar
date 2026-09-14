// Freeze a bounded, reproducible NASA/JPL Horizons SPK response pack.
// Responses are fetched serially and retained with raw-response and binary
// hashes before integration crops the original type-21 records.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH24_CACHE ?? '.cache/horizons-asteroids-batch24-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH24_REFRESH === '1'
const targets = [
  ['tl66', '15874 (1996 TL66)', '15874', 20015874],
  ['to66', '19308 (1996 TO66)', '19308', 20019308],
  ['ur163', '42301 (2001 UR163)', '42301', 20042301],
  ['lempo', '47171 Lempo (1999 TC36)', '47171', 20047171],
  ['silanunam', '79360 Sila-Nunam (1997 CS29)', '79360', 20079360],
  ['vs2', '84922 (2003 VS2)', '84922', 20084922],
  ['rr43', '145453 (2005 RR43)', '145453', 20145453],
  ['gkunhomdima', "229762 G!kun||'homdima (2007 UK126)", '229762', 20229762],
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
