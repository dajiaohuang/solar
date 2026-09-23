export type SphereDirection = { positionKm: readonly [number, number, number]; radiusKm: number }

/** Exact angular-cone overlap for two separated opaque spheres and an external
 * observer. Inputs must already share observer, epoch, frame and correction
 * convention. This does not apply aberration or convert time scales itself. */
export function sphericalOccultation(foreground: SphereDirection, background: SphereDirection) {
  const direction = (body: SphereDirection) => {
    if (body.positionKm.length !== 3 || body.positionKm.some(value => !Number.isFinite(value)) || !Number.isFinite(body.radiusKm) || body.radiusKm <= 0) throw new RangeError('Occultation requires finite position vectors and positive radii in km')
    const distanceKm = Math.hypot(...body.positionKm)
    if (!Number.isFinite(distanceKm) || distanceKm <= body.radiusKm) throw new RangeError('Observer must be strictly outside each sphere')
    const angularRadiusRadians = Math.asin(body.radiusKm/distanceKm)
    if (!(angularRadiusRadians > 0)) throw new RangeError('Angular radius is below the representable numerical range')
    return { distanceKm, unit: body.positionKm.map(value => value/distanceKm), angularRadiusRadians }
  }
  const front = direction(foreground), back = direction(background)
  // This sufficient ordering condition avoids ambiguous depth assignment for
  // intersecting or nearly co-located bodies. No closer-center heuristic.
  if (!(front.distanceKm+foreground.radiusKm < back.distanceKm-background.radiusKm)) throw new RangeError('Sphere depth intervals must be disjoint with the foreground entirely nearer')
  const a = front.unit, b = back.unit
  const cross = Math.hypot(a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
  const separationRadians = Math.atan2(cross, a.reduce((sum, value, i) => sum+value*b[i], 0))
  const externalGapRadians = separationRadians-(front.angularRadiusRadians+back.angularRadiusRadians)
  const internalGapRadians = separationRadians-Math.abs(front.angularRadiusRadians-back.angularRadiusRadians)
  const classification = externalGapRadians >= 0 ? 'none' : internalGapRadians > 0 ? 'partial'
    : front.angularRadiusRadians >= back.angularRadiusRadians ? 'total' : 'annular'
  return {
    classification,
    separationRadians, foregroundAngularRadiusRadians: front.angularRadiusRadians, backgroundAngularRadiusRadians: back.angularRadiusRadians,
    foregroundDistanceKm: front.distanceKm, backgroundDistanceKm: back.distanceKm,
    externalGapRadians, internalGapRadians,
    externalContact: externalGapRadians === 0, internalContact: internalGapRadians === 0,
    model: 'ordered-spherical-limb-angular-cones' as const,
    limitations: ['Sphere approximation only; triaxial orientation, topography, atmospheres and rings are not included.',
      'Input directions require a common observer and declared epoch/frame/light-time convention.',
      'Single-epoch geometry, not contact timing, event completeness, photometric loss or probability.',
      'Zero gap denotes floating-point tangency only; no physical uncertainty or tolerance is inferred.'],
  }
}
