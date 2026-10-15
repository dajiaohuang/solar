import { ellipsoidLimb } from './ellipsoidLimb.ts'

type Vector = [number, number, number]
const dot = (a: Vector, b: Vector) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const cross = (a: Vector, b: Vector): Vector => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]

/** Single forward geometric ray against the same frozen oriented shape as the limb.
 * Uses body-fixed semi-axis scaling to intersect the unit sphere. This does
 * not transform a catalog star or solve surface-point light time. */
export function intersectEllipsoidRay(radiiKm: Vector, j2000ToBodyFixed: number[], observerJ2000Km: Vector, directionJ2000: Vector) {
  // Share the original shape, rotation and external-observer conditioning
  // policy. Do not silently accept a different shape than the displayed limb.
  const limb = ellipsoidLimb(radiiKm, j2000ToBodyFixed, observerJ2000Km)
  const directionLength = Math.hypot(...directionJ2000)
  if (directionJ2000.length !== 3 || !directionJ2000.every(Number.isFinite) || !(directionLength > 0) || !Number.isFinite(directionLength)) throw new RangeError('A finite nonzero J2000 ray direction is required')
  const unit = directionJ2000.map(value => value/directionLength) as Vector
  const bodyDirection = [0, 1, 2].map(row => j2000ToBodyFixed[row*3]*unit[0]+j2000ToBodyFixed[row*3+1]*unit[1]+j2000ToBodyFixed[row*3+2]*unit[2]) as Vector
  const q = limb.observerBodyFixedKm.map((value, i) => value/radiiKm[i]) as Vector
  const scaledDirection = bodyDirection.map((value, i) => value/radiiKm[i]) as Vector
  const inverseLengthKm = Math.hypot(...scaledDirection)
  if (!(inverseLengthKm > 0) || !Number.isFinite(inverseLengthKm)) throw new RangeError('Ray scaling exceeds numerical range')
  const w = scaledDirection.map(value => value/inverseLengthKm) as Vector
  const qLength = Math.hypot(...q), closestForward = -dot(q, w)
  // Cross-product distance avoids subtracting two nearly equal squared norms
  // for a far observer aimed close to the body's center.
  const impact = Math.hypot(q[1]*w[2]-q[2]*w[1], q[2]*w[0]-q[0]*w[2], q[0]*w[1]-q[1]*w[0])
  // A contact search needs the signed clearance of the forward half-ray. If
  // the supporting line's nearest point lies behind the observer, the nearest
  // point on the ray is its origin, whose unit-sphere clearance is |q| - 1.
  // At closestForward === 0 this agrees with impact - 1 continuously.
  const clearance = closestForward > 0 ? impact-1 : qLength-1
  const screeningMargin = 128*Number.EPSILON*Math.max(1, qLength)
  let classification: 'miss' | 'intercept' | 'near-limb-indeterminate' = 'miss'
  let distanceKm: number | null = null, pointBodyFixedKm: Vector | null = null, pointJ2000Km: Vector | null = null
  let surfaceResidual: number | null = null
  if (closestForward > 0 && clearance <= screeningMargin) {
    if (Math.abs(clearance) <= screeningMargin) classification = 'near-limb-indeterminate'
    else {
      const halfChord = Math.sqrt((1-impact)*(1+impact))
      // Product-of-roots form avoids loss when the observer is just outside
      // the surface and the near root is much smaller than the far root.
      const scaledDistance = ((qLength-1)*(qLength+1))/(closestForward+halfChord)
      distanceKm = scaledDistance/inverseLengthKm
      // Build the closest-approach offset from the perpendicular ray component
      // instead of adding two O(qLength) vectors to recover an O(1) surface
      // point. This keeps far-observer point reconstruction from losing the
      // small limb coordinates to cancellation.
      const perpendicular = cross(w, cross(q, w))
      const pointScaled = perpendicular.map((value, i) => value-w[i]*halfChord) as Vector
      pointBodyFixedKm = pointScaled.map((value, i) => value*radiiKm[i]) as Vector
      pointJ2000Km = [0, 1, 2].map(column => j2000ToBodyFixed[column]*pointBodyFixedKm![0]+j2000ToBodyFixed[3+column]*pointBodyFixedKm![1]+j2000ToBodyFixed[6+column]*pointBodyFixedKm![2]) as Vector
      surfaceResidual = Math.hypot(...pointBodyFixedKm.map((value, i) => value/radiiKm[i]))-1
      if (!(distanceKm > 0) || ![distanceKm, ...pointBodyFixedKm, ...pointJ2000Km, surfaceResidual].every(Number.isFinite)) throw new RangeError('Ray intercept exceeds finite numerical range')
      classification = 'intercept'
    }
  }
  return {
    model: 'frozen-oriented-ellipsoid-geometric-ray' as const, classification,
    directionUnitJ2000: unit, firstInterceptDistanceKm: distanceKm, pointBodyFixedKm, pointJ2000Km,
    signedRayClearanceScaled: clearance, observerScaledDistance: qLength, numericalScreeningMarginScaled: screeningMargin,
    surfaceResidualScaled: surfaceResidual, physicalUncertaintyKm: null,
    limitations: [
      'An infinite forward half-ray, not a finite-distance background target, stellar disk or probability.',
      'Uses the supplied frozen shape/orientation. No differential surface light time, stellar aberration, deflection, terrain, atmosphere or rings.',
      'The 128-epsilon scaled-distance screening margin is a numerical policy, not a certified error bound or physical uncertainty. Near-limb cases are indeterminate.',
      'Single-epoch geometry only; no ingress/egress timing or event completeness.',
    ],
  }
}
