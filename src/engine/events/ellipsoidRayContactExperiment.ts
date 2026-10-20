import { dynamicsSourceBase64 } from '../../lib/dynamicsSourceBytes'
import { loadPckOrientation } from '../../data/loaders/pckOrientation.ts'
import { loadPckRadii, PCK_RADII_SOURCE } from '../../data/loaders/pckRadii.ts'
import { createDe440Dynamics, DE440_DYNAMICS_SOURCE, DE440_FORCE_IDS } from '../dynamics/de440Dynamics.ts'
import { receptionLightTime } from '../ephemeris/receptionLightTime.ts'
import { intersectEllipsoidRay } from './ellipsoidRay.ts'
import { findSignedGapContacts } from './signedGapContacts.ts'
import { parseEllipsoidRayContactInput } from '../../lib/ellipsoidRayContactInput'

export { parseEllipsoidRayContactInput, type EllipsoidRayContactInput } from '../../lib/ellipsoidRayContactInput'

type Vector = [number, number, number]
const SPHERE_ROTATION = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** Bounded point-source contact search against one exact-ID oriented PCK
 * ellipsoid. SPK center states are geometric NONE or center-only reception CN;
 * the supplied inertial ray is held fixed over the search interval. */
export async function runEllipsoidRayContactExperiment(options: {
  inputBytes: ArrayBuffer
  spkBytes: ArrayBuffer
  takeSpkBytesOwnership?: boolean
  pckBytes: ArrayBuffer
  gmText: string
  signal?: AbortSignal
}) {
  const { signal } = options
  const cancelled = () => signal?.throwIfAborted()
  cancelled()
  const bytes = options.inputBytes.slice(0), input = parseEllipsoidRayContactInput(bytes)
  const marginSeconds = input.aberration === 'CN' ? input.maxLightTimeSeconds ?? 36000 : 0
  if (options.spkBytes.byteLength !== DE440_DYNAMICS_SOURCE.bytes || options.pckBytes.byteLength !== PCK_RADII_SOURCE.bytes || options.gmText.length > 1024*1024) {
    throw new RangeError('Ellipsoid-ray source inputs exceed the pinned source budgets')
  }
  const [shapes, orientations, states] = await Promise.all([
    loadPckRadii(options.pckBytes), loadPckOrientation(options.pckBytes),
    createDe440Dynamics({ spkBytes: options.spkBytes,
      ...(options.takeSpkBytesOwnership === undefined ? {} : { takeSpkBytesOwnership: options.takeSpkBytesOwnership }),
      gmText: options.gmText, referenceEpochTdb: input.referenceEpochTdb,
      elapsedRangeSeconds: [Math.min(0, input.startSeconds-marginSeconds), Math.max(0, input.endSeconds)],
      exclusionKm: Object.fromEntries(DE440_FORCE_IDS.map(id => [id, 0])) }),
  ])
  cancelled()
  const shape = shapes.get(input.targetId)
  if (!shape) throw new RangeError('No original PCK radii for the exact ellipsoid target ID')
  let ephemerisStateRequests = 0, maximumIterations = 0, maximumResidualSeconds = 0, maximumLightTimeSeconds = 0
  let minimumObserverScaledDistance = Infinity, maximumObserverScaledDistance = 0, maximumNumericalScreeningMarginScaled = 0
  const position = (id: number, elapsed: number, offsetSeconds = 0): Vector => {
    cancelled(); ephemerisStateRequests++
    const state = states.stateAtOffset(id, elapsed, offsetSeconds)
    return [state[0], state[1], state[2]]
  }
  const result = await findSignedGapContacts({
    startSeconds: input.startSeconds, endSeconds: input.endSeconds, maxStepSeconds: input.maxStepSeconds,
    toleranceSeconds: input.toleranceSeconds, signal,
    evaluateGap(elapsed) {
      const observer = position(input.observerId, elapsed)
      let observerToTarget: Vector, emissionOffsetSeconds = 0
      if (input.aberration === 'CN') {
        const corrected = receptionLightTime({ observerPositionKm: observer,
          targetPositionKm: offset => position(input.targetId, elapsed, offset), elapsedTdbSeconds: 0, maxLightTimeSeconds: marginSeconds })
        maximumIterations = Math.max(maximumIterations, corrected.iterations)
        maximumResidualSeconds = Math.max(maximumResidualSeconds, corrected.residualSeconds)
        maximumLightTimeSeconds = Math.max(maximumLightTimeSeconds, corrected.lightTimeSeconds)
        observerToTarget = corrected.positionKm
        emissionOffsetSeconds = corrected.emissionElapsedTdbSeconds
      } else {
        const target = position(input.targetId, elapsed)
        observerToTarget = [target[0]-observer[0], target[1]-observer[1], target[2]-observer[2]]
      }
      const observerFromTarget = observerToTarget.map(value => -value) as Vector
      const orientationEt = states.epochParts(elapsed, emissionOffsetSeconds)
      const orientation = shape.representation === 'sphere' ? null : orientations.evaluate(input.targetId, orientationEt[0], orientationEt[1])
      if (shape.representation !== 'sphere' && !orientation) throw new RangeError('No original text-PCK orientation for the exact triaxial ellipsoid target ID')
      const rotation = orientation?.j2000ToBodyFixed ?? SPHERE_ROTATION
      // The ray helper applies the same observer conditioning and shape/frame
      // contract as the separately displayed finite-distance limb.
      const ray = intersectEllipsoidRay(shape.radiiKm, rotation, observerFromTarget, input.directionJ2000)
      minimumObserverScaledDistance = Math.min(minimumObserverScaledDistance, ray.observerScaledDistance)
      maximumObserverScaledDistance = Math.max(maximumObserverScaledDistance, ray.observerScaledDistance)
      maximumNumericalScreeningMarginScaled = Math.max(maximumNumericalScreeningMarginScaled, ray.numericalScreeningMarginScaled)
      return { value: ray.signedRayClearanceScaled, indeterminateMargin: ray.numericalScreeningMarginScaled }
    },
  })
  const inputHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
  cancelled()
  return {
    schemaVersion: 1,
    calculation: input.aberration === 'CN' ? 'reception-oriented-ellipsoid-point-ray-contacts' : 'geometric-oriented-ellipsoid-point-ray-contacts',
    inputFile: { sha256: inputHash, bytes: bytes.byteLength, originalBase64: dynamicsSourceBase64(bytes), payload: input },
    ephemeris: { frame: 'J2000', origin: 'SSB', timeScale: 'TDB', elapsedRangeSeconds: [...states.evidence.elapsedRangeSeconds],
      aberration: input.aberration, referenceEpochTdb: input.referenceEpochTdb, kernel: states.evidence.kernel,
      emissionEpochPolicy: 'target-center-reception-light-time; shape orientation at center emission epoch' },
    ephemerisStateRequests,
    source: shapes.source,
    shape,
    orientationModel: shape.representation === 'sphere' ? 'rotation-invariant-sphere' : 'pck00011-text-IAU',
    observerScaledDistanceRange: [minimumObserverScaledDistance, maximumObserverScaledDistance],
    numericalScreening: { policy: '128*Number.EPSILON*max(1, observerScaledDistance)', maximumMarginScaled: maximumNumericalScreeningMarginScaled,
      limitation: 'Numerical indeterminate classification margin only; not a certified floating-point or physical error bound.' },
    directionUnitJ2000: (() => { const length = Math.hypot(...input.directionJ2000); return input.directionJ2000.map(value => value/length) as Vector })(),
    gapModel: 'scaled-forward-ray-ellipsoid-clearance-v1',
    gapUnits: 'dimensionless-scaled-unit-sphere-clearance',
    ...result,
    reception: input.aberration === 'CN' ? { model: 'converged-newtonian-reception', sourceMarginSeconds: marginSeconds,
      iterationToleranceSeconds: 1e-9, iterationTimeOrigin: 'each-reception-epoch', ephemerisTimeRepresentation: 'split-ET-Type-2/3',
      maxIterations: 12, observedMaximumIterations: maximumIterations, observedMaximumResidualSeconds: maximumResidualSeconds,
      observedMaximumLightTimeSeconds: maximumLightTimeSeconds } : null,
    physicalTimingUncertaintySeconds: null,
    limitations: [...shapes.limitations, ...(shape.representation === 'sphere' ? [] : orientations.limitations), ...result.limitations,
      'Fixed J2000-aligned inertial direction supplied by the user; it is not a catalog star solution, finite-distance source, or time-propagated astrometry.',
      'The direction is used as a geometric ray; stellar aberration, gravitational deflection, parallax updates and source motion are not included.',
      'CN corrects target-center reception light time and evaluates PCK orientation at center emission; differential surface light time is omitted.',
      'Shared limb conditioning requires the observer to remain outside the ellipsoid, axis ratio at least 1e-12 and scaled observer distance in (1 + 1e-10, 1e12].',
      'The signed gap is the forward half-ray clearance in scaled unit-sphere coordinates: impact parameter minus one when the closest point is forward, otherwise observer scaled distance minus one. It is not radians or kilometers. Near-limb screening is numerical only.',
      ...(shape.representation === 'sphere' ? ['Equal-axis PCK spheres are rotation-invariant; no orientation substitution is needed.'] :
        ['Text-PCK IAU orientation applies; physical orientation and event timing uncertainty remain unknown.']),
      'Pinned SPK source limits apply; physical timing uncertainty remains unknown.'],
  }
}
