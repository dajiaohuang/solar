import type { PorkchopWorkerRequest, PorkchopWorkerResponse } from '../../workers/porkchop.worker'
import { EPHEMERIS_MANIFEST } from '../ephemeris/kernelStore'
import { matchesAnalysisTimeEvidence } from '../ephemeris/analysisEphemeris'
import { utcJulianDayToTdb } from '../ephemeris/timeScales'
import { porkchopEndpointEpochs, PORKCHOP_GRID_COLUMNS, PORKCHOP_GRID_ROWS } from './porkchopRequest'
import { backendBodyId } from '../../lib/currentStateIdentity'

const SHA256 = /^[a-f0-9]{64}$/

/** Receipt consistency only; this does not independently solve Lambert. */
export function assertPorkchopResultBinding(request: PorkchopWorkerRequest, result: NonNullable<PorkchopWorkerResponse['result']>): void {
  const fail = (): never => { throw new Error('Mission grid does not match its request or ephemeris evidence') }
  if (result.columns !== PORKCHOP_GRID_COLUMNS || result.rows !== PORKCHOP_GRID_ROWS || !Array.isArray(result.points) ||
      result.points.length !== PORKCHOP_GRID_COLUMNS * PORKCHOP_GRID_ROWS ||
      result.endpoints?.departureBodyId !== request.departureBodyId || result.endpoints?.arrivalBodyId !== request.arrivalBodyId) fail()
  const evidence = result.ephemeris
  const scan = result.scan
  if (!scan || scan.departureStartJd !== request.departureStartJd || scan.departureSpanDays !== request.departureSpanDays ||
      scan.minFlightDays !== request.minFlightDays || scan.maxFlightDays !== request.maxFlightDays ||
      scan.epochTimeScale !== 'UTC' || scan.flightAxis !== 'arrival-minus-departure-utc-jd' ||
      scan.pointOrder !== 'row-major-flight-by-departure' || scan.prograde !== true || scan.revolutions !== 0) fail()
  const policy = request.ephemerisPolicy ?? 'prefer-spk'
  const expectedEndJulianDay = request.departureStartJd + request.departureSpanDays + request.maxFlightDays
  if (!evidence || evidence.schemaVersion !== 1 || evidence.policy !== policy ||
      evidence.startJulianDay !== request.departureStartJd || evidence.endJulianDay !== expectedEndJulianDay ||
      evidence.inputTimeScale !== 'UTC' || evidence.frame !== 'ECLIPJ2000' || evidence.origin !== 'Sun' ||
      evidence.positionUnit !== 'AU' || evidence.velocityUnit !== 'AU/d' || evidence.physicalPredictionUncertainty !== 'not-estimated' ||
      !Array.isArray(evidence.kernelPool) || !Array.isArray(evidence.bodies) || !Array.isArray(result.ephemerisFiles) ||
      result.ephemerisFiles.length !== evidence.kernelPool.length || !matchesAnalysisTimeEvidence(evidence)) fail()

  if (result.backendStateAudit) {
    assertBackendAudit(request, result, expectedEndJulianDay, fail)
  } else {
    if (evidence.manifestId !== EPHEMERIS_MANIFEST.id || evidence.kernelPool.length > (request.ephemerisFiles?.length ?? 0) || evidence.bodies.length > 2) fail()
    const requestedFiles = new Set(request.ephemerisFiles ?? [])
    const manifest = new Map(EPHEMERIS_MANIFEST.files.map(file => [file.id, file]))
    const seen = new Set<string>()
    for (const [index, file] of evidence.kernelPool.entries()) {
      if (!file || !requestedFiles.has(file.id) || !manifest.has(file.id) || seen.has(file.id) ||
          file.sha256 !== manifest.get(file.id)!.sha256 || result.ephemerisFiles[index] !== file.id) fail()
      seen.add(file.id)
    }
    const bodies = new Map(request.bodies.map(body => [body.id, body]))
    const reported = new Set<string>()
    for (const body of evidence.bodies) {
      if (!body || !bodies.has(body.bodyId) || reported.has(body.bodyId) || ![request.departureBodyId, request.arrivalBodyId].includes(body.bodyId) ||
          body.source !== bodies.get(body.bodyId)?.source || !['jpl-spk', 'approximate-fallback', 'heliocentric-origin'].includes(body.model) ||
          (body.model === 'heliocentric-origin') !== (body.bodyId === 'sun') ||
          (policy === 'require-spk' && body.model === 'approximate-fallback') ||
          (body.model === 'jpl-spk' && evidence.kernelPool.length === 0)) fail()
      reported.add(body.bodyId)
    }
  }

  const failureCodes = new Set(['invalid-input', 'singular-geometry', 'no-solution', 'non-convergence', 'singular-coefficient', 'missing-ephemeris'])
  const reportedBodies = new Set(evidence.bodies.map(body => body?.bodyId))
  for (const [index, point] of result.points.entries()) {
    const row = Math.floor(index / result.columns), column = index % result.columns
    const flight = row === result.rows - 1 ? request.maxFlightDays
      : request.minFlightDays + row / (result.rows - 1) * (request.maxFlightDays - request.minFlightDays)
    const departure = request.departureStartJd + column / (result.columns - 1) * request.departureSpanDays
    if (!point || typeof point.feasible !== 'boolean' || !Number.isFinite(point.departureJulianDay) ||
        !Number.isFinite(point.arrivalJulianDay) || point.departureJulianDay !== departure || point.arrivalJulianDay !== departure + flight) fail()
    if (point.feasible) {
      if (![point.departureVInfinityKmS, point.arrivalVInfinityKmS, point.totalVInfinityKmS].every(value => Number.isFinite(value) && value >= 0) ||
          point.totalVInfinityKmS !== point.departureVInfinityKmS + point.arrivalVInfinityKmS || point.failureCode !== undefined ||
          !reportedBodies.has(request.departureBodyId) || !reportedBodies.has(request.arrivalBodyId)) fail()
    } else if (!failureCodes.has(point.failureCode ?? '') ||
        ![point.departureVInfinityKmS, point.arrivalVInfinityKmS, point.totalVInfinityKmS].every(Number.isNaN)) fail()
  }
}

