import type { DynamicsRequest } from '../workers/dynamics.protocol'
import { parseSbdbCovariance } from '../data/loaders/sbdbCovariance.ts'
import { sampleSbdbCovariance } from '../engine/ephemeris/covarianceSampling.ts'
import { summarizeFirstDetectedEventTimes } from '../engine/dynamics/eventTimingSummary.ts'
import type { EnsembleDistanceEventDraw } from '../engine/dynamics/ensembleDistanceEvents'
import { trajectoryScanIntervals } from '../engine/events/trajectoryEvents.ts'
import { checkEnsembleInitialReceipt } from './ensembleInitialReceipt.ts'

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid event ensemble record')
  return value as Record<string, unknown>
}
const requireValue = (condition: boolean) => { if (!condition) throw new Error('Event ensemble receipt differs from its request or draw evidence') }
const same = (actual: unknown, expected: unknown) => requireValue(JSON.stringify(actual) === JSON.stringify(expected))
const bounded = (value: unknown, max: number): number => {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max)
  return value as number
}
const finite = (value: unknown): number => {
  requireValue(typeof value === 'number' && Number.isFinite(value))
  return value as number
}
const notes = (value: unknown) => requireValue(Array.isArray(value) && value.length > 0 && value.length <= 128 && value.every(note => typeof note === 'string' && note.trim().length > 0))
const pair = (value: unknown): [number,number] => {
  requireValue(Array.isArray(value) && value.length === 2)
  const values = value as unknown[]
  return [finite(values[0]),finite(values[1])]
}

