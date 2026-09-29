// Freeze JPL Horizons' published, time-mapped Borisov state uncertainties.
// The response and receipt are immutable inputs for the local normalizer.
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'tests/fixtures/horizons-borisov-uncertainty-20260929')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const parameters = {
  format: 'json', COMMAND: "'DES=1003639;'", EPHEM_TYPE: 'VECTORS', CENTER: "'@10'",
  START_TIME: "'2019-01-01'", STOP_TIME: "'2031-01-01'", STEP_SIZE: "'30 d'",
  VEC_TABLE: "'2r'", OUT_UNITS: "'AU-D'", REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'ICRF'",
}
const url = new URL('https://ssd.jpl.nasa.gov/api/horizons.api')
for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
const retrievedAt = new Date().toISOString()
const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
if (!response.ok) throw new Error(`Horizons uncertainty request failed with HTTP ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (bytes.length > 2 * 1024 * 1024) throw new Error('Horizons uncertainty response exceeds 2 MiB')
const payload = JSON.parse(bytes.toString('utf8'))
const result = payload.result ?? ''
for (const marker of [
  'NASA/JPL Horizons API', 'Target body name: Borisov (C/2019 Q4)', 'source: JPL#54',
  'Center body name: Sun (10)', 'Small perturbers: Yes', 'Output units    : AU-D',
  'Output format   : 2r (pos. & vel. w/uncertainties: RTN)', 'JDTDB', '$$SOE', '$$EOE',
  '2019-02-24 to 2020-09-30',
]) {
  if (!(payload.signature?.source ?? '').includes(marker) && !result.includes(marker)) {
    throw new Error(`Horizons uncertainty response is missing source marker: ${marker}`)
  }
}
if (!['1.2', '1.3'].includes(payload.signature?.version) || payload.error) {
  throw new Error(`Unsupported Horizons response: ${payload.error ?? payload.signature?.version}`)
}

await mkdir(output, { recursive: true })
const responsePath = join(output, 'response.json')
const receiptPath = join(output, 'receipt.json')
const receipt = {
  schemaVersion: 1,
  source: url.href,
  retrievedAt,
  request: parameters,
  responseBytes: bytes.length,
  responseSha256: digest(bytes),
}
await writeFile(responsePath, bytes, { flag: 'wx' })
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ responsePath, receiptPath, responseBytes: bytes.length, responseSha256: receipt.responseSha256, retrievedAt }))
