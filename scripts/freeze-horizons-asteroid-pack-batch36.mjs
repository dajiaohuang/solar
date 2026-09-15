// Freeze two bounded NASA/JPL Horizons SPK responses for named TNO primaries.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH36_CACHE ?? '.cache/horizons-tno-batch36-20260915'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH36_REFRESH === '1'
const targets = [
  ['altjira', '148780 Altjira', '148780', 20148780],
  ['mbabamwanawaresa', '184314 Mbabamwanawaresa', '184314', 20184314],
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
  console.log(result.source.solution?.slice(0, 1200) ?? 'no solution metadata')
}