/** Bounded request/receipt checks, not reintegration or physical validation. */
export async function checkEnsembleEventReceipt(receipt: Record<string,unknown>, request: DynamicsRequest, payload: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const source = parseSbdbCovariance(payload), count = request.sampleCount!, settings = request.eventSearch!
  const expected = sampleSbdbCovariance(source,count,request.seed!)
  const start = Math.min(0,request.durationSeconds), end = Math.max(0,request.durationSeconds)
  requireValue(receipt.method === 'seeded-restricted-dynamics-distance-event-ensemble-nearest-scan-checkpoint-v2')
  same(receipt.searchSettings,{ ...settings,startSeconds:start,endSeconds:end })
  notes(receipt.limitations)
  const sampling = record(receipt.sampling), initial = record(receipt.initial)
  same(receipt.source,initial.source)
  const force = record(receipt.forceModel), transform = record(receipt.initialFrameTransform)
  requireValue(Array.isArray(force.masses))
  const solar = (force.masses as unknown[]).map(record).find(mass => mass.naifId === 10)
  requireValue(Boolean(solar))
  const AU = 149597870.7, DAY = 86400, angle = 84381.448/3600*Math.PI/180
  const c = Math.cos(angle), s = Math.sin(angle)
  const gm = finite(solar!.gmKm3PerSecond2)
  requireValue(gm > 0)
  same(initial.adoptedSolarGM,{au3PerDay2:gm*DAY**2/AU**3,source:solar!.gmSource})
  requireValue(transform.method === 'fixed-eclipj2000-to-j2000-plus-prescribed-sun-v1' &&
    transform.sourceFrame === source.frame && transform.destinationFrame === 'J2000' && transform.destinationOrigin === 'SSB' &&
    transform.referenceEpochTdb === source.solutionEpochTdb && transform.elapsedTdbSeconds === 0 &&
    transform.auKm === AU && transform.daySeconds === DAY && transform.obliquityArcseconds === 84381.448 &&
    transform.sunNaifId === 10 && transform.ephemerisSource === force.ephemerisSource &&
    typeof transform.limitation === 'string' && transform.limitation.trim().length > 0)
  requireValue(Array.isArray(transform.sunStateKmKmPerSecond) && transform.sunStateKmKmPerSecond.length === 6)
  const sun = (transform.sunStateKmKmPerSecond as unknown[]).map(finite)
  for (const key of ['algorithm','distribution','count','dimension','seed','labels','units','nominal','solutionEpochTdb','solutionId','factorization'] as const) same(sampling[key],expected[key])
  notes(sampling.limitations); notes(initial.limitations)
  requireValue(initial.count === count && initial.dimension === 6 && initial.method === 'nonlinear-source-offsets-to-periapsis-conic-state-v1')
  for (const values of [sampling.offsets,initial.offsets]) {
    requireValue(values instanceof Float64Array && values.length === expected.offsets.length)
    requireValue((values as Float64Array).every((value,index) => value === expected.offsets[index]))
  }
  const states = initial.states, valid = initial.valid
  requireValue(states instanceof Float64Array && states.length === count*6 && valid instanceof Uint8Array && valid.length === count)
  await checkEnsembleInitialReceipt(source,initial,expected.offsets,{
    au3PerDay2:gm*DAY**2/AU**3,source:solar!.gmSource as string,
  },signal)
  requireValue(initial.additionalValues instanceof Float64Array && initial.additionalValues.length === 0)
  same(initial.additionalLabels,[]); same(initial.additionalUnits,[])
  const failures = new Map<number,string>()
  requireValue(Array.isArray(initial.failures) && initial.failures.length <= count)
  for (const item of initial.failures as unknown[]) {
    const failure = record(item), index = bounded(failure.index,count-1)
    requireValue(!failures.has(index) && typeof failure.reason === 'string' && failure.reason.length > 0)
    failures.set(index,failure.reason as string)
  }
  requireValue(Array.isArray(receipt.draws) && receipt.draws.length === count)
  let scanGrid: Map<number,number> | null = null
  let expectedMaximumScanInterval = 0
  let searched = 0, failed = 0, unresolved = 0, evaluations = 0
  for (const [index,item] of (receipt.draws as unknown[]).entries()) {
    const draw = record(item), flag = (valid as Uint8Array)[index]
    requireValue(draw.index === index && flag <= 1 && failures.has(index) === (flag === 0))
    for (let axis=0;axis<6;axis++) requireValue(flag === 1 ? Number.isFinite((states as Float64Array)[index*6+axis]) : Number.isNaN((states as Float64Array)[index*6+axis]))
    const calls = bounded(draw.forceEvaluations,250000)
    const before = evaluations
    evaluations += calls
    requireValue(evaluations <= 250000)
    if (draw.status === 'failed') {
      failed++
      requireValue(typeof draw.reason === 'string' && draw.reason.length > 0)
      requireValue(flag === 0 ? draw.stage === 'coordinates' && draw.reason === failures.get(index) && calls === 0 :
        (draw.stage === 'integration' || draw.stage === 'localization') && before < 250000)
      if (draw.stage === 'localization') {
        const bracket = pair(draw.bracketSeconds), values = pair(draw.bracketValues)
        const middle = bracket[0]+(bracket[1]-bracket[0])/2
        requireValue(start <= bracket[0] && bracket[1] <= end && bracket[1]-bracket[0] > settings.toleranceSeconds &&
          !(middle > bracket[0] && middle < bracket[1]) && values[0] !== 0 && values[1] !== 0 && (values[0] < 0) !== (values[1] < 0))
        const progress = record(draw.searchProgress), attempts = bounded(progress.attemptedEvaluations,settings.maxEvaluations)
        const retained = bounded(progress.retainedEventCount,settings.maxEvents), last = finite(progress.lastAttemptSeconds)
        requireValue(attempts >= 2 && progress.completedEvaluations === attempts && retained <= attempts && start <= last && last <= end)
      }
      requireValue(draw.result === undefined)
      continue
    }
    requireValue(flag === 1)
    if (draw.status === 'unresolved') {
      unresolved++
      requireValue(['evaluations','events','forces'].includes(String(draw.resource)) && typeof draw.reason === 'string' && draw.reason.length > 0 && draw.result === undefined)
      if (draw.stage === 'not-started') requireValue(draw.resource === 'forces' && before === 250000 && calls === 0 && draw.searchProgress === null)
      else {
        requireValue(draw.stage === 'search' && before < 250000)
        const progress = record(draw.searchProgress)
        const attempts = bounded(progress.attemptedEvaluations,settings.maxEvaluations)
        const completed = bounded(progress.completedEvaluations,attempts)
        const retained = bounded(progress.retainedEventCount,settings.maxEvents)
        const last = finite(progress.lastAttemptSeconds)
        requireValue(attempts > 0 && start <= last && last <= end && retained <= completed)
        if (draw.resource === 'forces') requireValue(evaluations === 250000 && completed+1 === attempts)
        else {
          requireValue(completed === attempts)
          if (draw.resource === 'evaluations') requireValue(attempts === settings.maxEvaluations)
          else requireValue(retained === settings.maxEvents)
        }
      }
      continue
    }
    requireValue(draw.status === 'searched' && before < 250000); searched++
    const result = record(draw.result), search = record(result.search)
    requireValue(result.method === 'restricted-dynamics-nearest-scan-checkpoint-distance-events-v2' && result.forceEvaluations === calls && result.maximumForceEvaluations === 250000)
    same(result.forceModel,receipt.forceModel)
    requireValue(Array.isArray(result.initialStateKmKmPerSecond) && result.initialStateKmKmPerSecond.length === 6 && result.initialStateKmKmPerSecond.every(value => typeof value === 'number' && Number.isFinite(value)))
    const barycentric = result.initialStateKmKmPerSecond as number[]
    const sample = (states as Float64Array).subarray(index*6,index*6+6)
    for (const offset of [0,3]) {
      const scale = AU/(offset === 0 ? 1 : DAY)
      requireValue(barycentric[offset] === sample[offset]*scale+sun[offset] &&
        barycentric[offset+1] === (c*sample[offset+1]-s*sample[offset+2])*scale+sun[offset+1] &&
        barycentric[offset+2] === (s*sample[offset+1]+c*sample[offset+2])*scale+sun[offset+2])
    }
    same(result.eventDefinition,{ kind:'geometric-target-distance-threshold',targetNaifId:settings.targetNaifId,distanceKm:settings.distanceKm,
      valueUnits:'km',stateFrame:'J2000',stateOrigin:'solar-system-barycenter',negativeMeaning:'inside-threshold',positiveMeaning:'outside-threshold',aberration:'NONE' })
    same(result.integrationSettings,{ algorithm:'dormand-prince-54-component-max-v1',absoluteTolerance:[1e-5,1e-5,1e-5,1e-12,1e-12,1e-12],relativeTolerance:1e-12,initialStep:3600,maxStep:86400,maxAttempts:20000 })
    const integrations = bounded(result.integrations,settings.maxEvaluations)
    const accepted = bounded(result.accepted,integrations*20000), rejected = bounded(result.rejected,integrations*20000)
    requireValue(accepted+rejected <= integrations*20000 && calls === integrations+6*(accepted+rejected))
    const maxAcceptedErrorRatio = finite(result.maxAcceptedErrorRatio)
    const largestAcceptedStepSeconds = finite(result.largestAcceptedStepSeconds)
    const smallestAcceptedStepSeconds = result.smallestAcceptedStepSeconds === null
      ? null : finite(result.smallestAcceptedStepSeconds)
    requireValue(maxAcceptedErrorRatio >= 0 && maxAcceptedErrorRatio <= 1 &&
      largestAcceptedStepSeconds >= 0 && largestAcceptedStepSeconds <= 86400)
    if (accepted === 0) requireValue(maxAcceptedErrorRatio === 0 && smallestAcceptedStepSeconds === null && largestAcceptedStepSeconds === 0)
    else requireValue(smallestAcceptedStepSeconds !== null && smallestAcceptedStepSeconds > 0 &&
      smallestAcceptedStepSeconds <= largestAcceptedStepSeconds)
    notes(result.limitations); notes(search.limitations)
    requireValue(search.method === 'async-sampled-sign-change-bisection-v1' && search.referenceEpochTdb === source.solutionEpochTdb && search.timeScale === 'TDB' &&
      search.startSeconds === start && search.endSeconds === end && search.maxEvaluations === settings.maxEvaluations && search.maxEvents === settings.maxEvents &&
      search.requestedMaxStepSeconds === settings.maxStepSeconds && search.toleranceSeconds === settings.toleranceSeconds &&
      search.coverage === 'sampled-sign-changes-only' && search.possibleMissedEvents === true)
    const intervals = trajectoryScanIntervals(end-start, settings.maxStepSeconds, start, end, settings.maxEvaluations)
    const samples = bounded(search.evaluations,settings.maxEvaluations)
    requireValue(search.scanIntervals === intervals && samples >= intervals+1 && integrations <= samples)
    if (!scanGrid) {
      // Reconstruct only the bounded sampling grid, never the trajectory. Match
      // the producer's floating-point operation order, including its final end.
      bounded(intervals,2047)
      scanGrid = new Map([[start,0]])
      let previousTime = start
      for (let index=1;index<=intervals;index++) {
        const time = index === intervals ? end : start+((end-start)/intervals)*index
        requireValue(time > previousTime)
        expectedMaximumScanInterval = Math.max(expectedMaximumScanInterval,time-previousTime)
        scanGrid.set(time,index)
        previousTime = time
      }
      requireValue(expectedMaximumScanInterval <= settings.maxStepSeconds)
    }
    const step = finite(search.maximumScanIntervalSeconds)
    requireValue(step === expectedMaximumScanInterval)
    const startValue = finite(search.startValue), endValue = finite(search.endValue)
    if (intervals === 0) requireValue(startValue === endValue && samples === 1)
    requireValue(Array.isArray(search.events) && search.events.length <= settings.maxEvents)
    const occupiedScanSlots = new Set<number>()
    const sampledZeroSlots = new Set<number>()
    let previous = -Infinity
    for (const entry of search.events as unknown[]) {
      const event = record(entry), time = finite(event.elapsedTdbSeconds)
      const scan = pair(event.scanBracketSeconds), bracket = pair(event.localizationBracketSeconds), values = pair(event.localizationValues)
      requireValue(time >= previous && start <= scan[0] && scan[0] <= bracket[0] && bracket[0] <= time && time <= bracket[1] && bracket[1] <= scan[1] && scan[1] <= end && bracket[1]-bracket[0] <= settings.toleranceSeconds)
      // The producer reports this exact midpoint, not an arbitrary point in the
      // bracket. Bind it before deriving order statistics from received times.
      requireValue(time === bracket[0]+(bracket[1]-bracket[0])/2)
      previous = time
      const leftSlot = scanGrid.get(scan[0]), rightSlot = scanGrid.get(scan[1])
      requireValue(leftSlot !== undefined && rightSlot !== undefined && !occupiedScanSlots.has(rightSlot!))
      occupiedScanSlots.add(rightSlot!)
      if (event.kind === 'sampled-zero') {
        requireValue(event.direction === 'unclassified' && scan[0] === time && scan[1] === time && values[0] === 0 && values[1] === 0)
        sampledZeroSlots.add(rightSlot!)
      }
      else {
        requireValue(event.kind === 'sign-change' && scan[1] > scan[0] && ['increasing','decreasing'].includes(String(event.direction)))
        requireValue(rightSlot === leftSlot!+1 && !sampledZeroSlots.has(leftSlot!))
        requireValue(bracket[0] === bracket[1] ? values[0] === 0 && values[1] === 0 :
          event.direction === 'increasing' ? values[0] < 0 && values[1] > 0 : values[0] > 0 && values[1] < 0)
      }
    }
    requireValue(sampledZeroSlots.has(0) === (startValue === 0) && sampledZeroSlots.has(intervals) === (endValue === 0))
  }
  same(receipt.counts,{total:count,searched,failed,unresolved})
  requireValue(receipt.allDrawsSearched === (searched === count) && receipt.forceEvaluations === evaluations && evaluations <= 250000 && receipt.maximumForceEvaluations === 250000)
  same(receipt.timingSummary,summarizeFirstDetectedEventTimes(receipt.draws as EnsembleDistanceEventDraw[]))
}
