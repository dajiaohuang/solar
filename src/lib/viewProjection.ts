import type { Vector2 } from '../types'

export const SVG_SIZE = 880
export const SVG_PADDING = 56
export const GRID_LEVELS = [0.25, 0.5, 0.75]

export type Projection = {
  width: number
  height: number
  padding: number
  drawableRadius: number
  scale: number
  centerX: number
  centerY: number
  offsetXAU: number
  offsetYAU: number
}

export function createProjection(
  viewRadiusAU: number,
  width: number,
  height: number,
  padding = SVG_PADDING,
  offset?: Vector2,
): Projection {
  const drawableRadius = Math.max(Math.min(width, height) / 2 - padding, 1)
  const scale = drawableRadius / Math.max(viewRadiusAU, 1e-6)

  return {
    width,
    height,
    padding,
    drawableRadius,
    scale,
    centerX: width / 2,
    centerY: height / 2,
    offsetXAU: offset?.x ?? 0,
    offsetYAU: offset?.y ?? 0,
  }
}

export function projectPoint(point: Vector2, projection: Projection) {
  return {
    x: projection.centerX + (point.x - projection.offsetXAU) * projection.scale,
    y: projection.centerY - (point.y - projection.offsetYAU) * projection.scale,
  }
}

export function unprojectPoint(point: Vector2, projection: Projection) {
  return {
    x: projection.offsetXAU + (point.x - projection.centerX) / projection.scale,
    y: projection.offsetYAU - (point.y - projection.centerY) / projection.scale,
  }
}

export function toSvgPoint(point: Vector2, viewRadiusAU: number) {
  return projectPoint(point, createProjection(viewRadiusAU, SVG_SIZE, SVG_SIZE))
}