function assertBackendAudit(
  request: PorkchopWorkerRequest,
  result: NonNullable<PorkchopWorkerResponse['result']>,
  expectedEndJulianDay: number,
  fail: () => never,
): void {
  const audit = result.backendStateAudit!, evidence = result.ephemeris!
  if ((request.ephemerisPolicy ?? 'prefer-spk') !== 'require-spk' || audit.schemaVersion !== 1 || audit.kind !== 'backend-state-window' ||
      typeof audit.catalogVersion !== 'string' || !audit.catalogVersion || !SHA256.test(audit.catalogManifestSha256) ||
      audit.inventoryManifestSha256 !== undefined && !SHA256.test(audit.inventoryManifestSha256) ||
      evidence.manifestId !== `backend:${audit.catalogVersion}:${audit.catalogManifestSha256}`) fail()

  const expectedUtcEpochs = porkchopEndpointEpochs({ departureStartJd: request.departureStartJd,
    departureSpanDays: request.departureSpanDays, minFlightDays: request.minFlightDays,
    maxFlightDays: request.maxFlightDays, columns: result.columns, rows: result.rows })
  const expectedTdbEpochs = expectedUtcEpochs.map(utcJulianDayToTdb)
  const expectedBodyIds = [request.departureBodyId, request.arrivalBodyId, 'sun']
  const bodies = new Map(request.bodies.map(body => [body.id, body]))
  const expectedBackendIds = expectedBodyIds.map(bodyId => {
    const body = bodies.get(bodyId)
    if (!body) return fail()
    return backendBodyId(body)
  })
  if (!Array.isArray(audit.epochsTdbJd) || !Array.isArray(audit.bodyIds) || !Array.isArray(audit.backendIds) ||
      !Array.isArray(audit.uniqueBackendIds) || !Array.isArray(audit.sources) || !Array.isArray(audit.sourceOrdinals) ||
      !Array.isArray(audit.plans) || !Array.isArray(audit.tiles)) fail()
  const expectedUniqueBackendIds = [...new Set(expectedBackendIds)]
  if (!expectedTdbEpochs.length || expectedUtcEpochs[0] !== request.departureStartJd ||
      expectedTdbEpochs[expectedTdbEpochs.length - 1] !== utcJulianDayToTdb(expectedEndJulianDay) ||
      audit.epochsTdbJd.length !== expectedTdbEpochs.length || Array.from(audit.epochsTdbJd).some((epoch, index) => epoch !== expectedTdbEpochs[index]) ||
      audit.epochsTdbJd.length > 1024 || audit.bodyIds.length !== expectedBodyIds.length ||
      Array.from(audit.bodyIds).some((bodyId, index) => bodyId !== expectedBodyIds[index]) ||
      audit.backendIds.length !== expectedBodyIds.length || Array.from(audit.backendIds).some((id, index) => id !== expectedBackendIds[index] || id.length > 512) ||
      audit.uniqueBackendIds.length !== expectedUniqueBackendIds.length ||
      Array.from(audit.uniqueBackendIds).some((id, index) => id !== expectedUniqueBackendIds[index]) ||
      !audit.sources.length || audit.sourceOrdinals.length !== expectedTdbEpochs.length * expectedBodyIds.length ||
      !Array.from(audit.sourceOrdinals).every(ordinal => Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < audit.sources.length) ||
      audit.plans.length !== expectedTdbEpochs.length ||
      Array.from(audit.plans).some((plan, index) => !plan || plan.epochIndex !== index || !SHA256.test(plan.planHash))) fail()

  const sourceIds = new Set<string>()
  for (const source of audit.sources) {
    if (!source || typeof source.id !== 'string' || !source.id || typeof source.source !== 'string' || !source.source ||
        source.model !== 'spk-original' || source.centerId !== 'naif:0' || typeof source.kernelSha256 !== 'string' || !SHA256.test(source.kernelSha256) ||
        typeof source.datasetSha256 !== 'string' || !SHA256.test(source.datasetSha256) ||
        typeof source.sourceChainSha256 !== 'string' || !SHA256.test(source.sourceChainSha256) ||
        typeof source.stateEvidence !== 'string' || !source.stateEvidence) fail()
    sourceIds.add(`${source.source}@${source.kernelSha256}`)
  }
  const expectedKernelPool = [...sourceIds].sort()
  if (evidence.kernelPool.length !== expectedKernelPool.length || Array.from(result.ephemerisFiles).some((id, index) => id !== expectedKernelPool[index]) ||
      Array.from(evidence.kernelPool).some((file, index) => !file || file.id !== expectedKernelPool[index] || file.sha256 !== file.id.slice(file.id.lastIndexOf('@') + 1))) fail()
  for (let epochIndex = 0; epochIndex < expectedTdbEpochs.length; epochIndex++) {
    for (let bodyIndex = 0; bodyIndex < expectedBodyIds.length; bodyIndex++) {
      const source = audit.sources[audit.sourceOrdinals[epochIndex * expectedBodyIds.length + bodyIndex]]
      if (source.id !== audit.backendIds[bodyIndex]) fail()
    }
  }

  let tileIndex = 0
  for (let epochIndex = 0; epochIndex < expectedTdbEpochs.length; epochIndex++) {
    let sequence = 0, ordinalStart = 0
    while (tileIndex < audit.tiles.length && audit.tiles[tileIndex].epochIndex === epochIndex) {
      const tile = audit.tiles[tileIndex++]
      if (!tile || tile.sequence !== sequence++ || tile.ordinalStart !== ordinalStart || !Number.isSafeInteger(tile.recordCount) || tile.recordCount < 1 ||
          !SHA256.test(tile.payloadSha256)) fail()
      ordinalStart += tile.recordCount
    }
    if (!sequence || ordinalStart !== audit.uniqueBackendIds.length) fail()
  }
  if (tileIndex !== audit.tiles.length) fail()

  if (evidence.bodies.length !== expectedBodyIds.length || Array.from(evidence.bodies).some((body, index) =>
      !body || body.bodyId !== expectedBodyIds[index] || body.model !== (body.bodyId === 'sun' ? 'heliocentric-origin' : 'jpl-spk') ||
      body.source !== bodies.get(body.bodyId)?.source)) fail()
}
