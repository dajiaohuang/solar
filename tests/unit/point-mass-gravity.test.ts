import { expect, test } from 'vitest'
import { integrateAdaptive } from '../../src/engine/dynamics/adaptiveIntegrator'
import { createPointMassGravity, withIdentityTransition, type PrescribedEphemeris } from '../../src/engine/dynamics/pointMassGravity'
import reference from '../fixtures/dynamics-reference.json'

const source: PrescribedEphemeris = { frame: 'J2000', origin: 'SSB', timeScale: 'TDB', aberration: 'NONE',
  referenceEpochTdb: 2451545, elapsedRangeSeconds: [-100, 100], source: 'Analytic fixed origin, unit GM test only',
  positions: (_t, _ids, out) => out.fill(0) }
const model = () => createPointMassGravity([{ naifId: 10, gmKm3PerSecond2: 1, gmSource: 'Analytic unit-GM example', exclusionKm: 0 }], source)

test('point force and analytic variational gradient agree with known radial values', () => {
  const state = withIdentityTransition([2, 0, 0, 0, 1, 0]), out = new Float64Array(42)
  model().derivative(0, state, out)
  expect([...out.subarray(0, 6)]).toEqual([0, 1, 0, -.25, 0, 0])
  expect(out[6 + 3*6]).toBe(.25)
  expect(out[6 + 4*6+1]).toBe(-.125)
  expect(out[6 + 5*6+2]).toBe(-.125)
})

test('full-period circular integration and transition matrix preserve analytic invariants', async () => {
  const initial = withIdentityTransition([1, 0, 0, 0, 1, 0])
  const result = await integrateAdaptive({ initial, duration: 2*Math.PI, derivative: model().derivative,
    absoluteTolerance: new Float64Array(42).fill(1e-12), relativeTolerance: 1e-11,
    initialStep: .1, maxStep: .2, maxAttempts: 10000 })
  const y = result.state
  for (let i = 0; i < 6; i++) expect(y[i]).toBeCloseTo(initial[i], 8)
  const energy = (y[3]**2+y[4]**2+y[5]**2)/2 - 1/Math.hypot(...y.subarray(0, 3))
  expect(energy).toBeCloseTo(-.5, 10)
  expect(y[0]*y[4] - y[1]*y[3]).toBeCloseTo(1, 10)
  // Autonomous flow maps its initial tangent f(y0) to f(y(t)).
  const endpoint = new Float64Array(6)
  model().derivative(result.elapsed, y.subarray(0, 6), endpoint)
  for (let row = 0; row < 6; row++) expect(y[6+row*6+1] - y[6+row*6+3]).toBeCloseTo(endpoint[row], 8)
})

test('force rejects missing source coordinates, coverage gaps and close approaches', () => {
  const state = new Float64Array([1, 0, 0, 0, 1, 0]), out = new Float64Array(6)
  expect(() => model().derivative(101, state, out)).toThrow('coverage')
  expect(() => model().derivative(0, new Float64Array(6), out)).toThrow('exclusion')
  const missing = createPointMassGravity([{ naifId: 10, gmKm3PerSecond2: 1, gmSource: 'test', exclusionKm: 0 }], { ...source, positions: () => {} })
  expect(() => missing.derivative(0, state, out)).toThrow('every finite mass')
})

test('force contributions superpose and translate with the inertial origin', () => {
  const masses = [{ naifId: 10, gmKm3PerSecond2: 1, gmSource: 'test', exclusionKm: 0 }, { naifId: 399, gmKm3PerSecond2: 1, gmSource: 'test', exclusionKm: 0 }]
  for (const offset of [0, 100]) {
    const force = createPointMassGravity(masses, { ...source, positions: (_t, _ids, out) => { out.set([offset-1, 0, 0, offset+1, 0, 0]) } })
    const out = new Float64Array(6)
    force.derivative(0, new Float64Array([offset, 0, 0, 0, 0, 0]), out)
    expect([...out]).toEqual([0, 0, 0, 0, 0, 0])
  }
})

for (const example of reference.cases) test(`independent ${example.referenceMethod} reference: ${example.name}`, async () => {
  const masses = [{ naifId: 10, gmKm3PerSecond2: 1, gmSource: 'Synthetic reference unit GM', exclusionKm: 0 }]
  if (example.moving) masses.push({ naifId: 399, gmKm3PerSecond2: .03, gmSource: 'Synthetic prescribed perturber', exclusionKm: 0 })
  const force = createPointMassGravity(masses, { ...source,
    positions: (t, _ids, out) => { out.fill(0); if (example.moving) out.set([5*Math.cos(t/10), 5*Math.sin(t/10), 1], 3) } })
  const result = await integrateAdaptive({ initial: withIdentityTransition(example.initial), duration: example.duration,
    derivative: force.derivative, absoluteTolerance: new Float64Array(42).fill(1e-15), relativeTolerance: 1e-14,
    initialStep: .01, maxStep: .05, maxAttempts: 20000 })
  // Compare all six states and all 36 transition coefficients; this bounds
  // observed numerical disagreement for these synthetic examples only.
  for (let i = 0; i < 42; i++) expect(Math.abs(result.state[i]-example.result[i]) / (1+Math.abs(example.result[i]))).toBeLessThan(3e-7)
})
