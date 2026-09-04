import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// Explicit generation only. Examples:
// node scripts/reference/record-spk17-reference.mjs NEW.json /path/spk17-oracle
// node scripts/reference/record-spk17-reference.mjs NEW.json wsl -d Ubuntu-24.04 -- /mnt/d/.../spk17-oracle
const [output, command, ...args] = process.argv.slice(2)
if (!output || !command) throw new Error('Supply NEW_OUTPUT.json and an independent CSPICE oracle command')
const records = [
  [123456, 42164, .12, -.08, 1.3, .06, .11, 2.1e-8, 7.8e-5, -1.7e-8, 0, Math.PI / 2],
  [123456, 42164, .12, -.08, 1.3, .06, .11, 2.1e-8, 7.8e-5, -1.7e-8, .7, .9],
  [0, 170000, .899999, 0, -Math.PI + .01, .3, -.2, 1e-8, 3e-5, 2e-8, 4.2, -.4],
  [0, 100000, 0, 0, Math.PI - .01, 0, 0, 0, 4e-5, 0, -Math.PI / 2, Math.PI / 2],
  [42000, 90000, -.3, .8, 5.9, -1.5, 2.1, -2e-8, -5e-5, 7e-8, -.3, .4],
]
const samples = records.flatMap((elements, record) => [-1e9, -200000, -1, 0, 1, 108432, 271974, 1e9].map(offset => ({ record, et: elements[0] + offset })))
const input = samples.map(sample => [sample.et, ...records[sample.record]].join(' ')).join('\n') + '\n'
const oracle = spawnSync(command, args, { input, encoding: 'utf8', timeout: 120000 })
if (oracle.status !== 0) throw new Error(`Independent oracle failed: ${oracle.stderr || oracle.stdout || oracle.error}`)
const states = oracle.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line))
if (states.length !== samples.length || states.some(state => state.length !== 6 || !state.every(Number.isFinite))) throw new Error('Invalid oracle output')
const result = {
  source: 'CSPICE N0067 eqncpv_c; synthetic inputs, not physical ephemerides',
  documentation: 'https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/eqncpv_c.html',
  oracleSourceSha256: createHash('sha256').update(await readFile(new URL('./spk17-oracle.c', import.meta.url))).digest('hex'),
  units: { position: 'km', velocity: 'km/s', time: 'TDB seconds past J2000' },
  records, samples: samples.map((sample, index) => ({ ...sample, state: states[index] })),
}
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
console.log(`${records.length} records; ${samples.length} independent state samples`)
