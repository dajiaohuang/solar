import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { withSolarRelativity, SOLAR_1PN } from '../../src/engine/dynamics/solarRelativity'
import { withIdentityTransition } from '../../src/engine/dynamics/pointMassGravity'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'
import { integrateDynamicsExperiment } from '../../src/engine/dynamics/experiment'
import reference from '../fixtures/de440-solar-1pn-reference.json'

const gm = reference.masses[0].gmKm3PerSecond2
const sun = Float64Array.from(reference.sourceStates[0].states[0])
const correction = withSolarRelativity((_t, _y, out) => out.fill(0), () => sun, gm)

test('solar acceleration and all six Jacobian columns match independent complex-step reference', () => {
  const out = new Float64Array(42)
  correction(0, withIdentityTransition(reference.initial), out)
  for (let row = 0; row < 3; row++) {
    expect(Math.abs(out[row+3]/reference.solarRelativity.acceleration[row]-1)).toBeLessThan(1e-13)
    for (let col = 0; col < 6; col++) expect(Math.abs(out[6+(row+3)*6+col]/reference.solarRelativity.jacobian[row][col]-1)).toBeLessThan(1e-12)
  }
})

test('nonidentity transition includes velocity derivatives and preserves the existing force', () => {
  const state = withIdentityTransition(reference.initial)
  for (let i = 0; i < 36; i++) state[i+6] = Math.sin(i+1)
  const out = new Float64Array(42), combined = withSolarRelativity((_t, _y, output) => output.fill(2), () => sun, gm)
  // Isolate the correction to avoid losing small terms when added to 2.
  correction(0, state, out)
  for (let row = 0; row < 3; row++) for (let col = 0; col < 6; col++) {
    const expected = reference.solarRelativity.jacobian[row].reduce((sum, value, k) => sum+value*state[6+k*6+col], 0)
    expect(Math.abs((out[6+(row+3)*6+col]-expected)/expected)).toBeLessThan(1e-12)
  }
  const baseline = new Float64Array(42); combined(0, state, baseline)
  // Six sequential additions need not round identically to one sum.
  for (let i = 0; i < 42; i++) expect(Math.abs(baseline[i]-(2+out[i]))).toBeLessThanOrEqual(12*Number.EPSILON)
})

test('a common spatial translation and velocity boost leave the relative correction unchanged', () => {
  const offset = [100, -200, 300, 4, -5, 6]
  const boosted = withSolarRelativity((_t, _y, out) => out.fill(0), () => sun.map((value, i) => value+offset[i]), gm)
  const expected = new Float64Array(42), actual = new Float64Array(42)
  correction(0, withIdentityTransition(reference.initial), expected)
  boosted(0, withIdentityTransition(reference.initial.map((value, i) => value+offset[i])), actual)
  for (let i = 0; i < 42; i++) expect(Math.abs(actual[i]-expected[i])).toBeLessThan(1e-25)
})

test('rejects strong-field, high-speed and incomplete source states', () => {
  const y = Float64Array.from(reference.initial), out = new Float64Array(6)
  y.set(sun.subarray(0, 3))
  expect(() => correction(0, y, out)).toThrow('domain')
  y.set(reference.initial); y[3] = SOLAR_1PN.speedOfLightKmPerSecond
  expect(() => correction(0, y, out)).toThrow('domain')
  const missing = withSolarRelativity((_t, _y, o) => o.fill(0), () => new Float64Array([0]), gm)
  expect(() => missing(0, y, out)).toThrow('Sun six-state')
  expect(() => withSolarRelativity(correction, () => sun, 0)).toThrow('GM')
})

for (const example of reference.cases) test(`DE440 solar 1PN ${example.duration/86400} days matches independent CSPICE/DOP853`, async () => {
  const bytes = readFileSync(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`)
  const force = await createDe440Dynamics({ spkBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength),
    gmText: readFileSync('src/data/gm_de440.tpc', 'utf8'), referenceEpochTdb: reference.referenceEpochTdb,
    elapsedRangeSeconds: [Math.min(0, example.duration), Math.max(0, example.duration)],
    exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 1])), solarRelativity: true })
  const result = await integrateDynamicsExperiment(force, reference.initial, example.duration)
  const actual = [...result.finalStateKmKmPerSecond, ...result.transitionMatrix.values]
  for (let i = 0; i < 42; i++) expect(Math.abs(actual[i]-example.result[i])/(1+Math.abs(example.result[i]))).toBeLessThan(3e-10)
  expect(Math.hypot(...actual.slice(0, 3).map((value, i) => value-example.result[i]))).toBeLessThan(1e-4)
  expect(Math.abs(Math.hypot(...actual.slice(0, 3).map((value, i) => value-example.originalSpkState[i]))-example.modelResidualPositionKm)).toBeLessThan(1e-4)
  expect(result.forceModel.solarRelativity?.model).toBe('solar-monopole-1pn')
  expect(result.forceModel.limitations).not.toContain('No relativistic, harmonic, non-gravitational or test-particle back-reaction forces.')
})
