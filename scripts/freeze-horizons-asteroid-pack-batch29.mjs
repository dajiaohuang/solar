// Freeze one bounded NASA/JPL Horizons SPK response for Amycus.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_BATCH29_CACHE ?? '.cache/horizons-centaur-batch29-20260914'
const refresh = process.env.SOLAR_HORIZONS_ASTEROID_BATCH29_REFRESH === '1'
const target = ['amycus', '55576 Amycus', '55576', 20055576]

await mkdir(cache, { recursive: true })
const [slug, name, designation, targetId] = target
const binaryPath = join(cache, `${slug}.bsp`)
const evidencePath = join(cache, `${slug}.json`)
if (!refresh) {
  try {
    await readFile(binaryPath)
    await readFile(evidencePath)
    console.log(`${name}: retained ${binaryPath}`)
    process.exit(0)
  } catch {}
}
const result = await fetchHorizonsSpk({ designation, target: targetId, from: '2020-01-01', to: '2031-01-01' })
await writeFile(binaryPath, result.buffer)
await writeFile(evidencePath, `${JSON.stringify({ source: result.source }, null, 2)}\n`)
console.log(`${name}: ${result.source.bytes} bytes; binary ${result.source.sha256}; response ${result.source.responseSha256}`)
