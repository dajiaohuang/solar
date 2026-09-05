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

function pushVertex(
  positions: number[],
  colors: number[],
  x: number,
  y: number,
  rgba: number[],
) {
  positions.push(x, y)
  colors.push(rgba[0], rgba[1], rgba[2], rgba[3])
}

function pushLineSegment(
  positions: number[],
  colors: number[],
  start: { x: number; y: number },
  end: { x: number; y: number },
  rgba: number[],
) {
  pushVertex(positions, colors, start.x, start.y, rgba)
  pushVertex(positions, colors, end.x, end.y, rgba)
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
  const linePositions: number[] = []
  const lineColors: number[] = []
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
          linePositions,
          lineColors,
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
      linePositions,
      lineColors,
      toClipSpace({ x: projection.padding, y: projection.centerY }, projection),
      toClipSpace({ x: projection.width - projection.padding, y: projection.centerY }, projection),
      gridColor,
    )
    pushLineSegment(
      linePositions,
      lineColors,
      toClipSpace({ x: projection.centerX, y: projection.padding }, projection),
      toClipSpace({ x: projection.centerX, y: projection.height - projection.padding }, projection),
      gridColor,
    )
  }

  const haloSegments = 48
  for (let index = 0; index < haloSegments; index += 1) {
    const startAngle = (index / haloSegments) * Math.PI * 2
    const endAngle = ((index + 1) / haloSegments) * Math.PI * 2
    const radius = 16

    pushLineSegment(
      linePositions,
      lineColors,
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
    if (trajectory.points.length < 2) {
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

    for (let index = 1; index < trajectory.points.length; index += 1) {
      const previous = toClipSpace(projectPoint(trajectory.points[index - 1], projection), projection)
      const current = toClipSpace(projectPoint(trajectory.points[index], projection), projection)
      pushLineSegment(linePositions, lineColors, previous, current, color)
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
        pushLineSegment(linePositions, lineColors, previous, current, color)
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
    linePositions: new Float32Array(linePositions),
    lineColors: new Float32Array(lineColors),
    pointPositions,
    pointColors,
    pointSizes,
  }
}
