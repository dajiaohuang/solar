export type CatalogRotation = { azimuthDegrees: number; tiltDegrees: number }

/** Orthographic display basis only; source heliocentric ecliptic states stay unchanged. */
export function catalogProjection(rotation: CatalogRotation) {
  const { azimuthDegrees: yaw, tiltDegrees: tilt } = rotation
  if (!Number.isFinite(yaw) || Math.abs(yaw) > 180 || !Number.isFinite(tilt) || Math.abs(tilt) > 90) throw new RangeError('Invalid catalog display rotation')
  const cy = Math.cos(yaw*Math.PI/180), sy = Math.sin(yaw*Math.PI/180)
  const cp = Math.cos(tilt*Math.PI/180), sp = Math.sin(tilt*Math.PI/180)
  return [[cy,-sy,0],[cp*sy,cp*cy,-sp]] as const
}
