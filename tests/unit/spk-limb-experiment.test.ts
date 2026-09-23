import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parseSpkLimbInput, runSpkLimbExperiment } from '../../src/engine/events/spkLimbExperiment'
import { DE440_DYNAMICS_SOURCE } from '../../src/engine/dynamics/de440Dynamics'
import { evaluateSpkLimbFile } from '../../scripts/evaluate-spk-limb.mjs'
import reference from '../fixtures/spk-limb-reference.json'

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
const array = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength) as ArrayBuffer
async function sources() {
  const [spk, pck, gmText] = await Promise.all([readFile(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`), readFile('src/data/pck00011.tpc'), readFile('src/data/gm_de440.tpc', 'utf8')])
  return { spkBytes: array(spk), pckBytes: array(pck), gmText }
}

it('matches twelve independent DE440/CSPICE simultaneous and center-reception limbs', async () => {
  const source = await sources()
  expect(reference.generatorSha256).toBe(createHash('sha256').update(await readFile('scripts/reference-spk-limb.py')).digest('hex'))
  for (const entry of reference.sources) expect(entry.sha256).toBe(createHash('sha256').update(await readFile(entry.path)).digest('hex'))
  for (const sample of reference.cases) {
    const result = await runSpkLimbExperiment({ ...source, inputBytes: encode(sample.input) })
    const scale = Math.max(...result.shape.radiiKm)
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(result.observerJ2000Km[i]-sample.observerJ2000Km[i])).toBeLessThan(2e-6)
      expect(Math.abs(result.limb.centerBodyFixedKm[i]-sample.centerBodyFixedKm[i])/scale).toBeLessThan(2e-10)
      for (let j = 0; j < 3; j++) {
        const tensor = result.limb.generatorsBodyFixedKm.reduce((sum, axis) => sum+axis[i]*axis[j], 0)
        expect(Math.abs(tensor-sample.shapeTensor[i][j])/(scale*scale)).toBeLessThan(2e-10)
      }
    }
    expect(Math.abs(result.orientation.secondsPastJ2000Tdb-sample.orientationEt)).toBeLessThan(3e-7)
    for (let i = 0; i < 9; i++) expect(Math.abs(result.orientation.j2000ToBodyFixed[i]-sample.j2000ToBodyFixed[i])).toBeLessThan(2e-10)
    if (sample.input.aberration === 'CN') {
      expect(result.reception!.lightTimeSeconds).toBeGreaterThan(0)
      expect(result.ephemeris.emissionElapsedTdbSeconds).toBeLessThan(result.ephemeris.receptionElapsedTdbSeconds)
      expect(result.reception!.residualSeconds).toBeLessThanOrEqual(1e-9)
    } else expect(result.reception).toBeNull()
    expect(result.physicalLimbUncertaintyKm).toBeNull()
  }
})

it('fails closed for unsupported identities, unavailable epochs, inadequate margins, corruption and cancellation', async () => {
  const source = await sources(), input = reference.cases[1].input
  for (const patch of [{ observerId: input.targetId }, { frame: 'ECLIPJ2000' }, { timeScale: 'UTC' }, { maxLightTimeSeconds: 0 }, { elapsedTdbSeconds: 366*86400 }]) {
    expect(() => parseSpkLimbInput(encode({ ...input, ...patch }))).toThrow()
  }
  for (const patch of [{ targetId: 3 }, { targetId: 499 }, { referenceEpochTdb: 2400000 }, { maxLightTimeSeconds: 0.01 }]) {
    await expect(runSpkLimbExperiment({ ...source, inputBytes: encode({ ...input, ...patch }) })).rejects.toThrow()
  }
  await expect(runSpkLimbExperiment({ ...source, inputBytes: encode(input), signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  const corrupt = source.spkBytes.slice(0); new Uint8Array(corrupt)[100] ^= 1
  await expect(runSpkLimbExperiment({ ...source, spkBytes: corrupt, inputBytes: encode(input) })).rejects.toThrow('checksum')
})

it('freezes input/source bytes before asynchronous validation', async () => {
  const source = await sources(), inputBytes = encode(reference.cases[1].input)
  const pending = runSpkLimbExperiment({ ...source, inputBytes })
  new Uint8Array(source.spkBytes).fill(0); new Uint8Array(source.pckBytes).fill(0); new Uint8Array(inputBytes).fill(0)
  const result = await pending
  expect(result.inputFile.payload).toEqual(reference.cases[1].input)
  expect(result.reception!.lightTimeSeconds).toBeGreaterThan(0)
})

it('writes actual source-bearing CLI output and preserves existing files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'solar-spk-limb-'))
  try {
    const input = join(directory, 'input.json'), output = join(directory, 'result.json')
    await writeFile(input, JSON.stringify(reference.cases[1].input))
    const report = await evaluateSpkLimbFile(input, output)
    const original = await readFile(output, 'utf8')
    expect(JSON.parse(original)).toEqual(report)
    expect(report.inputFile.sha256).toBe(createHash('sha256').update(await readFile(input)).digest('hex'))
    for (const [path, sha] of Object.entries(report.implementationSha256)) expect(sha).toBe(createHash('sha256').update(await readFile(path)).digest('hex'))
    await expect(evaluateSpkLimbFile(input, output)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(output, 'utf8')).toBe(original)
    const cancelled = join(directory, 'cancelled.json')
    await expect(evaluateSpkLimbFile(input, cancelled, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    await expect(readFile(cancelled)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
