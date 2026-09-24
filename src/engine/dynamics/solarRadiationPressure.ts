import type { Derivative } from './adaptiveIntegrator.ts'
import { DynamicsSampleError } from './sampleFailure.ts'

export type SolarRadiationPressure = Readonly<{
  model: 'constant-radial-srp'
  illumination: 'unshadowed'
  pressureAt1AuNewtonPerSquareMeter: number
  areaSquareMeters: number
  massKg: number
  reflectivityCoefficient: number
  source: string
}>

export const SOLAR_RADIATION_PRESSURE = Object.freeze({
  astronomicalUnitKm: 149597870.7,
  reference: 'https://software.llnl.gov/SSAPy/api/ssapy.accel.AccelSolRad.html',
  equation: 'a = (P_1AU Cr A / m) (AU/r)^2 u / 1000 [km/s^2]; da/dr = (|a|/r) (I - 3 u u^T)',
  limitation: 'Constant effective area, mass, optical coefficient and pressure; unshadowed outward radial force only. No eclipses, attitude, time-varying solar flux, thermal recoil, outgassing or parameter uncertainty.',
})

/** No physical parameter defaults: a source declaration is retained, not authenticated. */
export function parseSolarRadiationPressure(value: unknown): SolarRadiationPressure {
  const input = value as Record<string, unknown> | null
  const fields = ['pressureAt1AuNewtonPerSquareMeter', 'areaSquareMeters', 'massKg', 'reflectivityCoefficient'] as const
  if (!input || input.model !== 'constant-radial-srp' || input.illumination !== 'unshadowed' ||
      typeof input.source !== 'string' || !input.source.trim() || input.source.length > 8192 ||
      fields.some(key => typeof input[key] !== 'number' || !Number.isFinite(input[key]) || (input[key] as number) <= 0) ||
      Object.keys(input).some(key => !['model', 'illumination', 'source', ...fields].includes(key))) {
    throw new RangeError('Solar radiation pressure requires an explicit unshadowed radial model, positive finite SI parameters and a source; unknown fields are rejected')
  }
  const parameters = Object.freeze({ model: input.model, illumination: input.illumination,
    pressureAt1AuNewtonPerSquareMeter: input.pressureAt1AuNewtonPerSquareMeter as number,
    areaSquareMeters: input.areaSquareMeters as number, massKg: input.massKg as number,
    reflectivityCoefficient: input.reflectivityCoefficient as number, source: input.source })
  const acceleration = accelerationAt1Au(parameters)
  if (!(acceleration > 0) || !Number.isFinite(acceleration)) throw new RangeError('Solar radiation pressure amplitude is not representable')
  return parameters
}

function accelerationAt1Au(parameters: SolarRadiationPressure) {
  return parameters.pressureAt1AuNewtonPerSquareMeter * parameters.reflectivityCoefficient *
    (parameters.areaSquareMeters / parameters.massKg) / 1000
}

/** Analytic state Jacobian with prescribed Sun and all force parameters fixed. */
export function withSolarRadiationPressure(base: Derivative, sunState: (elapsed: number) => Float64Array, input: SolarRadiationPressure): Derivative {
  const parameters = parseSolarRadiationPressure(input), amplitude = accelerationAt1Au(parameters)
  const unit = new Float64Array(3)
  return (elapsed, state, output) => {
    if (![6, 42].includes(state.length) || output.length !== state.length || !state.every(Number.isFinite)) throw new RangeError('Solar radiation pressure requires a finite six-state or 42-state')
    base(elapsed, state, output)
    if (!output.every(Number.isFinite)) throw new RangeError('Solar radiation pressure base derivative did not supply every finite component')
    const sun = sunState(elapsed)
    if (sun.length !== 6 || !sun.every(Number.isFinite)) throw new RangeError('Solar radiation pressure requires a finite prescribed Sun state')
    for (let i = 0; i < 3; i++) unit[i] = state[i] - sun[i]
    const radius = Math.hypot(...unit)
    if (!(radius > 0) || !Number.isFinite(radius)) throw new DynamicsSampleError('Invalid solar radiation pressure distance')
    const ratio = SOLAR_RADIATION_PRESSURE.astronomicalUnitKm / radius
    const acceleration = amplitude * ratio * ratio, gradient = acceleration / radius
    if (!(acceleration > 0) || !Number.isFinite(acceleration) || !Number.isFinite(gradient) || (state.length === 42 && gradient === 0)) throw new DynamicsSampleError('Solar radiation pressure derivative is not representable')
    for (let i = 0; i < 3; i++) unit[i] /= radius
    for (let row = 0; row < 3; row++) {
      output[row + 3] += acceleration * unit[row]
      if (state.length === 42) for (let column = 0; column < 6; column++) {
        for (let k = 0; k < 3; k++) output[6 + (row + 3) * 6 + column] +=
          gradient * (Number(row === k) - 3 * unit[row] * unit[k]) * state[6 + k * 6 + column]
      }
    }
    if (!output.every(Number.isFinite)) throw new DynamicsSampleError('Solar radiation pressure derivative became nonfinite')
  }
}
