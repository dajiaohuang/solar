import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'
import { propagateSourceOffsetEnsemble } from '../../src/engine/dynamics/nonlinearEnsemble'
import { parseSbdbCovariance } from '../../src/data/loaders/sbdbCovariance'
import eros from '../fixtures/sbdb-eros-covariance.json'
import bennu from '../fixtures/sbdb-bennu-covariance.json'
import reference from '../fixtures/nonlinear-ensemble-reference.json'

const DAY = 86400
const bytes = readFileSync(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`)
const create = (solarRelativity = false) => createDe440Dynamics({
  spkBytes: bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
  gmText: readFileSync('src/data/gm_de440.tpc','utf8'), referenceEpochTdb: reference.referenceEpochTdb,
  elapsedRangeSeconds: [-864000,2592000], exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id,0])), solarRelativity,
})

test('nonlinear reference retains exact source and independent generator identities', () => {
  const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
  expect(sha('scripts/reference-nonlinear-ensemble.py')).toBe(reference.generatorSha256)
  expect(sha('scripts/reference-covariance-state-samples.py')).toBe(reference.coordinateGeneratorSha256)
  expect(sha('tests/fixtures/sbdb-eros-covariance.json')).toBe(reference.sourceSha256)
  expect(sha('src/data/gm_de440.tpc')).toBe(reference.gmSha256)
  expect(DE440_DYNAMICS_SOURCE.sha256).toBe(reference.spkSha256)
})

for (const solar1pn of [false,true]) for (const durationSeconds of [-864000,2592000]) {
  test(`nonlinear draws agree with independent CSPICE/DOP853: ${durationSeconds/DAY} days, 1PN=${solar1pn}`, async () => {
    const cases = reference.cases.filter(c => c.solar1pn === solar1pn && c.durationSeconds === durationSeconds)
    const result = await propagateSourceOffsetEnsemble(await create(solar1pn),parseSbdbCovariance(eros),new Float64Array(cases.flatMap(c => c.offsets)),durationSeconds)
    expect([...result.valid]).toEqual([1,1,1])
    expect(result.failures).toEqual([])
    expect(result.numerics).toHaveLength(3)
    expect(result.evaluations).toBe(result.numerics.reduce((sum,row) => sum+row.evaluations,0))
    cases.forEach((sample,index) => sample.final.forEach((value,i) => {
      expect(Math.abs(result.finalStates[index*6+i]-value)).toBeLessThan(i < 3 ? 2e-12 : 2e-14)
      expect(sample.refinementMaxAbsolute).toBeLessThan(1e-14)
    }))
  })
}
test('preserves sample identity, invalid offsets and failures without partial cancellation results', async () => {
  const dynamics = await create(), source = parseSbdbCovariance(eros), original = structuredClone(source)
  const offsets = new Float64Array(18); offsets[6] = -2
  const pending = propagateSourceOffsetEnsemble(dynamics,source,offsets,0)
  source.nominal.fill(0); offsets.fill(100)
  const result = await pending
  expect(result.initial.source).toEqual(original)
  expect(result.initial.offsets[6]).toBe(-2)
  expect([...result.valid]).toEqual([1,0,1])
  expect(result.failures[0]).toMatchObject({ index: 1, stage: 'coordinates' })
  expect(result.finalStates.slice(6,12).every(Number.isNaN)).toBe(true)
  expect(result.evaluations).toBe(0)
  const controller = new AbortController()
  const cancelled = propagateSourceOffsetEnsemble(dynamics,original,new Float64Array(768),2592000,controller.signal)
  setTimeout(() => controller.abort(),0)
  await expect(cancelled).rejects.toThrow()
})

test('refuses unmatched force parameters, excessive work and out-of-window epochs', async () => {
  const dynamics = await create(), source = parseSbdbCovariance(eros), offsets = new Float64Array(6)
  await expect(propagateSourceOffsetEnsemble(dynamics,parseSbdbCovariance(bennu),new Float64Array(8),0)).rejects.toThrow('every additional source parameter')
  for (const count of [0,7,774]) await expect(propagateSourceOffsetEnsemble(dynamics,source,new Float64Array(count),0)).rejects.toThrow('1 to 128')
  await expect(propagateSourceOffsetEnsemble(dynamics,source,offsets,366*86400)).rejects.toThrow('365 days')
  await expect(propagateSourceOffsetEnsemble(dynamics,source,offsets,31*86400)).rejects.toThrow('frozen force window')
  await expect(propagateSourceOffsetEnsemble(dynamics,{...source,solutionEpochTdb: source.solutionEpochTdb+1},offsets,0)).rejects.toThrow('solution epoch')
})

test('retains integration failures instead of treating the survivors as the original distribution', async () => {
  const dynamics = await create(), source = parseSbdbCovariance(eros)
  const result = await propagateSourceOffsetEnsemble({ ...dynamics, derivative: () => { throw new RangeError('Point-mass exclusion reached') } },source,new Float64Array(12),86400)
  expect([...result.valid]).toEqual([0,0])
  expect(result.failures.map(f => [f.index,f.stage])).toEqual([[0,'integration'],[1,'integration']])
  expect(result.evaluations).toBe(2)
  expect(result.finalStates.every(Number.isNaN)).toBe(true)
})

test('enforces one shared force-evaluation budget across the entire ensemble', async () => {
  const dynamics = await create()
  let calls = 0
  const synthetic = { ...dynamics, evidence: { ...dynamics.evidence, elapsedRangeSeconds: [0,365*DAY] },
    state: () => new Float64Array(6), derivative: (_t: number, _y: Float64Array, out: Float64Array) => { calls++; out.fill(0) } }
  vi.useFakeTimers()
  try {
    const rejection = expect(propagateSourceOffsetEnsemble(synthetic,parseSbdbCovariance(eros),new Float64Array(768),365*DAY)).rejects.toThrow('shared 250000')
    await vi.runAllTimersAsync()
    await rejection
    expect(calls).toBe(250000)
  } finally { vi.useRealTimers() }
}, 10000)
