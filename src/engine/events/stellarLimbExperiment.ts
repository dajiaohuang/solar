import { dynamicsSourceBase64 } from '../../lib/dynamicsSourceBytes'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../dynamics/de440Dynamics.ts'
import { receptionLightTime } from '../ephemeris/receptionLightTime.ts'
import { loadPckRadii, PCK_RADII_SOURCE } from '../../data/loaders/pckRadii.ts'
import { loadPckOrientation } from '../../data/loaders/pckOrientation.ts'
import { validateStellarObserver, validateStellarObserverRequest, type StellarObserverRequest } from '../../lib/stellarObserver.ts'
import { ellipsoidLimb } from './ellipsoidLimb.ts'
import { intersectEllipsoidRay } from './ellipsoidRay.ts'

type Vector = [number, number, number]
export type StellarLimbInput = {
  schemaVersion: 1
  targetId: number
  aberration: 'NONE' | 'CN'
  maxLightTimeSeconds?: number
}

export function parseStellarLimbInput(bytes: ArrayBuffer): StellarLimbInput {
  if (!bytes.byteLength || bytes.byteLength > 65536) throw new RangeError('Station limb input must fit 64 KiB')
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['schemaVersion', 'targetId', 'aberration', 'maxLightTimeSeconds'].includes(key)) ||
      input.schemaVersion !== 1 || !Number.isSafeInteger(input.targetId) || input.targetId <= 0 || input.targetId === 399 ||
      !['NONE', 'CN'].includes(input.aberration) ||
      (input.aberration === 'CN' ? !Number.isFinite(input.maxLightTimeSeconds) || input.maxLightTimeSeconds <= 0 || input.maxLightTimeSeconds > 86400 : input.maxLightTimeSeconds !== undefined)) {
    throw new RangeError('Expected exact non-Earth target ID and NONE, or CN with explicit light-time margin; station and epoch come only from the observer receipt')
  }
  return input
}

/** A single frozen-shape stellar ray from a source-validated ground station.
 * This composes coordinate geometry, not the separately reported apparent sky. */
