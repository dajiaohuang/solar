// Explicit independent numerical validation of real Type 17 source records.
// Usage: node ... VERIFIED_CROP.bsp NEW_REFERENCE.json ORACLE [ORACLE_ARGS...]
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { SpkKernel } from '../../src/engine/ephemeris/spk.ts'

const [input, output, command, ...args] = process.argv.slice(2)
if (!input || !output || !command) throw new Error('Verified crop, new reference JSON and independent oracle command required')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const bytes = await readFile(input), evidenceBytes = await readFile(`${input}.json`)
const evidence = JSON.parse(evidenceBytes)
if (bytes.length !== evidence.bytes || digest(bytes) !== evidence.sha256) throw new Error('Source crop integrity mismatch')
if (new URL(evidence.source.source).protocol !== 'https:') throw new Error('Original source provenance required')
const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const little = bytes.toString('ascii', 88, 96) === 'LTL-IEEE'
const records = kernel.segments.filter(segment => segment.type === 17).map(segment => ({
  target: segment.target, center: segment.center, frame: segment.frame, startEt: segment.startEt, endEt: segment.endEt,
  elements: Array.from({ length: 12 }, (_, index) => {
    const offset = (segment.startAddress - 1 + index) * 8
    return little ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset)
  }),
}))
if (!records.length) throw new Error('No Type 17 records')
const samples = records.flatMap((record, index) => Array.from({ length: 65 }, (_, step) => ({ record: index, et: record.startEt + (record.endEt - record.startEt) * step / 64 })))
const oracle = spawnSync(command, args, { input: samples.map(sample => [sample.et, ...records[sample.record].elements].join(' ')).join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
if (oracle.status !== 0) throw new Error(`Independent oracle failed: ${oracle.stderr || oracle.stdout || oracle.error}`)
const states = oracle.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line))
if (states.length !== samples.length || states.some(state => state.length !== 6 || !state.every(Number.isFinite))) throw new Error('Invalid oracle output')
const result = { oracle: 'CSPICE N0067 eqncpv_c',
  contract: 'Independent numerical Type 17 reference relative to each original segment center; not a physical-uncertainty estimate or complete center-chain validation.',
  source: evidence.source, cropSha256: evidence.sha256, cropEvidenceSha256: digest(evidenceBytes),
  oracleSourceSha256: digest(await readFile(new URL('./spk17-oracle.c', import.meta.url))),
  units: { position: 'km', velocity: 'km/s', time: 'TDB seconds past J2000' },
  records, samples: samples.map((sample, index) => ({ ...sample, state: states[index] })),
}
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
console.log(`${records.length} original Type 17 records; ${samples.length} independent state samples`)
