import type { SpkKernel } from './spk'
import type { Vector3 } from '../../types'

export type GeometricState = { position: Vector3; velocity: Vector3 }
export type LoadedKernel = { id: string; kernel: SpkKernel }
/** A scan must not acquire/drop a kernel halfway through a curve or event
 * bracket: that discontinuity can manufacture an extremum. Conservative
 * whole-segment coverage is deliberate; partial files fall back for the scan. */
export function kernelsCoveringInterval(kernels: readonly LoadedKernel[], startEt: number, endEt: number) {
  if (!Number.isFinite(startEt) || !Number.isFinite(endEt) || endEt < startEt) return []
  return kernels.filter(({ kernel }) => kernel.segments.length > 0 && kernel.segments.every((segment) => segment.startEt <= startEt && segment.endEt >= endEt))
}
const ZERO = { x: 0, y: 0, z: 0 }
const OBLIQUITY = 84381.448 / 3600 * Math.PI / 180
const add = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const subtract = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

/** J2000 equatorial -> ECLIPJ2000, the fixed NAIF frame 17 rotation. */
export function toEcliptic(vector: Vector3, frame: number): Vector3 {
  if (frame === 17) return vector
  if (frame !== 1) throw new Error(`Unsupported SPK reference frame ${frame}`)
  return {
    x: vector.x,
    y: Math.cos(OBLIQUITY) * vector.y + Math.sin(OBLIQUITY) * vector.z,
    z: -Math.sin(OBLIQUITY) * vector.y + Math.cos(OBLIQUITY) * vector.z,
  }
}

/** One epoch, one pool snapshot. Units remain km and km/s until the app boundary. */
export function createKernelResolver(kernels: readonly LoadedKernel[], et: number) {
  if (!Number.isFinite(et)) throw new RangeError('Ephemeris time must be finite')
  const cache = new Map<number, GeometricState | null>()
  const visiting = new Set<number>()
  const barycentric = (target: number): GeometricState | null => {
    if (target === 0) return { position: ZERO, velocity: ZERO }
    if (cache.has(target)) return cache.get(target)!
    if (visiting.has(target) || visiting.size > 32) throw new Error('Cyclic or excessively deep SPK center chain')
    visiting.add(target)
    try {
      for (let index = kernels.length - 1; index >= 0; index--) {
        const state = kernels[index].kernel.evaluate(target, et)
        if (!state) continue
        const center = barycentric(state.center)
        // A higher-priority segment with a missing center is not permission to
        // silently substitute a different model or an older kernel.
        const result = center ? {
          position: add(center.position, toEcliptic(state.position, state.frame)),
          velocity: add(center.velocity, toEcliptic(state.velocity, state.frame)),
        } : null
        cache.set(target, result)
        return result
      }
      cache.set(target, null)
      return null
    } finally { visiting.delete(target) }
  }
  return {
    barycentric,
    relative(target: number, observer: number): GeometricState | null {
      const body = barycentric(target), center = barycentric(observer)
      if (!body || !center) return null
      return { position: subtract(body.position, center.position), velocity: subtract(body.velocity, center.velocity) }
    },
  }
}
