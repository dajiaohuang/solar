import type { Derivative } from './adaptiveIntegrator'
import { DynamicsSampleError } from './sampleFailure.ts'

export const SOLAR_1PN = Object.freeze({
  model: 'solar-monopole-1pn' as const,
  speedOfLightKmPerSecond: 299792.458,
  maxExpansionParameter: 1e-4,
  reference: 'https://cds.cern.ch/record/257177/files/P00019892.pdf',
  equation: 'mu/(c^2 r^3) [(4 mu/r - v^2) r + 4 (r.v) v]',
  approximation: 'Sun-relative position and velocity; added to prescribed barycentric Newtonian acceleration. Not full barycentric EIH dynamics.',
})

/** Adds a test-particle Schwarzschild monopole term and its analytic position
 * AND velocity Jacobians. The prescribed Sun and its parameters are fixed.
 * The expansion-domain cut is an explicit validity guard, not an error bound. */
export function withSolarRelativity(base: Derivative, sunState: (elapsed: number) => Float64Array, gm: number): Derivative {
  if (!Number.isFinite(gm) || gm <= 0) throw new RangeError('Solar 1PN requires positive finite GM')
  const r = new Float64Array(3), v = new Float64Array(3), force = new Float64Array(3)
  const dr = new Float64Array(9), dv = new Float64Array(9)
  const c2 = SOLAR_1PN.speedOfLightKmPerSecond ** 2
  return (elapsed, state, output) => {
    if (![6, 42].includes(state.length) || output.length !== state.length || !state.every(Number.isFinite)) throw new RangeError('Solar 1PN requires a finite six-state or 42-state')
    base(elapsed, state, output)
    if (!output.every(Number.isFinite)) throw new RangeError('Solar 1PN base derivative did not supply every finite component')
    const sun = sunState(elapsed)
    if (sun.length !== 6 || !sun.every(Number.isFinite)) throw new RangeError('Solar 1PN requires a finite prescribed Sun six-state')
    for (let i = 0; i < 3; i++) { r[i] = state[i]-sun[i]; v[i] = state[i+3]-sun[i+3] }
    const radius = Math.hypot(...r), speed2 = v[0]**2 + v[1]**2 + v[2]**2
    if (!(radius > 0) || !Number.isFinite(radius) || gm/radius/c2 > SOLAR_1PN.maxExpansionParameter || speed2/c2 > SOLAR_1PN.maxExpansionParameter) throw new DynamicsSampleError('Solar 1PN weak-field/slow-motion domain exceeded')
    const k = gm/c2/radius/radius/radius, a = 4*gm/radius-speed2, b = r[0]*v[0]+r[1]*v[1]+r[2]*v[2]
    for (let i = 0; i < 3; i++) {
      force[i] = a*r[i] + 4*b*v[i]
      output[i+3] += k*force[i]
      if (state.length === 42) for (let j = 0; j < 3; j++) {
        dr[3*i+j] = k*(a*Number(i === j) - 4*gm/radius*(r[i]/radius)*(r[j]/radius) + 4*v[i]*v[j] - 3*(r[j]/radius)*(force[i]/radius))
        dv[3*i+j] = k*(-2*v[j]*r[i] + 4*r[j]*v[i] + 4*b*Number(i === j))
      }
    }
    if (state.length === 42) for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) {
      for (let q = 0; q < 3; q++) output[6+(i+3)*6+j] += dr[3*i+q]*state[6+q*6+j] + dv[3*i+q]*state[6+(q+3)*6+j]
    }
    if (!output.every(Number.isFinite)) throw new DynamicsSampleError('Solar 1PN derivative became nonfinite')
  }
}
