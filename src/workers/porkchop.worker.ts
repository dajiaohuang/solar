/// <reference lib="webworker" />

import { computePorkchopGrid } from '../engine/mission/lambert'
import type { BodyId, CelestialBody } from '../types'
import { ensureKernelFiles } from '../engine/ephemeris/kernelStore'

export type PorkchopWorkerRequest = {
  ephemerisFiles?: string[]
  requestId: number
  departureBodyId: BodyId
  arrivalBodyId: BodyId
  bodies: CelestialBody[]
  departureStartJd: number
  departureSpanDays: number
  minFlightDays: number
  maxFlightDays: number
}

export type PorkchopWorkerResponse = {
  requestId: number
  result?: ReturnType<typeof computePorkchopGrid>
  error?: string
}

const workerScope = self as DedicatedWorkerGlobalScope
workerScope.onmessage = async (event: MessageEvent<PorkchopWorkerRequest>) => {
  const request = event.data
  try {
    await ensureKernelFiles(request.ephemerisFiles ?? [])
    const bodiesById = new Map<BodyId, CelestialBody>(request.bodies.map((body) => [body.id, body]))
    const result = computePorkchopGrid({
      ephemerisFiles: request.ephemerisFiles ?? [],
      departureBodyId: request.departureBodyId,
      arrivalBodyId: request.arrivalBodyId,
      bodiesById,
      departureStartJd: request.departureStartJd,
      departureSpanDays: request.departureSpanDays,
      minFlightDays: request.minFlightDays,
      maxFlightDays: request.maxFlightDays,
      columns: 26,
      rows: 22,
    })
    workerScope.postMessage({ requestId: request.requestId, result } satisfies PorkchopWorkerResponse)
  } catch (error) {
    workerScope.postMessage({ requestId: request.requestId, error: error instanceof Error ? error.message : String(error) } satisfies PorkchopWorkerResponse)
  }
}

export {}
