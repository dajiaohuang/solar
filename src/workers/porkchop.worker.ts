/// <reference lib="webworker" />

import { computePorkchopGrid } from '../engine/mission/lambert'
import { admitPorkchopRequest, porkchopEndpointEpochs, PORKCHOP_GRID_COLUMNS, PORKCHOP_GRID_ROWS } from '../engine/mission/porkchopRequest'
import type { BodyId, CelestialBody } from '../types'
import { ensureKernelFiles } from '../engine/ephemeris/kernelStore'
import type { AnalysisEphemerisPolicy, AnalysisEphemerisProvider } from '../engine/ephemeris/analysisEphemeris'
import { loadBackendAnalysisEphemeris } from '../lib/backendAnalysisEphemeris'
import type { BackendAnalysisStateAudit } from '../lib/backendAnalysisEphemeris'

export type PorkchopWorkerRequest = {
  ephemerisFiles?: string[]
  ephemerisPolicy?: AnalysisEphemerisPolicy
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
    admitPorkchopRequest(request)
    const bodiesById = new Map<BodyId, CelestialBody>(request.bodies.map((body) => [body.id, body]))
    const policy = request.ephemerisPolicy ?? 'prefer-spk'
    const backendBase = typeof import.meta.env.VITE_SOLAR_API_BASE_URL === 'string'
      ? import.meta.env.VITE_SOLAR_API_BASE_URL.trim() : ''
    const useBackend = policy === 'require-spk' && Boolean(backendBase)
    let ephemerisProvider: AnalysisEphemerisProvider | undefined
    let backendStateAudit: BackendAnalysisStateAudit | undefined
    if (useBackend) {
      const epochUtcJds = porkchopEndpointEpochs({
        departureStartJd: request.departureStartJd, departureSpanDays: request.departureSpanDays,
        minFlightDays: request.minFlightDays, maxFlightDays: request.maxFlightDays,
        columns: PORKCHOP_GRID_COLUMNS, rows: PORKCHOP_GRID_ROWS,
      })
      const ephemeris = await loadBackendAnalysisEphemeris({ base: backendBase, bodiesById,
        bodyIds: [request.departureBodyId, request.arrivalBodyId], epochUtcJds, signal: new AbortController().signal })
      ephemerisProvider = ephemeris
      backendStateAudit = ephemeris.backendStateAudit
    } else await ensureKernelFiles(request.ephemerisFiles ?? [])
    const result = computePorkchopGrid({
      ephemerisFiles: request.ephemerisFiles ?? [],
      ephemerisPolicy: request.ephemerisPolicy,
      departureBodyId: request.departureBodyId,
      arrivalBodyId: request.arrivalBodyId,
      bodiesById,
      departureStartJd: request.departureStartJd,
      departureSpanDays: request.departureSpanDays,
      minFlightDays: request.minFlightDays,
      maxFlightDays: request.maxFlightDays,
      columns: PORKCHOP_GRID_COLUMNS,
      rows: PORKCHOP_GRID_ROWS,
      ephemerisProvider,
      backendStateAudit,
    })
    workerScope.postMessage({ requestId: request.requestId, result } satisfies PorkchopWorkerResponse)
  } catch (error) {
    workerScope.postMessage({ requestId: request.requestId, error: error instanceof Error ? error.message : String(error) } satisfies PorkchopWorkerResponse)
  }
}

export {}
