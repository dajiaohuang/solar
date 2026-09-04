import seedData from '../../data/ephemerisBodies.json'
import { bodyNaifId } from '../../data/ephemerisTargets'
import { AU_IN_KM, SECONDS_PER_DAY } from '../units'
import { loadedKernels } from './kernelStore'
import { createKernelResolver } from './kernelPool'
import { stateToOsculatingElements } from './osculating'
import { apparentPosition, type ApparentMode, type BarycentricState } from './apparent'
import { utcJulianDayToEt } from './timeScales'
import type { CelestialBody } from '../../types'

export function currentOsculatingElements(body: CelestialBody, parent: CelestialBody, utcJd: number) {
  const targetId = bodyNaifId(body), parentId = bodyNaifId(parent)
  if (targetId === undefined || parentId === undefined || targetId === parentId) return null
  const gm = seedData.source.gmKm3S2 as Record<string, number>
  if (!gm[parentId]) return null
  try {
    const state = createKernelResolver(loadedKernels(), utcJulianDayToEt(utcJd)).relative(targetId, parentId)
    if (!state) return null
    const position = { x: state.position.x / AU_IN_KM, y: state.position.y / AU_IN_KM, z: state.position.z / AU_IN_KM }
    const velocity = { x: state.velocity.x * SECONDS_PER_DAY / AU_IN_KM, y: state.velocity.y * SECONDS_PER_DAY / AU_IN_KM, z: state.velocity.z * SECONDS_PER_DAY / AU_IN_KM }
    return stateToOsculatingElements(position, velocity, (gm[parentId] + (gm[targetId] ?? 0)) * SECONDS_PER_DAY ** 2 / AU_IN_KM ** 3)
  } catch { return null }
}

/** Separate reception geometry. Scene positions remain geometric, never a mix
 * of retarded positions and simultaneous orbital elements. */
export function currentObservation(body: CelestialBody, observer: CelestialBody, utcJd: number, mode: ApparentMode) {
  const targetId = bodyNaifId(body), observerId = bodyNaifId(observer)
  if (targetId === undefined || observerId === undefined || targetId === observerId) return null
  const kernels = loadedKernels()
  try {
    const et = utcJulianDayToEt(utcJd)
    const tdbJd = 2451545 + et / SECONDS_PER_DAY
    const resolve = (id: number, jd: number): BarycentricState => {
      const state = createKernelResolver(kernels, et + (jd - tdbJd) * SECONDS_PER_DAY).barycentric(id)
      if (!state) throw new RangeError('Observation emission epoch is outside loaded SPK coverage')
      return { position: [state.position.x, state.position.y, state.position.z], velocity: [state.velocity.x, state.velocity.y, state.velocity.z] }
    }
    const result = apparentPosition({ target: (jd) => resolve(targetId, jd), observer: (jd) => resolve(observerId, jd), julianDay: tdbJd, mode })
    return result.converged ? result : null
  } catch { return null }
}
