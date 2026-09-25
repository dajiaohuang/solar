import type { EventAnalysisRequest, EventAnalysisResponse } from '../../workers/conjunction.worker'
import { EPHEMERIS_MANIFEST } from '../ephemeris/kernelStore'
import { adaptiveEventSampleCount, eventSamplingBodies, eventSamplingReceipt } from './eventSampling'
import { MAX_ANALYSIS_EVENTS } from './eventAnalysisLimits'
import { matchesAnalysisTimeEvidence } from '../ephemeris/analysisEphemeris'

/** Bind a worker receipt to its request and pinned manifest. This checks
 * consistency, not the independent accuracy of the computed extrema. */
export function assertEventResultBinding(request: EventAnalysisRequest, response: EventAnalysisResponse): void {
  function fail(): never { throw new Error('Event result does not match its frozen request or ephemeris evidence') }
  const start = request.centerJulianDay - request.windowDays / 2
  const end = request.centerJulianDay + request.windowDays / 2
  const policy = request.ephemerisPolicy ?? 'prefer-spk'
  const evidence = response.ephemeris
  if (response.type !== 'result' || response.requestId !== request.requestId ||
      !Array.isArray(response.events) || response.events.length > MAX_ANALYSIS_EVENTS) fail()
  if (!evidence || evidence.schemaVersion !== 1 || evidence.policy !== policy ||
      evidence.startJulianDay !== start || evidence.endJulianDay !== end ||
      evidence.manifestId !== EPHEMERIS_MANIFEST.id || evidence.inputTimeScale !== 'UTC' ||
      evidence.frame !== 'ECLIPJ2000' || evidence.origin !== 'Sun' || evidence.positionUnit !== 'AU' ||
      evidence.velocityUnit !== 'AU/d' || evidence.physicalPredictionUncertainty !== 'not-estimated' ||
      !Array.isArray(evidence.kernelPool) || !Array.isArray(evidence.bodies)) fail()
  if (!matchesAnalysisTimeEvidence(evidence) || evidence.kernelPool.length > (request.ephemerisFiles?.length ?? 0) ||
      evidence.bodies.length > request.resolutionBodies.length) fail()
  const requestedFiles = new Set(request.ephemerisFiles ?? [])
  const manifest = new Map(EPHEMERIS_MANIFEST.files.map(file => [file.id, file]))
  const poolIds: string[] = []
  const poolSet = new Set<string>()
  for (const file of evidence.kernelPool) {
    if (!file || !requestedFiles.has(file.id) || !manifest.has(file.id) || poolSet.has(file.id) || file.sha256 !== manifest.get(file.id)?.sha256) fail()
    poolSet.add(file.id)
    poolIds.push(file.id)
  }
  const targets = new Map(request.bodies.map(body => [body.id, body]))
  const descriptions = new Map(request.resolutionBodies.map(body => [body.id, body]))
  const models = new Map(evidence.bodies.map(body => {
    if (!body) fail()
    return [body.bodyId, body] as const
  }))
  if (models.size !== evidence.bodies.length) fail()
  const needsAngles = request.eventKinds.some(kind => kind === 'conjunction' || kind === 'opposition')
  // Successful sampling records these bodies even if no extrema pass the
  // event filters. Empty results must not erase the models actually sampled.
  const sampledBodies = new Set(request.bodies.map(body => body.id))
  if (needsAngles) sampledBodies.add(request.referenceId)
  for (const body of request.bodies) {
    if (body.id === 'sun') continue
    const center = body.parentId ?? 'sun'
    const apsides = center === 'sun' ? ['perihelion', 'aphelion'] : ['periapsis', 'apoapsis']
    if (request.eventKinds.some(kind => apsides.includes(kind))) sampledBodies.add(center)
  }
  if (models.size !== sampledBodies.size || [...sampledBodies].some(id => !models.has(id))) fail()
  for (const body of evidence.bodies) {
    const description = descriptions.get(body.bodyId)
    if (!description || body.source !== description.source ||
        !['jpl-spk', 'approximate-fallback', 'heliocentric-origin'].includes(body.model) ||
        (body.model === 'heliocentric-origin') !== (body.bodyId === 'sun') ||
        (policy === 'require-spk' && body.model === 'approximate-fallback') ||
        (body.model === 'jpl-spk' && poolIds.length === 0)) fail()
  }
  const sampling = eventSamplingReceipt(request.centerJulianDay, request.windowDays,
    adaptiveEventSampleCount(eventSamplingBodies(request), request.windowDays, request.sampleCount))
  const receivedSampling = response.sampling
  const samplingFields = ['method', 'inputTimeScale', 'sampleCount', 'startJulianDay', 'endJulianDay', 'nominalIntervalDays', 'maximumIntervalDays', 'eventCompletenessCertified']
  if (!receivedSampling || typeof receivedSampling !== 'object' ||
      Object.keys(receivedSampling).length !== samplingFields.length || samplingFields.some(key => !Object.hasOwn(receivedSampling, key)) ||
      receivedSampling.method !== sampling.method || receivedSampling.inputTimeScale !== sampling.inputTimeScale ||
      receivedSampling.sampleCount !== sampling.sampleCount ||
      receivedSampling.startJulianDay !== sampling.startJulianDay || receivedSampling.endJulianDay !== sampling.endJulianDay ||
      receivedSampling.nominalIntervalDays !== sampling.nominalIntervalDays || receivedSampling.maximumIntervalDays !== sampling.maximumIntervalDays ||
      receivedSampling.eventCompletenessCertified !== false) fail()
  const interval = sampling.nominalIntervalDays
  let previous = -Infinity
  for (const event of response.events ?? []) {
    if (!event || !request.eventKinds.includes(event.kind) || !targets.has(event.bodyAId) ||
        !Number.isFinite(event.julianDay) || event.julianDay < start || event.julianDay > end || event.julianDay < previous ||
        !Number.isFinite(event.value) || event.value < 0 || event.sampleIntervalDays !== interval ||
        !Number.isFinite(event.numericalRefinementHalfWidthDays) || event.numericalRefinementHalfWidthDays < 0 ||
        !Number.isSafeInteger(event.refinementIterations) || event.refinementIterations < 0 || event.refinementIterations > 64 ||
        event.model !== 'sampled-ephemeris-local-refinement-v7' || event.physicalPredictionUncertainty !== 'not-estimated' ||
        !Array.isArray(event.ephemerisFiles) || event.ephemerisFiles.length !== poolIds.length ||
        poolIds.some((id, index) => !Object.hasOwn(event.ephemerisFiles, index) || event.ephemerisFiles[index] !== id) || event.ephemeris?.policy !== policy ||
        !Array.isArray(event.ephemeris.bodies)) fail()
    previous = event.julianDay
    const pair = ['close-approach', 'conjunction', 'opposition'].includes(event.kind)
    if (pair) {
      if (!event.bodyBId || event.bodyBId === event.bodyAId || !targets.has(event.bodyBId) || event.centralBodyId !== undefined) fail()
    } else {
      const center = targets.get(event.bodyAId)!.parentId ?? 'sun'
      const kinds = center === 'sun' ? ['perihelion', 'aphelion'] : ['periapsis', 'apoapsis']
      if (event.centralBodyId !== center || event.bodyBId !== undefined || !kinds.includes(event.kind)) fail()
    }
    const angular = event.kind === 'conjunction' || event.kind === 'opposition'
    if (event.unit !== (angular ? 'deg' : 'AU') || (angular && event.value > 180) ||
        (event.kind === 'conjunction' && event.value > 2) || (event.kind === 'opposition' && event.value < 178) ||
        (event.kind === 'close-approach' && event.value > request.thresholdAU)) fail()
    const requiredBodies = new Set([event.bodyAId, ...(pair ? [event.bodyBId!, ...(needsAngles ? [request.referenceId] : [])] : [event.centralBodyId!])])
    if (event.ephemeris.bodies.length !== requiredBodies.size) fail()
    for (const body of event.ephemeris.bodies) {
      if (!body) fail()
      const model = models.get(body.bodyId)
      if (!requiredBodies.delete(body.bodyId) || !model || model.model !== body.model || model.source !== body.source) fail()
    }
  }
}
