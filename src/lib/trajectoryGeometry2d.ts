import { GRID_LEVELS, projectPoint, type Projection } from './viewProjection'
import type { CurrentPositions } from './currentPositions'
import type { CelestialBody, AsteroidRecord, TrajectorySample, Vector2 } from '../types'

export type OrbitEllipse = {
  body: CelestialBody
  points: Vector2[]
}

export type Geometry = {
  linePositions: Float32Array
  lineColors: Float32Array
  pointPositions: Float32Array
  pointColors: Float32Array
  pointSizes: Float32Array
}

const RING_SEGMENTS = 72

const NEO_CLASSES = new Set(['APO', 'ATE', 'AMO', 'ATI'])

function isNeo(body: CelestialBody) {
  return body.orbitClassCode !== undefined && NEO_CLASSES.has(body.orbitClassCode)
}

function isComet(body: CelestialBody) {
  if (!body.orbit) {
    return false
  }

  const e = body.orbit.model === 'planetaryApprox'
    ? body.orbit.base.eccentricity
    : body.orbit.eccentricity

  return e > 0.9
}

function neoDistanceColor(distanceAU: number, alpha: number) {
  const logDistance = Math.log(Math.max(distanceAU, 0.001))
  const t = Math.max(0, Math.min(1, (logDistance - Math.log(0.01)) / (Math.log(1.0) - Math.log(0.01))))

  const red = 1.0 - t
  const green = t < 0.5 ? t * 2 : 2 - t * 2
  const blue = t

  return [red, green, blue, alpha]
}

function getMagnitudeScaledSize(body: CelestialBody) {
  if (body.absoluteMagnitude === undefined) {
    return body.size
  }

  const factor = 1 + (15 - body.absoluteMagnitude) * 0.12
  return body.size * Math.max(0.6, Math.min(3, factor))
}

function hexToRgba(hexColor: string, alpha: number) {
  const normalized = hexColor.replace('#', '')
  const value = normalized.length === 3
    ? normalized
        .split('')
        .map((part) => part + part)
        .join('')
    : normalized

  const red = Number.parseInt(value.slice(0, 2), 16) / 255
  const green = Number.parseInt(value.slice(2, 4), 16) / 255
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255

  return [red, green, blue, alpha]
}

function toClipSpace(point: { x: number; y: number }, projection: Projection) {
  return {
    x: (point.x / projection.width) * 2 - 1,
    y: 1 - (point.y / projection.height) * 2,
  }
}

