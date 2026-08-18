export type InfluenceRadii = {
  hillRadiusAU: number
  laplaceSoiRadiusAU: number
}
/** Hill and Laplace sphere-of-influence approximations for a body orbiting a primary. */
export function computeInfluenceRadii(
  semiMajorAxisAU: number,
  eccentricity: number,
  bodyMassKg: number,
  primaryMassKg: number,
): InfluenceRadii | null {
  if (
    !Number.isFinite(semiMajorAxisAU) || semiMajorAxisAU <= 0 ||
    !Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1 ||
    !Number.isFinite(bodyMassKg) || bodyMassKg <= 0 ||
    !Number.isFinite(primaryMassKg) || primaryMassKg <= bodyMassKg
  ) {
    return null
  }

  const massRatio = bodyMassKg / primaryMassKg
  return {
    hillRadiusAU: semiMajorAxisAU * (1 - eccentricity) * Math.cbrt(massRatio / 3),
    laplaceSoiRadiusAU: semiMajorAxisAU * massRatio ** (2 / 5),
  }
}
