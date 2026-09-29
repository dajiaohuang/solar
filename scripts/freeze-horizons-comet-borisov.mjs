// Freeze a bounded NASA/JPL Horizons SPK for 2I/Borisov (C/2019 Q4).
// Preserve the original binary and identity receipt as immutable source inputs.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchHorizonsSpk } from './lib/horizons-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_COMET_BORISOV_CACHE ?? '.cache/horizons-comet-borisov-20260929'
const refresh = process.env.SOLAR_HORIZONS_COMET_BORISOV_REFRESH === '1'
const binaryPath = join(cache, 'borisov.bsp')
const evidencePath = join(cache, 'borisov.json')
const fixture = 'tests/fixtures/horizons-borisov-spk-20260929'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

async function writeImmutable(path, bytes) {
  try { await writeFile(path, bytes, { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST' || !Buffer.from(await readFile(path)).equals(Buffer.from(bytes))) throw error
  }
}

async function preserveSource(bytes, source) {
  if (bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw new Error('Horizons Borisov source does not match its recorded identity')
  await mkdir(fixture, { recursive: true })
  await writeImmutable(join(fixture, 'original.bsp'), bytes)
  const receipt = Buffer.from(`${JSON.stringify({ schemaVersion: 1, source }, null, 2)}\n`)
  await writeImmutable(join(fixture, 'receipt.json'), receipt)
}

await mkdir(cache, { recursive: true })
if (!refresh) {
  let bytes, evidence
  try {
    bytes = await readFile(binaryPath)
    evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
  } catch {}
  if (bytes && evidence?.source) {
    await preserveSource(bytes, evidence.source)
    console.log(`Borisov: retained ${binaryPath} and immutable ${fixture}`)
    process.exit(0)
  }
}

const result = await fetchHorizonsSpk({
  designation: 'DES=1003639',
  target: 1003639,
  from: '2019-01-01',
  to: '2031-01-01',
})
await writeFile(binaryPath, result.buffer)
await writeFile(evidencePath, `${JSON.stringify({ source: result.source }, null, 2)}\n`)
await preserveSource(result.buffer, result.source)
console.log(`Borisov: ${result.source.bytes} bytes; binary ${result.source.sha256}; response ${result.source.responseSha256}`)
console.log(result.source.solution?.slice(0, 1800) ?? 'no solution metadata')
