import type { SbdbCovariance } from '../../data/loaders/sbdbCovariance'
import { sampleSbdbCovariance } from '../ephemeris/covarianceSampling.ts'
import { cartesianStatesFromSourceOffsets } from '../ephemeris/covarianceStateSamples.ts'
import { TrajectoryEventBudgetError, TrajectoryLocalizationError, trajectoryScanIntervals, type TrajectorySearchProgress } from '../events/trajectoryEvents.ts'
import { findDynamicsDistanceEvents } from './distanceEvents.ts'
import { DynamicsSampleError } from './sampleFailure.ts'
import type { createDe440Dynamics } from './de440Dynamics'
import { summarizeFirstDetectedEventTimes } from './eventTimingSummary.ts'

type Settings = Omit<Parameters<typeof findDynamicsDistanceEvents>[1], 'initialStateKmKmPerSecond'>
type Receipt = Awaited<ReturnType<typeof findDynamicsDistanceEvents>>
export type EnsembleDistanceEventDraw =
  | { index: number; status: 'searched'; forceEvaluations: number; result: Receipt }
  | { index: number; status: 'failed'; stage: 'coordinates' | 'integration'; reason: string; forceEvaluations: number }
  | { index: number; status: 'failed'; stage: 'localization'; reason: string; forceEvaluations: number;
      bracketSeconds: readonly [number,number]; bracketValues: readonly [number,number]; searchProgress: Readonly<TrajectorySearchProgress> }
  | { index: number; status: 'unresolved'; stage: 'search' | 'not-started'; resource: 'evaluations' | 'events' | 'forces'; reason: string; forceEvaluations: number; searchProgress: Readonly<TrajectorySearchProgress> | null }

/** Finite seeded draws, never a probability estimator. Every draw keeps its
 * original index, including coordinate failures and unsearched budget tails. */
