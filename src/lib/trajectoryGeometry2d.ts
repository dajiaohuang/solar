import { GRID_LEVELS, projectPoint, type Projection } from './viewProjection'
import type { CurrentPositions } from './currentPositions'
import type { ScreenPointIndex } from './screenPointIndex'
import type { CelestialBody, AsteroidRecord, TrajectorySample, Vector2 } from '../types'

export type OrbitEllipse = {
  body: CelestialBody
  points: Vector2[]
}

export type Geometry = {
  linePositions: Float32Array
  lineColors: Float32Array
  pointPositions: Float32Array
  pointColors: Uint8Array
  pointSizes: Float32Array
}

export type GeometryBufferPool = {
  linePositions: Float32Array
  lineColors: Float32Array
  pointPositions: Float32Array
  pointColors: Uint8Array
  pointSizes: Float32Array
}

export function createGeometryBufferPool(): GeometryBufferPool {
  return {
    linePositions: new Float32Array(),
    lineColors: new Float32Array(),
    pointPositions: new Float32Array(),
    pointColors: new Uint8Array(),
    pointSizes: new Float32Array(),
  }
}

function acquireGeometryBuffer<K extends keyof GeometryBufferPool>(
  pool: GeometryBufferPool | undefined,
  key: K,
  requiredLength: number,
  create: (length: number) => GeometryBufferPool[K],
): GeometryBufferPool[K] {
  if (!pool) return create(requiredLength)
  const previous = pool[key]
  const shouldShrink = previous.length > 256 && requiredLength < previous.length / 4
  if (previous.length >= requiredLength && !shouldShrink) return previous
  const capacity = requiredLength
    ? Math.max(256, requiredLength, shouldShrink ? 0 : Math.ceil(previous.length * 1.5))
    : 0
  const next = previous.length === capacity ? previous : create(capacity)
  pool[key] = next
  return next
}

const createFloatBuffer = (length: number) => new Float32Array(length)
const createByteBuffer = (length: number) => new Uint8Array(length)

const RING_SEGMENTS = 72

const NEO_CLASSES = new Set(['APO', 'ATE', 'AMO', 'ATI'])
const CATALOG_PHA_COLOR = [1, 0.35, 0.3, 0.82] as const
const CATALOG_NEO_COLOR = [1, 0.62, 0.5, 0.76] as const
const CATALOG_OTHER_COLOR = [0.62, 0.7, 0.76, 0.52] as const
const rgbaColorCache = new Map<string, Map<number, number[]>>()

function isNeo(body: CelestialBody) {
  return body.orbitClassCode !== undefined && NEO_CLASSES.has(body.orbitClassCode)
}

function isComet(body: CelestialBody) {
  if (body.kind === 'comet') {
    return true
  }
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
  let byAlpha = rgbaColorCache.get(hexColor)
  const cached = byAlpha?.get(alpha)
  if (cached) return cached

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

  const rgba = [red, green, blue, alpha]
  if (!byAlpha) {
    if (rgbaColorCache.size >= 256) {
      const oldest = rgbaColorCache.keys().next().value
      if (oldest !== undefined) rgbaColorCache.delete(oldest)
    }
    byAlpha = new Map()
    rgbaColorCache.set(hexColor, byAlpha)
  } else if (byAlpha.size >= 16) {
    const oldestAlpha = byAlpha.keys().next().value
    if (oldestAlpha !== undefined) byAlpha.delete(oldestAlpha)
  }
  byAlpha.set(alpha, rgba)
  return rgba
}

function toClipSpace(point: { x: number; y: number }, projection: Projection) {
  return {
    x: (point.x / projection.width) * 2 - 1,
    y: 1 - (point.y / projection.height) * 2,
  }
}

