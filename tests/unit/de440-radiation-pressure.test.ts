import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../../src/engine/dynamics/de440Dynamics'
import { withIdentityTransition } from '../../src/engine/dynamics/pointMassGravity'
import { SOLAR_RADIATION_PRESSURE } from '../../src/engine/dynamics/solarRadiationPressure'
import reference from '../fixtures/de440-dynamics-reference.json'

const bytes = readFileSync(`public/data/ephemerides/${DE440_DYNAMICS_SOURCE.path}`)
const gmText = readFileSync('src/data/gm_de440.tpc', 'utf8')
const parameters = {
  model: 'constant-radial-srp' as const, illumination: 'unshadowed' as const,
  pressureAt1AuNewtonPerSquareMeter: 4.56e-6, areaSquareMeters: 20,
  massKg: 1000, reflectivityCoefficient: 1.5, source: 'Explicit synthetic spacecraft properties',
}
const options = () => ({ spkBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), gmText,
  referenceEpochTdb: reference.referenceEpochTdb, elapsedRangeSeconds: [-86400, 86400] as const,
  exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) })

for (const solarRelativity of [false, true]) test(`DE440 composes SRP with relativity=${solarRelativity} and retains its actual force evidence`, async () => {
  const input = { ...parameters }
  const pending = createDe440Dynamics({ ...options(), solarRelativity, solarRadiationPressure: input })
  // Ownership must precede the asynchronous source hashing boundary.
  input.massKg = 1
  const combined = await pending
  const baseline = await createDe440Dynamics({ ...options(), solarRelativity })
  for (const elapsed of [-86400, 0, 86400]) {
    const state = withIdentityTransition(reference.initial)
    const actual = new Float64Array(42), original = new Float64Array(42)
    combined.derivative(elapsed, state, actual); baseline.derivative(elapsed, state, original)
    const sun = baseline.state(10, elapsed)
    const delta = Array.from(state.slice(0, 3), (value, i) => value - sun[i])
    const radius = Math.hypot(...delta), unit = delta.map(value => value / radius)
    const acceleration = 1.368e-10 * (149597870.7 / radius) ** 2
    for (let row = 0; row < 3; row++) {
      expect(Math.abs((actual[row + 3] - original[row + 3]) / (acceleration * unit[row]) - 1)).toBeLessThan(1e-9)
      for (let column = 0; column < 3; column++) {
        const index = 6 + (row + 3) * 6 + column
        const expected = acceleration / radius * (Number(row === column) - 3 * unit[row] * unit[column])
        expect(Math.abs((actual[index] - original[index]) / expected - 1)).toBeLessThan(1e-9)
      }
    }
    expect(actual.slice(0, 3)).toEqual(original.slice(0, 3))
    expect(actual.slice(6, 24)).toEqual(original.slice(6, 24))
  }
  expect(combined.evidence.model).toBe(solarRelativity ? 'restricted-newtonian-plus-solar-1pn-and-radial-srp' : 'restricted-newtonian-plus-radial-srp')
  expect(combined.evidence.solarRadiationPressure?.parameters).toEqual(parameters)
  expect(combined.evidence.limitations).toContain(SOLAR_RADIATION_PRESSURE.limitation)
  expect(combined.evidence.limitations).not.toContain('No non-gravitational forces.')
  expect(baseline.evidence.solarRadiationPressure).toBeNull()
  expect(baseline.evidence.limitations).toContain('No non-gravitational forces.')
})