export async function runStellarLimbExperiment(options: {
  inputBytes: ArrayBuffer
  observerResponseBytes: ArrayBuffer
  observerRequest: StellarObserverRequest
  spkBytes: ArrayBuffer
  takeSpkBytesOwnership?: boolean
  pckBytes: ArrayBuffer
  gmText: string
  signal?: AbortSignal
}) {
  const { signal } = options
  const cancelled = () => signal?.throwIfAborted()
  cancelled()
  if (!options.observerResponseBytes.byteLength || options.observerResponseBytes.byteLength > 14*1024*1024) throw new RangeError('Station observer receipt must fit 14 MiB')
  if (options.spkBytes.byteLength !== DE440_DYNAMICS_SOURCE.bytes || options.pckBytes.byteLength !== PCK_RADII_SOURCE.bytes ||
      options.gmText.length > 1024*1024) throw new RangeError('Station limb source inputs exceed pinned source budgets')
  validateStellarObserverRequest(options.observerRequest)
  const input = parseStellarLimbInput(options.inputBytes), inputBytes = options.inputBytes.slice(0)
  // Own mutable inputs before the first await unless the caller explicitly
  // transfers its sole SPK buffer reference; request strings are immutable.
  const request: StellarObserverRequest = { ...options.observerRequest, station: { ...options.observerRequest.station },
    ...(options.observerRequest.atmosphere ? { atmosphere: { ...options.observerRequest.atmosphere } } : {}) }
  const responseBytes = options.observerResponseBytes.slice(0)
  const originalResponseJson = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(responseBytes)
  const spkBytes = options.takeSpkBytesOwnership ? options.spkBytes : options.spkBytes.slice(0)
  const pckBytes = options.pckBytes.slice(0), gmText = options.gmText
  const report = await validateStellarObserver(JSON.parse(originalResponseJson), request, signal)
  cancelled()
  const observation = report.experiment.observation, observer = observation.observerState!
  const epoch = observer.epochJdTdbParts
  // Keep the fraction in relative seconds instead of first rounding it into
  // one large Julian date. The pinned SPK evaluator preserves a split ET pair.
  const wholeDays = Math.floor(epoch[0])+Math.floor(epoch[1])
  const fractions = (epoch[0]-Math.floor(epoch[0]))+(epoch[1]-Math.floor(epoch[1]))
  const referenceEpochTdb = Math.max(wholeDays+Math.floor(fractions), 2451545+DE440_DYNAMICS_SOURCE.startEt/86400)
  const receptionElapsedTdbSeconds = ((wholeDays-referenceEpochTdb)+fractions)*86400
  const margin = input.aberration === 'CN' ? input.maxLightTimeSeconds! : 0
  for (const bodyId of ['naif:399', 'naif:10']) {
    const sources = observation.sources.filter(source => source.bodyId === bodyId)
    if (!sources.length || sources.some(source => source.kernelSha256 !== DE440_DYNAMICS_SOURCE.sha256) ||
        !sources.some(source => source.startJdTdb <= observation.jdTdb && source.endJdTdb >= observation.jdTdb)) {
      throw new RangeError('Station Earth/Sun sources must match the exact pinned limb SPK at reception')
    }
  }
  const [states, shapes, orientations] = await Promise.all([
    createDe440Dynamics({ spkBytes, takeSpkBytesOwnership: true, gmText, referenceEpochTdb,
      elapsedRangeSeconds: [Math.min(0, receptionElapsedTdbSeconds-margin), Math.max(0, receptionElapsedTdbSeconds)],
      exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) }),
    loadPckRadii(pckBytes), loadPckOrientation(pckBytes),
  ])
  cancelled()
  const shape = shapes.get(input.targetId)
  if (!shape) throw new RangeError('No original radii for exact station limb target ID')
  let ephemerisStateRequests = 0
  const target = (elapsed: number, offsetSeconds = 0): Vector => {
    cancelled(); ephemerisStateRequests++
    const state = states.stateAtOffset(input.targetId, elapsed, offsetSeconds)
    return [state[0], state[1], state[2]]
  }
  const localReception = input.aberration === 'CN' ? receptionLightTime({ observerPositionKm: observer.positionKm,
    targetPositionKm: offset => target(receptionElapsedTdbSeconds, offset), elapsedTdbSeconds: 0, maxLightTimeSeconds: margin }) : null
  const reception = localReception ? { ...localReception,
    emissionElapsedTdbSeconds: receptionElapsedTdbSeconds + localReception.emissionElapsedTdbSeconds,
    emissionOffsetFromReceptionSeconds: localReception.emissionElapsedTdbSeconds,
    iterationOriginElapsedTdbSeconds: receptionElapsedTdbSeconds,
    ephemerisTimeRepresentation: 'split-ET-Type-2/3' } : null
  const emissionElapsedTdbSeconds = reception?.emissionElapsedTdbSeconds ?? receptionElapsedTdbSeconds
  const relative = reception?.positionKm ?? target(receptionElapsedTdbSeconds).map((value, index) => value-observer.positionKm[index])
  const observerJ2000Km = relative.map(value => -value) as Vector
  const orientationEt = states.epochParts(receptionElapsedTdbSeconds, localReception?.emissionElapsedTdbSeconds ?? 0)
  const orientation = orientations.evaluate(input.targetId, orientationEt[0], orientationEt[1])
  if (!orientation) throw new RangeError('No original orientation for exact station limb target ID')
  const limb = ellipsoidLimb(shape.radiiKm, orientation.j2000ToBodyFixed, observerJ2000Km)
  const sightline = intersectEllipsoidRay(shape.radiiKm, orientation.j2000ToBodyFixed, observerJ2000Km, report.experiment.coordinateDirectionBcrs)
  const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
  const [inputHash, responseHash] = await Promise.all([digest(inputBytes), digest(responseBytes)])
  cancelled()
  return {
    schemaVersion: 1, model: 'source-gaia-ground-station-frozen-ellipsoid-ray-v1',
    inputFile: { sha256: inputHash, bytes: inputBytes.byteLength, originalBase64: dynamicsSourceBase64(inputBytes), payload: input },
    observerReceipt: { sha256: responseHash, bytes: responseBytes.byteLength, originalResponseJson },
    sourceId: request.sourceId, utc: request.utc, station: request.station,
    coordinateRay: {
      model: 'station-coordinate-bcrs-ray-in-icrs-aligned-j2000' as const,
      sourceField: 'experiment.coordinateDirectionBcrs' as const,
      directionBcrs: [...report.experiment.coordinateDirectionBcrs] as Vector,
      observerPositionBarycentricKm: [...observer.positionKm] as Vector,
      receptionEpochJdTdbParts: [...epoch] as [number, number],
      observerParallax: 'already-applied-by-Pmpx' as const,
      frameConvention: 'SPK-J2000-treated-as-ICRS-aligned' as const,
    },
    stationSkyContext: {
      model: report.experiment.observed.model,
      apparentAirless: { ...report.experiment.observed.apparentAirless },
      solarElongationDeg: report.experiment.observed.solarElongationDeg,
      visibility: 'not-evaluated' as const,
      use: 'context-only-not-the-intersection-ray' as const,
    },
    source: shapes.source, kernel: states.evidence.kernel, shape, orientation, observerJ2000Km, limb, sightline,
    ephemeris: { frame: 'J2000', origin: 'SSB', timeScale: 'TDB', elapsedRangeSeconds: [...states.evidence.elapsedRangeSeconds], observerKind: 'earth-ground-station',
      epochJdTdbParts: [...epoch], referenceEpochTdb, receptionElapsedTdbSeconds, emissionElapsedTdbSeconds, aberration: input.aberration },
    ephemerisStateRequests, reception, physicalLimbUncertaintyKm: null,
    timeRepresentationBoundary: 'SPK translation and text-PCK orientation share split ET; Float64 polynomial and source-model errors remain. Local light-time residual is not end-to-end epoch accuracy.',
    limitations: [...report.experiment.limitations, ...shapes.limitations, ...orientations.limitations,
      'Uses coordinate BCRS stellar direction with SPK J2000 treated as ICRS-aligned; not CIRS, aberrated or refracted sky coordinates.',
      'CN freezes the target shape at center emission; NONE uses reception geometry. No differential surface light time or gravitational ray bending.',
      'Original observer receipt is consistency-checked, not independently recomputed or cryptographically authenticated.',
      'Point-star single-epoch intercept only. No stellar disk, terrain, rings, local visibility, contact timing, probability or event completeness.',
      'Source matching and numerical screening do not certify physical accuracy.'],
  }
}
