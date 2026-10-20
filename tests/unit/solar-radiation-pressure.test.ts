import { expect, test } from 'vitest'
import { parseSolarRadiationPressure, withSolarRadiationPressure } from '../../src/engine/dynamics/solarRadiationPressure'
import { DynamicsSampleError } from '../../src/engine/dynamics/sampleFailure'

const parameters = {
  model: 'constant-radial-srp' as const, illumination: 'unshadowed' as const,
  pressureAt1AuNewtonPerSquareMeter: 4.56e-6, areaSquareMeters: 20,
  massKg: 1000, reflectivityCoefficient: 1.5, source: 'Explicit test parameters, not an observed spacecraft',
}
const au = 149597870.7
const zero = (_t: number, _y: Float64Array, out: Float64Array) => { out.fill(0) }

test('SI force becomes outward km/s² with inverse-square distance and additive base acceleration', () => {
  const sun = new Float64Array([30, -40, 50, 0, 0, 0])
  const force = withSolarRadiationPressure((_t, _y, out) => { out.fill(2e-10) }, () => sun, parameters)
  for (const distance of [0.5, 1, 2]) {
    const out = new Float64Array(6)
    force(0, new Float64Array([30, -40 - distance * au, 50, 1, 2, 3]), out)
    // 4.56 µPa × 20 m² × 1.5 / 1000 kg = 1.368e-7 m/s² at 1 AU.
    expect(out[4]).toBeCloseTo(2e-10 - 1.368e-10 / distance ** 2, 23)
    for (const i of [0, 1, 2, 3, 5]) expect(out[i]).toBe(2e-10)
  }
})

test('arbitrary transition matrices match finite differences of the independent vector force', () => {
  const sun = new Float64Array([300, -400, 500, 7, 8, 9])
  const state = new Float64Array(42)
  state.set([0.7 * au, -1.1 * au, 0.4 * au, 2, 3, 4])
  for (let i = 6; i < 42; i++) state[i] = Math.sin(i)
  const out = new Float64Array(42)
  withSolarRadiationPressure(zero, () => sun, parameters)(0, state, out)
  const reference = (position: number[]) => {
    const meters = position.map((x, i) => (x - sun[i]) * 1000)
    const radius = Math.hypot(...meters)
    const magnitude = 4.56e-6 * 20 * 1.5 / 1000 * (149597870700 / radius) ** 2
    return meters.map(x => magnitude * x / radius / 1000)
  }
  const jacobian = Array.from({ length: 3 }, () => new Array<number>(3))
  for (let k = 0; k < 3; k++) {
    const plus = [...state.slice(0, 3)], minus = [...plus]
    plus[k] += 100; minus[k] -= 100
    const a = reference(plus), b = reference(minus)
    for (let row = 0; row < 3; row++) jacobian[row][k] = (a[row] - b[row]) / 200
  }
  for (let row = 0; row < 3; row++) for (let column = 0; column < 6; column++) {
    const expected = jacobian[row].reduce((sum, value, k) => sum + value * state[6 + k * 6 + column], 0)
    expect(Math.abs(out[6 + (row + 3) * 6 + column] - expected)).toBeLessThan(1e-27)
  }
  expect([...out.slice(6, 24)]).toEqual(new Array(18).fill(0))
})

test('the wrapper owns its parameters and is invariant under common translation and velocity changes', () => {
  const input = { ...parameters }
  const force = withSolarRadiationPressure(zero, () => new Float64Array(6), input)
  input.massKg = 1
  const out = new Float64Array(6), translated = new Float64Array(6)
  force(0, new Float64Array([au, 2 * au, -au, 0, 0, 0]), out)
  withSolarRadiationPressure(zero, () => new Float64Array([100, 200, 300, 5, 6, 7]), parameters)(
    0, new Float64Array([au + 100, 2 * au + 200, -au + 300, 9, 10, 11]), translated)
  expect(translated).toEqual(out)
  expect(Object.isFrozen(parseSolarRadiationPressure(parameters))).toBe(true)
})

test('invalid configuration and broken source providers are not classified as failed trajectory samples', () => {
  for (const patch of [{ massKg: 0 }, { areaSquareMeters: NaN }, { source: '' }, { illumination: 'shadowed' }, { extra: true }]) {
    expect(() => parseSolarRadiationPressure({ ...parameters, ...patch })).toThrow(RangeError)
  }
  const force = withSolarRadiationPressure(zero, () => new Float64Array(3), parameters)
  try { force(0, new Float64Array([au, 0, 0, 0, 0, 0]), new Float64Array(6)) }
  catch (error) {
    expect(error).toBeInstanceOf(RangeError)
    expect(error).not.toBeInstanceOf(DynamicsSampleError)
    return
  }
  throw new Error('Incomplete Sun state must fail')
})

test('a Sun collision is an explicit trajectory failure', () => {
  const force = withSolarRadiationPressure(zero, () => new Float64Array(6), parameters)
  expect(() => force(0, new Float64Array(6), new Float64Array(6))).toThrow(DynamicsSampleError)
})
