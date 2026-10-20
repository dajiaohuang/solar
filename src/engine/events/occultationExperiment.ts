import { dynamicsSourceBase64 } from '../../lib/dynamicsSourceBytes'
import { createDe440Dynamics, DE440_FORCE_IDS } from '../dynamics/de440Dynamics.ts'
import { loadPckRadii } from '../../data/loaders/pckRadii.ts'
import { sphericalOccultation } from './sphericalOccultation.ts'
import { findOccultationContacts, OCCULTATION_MAX_EVALUATIONS, occultationScanIntervalCount } from './occultationContacts.ts'
import { receptionLightTime } from '../ephemeris/receptionLightTime.ts'

export type OccultationInput = {
  schemaVersion: 1; foregroundId: number; backgroundId: number; observerId: number
  referenceEpochTdb: number; startSeconds: number; endSeconds: number
  maxStepSeconds: number; toleranceSeconds: number; maxLightTimeSeconds?: number
  aberration: 'NONE' | 'CN'; frame: 'J2000'; timeScale: 'TDB'
}
export function parseOccultationInput(bytes: ArrayBuffer): OccultationInput {
  if (bytes.byteLength > 65536) throw new RangeError('Contact experiment input exceeds 64 KiB')
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const { foregroundId, backgroundId, observerId, referenceEpochTdb, startSeconds, endSeconds, maxStepSeconds, toleranceSeconds } = input ?? {}
  const margin = input?.maxLightTimeSeconds ?? 36000
  if (input?.schemaVersion !== 1 || !['NONE', 'CN'].includes(input.aberration) || input.frame !== 'J2000' || input.timeScale !== 'TDB' ||
      ![foregroundId, backgroundId, observerId].every(id => Number.isSafeInteger(id) && id >= 0) || new Set([foregroundId, backgroundId, observerId]).size !== 3 ||
      ![referenceEpochTdb, startSeconds, endSeconds, maxStepSeconds, toleranceSeconds].every(Number.isFinite) || endSeconds < startSeconds ||
      endSeconds-startSeconds > 365*86400 || maxStepSeconds <= 0 || toleranceSeconds <= 0 || toleranceSeconds > maxStepSeconds ||
      (input.aberration === 'CN' && (!Number.isFinite(margin) || margin <= 0 || margin > 86400))) throw new RangeError('Expected explicit distinct NAIF IDs, J2000/NONE-or-CN/TDB and a finite bounded contact window within 365 days')
  const intervals = occultationScanIntervalCount(
    endSeconds - startSeconds, maxStepSeconds, startSeconds, endSeconds, OCCULTATION_MAX_EVALUATIONS,
  )
  if (!Number.isSafeInteger(intervals) || intervals + 1 > OCCULTATION_MAX_EVALUATIONS) {
    throw new RangeError(`Occultation scan exceeds the ${OCCULTATION_MAX_EVALUATIONS} geometry-evaluation budget`)
  }
  return input
}