export function buildGeometry(
  projection: Projection,
  referenceBody: CelestialBody,
  trajectories: TrajectorySample[],
  currentPositions: CurrentPositions,
  showEcliptic: boolean,
  showOrbits: boolean,
  orbitEllipses: OrbitEllipse[],
  planetOpacity: number,
  asteroidOpacity: number,
  moonOpacity: number,
  catalogRecords: AsteroidRecord[],
  catalogPositions: Float32Array,
  catalogDrawCount: number,
  catalogOrigin: Vector2,
): Geometry {
  const haloSegments = 48
  const lineCount = haloSegments + (showEcliptic ? GRID_LEVELS.length * RING_SEGMENTS + 2 : 0) +
    trajectories.reduce((count, trail) => count + Math.max(0, trail.coordinates.length / 3 - 1), 0) +
    (showOrbits ? orbitEllipses.reduce((count, ellipse) => count + Math.max(0, ellipse.points.length - 1), 0) : 0)
  const linePositions = new Float32Array(lineCount * 4)
  const lineColors = new Float32Array(lineCount * 8)
  let lineCursor = 0
  const writeLine = (x1: number, y1: number, x2: number, y2: number, rgba: number[]) => {
    const offset = lineCursor * 4
    linePositions[offset] = x1; linePositions[offset + 1] = y1
    linePositions[offset + 2] = x2; linePositions[offset + 3] = y2
    lineColors.set(rgba, lineCursor * 8); lineColors.set(rgba, lineCursor * 8 + 4)
    lineCursor++
  }
  const pushLineSegment = (start: Vector2, end: Vector2, rgba: number[]) => {
    writeLine(start.x, start.y, end.x, end.y, rgba)
  }
  const cloudCount = Math.min(catalogDrawCount, catalogRecords.length, Math.floor(catalogPositions.length / 2))
  const pointCount = cloudCount + 1 + currentPositions.length
  const pointPositions = new Float32Array(pointCount * 2)
  const pointColors = new Float32Array(pointCount * 4)
  const pointSizes = new Float32Array(pointCount)
  let pointCursor = 0
  const writePoint = (x: number, y: number, color: number[], size: number) => {
    pointPositions[pointCursor * 2] = ((projection.centerX + (x - projection.offsetXAU) * projection.scale) / projection.width) * 2 - 1
    pointPositions[pointCursor * 2 + 1] = 1 - ((projection.centerY - (y - projection.offsetYAU) * projection.scale) / projection.height) * 2
    pointColors.set(color, pointCursor * 4)
    pointSizes[pointCursor++] = size
  }
  const gridColor = [173 / 255, 201 / 255, 1, 0.18]
  const haloColor = [1, 1, 1, 0.18]
  const projectedReferencePoint = projectPoint({ x: 0, y: 0 }, projection)

  if (showEcliptic) {
    for (const ratio of GRID_LEVELS) {
      for (let index = 0; index < RING_SEGMENTS; index += 1) {
        const startAngle = (index / RING_SEGMENTS) * Math.PI * 2
        const endAngle = ((index + 1) / RING_SEGMENTS) * Math.PI * 2
        const radius = projection.drawableRadius * ratio

        pushLineSegment(
          toClipSpace(
            {
              x: projection.centerX + Math.cos(startAngle) * radius,
              y: projection.centerY + Math.sin(startAngle) * radius,
            },
            projection,
          ),
          toClipSpace(
            {
              x: projection.centerX + Math.cos(endAngle) * radius,
              y: projection.centerY + Math.sin(endAngle) * radius,
            },
            projection,
          ),
          gridColor,
        )
      }
    }
    pushLineSegment(
      toClipSpace({ x: projection.padding, y: projection.centerY }, projection),
      toClipSpace({ x: projection.width - projection.padding, y: projection.centerY }, projection),
      gridColor,
    )
    pushLineSegment(
      toClipSpace({ x: projection.centerX, y: projection.padding }, projection),
      toClipSpace({ x: projection.centerX, y: projection.height - projection.padding }, projection),
      gridColor,
    )
  }

  for (let index = 0; index < haloSegments; index += 1) {
    const startAngle = (index / haloSegments) * Math.PI * 2
    const endAngle = ((index + 1) / haloSegments) * Math.PI * 2
    const radius = 16

    pushLineSegment(
      toClipSpace(
        {
          x: projectedReferencePoint.x + Math.cos(startAngle) * radius,
          y: projectedReferencePoint.y + Math.sin(startAngle) * radius,
        },
        projection,
      ),
      toClipSpace(
        {
          x: projectedReferencePoint.x + Math.cos(endAngle) * radius,
          y: projectedReferencePoint.y + Math.sin(endAngle) * radius,
        },
        projection,
      ),
      haloColor,
    )
  }

  const trailIds = new Set(trajectories.map(item => item.body.id)), distanceByBodyId = new Map<string, number>()
  for (let index = 0; index < currentPositions.length; index++) {
    const id = currentPositions.bodyAt(index).id
    if (trailIds.has(id)) distanceByBodyId.set(id, currentPositions.distanceAt(index))
  }
  const isEarthReference = referenceBody.id === 'earth'

  for (const trajectory of trajectories) {
    const coordinates = trajectory.coordinates
    if (coordinates.length < 6) {
      continue
    }

    const bodyDistance = distanceByBodyId.get(trajectory.body.id) ?? 0
    const useNeoColor = isEarthReference && isNeo(trajectory.body)
    const isCometBody = isComet(trajectory.body)
    const color = isCometBody
      ? hexToRgba('#44dddd', 0.5 * asteroidOpacity)
      : useNeoColor
        ? neoDistanceColor(bodyDistance, 0.6)
        : hexToRgba(
            trajectory.body.color,
            (trajectory.body.kind === 'asteroid' ? 0.3 : trajectory.body.kind === 'moon' ? 0.75 : 0.92) *
              (trajectory.body.kind === 'planet' || trajectory.body.kind === 'dwarfPlanet' ? planetOpacity : trajectory.body.kind === 'moon' ? moonOpacity : asteroidOpacity),
          )

    const clipX = (value: number) => ((projection.centerX + (value - projection.offsetXAU) * projection.scale) / projection.width) * 2 - 1
    const clipY = (value: number) => 1 - ((projection.centerY - (value - projection.offsetYAU) * projection.scale) / projection.height) * 2
    for (let offset = 3; offset < coordinates.length; offset += 3) {
      writeLine(clipX(coordinates[offset - 3]), clipY(coordinates[offset - 2]), clipX(coordinates[offset]), clipY(coordinates[offset + 1]), color)
    }
  }

  if (showOrbits) {
    for (const ellipse of orbitEllipses) {
      if (ellipse.points.length < 2) {
        continue
      }

      const color = hexToRgba(ellipse.body.color, 0.18)

      for (let index = 1; index < ellipse.points.length; index += 1) {
        const previous = toClipSpace(projectPoint(ellipse.points[index - 1], projection), projection)
        const current = toClipSpace(projectPoint(ellipse.points[index], projection), projection)
        pushLineSegment(previous, current, color)
      }
    }
  }

  const referenceColor = hexToRgba(referenceBody.color, 1)
  for (let index = 0; index < cloudCount; index += 1) {
    const record = catalogRecords[index]
    const color = record.isPha ? [1, 0.35, 0.3, 0.82] : record.isNeo ? [1, 0.62, 0.5, 0.76] : [0.62, 0.7, 0.76, 0.52]
    writePoint(catalogPositions[index * 2] - catalogOrigin.x, catalogPositions[index * 2 + 1] - catalogOrigin.y, color, record.isPha ? 2.8 : record.isNeo ? 2.2 : 1.4)
  }

  writePoint(0, 0, referenceColor, 7)

  for (let index = 0; index < currentPositions.length; index++) {
    const body = currentPositions.bodyAt(index)
    const useNeoColor = isEarthReference && isNeo(body)
    const typeOpacity = body.kind === 'planet' || body.kind === 'dwarfPlanet'
      ? planetOpacity
      : body.kind === 'moon'
        ? moonOpacity
        : asteroidOpacity
    const color = useNeoColor
      ? neoDistanceColor(currentPositions.distanceAt(index), 0.92 * typeOpacity)
      : hexToRgba(body.color, (body.kind === 'asteroid' ? 0.92 : 1) * typeOpacity)
    writePoint(currentPositions.coordinateAt(index, 0), currentPositions.coordinateAt(index, 1), color, getMagnitudeScaledSize(body))
  }

  return {
    linePositions,
    lineColors,
    pointPositions,
    pointColors,
    pointSizes,
  }
}
