import { DE440_DYNAMICS_SOURCE } from '../engine/dynamics/de440Source'
import { parseEllipsoidRayContactInput } from './ellipsoidRayContactInput'
import { OCCULTATION_MAX_EVALUATIONS, occultationScanIntervalCount } from '../engine/events/occultationContacts'
import pckSource from '../data/pck00011.source.json' with { type: 'json' }

type InputBinding = { sha256: string; bytes: number; originalBase64: string; payloadJson: string }

/** Bind the ray-event receipt to its exact submitted input and frozen source
 * identities. This checks provenance and numerical brackets, not ray geometry
 * correctness, source authentication, event completeness or physical accuracy. */
export function checkEllipsoidRayContactInputBinding(value: unknown, binding: InputBinding) {
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ellipsoid-ray receipt record')
    return value as Record<string, unknown>
  }
  const same = (actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Ellipsoid-ray receipt input, source or epoch mismatch')
  }
  const finite = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Nonfinite ellipsoid-ray receipt value')
    return value
  }
  const integer = (value: unknown, minimum: number, maximum: number, name: string) => {
    const result = finite(value)
    if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`Invalid ellipsoid-ray ${name} budget`)
    return result
  }
  const pair = (value: unknown, minimum: number, maximum: number, name: string): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`Invalid ellipsoid-ray ${name} bracket`)
    const result: [number, number] = [finite(value[0]), finite(value[1])]
    if (result[0] > result[1] || result[0] < minimum || result[1] > maximum) throw new Error(`Ellipsoid-ray ${name} lies outside its search window`)
    return result
  }
  const receipt = record(value), inputFile = record(receipt.inputFile)
  if (inputFile.sha256 !== binding.sha256 || inputFile.bytes !== binding.bytes || inputFile.originalBase64 !== binding.originalBase64 ||
      JSON.stringify(inputFile.payload) !== binding.payloadJson) throw new Error('Ellipsoid-ray receipt does not match the submitted input')
  const payload = record(JSON.parse(binding.payloadJson))
  const canonicalBytes = new TextEncoder().encode(JSON.stringify(payload)).buffer
  same(parseEllipsoidRayContactInput(canonicalBytes), payload)
  const ephemeris = record(receipt.ephemeris)
  same(receipt.schemaVersion, 1)
  same(ephemeris.frame, 'J2000'); same(ephemeris.origin, 'SSB'); same(ephemeris.timeScale, 'TDB')
  same(ephemeris.aberration, payload.aberration)
  same(ephemeris.referenceEpochTdb, payload.referenceEpochTdb)
  same(ephemeris.emissionEpochPolicy, 'target-center-reception-light-time; shape orientation at center emission epoch')
  same(ephemeris.kernel, DE440_DYNAMICS_SOURCE)
  same(receipt.source, pckSource)
  same(receipt.gapModel, 'scaled-forward-ray-ellipsoid-clearance-v1')
  same(receipt.gapUnits, 'dimensionless-scaled-unit-sphere-clearance')
  const start = finite(payload.startSeconds), end = finite(payload.endSeconds), maxStep = finite(payload.maxStepSeconds), tolerance = finite(payload.toleranceSeconds)
  const margin = payload.aberration === 'CN' ? finite(payload.maxLightTimeSeconds ?? 36000) : 0
  const intervals = occultationScanIntervalCount(end-start, maxStep, start, end, OCCULTATION_MAX_EVALUATIONS)
  if (!Number.isSafeInteger(intervals) || intervals+1 > OCCULTATION_MAX_EVALUATIONS) throw new Error('Ellipsoid-ray request exceeds its evaluation budget')
  same(ephemeris.elapsedRangeSeconds, [Math.min(0, start-margin), Math.max(0, end)])
  same(receipt.startSeconds, start); same(receipt.endSeconds, end); same(receipt.toleranceSeconds, tolerance)
  same(receipt.requestedMaxStepSeconds, maxStep); same(receipt.scanIntervals, intervals)
  same(receipt.possibleMissedEvents, true)
  same(receipt.physicalTimingUncertaintySeconds, null)
  const targetId = integer(payload.targetId, 1, Number.MAX_SAFE_INTEGER, 'target ID')
  integer(payload.observerId, 0, Number.MAX_SAFE_INTEGER, 'observer ID')
  const shape = record(receipt.shape)
  same(shape.naifPckId, targetId)
  if (!Array.isArray(shape.radiiKm) || shape.radiiKm.length !== 3 || shape.radiiKm.some(value => finite(value) <= 0)) throw new Error('Invalid ellipsoid-ray shape receipt')
  const radii = shape.radiiKm.map(finite)
  if (Math.min(...radii)/Math.max(...radii) < 1e-12) throw new Error('Ellipsoid-ray axes exceed the limb conditioning limit')
  same(shape.representation, radii.every(value => value === radii[0]) ? 'sphere' : 'triaxial-ellipsoid')
  same(receipt.orientationModel, shape.representation === 'sphere' ? 'rotation-invariant-sphere' : 'pck00011-text-IAU')
  const observerDistance = pair(receipt.observerScaledDistanceRange, 1, 1e12, 'observer conditioning')
  if (observerDistance[0] <= 1+1e-10 || observerDistance[1] < observerDistance[0]) throw new Error('Ellipsoid-ray observer lies outside its declared conditioning range')
  const screening = record(receipt.numericalScreening)
  same(screening.policy, '128*Number.EPSILON*max(1, observerScaledDistance)')
  same(screening.limitation, 'Numerical indeterminate classification margin only; not a certified floating-point or physical error bound.')
  same(screening.maximumMarginScaled, 128*Number.EPSILON*Math.max(1, observerDistance[1]))
  const indeterminateSamples = receipt.indeterminateSamples
  const screenedCrossings = receipt.numericallyScreenedCrossings
  if (!Array.isArray(indeterminateSamples) || indeterminateSamples.length > OCCULTATION_MAX_EVALUATIONS ||
      !Array.isArray(screenedCrossings) || screenedCrossings.length > intervals || screenedCrossings.length > indeterminateSamples.length) {
    throw new Error('Invalid ellipsoid-ray numerical screening evidence')
  }
  same(receipt.coverage, indeterminateSamples.length ? 'sampled-with-numerically-indeterminate-points' : 'sampled-sign-changes-only')
  const screeningSamples = new Map<number, { gap: number; margin: number }>()
  for (const raw of indeterminateSamples) {
    const sample = record(raw), time = finite(sample.elapsedTdbSeconds), gap = finite(sample.gapScaled), margin = finite(sample.screeningMarginScaled)
    if (time < start || time > end || screeningSamples.has(time) || margin < 0 || margin > finite(screening.maximumMarginScaled) || Math.abs(gap) > margin) {
      throw new Error('Invalid or duplicate ellipsoid-ray indeterminate sample')
    }
    screeningSamples.set(time, { gap, margin })
  }
  if (!Array.isArray(payload.directionJ2000) || payload.directionJ2000.length !== 3) throw new Error('Invalid submitted J2000 ray')
  const direction = payload.directionJ2000.map(finite), length = Math.hypot(...direction)
  if (!(length > 0) || !Number.isFinite(length)) throw new Error('Invalid submitted J2000 ray length')
  same(receipt.directionUnitJ2000, direction.map(value => value/length))
  same(receipt.calculation, payload.aberration === 'CN' ? 'reception-oriented-ellipsoid-point-ray-contacts' : 'geometric-oriented-ellipsoid-point-ray-contacts')
  const evaluations = integer(receipt.evaluations, intervals+1, OCCULTATION_MAX_EVALUATIONS, 'geometry evaluation')
  if (indeterminateSamples.length > evaluations) throw new Error('Ellipsoid-ray indeterminate samples exceed the evaluation count')
  integer(receipt.ephemerisStateRequests, evaluations*2, evaluations*(payload.aberration === 'CN' ? 13 : 2), 'state request')
  const grid = new Map<number, number>()
  grid.set(start, 0)
  let expectedMaximumScan = 0, previousGridTime = start
  for (let i = 1; i <= intervals; i++) {
    const gridTime = i === intervals ? end : start+(end-start)/intervals*i
    if (!(gridTime > previousGridTime) || gridTime-previousGridTime > maxStep) throw new Error('Ellipsoid-ray scan grid exceeds its requested time resolution')
    expectedMaximumScan = Math.max(expectedMaximumScan, gridTime-previousGridTime)
    grid.set(gridTime, i); previousGridTime = gridTime
  }
  same(receipt.maximumScanIntervalSeconds, expectedMaximumScan)
  const contacts = receipt.contacts
  if (!Array.isArray(contacts) || contacts.length > 512) throw new Error('Ellipsoid-ray contacts exceed their result budget')
  const seen = new Set<number>()
  const localizedIntervals = new Set<number>()
  const sampledZeroIndices = new Set<number>()
  let previousContact = -Infinity
  for (const raw of contacts) {
    const contact = record(raw), time = finite(contact.elapsedTdbSeconds)
    if (contact.boundary !== 'ellipsoid-limb' || time < start || time > end || time < previousContact || seen.has(time)) throw new Error('Invalid or unordered ellipsoid-ray contact')
    seen.add(time); previousContact = time
    const scan = pair(contact.scanBracketSeconds, start, end, 'scan')
    const root = pair(contact.bracketSeconds, start, end, 'root')
    if (contact.direction === 'sampled-zero') {
      const sampleIndex = grid.get(time)
      const sample = screeningSamples.get(time)
      if (scan[0] !== time || scan[1] !== time || root[0] !== time || root[1] !== time || sampleIndex === undefined ||
          !sample || sample.gap !== 0 || sample.margin !== 0) throw new Error('Sampled ellipsoid-ray zero is not an exact unscreened scan sample')
      sampledZeroIndices.add(sampleIndex)
    } else {
      if (contact.direction !== 'enter' && contact.direction !== 'exit') throw new Error('Invalid ellipsoid-ray contact direction')
      const leftIndex = grid.get(scan[0]), rightIndex = grid.get(scan[1])
      if (leftIndex === undefined || rightIndex !== leftIndex+1 || !(scan[1] > scan[0]) || root[0] < scan[0] || root[1] > scan[1] ||
          root[1]-root[0] > tolerance || time !== root[0]+(root[1]-root[0])/2 || localizedIntervals.has(leftIndex)) {
        throw new Error('Ellipsoid-ray root bracket exceeds its scan interval or tolerance or duplicates a localized scan interval')
      }
      localizedIntervals.add(leftIndex)
    }
  }
  for (const zeroIndex of sampledZeroIndices) {
    if (localizedIntervals.has(zeroIndex-1) || localizedIntervals.has(zeroIndex)) {
      throw new Error('A sampled ellipsoid-ray zero cannot share an adjacent localized crossing interval')
    }
  }
  const screenedIntervals = new Set<number>()
  for (const raw of screenedCrossings) {
    const crossing = record(raw), scan = pair(crossing.scanBracketSeconds, start, end, 'screened scan')
    const screenedAt = finite(crossing.screeningSampleSeconds), gap = finite(crossing.screeningGapScaled), margin = finite(crossing.screeningMarginScaled)
    const leftIndex = grid.get(scan[0]), rightIndex = grid.get(scan[1])
    if (crossing.boundary !== 'ellipsoid-limb' || (crossing.direction !== 'enter' && crossing.direction !== 'exit') ||
        leftIndex === undefined || rightIndex === undefined || rightIndex !== leftIndex+1 || !(screenedAt > scan[0] && screenedAt < scan[1]) ||
        margin < 0 || margin > finite(screening.maximumMarginScaled) || Math.abs(gap) > margin || !screeningSamples.has(screenedAt) ||
        screenedIntervals.has(leftIndex) || localizedIntervals.has(leftIndex) || sampledZeroIndices.has(leftIndex) || sampledZeroIndices.has(rightIndex)) {
      throw new Error('Invalid or duplicate numerically screened ellipsoid-ray crossing')
    }
    const sample = screeningSamples.get(screenedAt)
    if (!sample || sample.gap !== gap || sample.margin !== margin) throw new Error('Screened ellipsoid-ray crossing lacks its matching indeterminate sample')
    screenedIntervals.add(leftIndex)
  }
  const startGap = finite(receipt.startGapScaled), endGap = finite(receipt.endGapScaled)
  const windows = receipt.sampledInterceptWindows
  if (!Array.isArray(windows) || windows.length > contacts.length+2) throw new Error('Ellipsoid-ray windows exceed their event budget')
  let previousEnd = -Infinity
  for (const raw of windows) {
    const window = record(raw)
    if (window.boundary !== 'ellipsoid-limb') throw new Error('Invalid ellipsoid-ray window boundary')
    const edgeTime = (rawEdge: unknown, position: 'start' | 'end') => {
      const edge = record(rawEdge), time = finite(edge.elapsedTdbSeconds), bracket = pair(edge.bracketSeconds, start, end, 'window-edge')
      if (time !== bracket[0]+(bracket[1]-bracket[0])/2 || bracket[1]-bracket[0] > tolerance) throw new Error('Ellipsoid-ray window edge exceeds its retained bracket')
      const clipped = (time === start || time === end) && bracket[0] === time && bracket[1] === time
      if (edge.kind === 'search-boundary') {
        const gap = time === start ? startGap : time === end ? endGap : undefined
        if (!clipped || gap === undefined || gap > 0) throw new Error('Clipped ellipsoid-ray window lacks a nonpositive endpoint gap')
      } else if (edge.kind === 'sampled-intercept') {
        if (clipped || bracket[0] !== bracket[1] || !grid.has(time)) throw new Error('Invalid sampled ellipsoid-ray intercept edge')
      } else if (edge.kind === 'sampled-zero') {
        if (clipped || bracket[0] !== bracket[1] || !contacts.some(value => {
          const item = record(value)
          return item.direction === 'sampled-zero' && item.elapsedTdbSeconds === time
        })) throw new Error('Sampled-zero ellipsoid-ray edge lacks a matching contact')
      } else if (edge.kind === 'bracketed-contact') {
        if (!contacts.some(value => {
          const item = record(value)
          return item.direction === (position === 'start' ? 'enter' : 'exit') && item.elapsedTdbSeconds === time && JSON.stringify(item.bracketSeconds) === JSON.stringify(bracket)
        })) throw new Error('Bracketed ellipsoid-ray edge lacks a matching contact')
      } else throw new Error('Invalid ellipsoid-ray window edge kind')
      return time
    }
    const from = edgeTime(window.start, 'start'), to = edgeTime(window.end, 'end'), duration = to-from
    if (!(duration > 0) || from <= previousEnd) throw new Error('Ellipsoid-ray windows must be positive and disjoint')
    previousEnd = to
    same(window.durationSeconds, duration)
    const startBracket = pair(record(window.start).bracketSeconds, start, end, 'window-start')
    const endBracket = pair(record(window.end).bracketSeconds, start, end, 'window-end')
    const bounds: [number, number] = [Math.max(0, endBracket[0]-startBracket[1]), endBracket[1]-startBracket[0]]
    same(window.numericalDurationBoundsSeconds, bounds)
    if (bounds[0] > duration || bounds[1] < duration) throw new Error('Ellipsoid-ray duration lies outside its retained numerical bounds')
  }
  if (payload.aberration === 'CN') {
    const reception = record(receipt.reception), sourceMargin = finite(reception.sourceMarginSeconds)
    same(reception.model, 'converged-newtonian-reception'); same(sourceMargin, margin)
    same(reception.iterationToleranceSeconds, 1e-9); same(reception.iterationTimeOrigin, 'each-reception-epoch')
    same(reception.ephemerisTimeRepresentation, 'split-ET-Type-2/3'); same(reception.maxIterations, 12)
    integer(reception.observedMaximumIterations, 1, 12, 'light-time iteration')
    const residual = finite(reception.observedMaximumResidualSeconds), lightTime = finite(reception.observedMaximumLightTimeSeconds)
    if (residual < 0 || residual > 1e-9 || lightTime <= 0 || lightTime > margin) throw new Error('Ellipsoid-ray light-time receipt exceeds its declared solver budget')
  } else same(receipt.reception, null)
}
