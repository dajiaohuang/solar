import type { SpkKernel, SpkSegment } from './spk'
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
    if (kernel.coversAllTargetsForInterval) return kernel.coversAllTargetsForInterval(startEt, endEt)
    // Group once rather than rescanning every segment for every target. Sort
    // only these private arrays for lightweight structural kernel adapters.
    const byTarget = new Map<number, SpkSegment[]>()
    for (const segment of kernel.segments) {
      const group = byTarget.get(segment.target)
      if (group) group.push(segment)
      else byTarget.set(segment.target, [segment])
    }
    if (!byTarget.size) return false
    for (const segments of byTarget.values()) {
      segments.sort((a, b) => a.startEt - b.startEt)
      let coveredUntil = startEt
      let started = false
      for (const segment of segments) {
        if (segment.endEt < startEt) continue
        if (segment.startEt > coveredUntil) break
        started = true
        coveredUntil = Math.max(coveredUntil, segment.endEt)
        if (coveredUntil >= endEt) break
      }
      if (!(started && coveredUntil >= endEt)) return false
    }
    return true
  })
}
const ZERO = Object.freeze({ x: 0, y: 0, z: 0 })
const OBLIQUITY = 84381.448 / 3600 * Math.PI / 180
const add = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const subtract = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const coversTargetAt = (kernel: SpkKernel, target: number, et: number) =>
  kernel.coversTargetAt?.(target, et) ?? kernel.segments.some(segment => segment.target === target && segment.startEt <= et && segment.endEt >= et)

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
export function createKernelResolver(sourceKernels: readonly LoadedKernel[], et: number) {
  if (!Number.isFinite(et)) throw new RangeError('Ephemeris time must be finite')
  // Own selection metadata for this epoch. Caller list edits or dependency
  // changes must not make the lazy contexts disagree with already cached states.
  const kernels = sourceKernels.map(({ id, kernel, solutionKernelIds, dependencyOnly }) => ({
    id, kernel, solutionKernelIds: solutionKernelIds?.slice(), dependencyOnly,
  }))
  const byId = new Map(kernels.map(kernel => [kernel.id, kernel]))
  if (byId.size !== kernels.length) throw new Error('Duplicate SPK kernel identity')
  // Legacy unbound sources cannot acquire new dependency-only cores or new
  // explicitly bound satellite solutions merely because another body loaded.
  const legacy = kernels.filter(kernel => !kernel.dependencyOnly && kernel.solutionKernelIds === undefined)
  const contexts = new Map<string, readonly LoadedKernel[] | null>([['legacy', legacy]])
  const targetContexts = new Map<number, string>()
  const observerCoverage = new Map<string, boolean>()
  const cache = new Map<string, GeometricState | null>()
  const visiting = new Set<string>()
  const contextFor = (target: number): string => {
    const cached = targetContexts.get(target)
    if (cached !== undefined) return cached
    for (let index = kernels.length - 1; index >= 0; index--) {
      const root = kernels[index]
      if (root.dependencyOnly || !coversTargetAt(root.kernel, target, et)) continue
      if (root.solutionKernelIds === undefined) {
        targetContexts.set(target, 'legacy')
        return 'legacy'
      }
      const key = `root:${root.id}`
      if (!contexts.has(key)) {
        const ids = root.solutionKernelIds
        if (ids.includes(root.id) || new Set(ids).size !== ids.length) throw new Error('Invalid explicit SPK dependency pool')
        contexts.set(key, ids.every(id => byId.has(id)) ? [...ids.map(id => byId.get(id)!), root] : null)
      }
      targetContexts.set(target, key)
      return key
    }
    targetContexts.set(target, 'legacy')
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
  const barycentric = (target: number): GeometricState | null => {
    const state = resolveIn(target, contextFor(target))
    // Public results are caller-owned; internal center-chain cache entries stay
    // private, including the shared SSB origin.
    return state ? { position: { ...state.position }, velocity: { ...state.velocity } } : null
  }
  return {
    barycentric,
    relative(target: number, observer: number): GeometricState | null {
      const context = contextFor(target)
      const body = resolveIn(target, context)
      // Sun and included parent centers use the exact same source pool. An
      // unrelated observer may require its independently declared solution;
      // that comparison is not a claim of a single global dynamical fit.
      const observerKey = `${context}/${observer}`
      let observerInPool = observerCoverage.get(observerKey)
      if (observerInPool === undefined) {
        observerInPool = contexts.get(context)?.some(({ kernel }) => coversTargetAt(kernel, observer, et)) ?? false
        observerCoverage.set(observerKey, observerInPool)
      }
      const center = observer === 0 || observerInPool ? resolveIn(observer, context) : resolveIn(observer, contextFor(observer))
      if (!body || !center) return null
      return { position: subtract(body.position, center.position), velocity: subtract(body.velocity, center.velocity) }
    },
  }
}
