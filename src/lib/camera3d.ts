export const MIN_3D_ZOOM = 0.15
export const MAX_3D_ZOOM = 12
const CANONICAL_DIRECTION_LENGTH = Math.hypot(0.16, 0.48, 1)

export function clamp3dZoom(zoom: number) {
  return Math.max(MIN_3D_ZOOM, Math.min(MAX_3D_ZOOM, Number.isFinite(zoom) ? zoom : 1))
}

export function cameraDistanceForFit(fitDistance: number, zoom: number) {
  return fitDistance * CANONICAL_DIRECTION_LENGTH / clamp3dZoom(zoom)
}

export function cameraRangeForFit(fitDistance: number, contentRadius: number) {
  const maxDistance = Math.max(220, cameraDistanceForFit(fitDistance, MIN_3D_ZOOM))
  return {
    maxDistance,
    far: Math.max(500, maxDistance + Math.max(contentRadius, 0) * 2),
  }
}
