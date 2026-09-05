import { createBodyPositionResolver } from './ephemeris'
import { kernelsForWindow, loadedKernelIds } from '../engine/ephemeris/kernelStore'
import { getRelativePositions } from './referenceFrame'
import { packedCurrentPositions } from './currentPositions'
import { createTrajectoryAccumulator, trajectoryViews } from './trajectorySamples'
import type { BodyId, CelestialBody, TrajectoryFrameData, TrajectorySample, Vector3 } from '../types'

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
    loadedKernelIds().join(','),
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

  const accumulator = createTrajectoryAccumulator(bodies, sampleCount)

  // One resolver per sample shares the same parent-body and reference-frame cache
  // across every focused body at that instant.
  const kernels = kernelsForWindow(centerJulianDay - historyDays, centerJulianDay)
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1)
    const julianDay = centerJulianDay - historyDays + progress * historyDays
    const resolve = createBodyPositionResolver(bodiesById, julianDay, kernels)
    const positions = getRelativePositions(bodies, referenceId, resolve)
    accumulator.append(positions)
  }

  const trajectories = trajectoryViews(accumulator.finish(), bodiesById)
  trajectoryCache.set(cacheKey, trajectories)

  if (trajectoryCache.size > 40) {
    const oldestKey = trajectoryCache.keys().next().value
    if (oldestKey) {
      trajectoryCache.delete(oldestKey)
    }
  }

  return trajectories
}

export function buildCurrentPositions(params: {
  bodies: CelestialBody[]
  bodiesById: Map<BodyId, CelestialBody>
  referenceId: BodyId
  julianDay: number
  resolveBodyPosition?: (id: BodyId) => Vector3
}) {
  const resolve = params.resolveBodyPosition ?? createBodyPositionResolver(params.bodiesById, params.julianDay)
  const relativePositions = getRelativePositions(params.bodies, params.referenceId, resolve)
  const coordinates = new Float64Array(relativePositions.length * 3)
  const positionedBodies: CelestialBody[] = []
  for (let index = 0; index < relativePositions.length; index++) {
    const { body, position } = relativePositions[index]
    positionedBodies.push(body)
    coordinates[index * 3] = position.x; coordinates[index * 3 + 1] = position.y; coordinates[index * 3 + 2] = position.z
  }
  const currentPositions = packedCurrentPositions(positionedBodies, coordinates)
  const positionedIds = new Set(positionedBodies.map(body => body.id))
  return {
    currentPositions,
    trajectoryUnavailableBodyIds: [],
    missingBodyIds: params.bodies.filter(body => !positionedIds.has(body.id)).map(body => body.id),
    maxDistance: currentPositions.maxDistance(),
  }
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
  const { currentPositions, maxDistance } = buildCurrentPositions({
    bodies,
    bodiesById,
    referenceId,
    julianDay: centerJulianDay,
  })
  const trajectories = buildTrajectories({
    bodies,
    bodiesById,
    referenceId,
    centerJulianDay,
    historyDays,
    sampleCount,
  })
  const completeIds = new Set(trajectories.map((sample) => sample.body.id))
  return {
    currentPositions,
    trajectories,
    trajectoryUnavailableBodyIds: bodies.filter((body) => !completeIds.has(body.id)).map((body) => body.id),
    maxDistance,
  }
}
