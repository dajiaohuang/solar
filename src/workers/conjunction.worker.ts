/// <reference lib="webworker" />

import { createBodyPositionResolver } from '../lib/ephemeris'
import { subtractVector3, vector3Magnitude } from '../lib/ephemeris'
import type { BodyId, CelestialBody } from '../types'

export type ConjunctionRequest = {
  type: 'find'
  requestId: number
  bodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  referenceId: BodyId
  centerJulianDay: number
  windowDays: number
  thresholdAU: number
}

export type ConjunctionEvent = {
  bodyAId: BodyId
  bodyAName: string
  bodyBId: BodyId
  bodyBName: string
  minDistanceAU: number
  julianDay: number
}

export type ConjunctionResponse = {
  type: 'result'
  requestId: number
  events: ConjunctionEvent[]
}

const workerScope = self as DedicatedWorkerGlobalScope

const COARSE_SAMPLES = 200
const FINE_SAMPLES = 100

function findConjunctions(
  bodies: CelestialBody[],
  bodiesById: Map<BodyId, CelestialBody>,
  referenceId: BodyId,
  centerJulianDay: number,
  windowDays: number,
  thresholdAU: number,
) {
  const events: ConjunctionEvent[] = []
  const halfWindow = windowDays / 2
  const startJD = centerJulianDay - halfWindow
  const endJD = centerJulianDay + halfWindow

  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const bodyA = bodies[i]
      const bodyB = bodies[j]

      let minDist = Number.POSITIVE_INFINITY
      let minJD = centerJulianDay

      for (let s = 0; s <= COARSE_SAMPLES; s += 1) {
        const jd = startJD + (s / COARSE_SAMPLES) * (endJD - startJD)
        const resolve = createBodyPositionResolver(bodiesById, jd)
        const refPos = resolve(referenceId)
        const posA = resolve(bodyA.id)
        const posB = resolve(bodyB.id)
        const relA = subtractVector3(posA, refPos)
        const relB = subtractVector3(posB, refPos)
        const dist = vector3Magnitude(subtractVector3(relA, relB))

        if (dist < minDist) {
          minDist = dist
          minJD = jd
        }
      }

      if (minDist > thresholdAU) {
        continue
      }

      const refineHalf = windowDays / COARSE_SAMPLES
      let refinedMin = minDist
      let refinedJD = minJD

      for (let s = 0; s <= FINE_SAMPLES; s += 1) {
        const jd = minJD - refineHalf + (s / FINE_SAMPLES) * refineHalf * 2
        const resolve = createBodyPositionResolver(bodiesById, jd)
        const refPos = resolve(referenceId)
        const posA = resolve(bodyA.id)
        const posB = resolve(bodyB.id)
        const relA = subtractVector3(posA, refPos)
        const relB = subtractVector3(posB, refPos)
        const dist = vector3Magnitude(subtractVector3(relA, relB))

        if (dist < refinedMin) {
          refinedMin = dist
          refinedJD = jd
        }
      }

      if (refinedMin <= thresholdAU) {
        events.push({
          bodyAId: bodyA.id,
          bodyAName: bodyA.name,
          bodyBId: bodyB.id,
          bodyBName: bodyB.name,
          minDistanceAU: refinedMin,
          julianDay: refinedJD,
        })
      }
    }
  }

  events.sort((a, b) => a.minDistanceAU - b.minDistanceAU)
  return events
}

workerScope.onmessage = (event: MessageEvent<ConjunctionRequest>) => {
  const request = event.data

  if (request.type !== 'find') {
    return
  }

  const bodiesById = new Map(request.resolutionBodies.map((body) => [body.id, body]))
  const events = findConjunctions(
    request.bodies,
    bodiesById,
    request.referenceId,
    request.centerJulianDay,
    request.windowDays,
    request.thresholdAU,
  )

  const response: ConjunctionResponse = {
    type: 'result',
    requestId: request.requestId,
    events,
  }

  workerScope.postMessage(response)
}

export {}
