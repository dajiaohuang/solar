import { findTrajectoryEvents, trajectoryScanIntervals, TrajectoryEventBudgetError } from '../events/trajectoryEvents.ts'
import { integrateAdaptive } from './adaptiveIntegrator.ts'
import type { createDe440Dynamics } from './de440Dynamics'

/** Geometric sphere-boundary crossings for one restricted-dynamics trajectory.
 * Scan endpoints are cached in chronological order; root-refinement samples
 * start from the nearest fixed scan/reference checkpoint. No dense output or
 * root-query-order dependence is used.
 */
export async function findDynamicsDistanceEvents(
  dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>,
  input: {
    initialStateKmKmPerSecond: ArrayLike<number>
    targetNaifId: number
    distanceKm: number
    startSeconds: number
    endSeconds: number
    maxStepSeconds: number
    toleranceSeconds: number
    maxEvaluations: number
    maxEvents: number
  },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const { targetNaifId, distanceKm, startSeconds, endSeconds, maxStepSeconds,
    toleranceSeconds, maxEvaluations, maxEvents } = input
  const evidence = structuredClone(dynamics.evidence), stateAt = dynamics.state, derivative = dynamics.derivative
  if (input.initialStateKmKmPerSecond.length !== 6) throw new RangeError('Distance events require a barycentric J2000 six-state')
  const initial = Float64Array.from(input.initialStateKmKmPerSecond)
  if (!initial.every(Number.isFinite) || !Number.isSafeInteger(targetNaifId) ||
      !evidence.masses.some(body => body.naifId === targetNaifId) ||
      !Number.isFinite(distanceKm) || distanceKm <= 0 ||
      !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds > endSeconds ||
      Math.max(Math.abs(startSeconds), Math.abs(endSeconds)) > 365*86400 ||
      Math.min(0,startSeconds) < evidence.elapsedRangeSeconds[0] || Math.max(0,endSeconds) > evidence.elapsedRangeSeconds[1] ||
      !Number.isSafeInteger(maxEvaluations) || maxEvaluations < 1 || maxEvaluations > 2048) {
    throw new RangeError('Invalid distance event source, domain or evaluation budget')
  }
  const scanDuration = endSeconds-startSeconds
  const scanIntervals = trajectoryScanIntervals(scanDuration, maxStepSeconds, startSeconds, endSeconds, maxEvaluations)
  if (!Number.isSafeInteger(scanIntervals) || scanIntervals+1 > maxEvaluations) {
    throw new TrajectoryEventBudgetError('evaluations','Trajectory scan exceeds its evaluation budget')
  }
  const scanEndpoints = new Set<number>([startSeconds])
  for (let index=1; index<=scanIntervals; index++) {
    scanEndpoints.add(index === scanIntervals ? endSeconds : startSeconds+(scanDuration/scanIntervals)*index)
  }
  const checkpoints: { elapsedSeconds: number; state: Float64Array }[] = [{ elapsedSeconds: 0, state: initial.slice() }]
  const nearestCheckpoint = (time: number) => {
    let low=0, high=checkpoints.length
    while (low<high) {
      const middle=low+Math.floor((high-low)/2)
      if (checkpoints[middle].elapsedSeconds<time) low=middle+1
      else high=middle
    }
    if (low<checkpoints.length && checkpoints[low].elapsedSeconds===time) return checkpoints[low]
    if (low===0) return checkpoints[0]
    if (low===checkpoints.length) return checkpoints[checkpoints.length-1]
    const before=checkpoints[low-1], after=checkpoints[low]
    return time-before.elapsedSeconds<=after.elapsedSeconds-time ? before : after
  }
  const rememberScanEndpoint = (time: number, state: Float64Array) => {
    let low=0, high=checkpoints.length
    while (low<high) {
      const middle=low+Math.floor((high-low)/2)
      if (checkpoints[middle].elapsedSeconds<time) low=middle+1
      else high=middle
    }
    if (low<checkpoints.length && checkpoints[low].elapsedSeconds===time) return
    checkpoints.splice(low,0,{ elapsedSeconds:time, state:state.slice() })
  }
  const integrationSettings = { algorithm: 'dormand-prince-54-component-max-v1',
    absoluteTolerance: [1e-5,1e-5,1e-5,1e-12,1e-12,1e-12], relativeTolerance: 1e-12,
    initialStep: 3600, maxStep: 86400, maxAttempts: 20000 }
  const maximumForceEvaluations = 250000
  let forceEvaluations = 0, integrations = 0, accepted = 0, rejected = 0
  let maxAcceptedErrorRatio = 0, smallestAcceptedStepSeconds: number | null = null, largestAcceptedStepSeconds = 0
  const search = await findTrajectoryEvents({ referenceEpochTdb: evidence.referenceEpochTdb,
    startSeconds, endSeconds, maxStepSeconds, toleranceSeconds, maxEvaluations, maxEvents, signal,
    evaluate: async time => {
      const target = stateAt(targetNaifId,time)
      if (target.length !== 6 || !target.every(Number.isFinite)) throw new RangeError('Distance event target state is unavailable')
      const checkpoint = nearestCheckpoint(time)
      let state = checkpoint.state
      if (time !== checkpoint.elapsedSeconds) {
        const anchor = checkpoint.elapsedSeconds, segmentDuration = time-anchor
        const result = await integrateAdaptive({ ...integrationSettings, initial:checkpoint.state, duration:segmentDuration, signal,
          derivative: (elapsed, value, output) => {
            if (forceEvaluations >= maximumForceEvaluations) throw new TrajectoryEventBudgetError('forces', 'Distance event search exhausted its shared force-evaluation budget')
            forceEvaluations++
            derivative(elapsed === segmentDuration ? time : anchor+elapsed,value,output)
          } })
        integrations++; accepted += result.accepted; rejected += result.rejected
        maxAcceptedErrorRatio = Math.max(maxAcceptedErrorRatio, result.maxAcceptedErrorRatio)
        largestAcceptedStepSeconds = Math.max(largestAcceptedStepSeconds, result.largestAcceptedStep)
        if (result.smallestAcceptedStep !== null) {
          smallestAcceptedStepSeconds = smallestAcceptedStepSeconds === null
            ? result.smallestAcceptedStep
            : Math.min(smallestAcceptedStepSeconds, result.smallestAcceptedStep)
        }
        state = result.state
        if (scanEndpoints.has(time)) rememberScanEndpoint(time,state)
      }
      return Math.hypot(state[0]-target[0],state[1]-target[1],state[2]-target[2])-distanceKm
    } })
  signal?.throwIfAborted()
  // TypeScript does not model writes performed by the asynchronous evaluator
  // callback, so restore the declared diagnostic contract at the boundary.
  const acceptedStepRange: { smallestAcceptedStepSeconds: number | null; largestAcceptedStepSeconds: number } = {
    smallestAcceptedStepSeconds: smallestAcceptedStepSeconds as number | null,
    largestAcceptedStepSeconds,
  }
  return { search, forceModel: evidence, initialStateKmKmPerSecond: Array.from(initial),
    eventDefinition: { kind: 'geometric-target-distance-threshold' as const,
      targetNaifId, distanceKm, valueUnits: 'km' as const, stateFrame: 'J2000' as const,
      stateOrigin: 'solar-system-barycenter' as const,
      negativeMeaning: 'inside-threshold', positiveMeaning: 'outside-threshold',
      aberration: 'NONE' as const },
    integrationSettings, integrations, accepted, rejected, maxAcceptedErrorRatio,
    ...acceptedStepRange, forceEvaluations, maximumForceEvaluations,
    method: 'restricted-dynamics-nearest-scan-checkpoint-distance-events-v2' as const,
    limitations: [
      'Threshold is caller-specified, not an adopted physical radius, impact classification or occultation model.',
      'Simultaneous geometric positions only; no light-time, apparent limb, observer or atmospheric correction.',
      'The target is a prescribed DE440 force-model body; source coverage and initial-state provenance must be retained by the caller.',
      'Scan checkpoints are built in chronological order; each refinement point integrates independently from its nearest fixed scan/reference checkpoint. Segment-local time is translated to elapsed time from the frozen reference epoch, and the endpoint uses the exact requested epoch. Refinement results are not fed back into the cache, so bisection order cannot change later trajectory states. DP54 restarts on segments and accumulated error has no global bound; all queries share one force budget.',
      'Root localization excludes accumulated integration and physical-model errors. Numerical tolerances are not event-time accuracy bounds.',
      'The maximum accepted embedded error ratio and accepted-step range aggregate completed DP54 segments only. They are local solver diagnostics, not accumulated state or event-time error bounds.',
      'This is one trajectory, not an ensemble probability or complete event detection.',
    ] }
}
