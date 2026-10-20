import { DE440_DYNAMICS_SOURCE } from '../engine/dynamics/de440Source'
import { OCCULTATION_MAX_EVALUATIONS, occultationScanIntervalCount } from '../engine/events/occultationContacts'
import pckSource from '../data/pck00011.source.json' with { type: 'json' }

// Mirrors DE440 epoch bookkeeping without loading or evaluating an ephemeris.
// Matching this representation is consistency evidence, not an accuracy check.
function emissionEpochParts(referenceJd: number, elapsed: number, offset: number) {
  const sum = (a: number, b: number) => {
    const high = a+b, carried = high-a
    return [high, (a-(high-carried))+(b-carried)] as const
  }
  const [high, low] = sum((referenceJd-2451545)*86400, elapsed)
  return sum(high, low+offset)
}

export type OccultationInputBinding = {
  calculation: 'contacts' | 'limb' | 'stellar-limb' | 'ellipsoid-ray-contacts'
  input: { sha256: string; bytes: number; originalBase64: string; payloadJson: string }
  observer?: { sha256: string; bytes: number; originalResponseJson: string; sourceId: string; utc: string; stationJson: string }
}

/** Bind provenance, source identities and request epochs before displaying a
 * worker result. This is not geometry validation or source authentication. */
export function checkOccultationInputBinding(value: unknown, binding: OccultationInputBinding) {
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid occultation receipt record')
    return value as Record<string, unknown>
  }
  const receipt = record(value), input = record(receipt.inputFile)
  if (input.sha256 !== binding.input.sha256 || input.bytes !== binding.input.bytes ||
      input.originalBase64 !== binding.input.originalBase64 ||
      JSON.stringify(input.payload) !== binding.input.payloadJson) throw new Error('Occultation receipt does not match the submitted input')
  const payload = record(JSON.parse(binding.input.payloadJson)), ephemeris = record(receipt.ephemeris)
  const same = (actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Occultation receipt source or epoch mismatch')
  }
  if (receipt.schemaVersion !== (binding.calculation === 'contacts' ? 2 : 1)) throw new Error('Occultation receipt schema version mismatch')
  const pinned = (value: unknown, expected: Record<string, unknown>) => {
    const actual = record(value)
    for (const [key, field] of Object.entries(expected)) same(actual[key], field)
  }
  const finite = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Nonfinite occultation receipt epoch')
    return value
  }
  const integer = (value: unknown, minimum: number, maximum: number, label: string): number => {
    const result = finite(value)
    if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`Invalid occultation ${label} budget receipt`)
    return result
  }
  const boundedPair = (value: unknown, minimum: number, maximum: number, label: string): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`Invalid occultation ${label} bracket`)
    const pair: [number, number] = [finite(value[0]), finite(value[1])]
    if (pair[0] > pair[1] || pair[0] < minimum || pair[1] > maximum) throw new Error(`Occultation ${label} lies outside its ordered search window`)
    return pair
  }
  same(ephemeris.frame, 'J2000'); same(ephemeris.origin, 'SSB'); same(ephemeris.timeScale, 'TDB')
  same(ephemeris.aberration, payload.aberration)
  pinned(binding.calculation === 'contacts' ? ephemeris.kernel : receipt.kernel, DE440_DYNAMICS_SOURCE)
  pinned(binding.calculation === 'contacts' ? record(receipt.shapes).source : receipt.source, pckSource)
  let referenceEpochTdb = payload.referenceEpochTdb, elapsed = payload.elapsedTdbSeconds
  if (binding.observer) {
    const observer = record(receipt.observerReceipt), expected = binding.observer
    if (observer.sha256 !== expected.sha256 || observer.bytes !== expected.bytes || observer.originalResponseJson !== expected.originalResponseJson ||
        receipt.sourceId !== expected.sourceId || receipt.utc !== expected.utc || JSON.stringify(receipt.station) !== expected.stationJson) {
      throw new Error('Station limb receipt does not match the submitted observer source')
    }
    const original = record(JSON.parse(expected.originalResponseJson))
    const experiment = record(original.experiment)
    const stationState = record(record(experiment.observation).observerState)
    const epoch = stationState.epochJdTdbParts
    if (!Array.isArray(epoch) || epoch.length !== 2) throw new Error('Invalid original station epoch')
    const a = finite(epoch[0]), b = finite(epoch[1])
    const wholeDays = Math.floor(a) + Math.floor(b), fractions = (a-Math.floor(a)) + (b-Math.floor(b))
    referenceEpochTdb = Math.max(wholeDays+Math.floor(fractions), 2451545+DE440_DYNAMICS_SOURCE.startEt/86400)
    elapsed = ((wholeDays-finite(referenceEpochTdb))+fractions)*86400
    same(ephemeris.epochJdTdbParts, epoch)
    same(ephemeris.observerKind, 'earth-ground-station')
    const ray = record(receipt.coordinateRay), sky = record(receipt.stationSkyContext), observed = record(experiment.observed)
    same(stationState.frame, 'J2000'); same(stationState.origin, 'solar-system-barycenter')
    same(ray.model, 'station-coordinate-bcrs-ray-in-icrs-aligned-j2000')
    same(ray.sourceField, 'experiment.coordinateDirectionBcrs')
    same(ray.directionBcrs, experiment.coordinateDirectionBcrs)
    same(ray.observerPositionBarycentricKm, stationState.positionKm)
    same(ray.receptionEpochJdTdbParts, epoch)
    same(ray.observerParallax, 'already-applied-by-Pmpx')
    same(ray.frameConvention, 'SPK-J2000-treated-as-ICRS-aligned')
    const direction = experiment.coordinateDirectionBcrs
    if (!Array.isArray(direction) || direction.length !== 3) throw new Error('Invalid original coordinate ray')
    const coordinates = direction.map(finite), length = Math.hypot(...coordinates)
    if (!Number.isFinite(length) || Math.abs(length-1) > 1e-12) throw new Error('Original coordinate ray must be a unit vector')
    same(record(receipt.sightline).directionUnitJ2000, coordinates.map(value => value/length))
    same(sky.model, observed.model); same(sky.apparentAirless, observed.apparentAirless)
    same(sky.solarElongationDeg, observed.solarElongationDeg)
    same(sky.visibility, 'not-evaluated'); same(sky.use, 'context-only-not-the-intersection-ray')
  }
  if ((binding.calculation === 'stellar-limb') !== Boolean(binding.observer)) throw new Error('Missing or unexpected station receipt binding')
  same(ephemeris.referenceEpochTdb, finite(referenceEpochTdb))
  const margin = payload.aberration === 'CN' ? finite(payload.maxLightTimeSeconds ?? 36000) : 0
  if (binding.calculation === 'contacts') {
    const start = finite(payload.startSeconds), end = finite(payload.endSeconds), shapes = record(receipt.shapes)
    const maxStep = finite(payload.maxStepSeconds), tolerance = finite(payload.toleranceSeconds)
    const duration = end-start
    if (duration < 0 || duration > 365*86400 || maxStep <= 0 || tolerance <= 0 || tolerance > maxStep ||
        (payload.aberration !== 'NONE' && payload.aberration !== 'CN') ||
        (payload.aberration === 'CN' && (margin <= 0 || margin > 86400))) throw new Error('Invalid occultation request budget or interval')
    const intervals = occultationScanIntervalCount(duration, maxStep, start, end, OCCULTATION_MAX_EVALUATIONS)
    if (!Number.isSafeInteger(intervals) || intervals+1 > OCCULTATION_MAX_EVALUATIONS) throw new Error('Occultation request exceeds the receipt evaluation budget')
    let expectedMaximumScan = 0, previous = start
    const scanTimes = new Set<number>([start])
    const scanGridIndices = new Map<number, number>([[start, 0]])
    for (let interval = 1; interval <= intervals; interval++) {
      const next = interval === intervals ? end : start+(duration/intervals)*interval
      if (!(next > previous)) throw new Error('Occultation request is below elapsed-time resolution')
      expectedMaximumScan = Math.max(expectedMaximumScan,next-previous)
      scanTimes.add(next)
      scanGridIndices.set(next, interval)
      previous = next
    }
    if (expectedMaximumScan > maxStep) throw new Error('Occultation scan exceeds its requested maximum step')
    const evaluations = integer(receipt.evaluations, intervals+1, OCCULTATION_MAX_EVALUATIONS, 'evaluation')
    const stateRequests = integer(receipt.ephemerisStateRequests, 0, 25*OCCULTATION_MAX_EVALUATIONS, 'ephemeris-state')
    const contacts = receipt.contacts
    if (!Array.isArray(contacts) || contacts.length > 512) throw new Error('Occultation contact result exceeds its event budget')
    if (payload.aberration === 'NONE' && stateRequests !== 3*evaluations ||
        payload.aberration === 'CN' && (stateRequests < 3*evaluations || stateRequests > 25*evaluations)) {
      throw new Error('Occultation ephemeris-state requests do not match the evaluation and light-time budgets')
    }
    const seenContacts: number[] = [], uniqueContacts = new Set<string>()
    for (const value of contacts) {
      const contact = record(value), elapsedContact = finite(contact.elapsedTdbSeconds)
      if (contact.boundary !== 'external' && contact.boundary !== 'internal') throw new Error('Invalid occultation contact boundary')
      if (elapsedContact < start || elapsedContact > end) throw new Error('Occultation contact lies outside the requested window')
      const contactKey = `${contact.boundary}:${elapsedContact}`
      if (uniqueContacts.has(contactKey)) throw new Error('Duplicate occultation contact record')
      uniqueContacts.add(contactKey)
      seenContacts.push(elapsedContact)
      const scan = boundedPair(contact.scanBracketSeconds,start,end,'scan')
      const root = boundedPair(contact.bracketSeconds,start,end,'localization')
      if (root[0] < scan[0] || root[1] > scan[1] || scan[1]-scan[0] > expectedMaximumScan) throw new Error('Occultation localization bracket exceeds its scan bracket')
      const scanStartIndex = scanGridIndices.get(scan[0]), scanEndIndex = scanGridIndices.get(scan[1])
      if (contact.direction === 'sampled-zero') {
        if (!scanTimes.has(elapsedContact) || scanStartIndex !== scanEndIndex || scanStartIndex === undefined ||
            root[0] !== elapsedContact || root[1] !== elapsedContact || scan[0] !== elapsedContact || scan[1] !== elapsedContact) throw new Error('Sampled-zero contact must retain its exact sample epoch')
      } else {
        if (contact.direction !== 'enter' && contact.direction !== 'exit') throw new Error('Invalid occultation contact direction')
        if (scanStartIndex === undefined || scanEndIndex !== scanStartIndex+1 || !(scan[1] > scan[0]) ||
            root[1]-root[0] > tolerance || elapsedContact !== root[0]+(root[1]-root[0])/2) throw new Error('Occultation contact localization exceeds its requested tolerance')
      }
    }
    const windows = receipt.sampledOverlapWindows
    if (!Array.isArray(windows) || windows.length > contacts.length+2) throw new Error('Occultation overlap-window result exceeds its event budget')
    const startGaps = record(receipt.startGapsRadians), endGaps = record(receipt.endGapsRadians)
    for (const boundary of ['external', 'internal'] as const) { finite(startGaps[boundary]); finite(endGaps[boundary]) }
    const previousWindowEnd = new Map<'external' | 'internal', number>()
    const verifyEdge = (value: unknown, boundary: 'external' | 'internal') => {
      const edge = record(value), time = finite(edge.elapsedTdbSeconds), bracket = boundedPair(edge.bracketSeconds,start,end,'window-edge')
      if (time !== bracket[0]+(bracket[1]-bracket[0])/2) throw new Error('Occultation overlap edge is not the center of its retained bracket')
      if (bracket[1]-bracket[0] > tolerance) throw new Error('Occultation overlap edge exceeds the requested localization tolerance')
      const clippedSample = (time === start || time === end) && bracket[0] === time && bracket[1] === time
      if (edge.kind === 'search-boundary') {
        if (!clippedSample) throw new Error('Occultation search edge is not identified as a clipped sample boundary')
        const endpointGap = time === start ? startGaps[boundary] : time === end ? endGaps[boundary] : undefined
        if (endpointGap === undefined || finite(endpointGap) > 0) throw new Error('Clipped occultation window edge lacks a nonpositive sampled gap')
      } else if (clippedSample || edge.kind !== 'sampled-overlap' && edge.kind !== 'sampled-zero' && edge.kind !== 'bracketed-contact') {
        throw new Error('Invalid occultation overlap edge kind')
      }
      if ((edge.kind === 'sampled-overlap' || edge.kind === 'sampled-zero') && bracket[0] !== bracket[1]) throw new Error('Sampled occultation edge must have a zero-width bracket')
      if (edge.kind === 'sampled-overlap' && !scanTimes.has(time)) throw new Error('Sampled overlap edge is not on the requested scan grid')
      if (edge.kind === 'sampled-zero' && !contacts.some(value => {
        const contact = record(value)
        return contact.boundary === boundary && contact.direction === 'sampled-zero' && contact.elapsedTdbSeconds === time
      })) throw new Error('Sampled-zero window edge has no matching contact record')
      if (edge.kind === 'bracketed-contact' && !contacts.some(value => {
        const contact = record(value)
        return contact.boundary === boundary && contact.direction !== 'sampled-zero' && contact.elapsedTdbSeconds === time &&
          JSON.stringify(contact.bracketSeconds) === JSON.stringify(bracket)
      })) throw new Error('Bracketed window edge has no matching contact record')
      return time
    }
    for (const value of windows) {
      const window = record(value)
      if (window.boundary !== 'external' && window.boundary !== 'internal') throw new Error('Invalid occultation overlap boundary')
      const boundary = window.boundary
      const windowStart = verifyEdge(window.start,boundary), windowEnd = verifyEdge(window.end,boundary), durationSeconds = windowEnd-windowStart
      if (!(durationSeconds > 0)) throw new Error('Occultation overlap window must have positive duration')
      const earlierEnd = previousWindowEnd.get(boundary)
      if (earlierEnd !== undefined && !(windowStart > earlierEnd)) throw new Error('Occultation overlap windows are not time ordered and disjoint')
      previousWindowEnd.set(boundary,windowEnd)
      same(window.durationSeconds,durationSeconds)
      const startEdge = record(window.start), endEdge = record(window.end)
      const startBracket = boundedPair(startEdge.bracketSeconds,start,end,'window-start')
      const endBracket = boundedPair(endEdge.bracketSeconds,start,end,'window-end')
      const expectedBounds = [Math.max(0,endBracket[0]-startBracket[1]),endBracket[1]-startBracket[0]]
      same(window.numericalDurationBoundsSeconds,expectedBounds)
      if (expectedBounds[0] > durationSeconds || expectedBounds[1] < durationSeconds) throw new Error('Occultation overlap duration is outside its retained numerical bounds')
    }
    same(receipt.maximumScanIntervalSeconds,expectedMaximumScan)
    if (seenContacts.some((time,index) => index > 0 && time < seenContacts[index-1])) throw new Error('Occultation contacts are not ordered by epoch')
    same(ephemeris.elapsedRangeSeconds, [Math.min(0, start-margin), Math.max(0, end)])
    same(record(shapes.foreground).naifPckId, payload.foregroundId)
    same(record(shapes.background).naifPckId, payload.backgroundId)
    same(receipt.startSeconds, start); same(receipt.endSeconds, end)
    same(receipt.toleranceSeconds, payload.toleranceSeconds); same(receipt.requestedMaxStepSeconds, payload.maxStepSeconds)
    same(receipt.scanIntervals,intervals)
    same(receipt.coverage, 'sampled-sign-changes-only'); same(receipt.possibleMissedEvents, true)
    same(receipt.physicalTimingUncertaintySeconds, null)
    same(receipt.calculation, payload.aberration === 'CN' ? 'reception-spherical-occultation-contacts' : 'geometric-spherical-occultation-contacts')
    if (payload.aberration === 'CN') {
      const reception = record(receipt.reception)
      same(reception.model, 'converged-newtonian-reception')
      same(reception.sourceMarginSeconds, margin)
      same(reception.iterationToleranceSeconds,1e-9); same(reception.maxIterations,12)
      same(reception.iterationTimeOrigin, 'each-reception-epoch')
      same(reception.ephemerisTimeRepresentation, 'split-ET-Type-2/3')
      integer(reception.observedMaximumIterations,1,12,'light-time iteration')
      const residual = finite(reception.observedMaximumResidualSeconds), lightTime = finite(reception.observedMaximumLightTimeSeconds)
      if (residual < 0 || residual > 1e-9 || lightTime <= 0 || lightTime > margin) throw new Error('Occultation light-time receipt exceeds its declared solver budget')
    } else same(receipt.reception, null)
  } else {
    const receptionEpoch = finite(elapsed), orientation = record(receipt.orientation)
    same(ephemeris.elapsedRangeSeconds, [Math.min(0, receptionEpoch-margin), Math.max(0, receptionEpoch)])
    same(ephemeris.receptionElapsedTdbSeconds, receptionEpoch)
    same(record(receipt.shape).naifPckId, payload.targetId); same(orientation.naifPckId, payload.targetId)
    same(orientation.model, 'pck00011-text-IAU')
    const parts = orientation.secondsPastJ2000TdbParts
    if (!Array.isArray(parts) || parts.length !== 2) throw new Error('Missing split orientation epoch')
    same(orientation.secondsPastJ2000Tdb, finite(parts[0])+finite(parts[1]))
    if (payload.aberration === 'CN') {
      const reception = record(receipt.reception), offset = finite(reception.emissionOffsetFromReceptionSeconds)
      if (offset > 0 || offset < -margin) throw new Error('Emission epoch exceeds the submitted light-time margin')
      same(reception.iterationOriginElapsedTdbSeconds, receptionEpoch)
      same(reception.ephemerisTimeRepresentation, 'split-ET-Type-2/3')
      same(reception.emissionElapsedTdbSeconds, receptionEpoch+offset)
      same(ephemeris.emissionElapsedTdbSeconds, receptionEpoch+offset)
      same(parts, emissionEpochParts(finite(referenceEpochTdb), receptionEpoch, offset))
    } else {
      same(receipt.reception, null); same(ephemeris.emissionElapsedTdbSeconds, receptionEpoch)
      same(parts, emissionEpochParts(finite(referenceEpochTdb), receptionEpoch, 0))
    }
    same(receipt.physicalLimbUncertaintyKm, null)
  }
}
