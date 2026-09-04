import { createBodyPositionResolver } from './ephemeris'
import { kernelsForWindow, loadedKernelIds } from '../engine/ephemeris/kernelStore'
import { getRelativePositions, toPlanarPoint } from './referenceFrame'
import { vector3Magnitude } from './ephemeris'
import { createTrajectoryAccumulator } from './trajectorySamples'
import type { BodyId, CelestialBody, TrajectoryFrameData, TrajectorySample } from '../types'

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

  const accumulator = createTrajectoryAccumulator(bodies)

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

  const trajectories = accumulator.complete(sampleCount)
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
}) {
  const resolve = createBodyPositionResolver(params.bodiesById, params.julianDay)
  const relativePositions = getRelativePositions(params.bodies, params.referenceId, resolve)
  const currentPositions = relativePositions.map((item) => ({
    body: item.body,
    planarPosition: toPlanarPoint(item.position),
    position3D: item.position,
    distance: vector3Magnitude(item.position),
  }))
  return {
    currentPositions,
    trajectoryUnavailableBodyIds: [],
    missingBodyIds: params.bodies.filter(body => !currentPositions.some(item => item.body.id === body.id)).map(body => body.id),
    maxDistance: currentPositions.reduce((largest, item) => Math.max(largest, item.distance), 0),
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