/** Shared browser/offline experiment. Uses original SPK states, not force integration. */
export async function runOccultationExperiment(options: {
  inputBytes: ArrayBuffer; spkBytes: ArrayBuffer; takeSpkBytesOwnership?: boolean; pckBytes: ArrayBuffer; gmText: string; signal?: AbortSignal
}) {
  const { spkBytes, pckBytes, gmText, signal } = options
  const bytes = options.inputBytes.slice(0), input = parseOccultationInput(bytes)
  const { foregroundId, backgroundId, observerId, referenceEpochTdb, startSeconds, endSeconds, maxStepSeconds, toleranceSeconds, aberration } = input
  const marginSeconds = aberration === 'CN' ? (input.maxLightTimeSeconds ?? 36000) : 0
  if (signal?.aborted) throw new DOMException('Contact search cancelled', 'AbortError')
  // Invoke both loaders before yielding: each owns its source bytes before
  // its first await. Waiting for PCK first left the caller-owned SPK mutable.
  const [shapes, states] = await Promise.all([
    loadPckRadii(pckBytes),
    createDe440Dynamics({ spkBytes, ...(options.takeSpkBytesOwnership === undefined ? {} : { takeSpkBytesOwnership: options.takeSpkBytesOwnership }), gmText, referenceEpochTdb,
      elapsedRangeSeconds: [Math.min(0, startSeconds-marginSeconds), Math.max(0, endSeconds)],
      exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) }),
  ])
  signal?.throwIfAborted()
  const front = shapes.get(foregroundId), back = shapes.get(backgroundId)
  if (!front || !back || front.representation !== 'sphere' || back.representation !== 'sphere') throw new RangeError('Both targets require sourced equal-axis spheres; missing or triaxial shapes are not replaced by mean radii')
  let ephemerisStateRequests = 0, maximumIterations = 0, maximumResidualSeconds = 0, maximumLightTimeSeconds = 0
  const position = (id: number, elapsed: number, offsetSeconds = 0): [number, number, number] => {
    ephemerisStateRequests++
    const state = states.stateAtOffset(id, elapsed, offsetSeconds)
    return [state[0], state[1], state[2]]
  }
  const result = await findOccultationContacts({ startSeconds, endSeconds, maxStepSeconds, toleranceSeconds, signal,
    evaluate(elapsed) {
      const observer = position(observerId, elapsed)
      const body = (shape: NonNullable<ReturnType<typeof shapes.get>>) => {
        if (aberration === 'CN') {
          const corrected = receptionLightTime({ observerPositionKm: observer, targetPositionKm: offset => position(shape.naifPckId, elapsed, offset),
            elapsedTdbSeconds: 0, maxLightTimeSeconds: marginSeconds })
          maximumIterations = Math.max(maximumIterations, corrected.iterations)
          maximumResidualSeconds = Math.max(maximumResidualSeconds, corrected.residualSeconds)
          maximumLightTimeSeconds = Math.max(maximumLightTimeSeconds, corrected.lightTimeSeconds)
          return { positionKm: corrected.positionKm, radiusKm: shape.radiiKm[0] }
        }
        const target = position(shape.naifPckId, elapsed)
        return { positionKm: [target[0]-observer[0], target[1]-observer[1], target[2]-observer[2]] as [number, number, number], radiusKm: shape.radiiKm[0] }
      }
      return sphericalOccultation(body(front), body(back))
    } })
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('')
  if (signal?.aborted) throw new DOMException('Contact search cancelled', 'AbortError')
  return { schemaVersion: 2, calculation: aberration === 'CN' ? 'reception-spherical-occultation-contacts' : 'geometric-spherical-occultation-contacts',
    inputFile: { sha256: hash, bytes: bytes.byteLength, originalBase64: dynamicsSourceBase64(bytes), payload: input },
    ephemeris: { frame: 'J2000', origin: 'SSB', timeScale: 'TDB', elapsedRangeSeconds: [...states.evidence.elapsedRangeSeconds], aberration, referenceEpochTdb, kernel: states.evidence.kernel }, ephemerisStateRequests,
    reception: aberration === 'CN' ? { model: 'converged-newtonian-reception', sourceMarginSeconds: marginSeconds,
      iterationToleranceSeconds: 1e-9, iterationTimeOrigin: 'each-reception-epoch', ephemerisTimeRepresentation: 'split-ET-Type-2/3', maxIterations: 12, observedMaximumIterations: maximumIterations,
      observedMaximumResidualSeconds: maximumResidualSeconds, observedMaximumLightTimeSeconds: maximumLightTimeSeconds,
      limitation: 'Center reception light time only; no stellar aberration, gravitational deflection or differential light time across limbs. Iteration residual is not physical timing uncertainty.' } : null,
    shapes: { source: shapes.source, foreground: front, background: back, limitations: shapes.limitations }, ...result, physicalTimingUncertaintySeconds: null }
}
