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
  const scale = Math.min(1, fitDistance / 2.8)
  const maxDistance = Math.max(220 * scale, cameraDistanceForFit(fitDistance, MIN_3D_ZOOM))
  return {
    near: 0.005 * scale,
    minDistance: 0.08 * scale,
    maxDistance,
    far: Math.max(500 * scale, maxDistance + Math.max(contentRadius, 0) * 2),
  }
}

/** AU coordinates stay physical; only the camera and illustrative markers scale. */
export function sceneFramingForRadius(contentRadius: number, aspect: number, nearestRadius = contentRadius) {
  const radius = Number.isFinite(contentRadius) && contentRadius > 0 ? contentRadius : 0
  if (radius > 0 && radius < 0.1) {
    const halfVertical = 21 * Math.PI / 180
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1))
    const distance = radius * 1.2 / Math.sin(Math.min(halfVertical, halfHorizontal))
    const nearest = Number.isFinite(nearestRadius) && nearestRadius > 0 ? nearestRadius : radius
    return {
      fitDistance: distance / CANONICAL_DIRECTION_LENGTH,
      bodyScale: Math.min(radius / 0.5, nearest / 0.3),
      auxiliaryScale: radius / 4,
    }
  }
  return {
    fitDistance: Math.max(2.8, Math.min(260, radius * 1.45 + 1.4)),
    bodyScale: Math.max(1, Math.min(4.5, Math.sqrt(Math.max(radius, 1) / 7))),
    auxiliaryScale: 1,
  }
}