/** Reuse cached positions/picking when frame and projection inputs match; cached
 * sizes also require unchanged point ordering. Full streams require all point
 * and picking inputs to match. Cached views must cover the complete live prefix. */
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
  catalogPositions: Float64Array,
  catalogDrawCount: number,
  catalogOrigin: Vector2,
  bufferPool?: GeometryBufferPool,
  screenPointIndex?: ScreenPointIndex,
  cachedPoints?: Pick<Geometry, 'pointPositions' | 'pointColors' | 'pointSizes'>,
  cachedPointPositions?: Float32Array,
  cachedPointSizes?: Float32Array,
  catalogAppearance?: Uint8Array,
): Geometry {
  const haloSegments = 48
  const lineCount = haloSegments + (showEcliptic ? GRID_LEVELS.length * RING_SEGMENTS + 2 : 0) +
    trajectories.reduce((count, trail) => count + Math.max(0, trail.coordinates.length / 3 - 1), 0) +
    (showOrbits ? orbitEllipses.reduce((count, ellipse) => count + Math.max(0, ellipse.points.length - 1), 0) : 0)
  const linePositionStorage = acquireGeometryBuffer(bufferPool, 'linePositions', lineCount * 4, createFloatBuffer)
  const lineColorStorage = acquireGeometryBuffer(bufferPool, 'lineColors', lineCount * 8, createFloatBuffer)
  const linePositions = linePositionStorage
  const lineColors = lineColorStorage
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
  const cloudCount = Math.min(catalogDrawCount, catalogAppearance ? catalogAppearance.length / 2 : catalogRecords.length, Math.floor(catalogPositions.length / 2))
  const pointCount = cloudCount + 1 + currentPositions.length
  if (cachedPoints && (cachedPoints.pointPositions.length !== pointCount * 2 || cachedPoints.pointColors.length !== pointCount * 4 || cachedPoints.pointSizes.length !== pointCount)) {
    throw new RangeError('Cached point streams do not match the live point count')
  }
  if (cachedPointPositions && cachedPointPositions.length !== pointCount * 2) throw new RangeError('Cached point positions do not match the live point count')
  if (cachedPointSizes && cachedPointSizes.length !== pointCount) throw new RangeError('Cached point sizes do not match the live point count')
  const pointPositionStorage = cachedPoints?.pointPositions ?? cachedPointPositions ?? acquireGeometryBuffer(bufferPool, 'pointPositions', pointCount * 2, createFloatBuffer)
  const pointColorStorage = cachedPoints?.pointColors ?? acquireGeometryBuffer(bufferPool, 'pointColors', pointCount * 4, createByteBuffer)
  const pointSizeStorage = cachedPoints?.pointSizes ?? cachedPointSizes ?? acquireGeometryBuffer(bufferPool, 'pointSizes', pointCount, createFloatBuffer)
  const pointPositions = pointPositionStorage
  const pointColors = pointColorStorage
  const pointSizes = pointSizeStorage
  let pointCursor = 0
  const writePointRgba = (x: number, y: number, red: number, green: number, blue: number, alpha: number, size: number) => {
    if (!cachedPointPositions) {
      pointPositions[pointCursor * 2] = ((projection.centerX + (x - projection.offsetXAU) * projection.scale) / projection.width) * 2 - 1
      pointPositions[pointCursor * 2 + 1] = 1 - ((projection.centerY - (y - projection.offsetYAU) * projection.scale) / projection.height) * 2
    }
    const colorOffset = pointCursor * 4
    pointColors[colorOffset] = Math.round(red * 255)
    pointColors[colorOffset + 1] = Math.round(green * 255)
    pointColors[colorOffset + 2] = Math.round(blue * 255)
    pointColors[colorOffset + 3] = Math.round(alpha * 255)
    if (!cachedPointSizes) pointSizes[pointCursor] = size
    pointCursor++
  }
  const writePoint = (x: number, y: number, color: ArrayLike<number>, size: number) =>
    writePointRgba(x, y, color[0], color[1], color[2], color[3], size)
  const writeNeoDistancePoint = (x: number, y: number, distanceAU: number, alpha: number, size: number) => {
    const logDistance = Math.log(Math.max(distanceAU, 0.001))
    const t = Math.max(0, Math.min(1, (logDistance - Math.log(0.01)) / (Math.log(1.0) - Math.log(0.01))))
    writePointRgba(x, y, 1 - t, t < 0.5 ? t * 2 : 2 - t * 2, t, alpha, size)
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
  for (let index = 0; trailIds.size && index < currentPositions.length; index++) {
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
            (trajectory.body.kind === 'asteroid' || trajectory.body.kind === 'comet' ? 0.3 : trajectory.body.kind === 'moon' ? 0.75 : 0.92) *
              (trajectory.body.kind === 'planet' || trajectory.body.kind === 'dwarfPlanet' ? planetOpacity : trajectory.body.kind === 'moon' ? moonOpacity : asteroidOpacity),
          )

    const clipX = (value: number) => ((projection.centerX + (value - projection.offsetXAU) * projection.scale) / projection.width) * 2 - 1
    const clipY = (value: number) => 1 - ((projection.centerY - (value - projection.offsetYAU) * projection.scale) / projection.height) * 2
    for (let offset = 3; offset < coordinates.length; offset += 3) {
      if (trajectory.breakBefore?.[offset / 3]) continue
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

  if (!cachedPoints) {
    const referenceColor = hexToRgba(referenceBody.color, 1)
    if (cachedPointPositions) pointCursor = cloudCount
    else {
      for (let index = 0; index < cloudCount; index += 1) {
        const record = catalogRecords[index]
        const flags = catalogAppearance?.[index * 2 + 1]
        const pha = flags === undefined ? record.isPha : Boolean(flags & 2), neo = flags === undefined ? record.isNeo : Boolean(flags & 1)
        const color = pha ? CATALOG_PHA_COLOR : neo ? CATALOG_NEO_COLOR : CATALOG_OTHER_COLOR
        writePoint(catalogPositions[index * 2] - catalogOrigin.x, catalogPositions[index * 2 + 1] - catalogOrigin.y, color, pha ? 2.8 : neo ? 2.2 : 1.4)
      }
    }

    writePoint(0, 0, referenceColor, 7)

    if (!cachedPointPositions) screenPointIndex?.clear()
    for (let index = 0; index < currentPositions.length; index++) {
      const body = currentPositions.bodyAt(index)
      const useNeoColor = isEarthReference && isNeo(body)
      const typeOpacity = body.kind === 'planet' || body.kind === 'dwarfPlanet'
        ? planetOpacity
        : body.kind === 'moon'
          ? moonOpacity
          : asteroidOpacity
      const x = cachedPointPositions ? 0 : currentPositions.coordinateAt(index, 0)
      const y = cachedPointPositions ? 0 : currentPositions.coordinateAt(index, 1)
      if (screenPointIndex && !cachedPointPositions) {
        screenPointIndex.add(
          index,
          projection.centerX + (x - projection.offsetXAU) * projection.scale,
          projection.centerY - (y - projection.offsetYAU) * projection.scale,
        )
      }
      const size = cachedPointSizes ? 0 : getMagnitudeScaledSize(body)
      if (useNeoColor) writeNeoDistancePoint(x, y, currentPositions.distanceAt(index), 0.92 * typeOpacity, size)
      else writePoint(x, y, hexToRgba(body.color, (body.kind === 'asteroid' || body.kind === 'comet' ? 0.92 : 1) * typeOpacity), size)
    }
  }

  return {
    linePositions: linePositions.subarray(0, lineCursor * 4),
    lineColors: lineColors.subarray(0, lineCursor * 8),
    pointPositions: cachedPoints?.pointPositions ?? cachedPointPositions ?? pointPositions.subarray(0, pointCursor * 2),
    pointColors: cachedPoints?.pointColors ?? pointColors.subarray(0, pointCursor * 4),
    pointSizes: cachedPoints?.pointSizes ?? cachedPointSizes ?? pointSizes.subarray(0, pointCursor),
  }
}
