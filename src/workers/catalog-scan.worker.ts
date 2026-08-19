/// <reference lib="webworker" />

import { fetchImmutableArrayBuffer, fetchImmutableJson } from '../data/cache/indexedDb'
import { createCatalogFieldMatcher } from '../lib/catalogFilters'
import { StratifiedCatalogSampler } from '../lib/catalogSampling'
import type {
  AsteroidIndexEntry,
  AsteroidRecord,
  CatalogScanWorkerRequest,
  CatalogScanWorkerResponse,
} from '../types'

const workerScope = self as DedicatedWorkerGlobalScope

function chunkId(index: number) {
  return `chunk-${String(index).padStart(4, '0')}`
}

function binaryValues(metadata: AsteroidIndexEntry[], buffer: ArrayBuffer) {
  const values = new Float64Array(buffer)
  const stride = 8
  if (values.length !== metadata.length * stride) {
    throw new Error(`Binary asteroid shard has ${values.length} values; expected ${metadata.length * stride}`)
  }
  return values
}

function materializeRecord(entry: AsteroidIndexEntry, values: Float64Array, offset: number): AsteroidRecord {
  return {
    ...entry,
    epochJd: values[offset],
    semiMajorAxisAU: values[offset + 1],
    eccentricity: values[offset + 2],
    inclinationDeg: values[offset + 3],
    ascendingNodeDeg: values[offset + 4],
    argPeriapsisDeg: values[offset + 5],
    meanAnomalyDeg: values[offset + 6],
    meanMotionDegPerDay: values[offset + 7],
  }
}

async function loadBinaryChunk(request: CatalogScanWorkerRequest, index: number) {
  const id = chunkId(index)
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  const [metadata, buffer] = await Promise.all([
    fetchImmutableJson<AsteroidIndexEntry[]>(`${root}/meta/${id}.json`),
    fetchImmutableArrayBuffer(`${root}/binary/${id}.bin`),
  ])
  return { metadata, values: binaryValues(metadata, buffer) }
}

async function loadJsonChunk(request: CatalogScanWorkerRequest, index: number) {
  const id = chunkId(index)
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  return fetchImmutableJson<AsteroidRecord[]>(`${root}/chunks/${id}.json`)
}

async function scan(request: CatalogScanWorkerRequest) {
  const sampler = new StratifiedCatalogSampler(Math.max(1, request.sampleLimit))
  const matches = createCatalogFieldMatcher(request.filters)
  let total = 0
  for (let index = 0; index < request.manifest.chunkCount; index += 1) {
    if (request.manifest.format === 'binary-v1') {
      const { metadata, values } = await loadBinaryChunk(request, index)
      for (let recordIndex = 0; recordIndex < metadata.length; recordIndex += 1) {
        const entry = metadata[recordIndex]
        const offset = recordIndex * 8
        const semiMajorAxisAU = values[offset + 1]
        const eccentricity = values[offset + 2]
        const inclinationDeg = values[offset + 3]
        if (!matches(
          entry.searchKey, entry.orbitClassCode, entry.absoluteMagnitude,
          semiMajorAxisAU, eccentricity, inclinationDeg,
        )) continue
        total += 1
        const decision = sampler.consider(
          entry.id, entry.orbitClassCode, semiMajorAxisAU, eccentricity,
          inclinationDeg, entry.absoluteMagnitude,
        )
        if (decision) sampler.commit(decision, materializeRecord(entry, values, offset))
      }
    } else {
      const records = await loadJsonChunk(request, index)
      for (const record of records) {
        if (!matches(
          record.searchKey, record.orbitClassCode, record.absoluteMagnitude,
          record.semiMajorAxisAU, record.eccentricity, record.inclinationDeg,
        )) continue
        total += 1
        sampler.add(record)
      }
    }
    workerScope.postMessage({
      type: 'progress',
      requestId: request.requestId,
      progress: (index + 1) / Math.max(request.manifest.chunkCount, 1),
    } satisfies CatalogScanWorkerResponse)
  }
  workerScope.postMessage({
    type: 'result', requestId: request.requestId, progress: 1, total, records: sampler.values(),
  } satisfies CatalogScanWorkerResponse)
}

workerScope.onmessage = (event: MessageEvent<CatalogScanWorkerRequest>) => {
  void scan(event.data).catch((error: unknown) => workerScope.postMessage({
    type: 'error',
    requestId: event.data.requestId,
    error: error instanceof Error ? error.message : String(error),
  } satisfies CatalogScanWorkerResponse))
}

export {}
