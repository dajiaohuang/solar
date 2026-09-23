import { createDe440Dynamics, DE440_FORCE_IDS } from '../dynamics/de440Dynamics.ts'
import { receptionLightTime } from '../ephemeris/receptionLightTime.ts'
import { loadPckRadii } from '../../data/loaders/pckRadii.ts'
import { loadPckOrientation } from '../../data/loaders/pckOrientation.ts'
import { ellipsoidLimb } from './ellipsoidLimb.ts'

export type SpkLimbInput = {
  schemaVersion: 1; targetId: number; observerId: number
  referenceEpochTdb: number; elapsedTdbSeconds: number
  frame: 'J2000'; timeScale: 'TDB'; aberration: 'NONE' | 'CN'; maxLightTimeSeconds?: number
}
export function parseSpkLimbInput(inputBytes: ArrayBuffer): SpkLimbInput {
  if (inputBytes.byteLength > 65536) throw new RangeError('Limb input exceeds 64 KiB')
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inputBytes))
  if (input?.schemaVersion !== 1 || input.frame !== 'J2000' || input.timeScale !== 'TDB' || !['NONE', 'CN'].includes(input.aberration) ||
      ![input.targetId, input.observerId].every(id => Number.isSafeInteger(id) && id >= 0) || input.targetId === input.observerId ||
      ![input.referenceEpochTdb, input.elapsedTdbSeconds].every(Number.isFinite) || Math.abs(input.elapsedTdbSeconds) > 365*86400 ||
      input.aberration === 'CN' && (!Number.isFinite(input.maxLightTimeSeconds) || input.maxLightTimeSeconds <= 0 || input.maxLightTimeSeconds > 86400)) {
    throw new RangeError('Expected exact distinct NAIF IDs, J2000/TDB, NONE or CN with explicit light-time margin, and elapsed time within 365 days')
  }
  return input
}

/** A single source-backed limb; CN uses the target center's emission epoch
 * for orientation. It does not solve differential light time along the limb. */
export async function runSpkLimbExperiment(options: {
  inputBytes: ArrayBuffer; spkBytes: ArrayBuffer; pckBytes: ArrayBuffer; gmText: string; signal?: AbortSignal
}) {
  const cancelled = () => { if (options.signal?.aborted) throw new DOMException('Limb calculation cancelled', 'AbortError') }
  cancelled()
  const inputBytes = options.inputBytes.slice(0), input = parseSpkLimbInput(inputBytes)
  const margin = input.aberration === 'CN' ? input.maxLightTimeSeconds! : 0
  // Each loader takes its own snapshot synchronously before its first await.
  const [states, shapes, orientations] = await Promise.all([
    createDe440Dynamics({ spkBytes: options.spkBytes, gmText: options.gmText, referenceEpochTdb: input.referenceEpochTdb,
      elapsedRangeSeconds: [Math.min(0, input.elapsedTdbSeconds-margin), Math.max(0, input.elapsedTdbSeconds)],
      exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) }),
    loadPckRadii(options.pckBytes), loadPckOrientation(options.pckBytes),
  ])
  cancelled()
  const shape = shapes.get(input.targetId)
  if (!shape) throw new RangeError('No source axes for exact target ID; barycenters are not body centers')
  const observer = states.state(input.observerId, input.elapsedTdbSeconds).slice(0, 3)
  let ephemerisStateRequests = 1
  const target = (elapsed: number): [number, number, number] => {
    ephemerisStateRequests++
    const state = states.state(input.targetId, elapsed)
    return [state[0], state[1], state[2]]
  }
  const reception = input.aberration === 'CN' ? receptionLightTime({
    observerPositionKm: [observer[0], observer[1], observer[2]], targetPositionKm: target,
    elapsedTdbSeconds: input.elapsedTdbSeconds, maxLightTimeSeconds: margin,
  }) : null
  const emissionElapsedTdbSeconds = reception?.emissionElapsedTdbSeconds ?? input.elapsedTdbSeconds
  const relative = reception?.positionKm ?? target(input.elapsedTdbSeconds).map((value, i) => value-observer[i])
  const observerJ2000Km = relative.map(value => -value) as [number, number, number]
  const orientationEt = (input.referenceEpochTdb-2451545)*86400 + emissionElapsedTdbSeconds
  const orientation = orientations.evaluate(input.targetId, orientationEt)
  if (!orientation) throw new RangeError('No source orientation for exact target ID')
  const limb = ellipsoidLimb(shape.radiiKm, orientation.j2000ToBodyFixed, observerJ2000Km)
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', inputBytes)), value => value.toString(16).padStart(2, '0')).join('')
  cancelled()
  return { schemaVersion: 1, inputFile: { sha256, bytes: inputBytes.byteLength, payload: input },
    source: shapes.source, kernel: states.evidence.kernel, shape, orientation, observerJ2000Km, limb,
    ephemeris: { frame: 'J2000', origin: 'SSB', timeScale: 'TDB', aberration: input.aberration,
      referenceEpochTdb: input.referenceEpochTdb, receptionElapsedTdbSeconds: input.elapsedTdbSeconds, emissionElapsedTdbSeconds },
    ephemerisStateRequests, reception, physicalLimbUncertaintyKm: null,
    limitations: [...orientations.limitations, ...shapes.limitations,
      'CN uses center reception light time and the center emission orientation; no differential limb light time, stellar aberration or gravitational deflection.',
      'NONE uses one simultaneous geometric epoch. Source body IDs must match exactly; no barycenter-to-body substitution.',
      'No terrain, atmosphere, rings, body-overlap/contact search, ground station or physical uncertainty certificate.'] }
}
