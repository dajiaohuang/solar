// Freeze a bounded NASA/JPL Horizons SPK for comet 67P/Churyumov-Gerasimenko.
// The cached binary and response identity are the immutable integration input.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_COMET_67P_CACHE ?? '.cache/horizons-comet-67p-20260929'
const refresh = process.env.SOLAR_HORIZONS_COMET_67P_REFRESH === '1'
const binaryPath = join(cache, '67p.bsp')
const evidencePath = join(cache, '67p.json')

await mkdir(cache, { recursive: true })
if (!refresh) {
  try {
    await readFile(binaryPath)
    await readFile(evidencePath)
    console.log(`67P: retained ${binaryPath}`)
    process.exit(0)
  } catch {}
}

const result = await fetchHorizonsSpk({
  designation: '90000703',
  target: 1000012,
  from: '2020-01-01',
  to: '2031-01-01',
})
await writeFile(binaryPath, result.buffer)
await writeFile(evidencePath, `${JSON.stringify({ source: result.source }, null, 2)}\n`)
console.log(`67P: ${result.source.bytes} bytes; binary ${result.source.sha256}; response ${result.source.responseSha256}`)
console.log(result.source.solution?.slice(0, 1600) ?? 'no solution metadata')
