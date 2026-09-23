export type DynamicsSample = { elapsedTdbSeconds: number; stateKmKmPerSecond: number[]; heliocentricPositionKm: number[] }

/** Bounded visualization of actual accepted nodes. No dense interpolation or
 * between-node event/collision guarantee. Endpoints are always retained. */
export function createTrajectoryRecorder<T extends DynamicsSample>(initial: T, capacity = 2048) {
  if (!Number.isSafeInteger(capacity) || capacity < 4 || capacity > 4096 || capacity % 2) throw new RangeError('Trajectory capacity must be even, from 4 to 4096')
  let samples = [initial], stride = 1, acceptedSteps = 0
  return {
    accept(makeSample: () => T) {
      acceptedSteps++
      if (acceptedSteps % stride) return
      if (samples.length === capacity) { samples = samples.filter((_, index) => index % 2 === 0); stride *= 2 }
      if (acceptedSteps % stride === 0) samples.push(makeSample())
    },
    finish(final: T) {
      if (samples[samples.length-1].elapsedTdbSeconds !== final.elapsedTdbSeconds) {
        if (samples.length === capacity) samples.pop()
        samples.push(final)
      }
      return { samples, acceptedSteps, retainedNodes: samples.length, stride, maxNodes: capacity,
        selection: 'Every stride-th accepted endpoint plus initial/final endpoints; no interpolation' }
    },
  }
}
