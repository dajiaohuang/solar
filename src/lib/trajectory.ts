import { createBodyPositionResolver } from './ephemeris'
import { getRelativePositions, toPlanarPoint } from './referenceFrame'
import { vector3Magnitude } from './ephemeris'
import type { BodyId, CelestialBody, TrajectoryFrameData, TrajectorySample } from '../types'

const trajectoryCache = new Map<string, TrajectorySample[]>()

export function getRecommendedSampleCount(displayCount: number) {
  if (displayCount >= 400) {
    return 18
  }

  if (displayCount >= 250) {
    return 24
  }

  if (displayCount >= 120) {
    return 36
  }

  if (displayCount >= 80) {
    return 48
  }

  if (displayCount >= 40) {
    return 72
  }

  if (displayCount >= 20) {
    return 96
  }

  if (displayCount >= 10) {
    return 128
  }

  return 180
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
    const points = []

    for (let index = 0; index < sampleCount; index += 1) {
      const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1)
      const julianDay = centerJulianDay - historyDays + progress * historyDays
      const resolve = createBodyPositionResolver(bodiesById, julianDay)
      const [relativePosition] = getRelativePositions([body], referenceId, resolve)

      points.push(toPlanarPoint(relativePosition.position))
    }

    return { body, points }
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