export async function searchEnsembleDistanceEvents(
  dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>,
  input: SbdbCovariance,
  count: number,
  seed: number,
  settings: Settings,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const source = structuredClone(input), searchSettings = { ...settings }
  const evidence = structuredClone(dynamics.evidence), stateAt = dynamics.state, derivative = dynamics.derivative
  if (source.labels.length !== 6 || source.additionalParameters.length || source.solutionEpochTdb !== evidence.referenceEpochTdb ||
      !Number.isSafeInteger(count) || count < 1 || count > 128) throw new RangeError('Event ensemble requires 1 to 128 six-parameter solution-epoch draws')
  const { startSeconds, endSeconds, maxStepSeconds, toleranceSeconds, maxEvaluations, maxEvents, distanceKm, targetNaifId } = searchSettings
  const duration = endSeconds-startSeconds
  // Validate before conversion: even an all-invalid draw set must not turn an
  // invalid search specification into an apparently usable ensemble receipt.
  if (![startSeconds,endSeconds,duration,maxStepSeconds,toleranceSeconds,distanceKm].every(Number.isFinite) ||
      duration < 0 || distanceKm <= 0 || maxStepSeconds <= 0 || toleranceSeconds <= 0 || toleranceSeconds > maxStepSeconds ||
      Math.max(Math.abs(startSeconds),Math.abs(endSeconds)) > 365*86400 ||
      Math.min(0,startSeconds) < evidence.elapsedRangeSeconds[0] || Math.max(0,endSeconds) > evidence.elapsedRangeSeconds[1] ||
      !Number.isSafeInteger(targetNaifId) || !evidence.masses.some(body => body.naifId === targetNaifId) ||
      !Number.isSafeInteger(maxEvaluations) || maxEvaluations < 1 || maxEvaluations > 2048 ||
      !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 128 ||
      trajectoryScanIntervals(duration, maxStepSeconds, startSeconds, endSeconds, maxEvaluations) + 1 > maxEvaluations) {
    throw new RangeError('Invalid bounded ensemble event settings')
  }
  const sampling = sampleSbdbCovariance(source,count,seed)
  const solar = evidence.masses.find(body => body.naifId === 10)
  if (!solar) throw new RangeError('Ensemble events require a sourced solar GM')
  const AU = 149597870.7, DAY = 86400
  const angle = 84381.448/3600*Math.PI/180, c = Math.cos(angle), s = Math.sin(angle)
  const initial = await cartesianStatesFromSourceOffsets(source, {
    au3PerDay2: solar.gmKm3PerSecond2*DAY**2/AU**3, source: solar.gmSource,
  },sampling.offsets,signal)
  const sun = stateAt(10,0)
  if (sun.length !== 6 || !sun.every(Number.isFinite)) throw new RangeError('Ensemble events require a finite reference Sun state')
  const initialFrameTransform = {
    method: 'fixed-eclipj2000-to-j2000-plus-prescribed-sun-v1' as const,
    sourceFrame: initial.frame, destinationFrame: 'J2000' as const, destinationOrigin: 'SSB' as const,
    referenceEpochTdb: source.solutionEpochTdb, elapsedTdbSeconds: 0,
    auKm: AU, daySeconds: DAY, obliquityArcseconds: 84381.448,
    sunNaifId: 10, sunStateKmKmPerSecond: Array.from(sun),
    ephemerisSource: evidence.ephemerisSource,
    limitation: 'Prescribed Sun translation is conditional on the pinned force source; its uncertainty is not propagated. Receipt checks do not independently reevaluate SPK states.',
  }
  const maximumForceEvaluations = 250000
  let forceEvaluations = 0
  const sharedDynamics = { ...dynamics, evidence, state: stateAt,
    derivative: ((time, state, output) => {
      if (forceEvaluations >= maximumForceEvaluations) throw new TrajectoryEventBudgetError('forces','Ensemble event search exhausted its shared force budget')
      forceEvaluations++
      derivative(time,state,output)
    }) as typeof dynamics.derivative }
  const draws: EnsembleDistanceEventDraw[] = []
  const coordinateFailures = new Map(initial.failures.map(failure => [failure.index,failure.reason]))
  for (let index = 0; index < count; index++) {
    await new Promise<void>(resolve => setTimeout(resolve,0))
    signal?.throwIfAborted()
    if (!initial.valid[index]) {
      const reason = coordinateFailures.get(index)
      if (!reason) throw new Error('Missing invalid ensemble draw identity')
      draws.push({ index, status: 'failed', stage: 'coordinates', reason, forceEvaluations: 0 })
      continue
    }
    if (forceEvaluations >= maximumForceEvaluations) {
      draws.push({ index, status: 'unresolved', stage: 'not-started', resource: 'forces', reason: 'Not searched after shared force budget exhaustion', forceEvaluations: 0, searchProgress: null })
      continue
    }
    const sample = initial.states.subarray(index*6,index*6+6), barycentric = new Float64Array(6)
    for (const offset of [0,3]) {
      const scale = AU/(offset === 0 ? 1 : DAY)
      barycentric[offset] = sample[offset]*scale+sun[offset]
      barycentric[offset+1] = (c*sample[offset+1]-s*sample[offset+2])*scale+sun[offset+1]
      barycentric[offset+2] = (s*sample[offset+1]+c*sample[offset+2])*scale+sun[offset+2]
    }
    const before = forceEvaluations
    try {
      if (!barycentric.every(Number.isFinite)) throw new DynamicsSampleError('Ensemble event initial state exceeds numeric range')
      const result = await findDynamicsDistanceEvents(sharedDynamics,{ ...searchSettings, initialStateKmKmPerSecond: barycentric },signal)
      draws.push({ index, status: 'searched', result, forceEvaluations: forceEvaluations-before })
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof TrajectoryEventBudgetError) {
        if (!error.searchProgress) throw new Error('Started event search lacks budget progress evidence', {cause:error})
        draws.push({ index, status: 'unresolved', stage: 'search', resource: error.resource, reason: error.message, forceEvaluations: forceEvaluations-before, searchProgress:error.searchProgress })
      } else if (error instanceof TrajectoryLocalizationError) {
        draws.push({index,status:'failed',stage:'localization',reason:error.message,forceEvaluations:forceEvaluations-before,
          bracketSeconds:error.bracketSeconds,bracketValues:error.bracketValues,searchProgress:error.searchProgress})
      } else if (error instanceof DynamicsSampleError) {
        draws.push({ index, status: 'failed', stage: 'integration', reason: error.message, forceEvaluations: forceEvaluations-before })
      } else throw error // Broken source/model contracts are not failed Gaussian draws.
    }
  }
  signal?.throwIfAborted()
  const searched = draws.filter(draw => draw.status === 'searched').length
  const failed = draws.filter(draw => draw.status === 'failed').length
  const unresolved = count-searched-failed
  return { method: 'seeded-restricted-dynamics-distance-event-ensemble-nearest-scan-checkpoint-v2' as const,
    source, sampling, initial, initialFrameTransform, searchSettings, forceModel: evidence, draws,
    counts: { total: count, searched, failed, unresolved }, allDrawsSearched: searched === count,
    timingSummary: summarizeFirstDetectedEventTimes(draws),
    forceEvaluations, maximumForceEvaluations,
    limitations: [
      'Finite Gaussian source draws under a conditional six-parameter force model, not complete orbit-fit uncertainty or calibrated event probabilities.',
      'Every draw retains its original index and offset; failures and unresolved budgets must never be counted as event-free trajectories.',
      'A searched draw with zero detected events is only a negative sampled search, not proof of no crossing.',
      'Crossings are geometric distance-threshold events, not collisions, occultations or apparent contacts. Sampled zeros remain unclassified.',
      'Timing summaries describe only the explicitly selected first-detected subsets; no physical event correspondence or population quantiles are inferred.',
      'Force evaluation counts include failed calls; coordinate conversion and prescribed target-state evaluations are outside that budget.',
      'Source/model contract failures and cancellation reject the ensemble; known sample and budget failures retain explicit draw status.',
    ] }
}
