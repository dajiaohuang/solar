import type { Vector3 } from '../../types'

export type ApproximationSegment = {
  startEt: number; endEt: number; coefficients: number[][]
  sampledPositionErrorKm: number; sampledVelocityErrorKmS: number
}
export type ApproximationSource = { position: Vector3; velocity: Vector3 }
const axes = ['x', 'y', 'z'] as const

/** Clenshaw evaluation, with the derivative in seconds, of a Chebyshev series. */
export function evaluateApproximation(segment: ApproximationSegment, et: number): ApproximationSource {
  if (!Number.isFinite(et) || et < segment.startEt || et > segment.endEt) throw new RangeError('Outside approximation segment')
  const scale = 2 / (segment.endEt - segment.startEt)
  const x = (et - segment.startEt) * scale - 1
  const position = { x: 0, y: 0, z: 0 }, velocity = { x: 0, y: 0, z: 0 }
  for (let axis = 0; axis < 3; axis++) {
    const c = segment.coefficients[axis]
    let b1 = 0, b2 = 0, d1 = 0, d2 = 0
    for (let k = c.length - 1; k >= 1; k--) {
      const b = c[k] + 2 * x * b1 - b2
      const d = 2 * b1 + 2 * x * d1 - d2
      b2 = b1; b1 = b; d2 = d1; d1 = d
    }
    position[axes[axis]] = c[0] + x * b1 - b2
    velocity[axes[axis]] = (b1 + x * d1 - d2) * scale
  }
  return { position, velocity }
}

/** Compare fixed candidates at independent off-node samples. "Best" means
 * lowest measured normalized error among these candidates, not global optimality
 * or a rigorous bound between validation samples. */
export function fitApproximationInterval(source: (et: number) => ApproximationSource,
  startEt: number, endEt: number, positionToleranceKm: number, velocityToleranceKmS: number,
  maxDepth = 20): ApproximationSegment[] {
  if (![startEt, endEt, positionToleranceKm, velocityToleranceKmS].every(Number.isFinite)
    || endEt <= startEt || positionToleranceKm <= 0 || velocityToleranceKmS <= 0) throw new RangeError('Invalid approximation interval or tolerance')
  const fit = (start: number, end: number, depth: number): ApproximationSegment[] => {
    const center = (start + end) / 2, half = (end - start) / 2
    let best: ApproximationSegment | undefined, bestScore = Infinity
    const validation = Array.from({ length: 66 }, (_, i) => {
      const et = i === 0 ? start : i === 65 ? end : start + (end - start) * (i - .5) / 64
      const expected = source(et)
      if (![...axes.map(axis => expected.position[axis]), ...axes.map(axis => expected.velocity[axis])].every(Number.isFinite)) throw new Error('Non-finite approximation source')
      return { et, expected }
    })
    for (const degree of [8, 12, 16]) {
      const count = degree + 1
      const values = Array.from({ length: count }, (_, i) => {
        const state = source(center + half * Math.cos(Math.PI * (i + .5) / count))
        if (![...axes.map(axis => state.position[axis]), ...axes.map(axis => state.velocity[axis])].every(Number.isFinite)) throw new Error('Non-finite approximation source')
        return state.position
      })
      const coefficients = axes.map(axis => Array.from({ length: count }, (_, k) => {
        let sum = 0
        for (let i = 0; i < count; i++) sum += values[i][axis] * Math.cos(Math.PI * k * (i + .5) / count)
        return sum * (k === 0 ? 1 : 2) / count
      }))
      const candidate = { startEt: start, endEt: end, coefficients, sampledPositionErrorKm: 0, sampledVelocityErrorKmS: 0 }
      // Uniform midpoints plus endpoints; none are fitting nodes. More than
      // twice the largest candidate's order exposes ordinary aliasing failures.
      for (const { et, expected } of validation) {
        const actual = evaluateApproximation(candidate, et)
        candidate.sampledPositionErrorKm = Math.max(candidate.sampledPositionErrorKm,
          Math.hypot(...axes.map(axis => actual.position[axis] - expected.position[axis])))
        candidate.sampledVelocityErrorKmS = Math.max(candidate.sampledVelocityErrorKmS,
          Math.hypot(...axes.map(axis => actual.velocity[axis] - expected.velocity[axis])))
      }
      const score = Math.max(candidate.sampledPositionErrorKm / positionToleranceKm, candidate.sampledVelocityErrorKmS / velocityToleranceKmS)
      if (score < bestScore) { best = candidate; bestScore = score }
    }
    if (best && bestScore <= 1) return [best]
    if (depth >= maxDepth) throw new Error(`Approximation tolerance not reached at ET ${start}..${end}`)
    return [...fit(start, center, depth + 1), ...fit(center, end, depth + 1)]
  }
  return fit(startEt, endEt, 0)
}

export function segmentAt(segments: readonly ApproximationSegment[], et: number) {
  let low = 0, high = segments.length
  while (low < high) { const mid = (low + high) >>> 1; if (segments[mid].startEt <= et) low = mid + 1; else high = mid }
  const segment = segments[low - 1]
  return segment && et <= segment.endEt ? segment : null
}
