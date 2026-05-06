import { createBodyPositionResolver } from './ephemeris'
import { getRelativePositions, toPlanarPoint } from './referenceFrame'
import { vector3Magnitude } from './ephemeris'
import type { BodyId, CelestialBody, TrajectoryFrameData, TrajectorySample, Vector2, Vector3 } from '../types'

const trajectoryCache = new Map<string, TrajectorySample[]>()

export function getRecommendedSampleCount(displayCount: number, historyDays: number) {
  let base: number

  if (displayCount >= 400) {
    base = 18
  } else if (displayCount >= 250) {
    base = 24
  } else if (displayCount >= 120) {
    base = 36
  } else if (displayCount >= 80) {
    base = 48
  } else if (displayCount >= 40) {
    base = 72
  } else if (displayCount >= 20) {
    base = 96
  } else if (displayCount >= 10) {
    base = 128
  } else {
    base = 180
  }

  const scaleByDuration = Math.sqrt(Math.max(historyDays, 1) / 365)
  return Math.min(Math.round(base * scaleByDuration), 600)
}

export function buildTrajectories(params: {
  bodies: CelestialBody[]
  bodiesById: Map<BodyId, CelestialBody>
  referenceId: BodyId
  centerJulianDay: number
  historyDays: number
  sampleCount: number
}) {
  const { bodies, bodiesById, referenceId, centerJulianDay, historyDays, sampleCount } = params
  const roundedCenter = Math.round(centerJulianDay * 4) / 4
  const cacheKey = [
    referenceId,
    historyDays,
    sampleCount,
    roundedCenter,
    bodies
      .map((body) => body.id)
      .sort()
      .join(','),
  ].join('|')

  const cached = trajectoryCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const trajectories = bodies.map((body) => {
    const points: Vector2[] = []
    const points3D: Vector3[] = []

    for (let index = 0; index < sampleCount; index += 1) {
      const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1)
      const julianDay = centerJulianDay - historyDays + progress * historyDays
      const resolve = createBodyPositionResolver(bodiesById, julianDay)
      const [relativePosition] = getRelativePositions([body], referenceId, resolve)

      points.push(toPlanarPoint(relativePosition.position))
      points3D.push(relativePosition.position)
    }

    return { body, points, points3D }
  })

  trajectoryCache.set(cacheKey, trajectories)

  if (trajectoryCache.size > 40) {
    const oldestKey = trajectoryCache.keys().next().value
    if (oldestKey) {
      trajectoryCache.delete(oldestKey)
    }
  }

  return trajectories
}

export function buildTrajectoryFrame(params: {
  bodies: CelestialBody[]
  bodiesById: Map<BodyId, CelestialBody>
  referenceId: BodyId
  centerJulianDay: number
  historyDays: number
  sampleCount: number
}): TrajectoryFrameData {
  const { bodies, bodiesById, referenceId, centerJulianDay, historyDays, sampleCount } = params
  const resolve = createBodyPositionResolver(bodiesById, centerJulianDay)
  const relativePositions = getRelativePositions(bodies, referenceId, resolve)
  const currentPositions = relativePositions.map((item) => ({
    body: item.body,
    planarPosition: toPlanarPoint(item.position),
    position3D: item.position,
    distance: vector3Magnitude(item.position),
  }))
  const trajectories = buildTrajectories({
    bodies,
    bodiesById,
    referenceId,
    centerJulianDay,
    historyDays,
    sampleCount,
  })
  const maxDistance = currentPositions.reduce((largest, item) => Math.max(largest, item.distance), 0)

  return {
    currentPositions,
    trajectories,
    maxDistance,
  }
}
