import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'
import { integrateAdaptive } from '../../src/engine/dynamics/adaptiveIntegrator'
import { withIdentityTransition } from '../../src/engine/dynamics/pointMassGravity'
import reference from '../fixtures/de440-dynamics-reference.json'
import manifest from '../../src/data/ephemeris-manifest.json'

const file = readFileSync(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`)
const gmText = readFileSync('src/data/gm_de440.tpc', 'utf8')
const options = () => ({ spkBytes: file.buffer.slice(file.byteOffset, file.byteOffset+file.byteLength), gmText,
  referenceEpochTdb: reference.referenceEpochTdb, elapsedRangeSeconds: [-864000, 2592000] as const,
  exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) })
let dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>
beforeAll(async () => { dynamics = await createDe440Dynamics(options()) })

test('pins source bytes and maps independent CSPICE barycentric J2000 states', () => {
  const source = manifest.files.find(entry => entry.id === DE440_DYNAMICS_SOURCE.id)!
  expect(source.sha256).toBe(DE440_DYNAMICS_SOURCE.sha256)
  expect(source.bytes).toBe(DE440_DYNAMICS_SOURCE.bytes)
  expect(dynamics.evidence.masses.map(mass => mass.naifId)).toEqual(DE440_FORCE_IDS)
  expect(DE440_FORCE_IDS).not.toContain(3)
  for (const row of reference.sourceStates) for (let i = 0; i < DE440_FORCE_IDS.length; i++) {
    const state = dynamics.state(DE440_FORCE_IDS[i], row.elapsed)
    for (let j = 0; j < 6; j++) expect(Math.abs(state[j]-row.states[i][j])).toBeLessThan(j < 3 ? 2e-6 : 1e-10)
  }
  // CSPICE's text-kernel decimal conversion and JS Number differ by a few
  // last bits; retain both values rather than claiming bitwise identity.
  for (let i = 0; i < reference.masses.length; i++) expect(Math.abs(dynamics.evidence.masses[i].gmKm3PerSecond2/reference.masses[i].gmKm3PerSecond2-1)).toBeLessThan(2e-15)
})

test('owns source bytes and returned states despite caller mutation', async () => {
  const input = options(), pending = createDe440Dynamics(input)
  new Uint8Array(input.spkBytes).fill(0)
  const frozen = await pending
  const state = frozen.state(399)
  state.fill(0)
  expect(frozen.state(399)[0]).not.toBe(0)
})

test('rejects corrupt sources, omitted exclusions and uncovered epochs', async () => {
  const corrupt = options()
  new Uint8Array(corrupt.spkBytes)[4000] ^= 1
  await expect(createDe440Dynamics(corrupt)).rejects.toThrow('checksum')
  await expect(createDe440Dynamics({ ...options(), gmText: `${gmText}\n` })).rejects.toThrow('checksum')
  await expect(createDe440Dynamics({ ...options(), exclusionKm: {} })).rejects.toThrow('contract')
  await expect(createDe440Dynamics({ ...options(), referenceEpochTdb: 2400000 })).rejects.toThrow('coverage')
  expect(() => dynamics.state(399, 2592001)).toThrow('window')
  expect(() => dynamics.state(499)).toThrow('Missing pinned')
})

for (const example of reference.cases) test(`real Eros initial state, restricted model at ${example.duration/86400} days matches independent integration`, async () => {
  const absoluteTolerance = new Float64Array(42).fill(1e-12)
  absoluteTolerance.fill(1e-5, 0, 3)
  const result = await integrateAdaptive({ initial: withIdentityTransition(reference.initial),
    duration: example.duration, derivative: dynamics.derivative, absoluteTolerance, relativeTolerance: 1e-12,
    initialStep: 3600, maxStep: 86400, maxAttempts: 10000 })
  for (let i = 0; i < 42; i++) expect(Math.abs(result.state[i]-example.result[i])/(1+Math.abs(example.result[i]))).toBeLessThan(3e-10)
  expect(Math.hypot(...Array.from(result.state.subarray(0, 3), (value, i) => value-example.result[i]))).toBeLessThan(1e-4)
  // Explicitly retain the independent source-orbit mismatch. It is not the
  // numerical integration error and is not an estimated physical uncertainty.
  const sourceResidual = Math.hypot(...Array.from(result.state.subarray(0, 3), (value, i) => value-example.originalSpkState[i]))
  expect(sourceResidual).toBeGreaterThan(.01)
  expect(Math.abs(sourceResidual-example.modelResidualPositionKm)).toBeLessThan(1e-4)
})
