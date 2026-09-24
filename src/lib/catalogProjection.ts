export type CatalogRotation = { azimuthDegrees: number; tiltDegrees: number }

// Outward display screening for Float32 shader uniforms/arithmetic. This is
// a conservative engineering policy, not a certified GPU precision bound.
export const CATALOG_CLIP_RELATIVE_MARGIN = 64 * 2 ** -23

/** Orthographic display basis only; source heliocentric ecliptic states stay unchanged. */
export function catalogProjection(rotation: CatalogRotation) {
  const { azimuthDegrees: yaw, tiltDegrees: tilt } = rotation
  if (!Number.isFinite(yaw) || Math.abs(yaw) > 180 || !Number.isFinite(tilt) || Math.abs(tilt) > 90) throw new RangeError('Invalid catalog display rotation')
  const cy = Math.cos(yaw*Math.PI/180), sy = Math.sin(yaw*Math.PI/180)
  const cp = Math.cos(tilt*Math.PI/180), sp = Math.sin(tilt*Math.PI/180)
  return [[cy,-sy,0],[cp*sy,cp*cy,-sp]] as const
}
