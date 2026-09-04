import type { SpkKernel } from './spk'
import type { Vector3 } from '../../types'

export type GeometricState = { position: Vector3; velocity: Vector3 }
export type LoadedKernel = {
  id: string; kernel: SpkKernel;
  /** Ordered, complete dependency pool; the root itself is appended last. */
  solutionKernelIds?: readonly string[];
  /** Available inside explicit pools, never an implicit root override. */
  dependencyOnly?: boolean;
}
/** A scan must not acquire/drop a kernel halfway through a curve or event
 * bracket: that discontinuity can manufacture an extremum. Each target must
 * have gap-free coverage for the whole interval, including adjacent original
 * backward/forward integration segments. The file set stays fixed throughout. */
export function kernelsCoveringInterval(kernels: readonly LoadedKernel[], startEt: number, endEt: number) {
  if (!Number.isFinite(startEt) || !Number.isFinite(endEt) || endEt < startEt) return []
  return kernels.filter(({ kernel }) => {
    const targets = [...new Set(kernel.segments.map(segment => segment.target))]
    return targets.length > 0 && targets.every(target => {
      const segments = kernel.segments.filter(segment => segment.target === target)
        .sort((a, b) => a.startEt - b.startEt)
      let coveredUntil = startEt
      let started = false
      for (const segment of segments) {
        if (segment.endEt < startEt) continue
        if (segment.startEt > coveredUntil) break
        started = true
        coveredUntil = Math.max(coveredUntil, segment.endEt)
        if (coveredUntil >= endEt) return true
      }
      return started && coveredUntil >= endEt
    })
  })
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
  const byId = new Map(kernels.map(kernel => [kernel.id, kernel]))
  if (byId.size !== kernels.length) throw new Error('Duplicate SPK kernel identity')
  // Legacy unbound sources cannot acquire new dependency-only cores or new
  // explicitly bound satellite solutions merely because another body loaded.
  const legacy = kernels.filter(kernel => !kernel.dependencyOnly && kernel.solutionKernelIds === undefined)
  const contexts = new Map<string, readonly LoadedKernel[] | null>([['legacy', legacy]])
  const cache = new Map<string, GeometricState | null>()
  const visiting = new Set<string>()
  const contextFor = (target: number): string => {
    for (let index = kernels.length - 1; index >= 0; index--) {
      const root = kernels[index]
      if (root.dependencyOnly || !root.kernel.segments.some(segment => segment.target === target && segment.startEt <= et && segment.endEt >= et)) continue
      if (root.solutionKernelIds === undefined) return 'legacy'
      const key = `root:${root.id}`
      if (!contexts.has(key)) {
        const ids = root.solutionKernelIds
        if (ids.includes(root.id) || new Set(ids).size !== ids.length) throw new Error('Invalid explicit SPK dependency pool')
        contexts.set(key, ids.every(id => byId.has(id)) ? [...ids.map(id => byId.get(id)!), root] : null)
      }
      return key
    }
    return 'legacy'
  }
  const resolveIn = (target: number, context: string): GeometricState | null => {
    if (target === 0) return { position: ZERO, velocity: ZERO }
    const pool = contexts.get(context)
    if (!pool) return null
    const key = `${context}/${target}`
    if (cache.has(key)) return cache.get(key)!
    if (visiting.has(key) || visiting.size > 32) throw new Error('Cyclic or excessively deep SPK center chain')
    visiting.add(key)
    try {
      for (let index = pool.length - 1; index >= 0; index--) {
        const state = pool[index].kernel.evaluate(target, et)
        if (!state) continue
        const center = resolveIn(state.center, context)
        // A higher-priority segment with a missing center is not permission to
        // silently substitute a different model or an older kernel.
        const result = center ? {
          position: add(center.position, toEcliptic(state.position, state.frame)),
          velocity: add(center.velocity, toEcliptic(state.velocity, state.frame)),
        } : null
        cache.set(key, result)
        return result
      }
      cache.set(key, null)
      return null
    } finally { visiting.delete(key) }
  }
  const barycentric = (target: number) => resolveIn(target, contextFor(target))
  return {
    barycentric,
    relative(target: number, observer: number): GeometricState | null {
      const context = contextFor(target)
      const body = resolveIn(target, context)
      // Sun and included parent centers use the exact same source pool. An
      // unrelated observer may require its independently declared solution;
      // that comparison is not a claim of a single global dynamical fit.
      const observerInPool = contexts.get(context)?.some(({ kernel }) => kernel.segments.some(segment => segment.target === observer && segment.startEt <= et && segment.endEt >= et))
      const center = observer === 0 || observerInPool ? resolveIn(observer, context) : barycentric(observer)
      if (!body || !center) return null
      return { position: subtract(body.position, center.position), velocity: subtract(body.velocity, center.velocity) }
    },
  }
}
