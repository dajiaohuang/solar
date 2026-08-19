/// <reference lib="webworker" />

import { fetchImmutableArrayBuffer, fetchImmutableJson } from '../data/cache/indexedDb'
import { createCatalogFieldMatcher } from '../lib/catalogFilters'
import { StratifiedCatalogSampler } from '../lib/catalogSampling'
import type {
  AsteroidIndexEntry,
  AsteroidRecord,
  CatalogLocator,
  CatalogScanWorkerCancelRequest,
  CatalogScanWorkerRequest,
  CatalogScanWorkerResponse,
} from '../types'

const workerScope = self as DedicatedWorkerGlobalScope
const compactIndexCache = new Map<string, Promise<ArrayBuffer>>()
const cancelledRequests = new Set<number>()
let activeRequestId = 0

function chunkId(index: number) {
  return `chunk-${String(index).padStart(4, '0')}`
}

function yieldToWorker() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function isCancelled(request: CatalogScanWorkerRequest) {
  return cancelledRequests.has(request.requestId) || activeRequestId !== request.requestId
}

function binaryValues(metadata: AsteroidIndexEntry[], buffer: ArrayBuffer) {
  const values = new Float64Array(buffer)
  const stride = 8
  if (values.length !== metadata.length * stride) {
    throw new Error(`Binary asteroid shard has ${values.length} values; expected ${metadata.length * stride}`)
  }
  return values
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

function postLocatorResult(request: CatalogScanWorkerRequest, total: number, sampled: CatalogLocator[]) {
  const locators = new Uint32Array(sampled.length * 2)
  sampled.forEach((locator, index) => {
    locators[index * 2] = locator.chunkIndex
    locators[index * 2 + 1] = locator.rowIndex
  })
  workerScope.postMessage({
    type: 'result', requestId: request.requestId, scanKey: request.scanKey,
    progress: 1, total, locators,
  } satisfies CatalogScanWorkerResponse, [locators.buffer])
}

async function scanCompactIndex(request: CatalogScanWorkerRequest) {
  const compactIndex = request.manifest.compactIndex
  if (!compactIndex) return false
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  const url = `${root}/${compactIndex.path}`
  let promise = compactIndexCache.get(url)
  if (!promise) {
    const request = fetchImmutableArrayBuffer(url)
    promise = request.catch((error: unknown) => {
      if (compactIndexCache.get(url) === promise) compactIndexCache.delete(url)
      throw error
    })
    compactIndexCache.set(url, promise)
  }
  const buffer = await promise
  if (buffer.byteLength !== compactIndex.count * compactIndex.strideBytes) {
    compactIndexCache.delete(url)
    throw new Error(`Compact catalog index has ${buffer.byteLength} bytes; expected ${compactIndex.count * compactIndex.strideBytes}`)
  }

  const filters = request.candidateLocators ? { ...request.filters, query: '' } : request.filters
  const matches = createCatalogFieldMatcher(filters)
  const sampler = new StratifiedCatalogSampler<CatalogLocator>(Math.max(1, request.sampleLimit))
  const view = new DataView(buffer)
  const candidateCount = request.candidateLocators ? request.candidateLocators.length / 2 : compactIndex.count
  const progressInterval = Math.max(1, Math.floor(candidateCount / 100))
  let total = 0

  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    const chunkIndex = request.candidateLocators
      ? request.candidateLocators[candidateIndex * 2]
      : Math.floor(candidateIndex / request.manifest.chunkSize)
    const rowIndex = request.candidateLocators
      ? request.candidateLocators[candidateIndex * 2 + 1]
      : candidateIndex % request.manifest.chunkSize
    const compactRow = chunkIndex * request.manifest.chunkSize + rowIndex
    if (compactRow >= compactIndex.count) throw new Error(`Search locator is outside compact index: ${chunkIndex}:${rowIndex}`)
    const offset = compactRow * compactIndex.strideBytes
    const semiMajorAxisAU = view.getFloat64(offset, true)
    const eccentricity = view.getUint32(offset + 8, true) / 1_000_000_000
    const inclinationDeg = view.getUint32(offset + 12, true) / 1_000_000
    const magnitudeFixed = view.getInt16(offset + 16, true)
    const magnitudeValue = magnitudeFixed === 0x7fff ? undefined : magnitudeFixed / 100
    const classIndex = view.getUint8(offset + 18)
    const orbitClassCode = compactIndex.classCodes[classIndex] ?? 'OTHER'
    if (matches('', orbitClassCode, magnitudeValue, semiMajorAxisAU, eccentricity, inclinationDeg)) {
      total += 1
      const decision = sampler.consider(
        `${chunkIndex}:${rowIndex}`, orbitClassCode, semiMajorAxisAU, eccentricity, inclinationDeg, magnitudeValue,
      )
      if (decision) sampler.commit(decision, { chunkIndex, rowIndex })
    }
    if (candidateIndex > 0 && candidateIndex % progressInterval === 0) {
      if (isCancelled(request)) return true
      workerScope.postMessage({
        type: 'progress', requestId: request.requestId, scanKey: request.scanKey,
        progress: candidateIndex / Math.max(candidateCount, 1),
      } satisfies CatalogScanWorkerResponse)
      await yieldToWorker()
    }
  }
  if (!isCancelled(request)) postLocatorResult(request, total, sampler.values())
  return true
}

async function scan(request: CatalogScanWorkerRequest) {
  activeRequestId = request.requestId
  if ((!request.filters.query.trim() || request.candidateLocators) && await scanCompactIndex(request)) return

  const matches = createCatalogFieldMatcher(request.filters)
  let total = 0
  if (request.manifest.format === 'binary-v1') {
    const sampler = new StratifiedCatalogSampler<CatalogLocator>(Math.max(1, request.sampleLimit))
    for (let index = 0; index < request.manifest.chunkCount; index += 1) {
      if (isCancelled(request)) return
      const { metadata, values } = await loadBinaryChunk(request, index)
      for (let recordIndex = 0; recordIndex < metadata.length; recordIndex += 1) {
        const entry = metadata[recordIndex]
        const offset = recordIndex * 8
        const semiMajorAxisAU = values[offset + 1]
        const eccentricity = values[offset + 2]
        const inclinationDeg = values[offset + 3]
        if (!matches(entry.searchKey, entry.orbitClassCode, entry.absoluteMagnitude, semiMajorAxisAU, eccentricity, inclinationDeg)) continue
        total += 1
        const decision = sampler.consider(
          entry.id, entry.orbitClassCode, semiMajorAxisAU, eccentricity, inclinationDeg, entry.absoluteMagnitude,
        )
        if (decision) sampler.commit(decision, { chunkIndex: index, rowIndex: recordIndex })
      }
      workerScope.postMessage({
        type: 'progress', requestId: request.requestId, scanKey: request.scanKey,
        progress: (index + 1) / Math.max(request.manifest.chunkCount, 1),
      } satisfies CatalogScanWorkerResponse)
      await yieldToWorker()
    }
    if (!isCancelled(request)) postLocatorResult(request, total, sampler.values())
    return
  }

  const sampler = new StratifiedCatalogSampler(Math.max(1, request.sampleLimit))
  for (let index = 0; index < request.manifest.chunkCount; index += 1) {
    if (isCancelled(request)) return
    const records = await loadJsonChunk(request, index)
    for (const record of records) {
      if (!matches(record.searchKey, record.orbitClassCode, record.absoluteMagnitude, record.semiMajorAxisAU, record.eccentricity, record.inclinationDeg)) continue
      total += 1
      sampler.add(record)
    }
    workerScope.postMessage({
      type: 'progress', requestId: request.requestId, scanKey: request.scanKey,
      progress: (index + 1) / Math.max(request.manifest.chunkCount, 1),
    } satisfies CatalogScanWorkerResponse)
    await yieldToWorker()
  }
  if (!isCancelled(request)) workerScope.postMessage({
    type: 'result', requestId: request.requestId, scanKey: request.scanKey,
    progress: 1, total, records: sampler.values(),
  } satisfies CatalogScanWorkerResponse)
}

workerScope.onmessage = (event: MessageEvent<CatalogScanWorkerRequest | CatalogScanWorkerCancelRequest>) => {
  if (event.data.type === 'cancel') {
    cancelledRequests.add(event.data.requestId)
    return
  }
  const request = event.data
  cancelledRequests.delete(request.requestId)
  void scan(request).catch((error: unknown) => {
    if (isCancelled(request)) return
    workerScope.postMessage({
      type: 'error', requestId: request.requestId, scanKey: request.scanKey,
      error: error instanceof Error ? error.message : String(error),
    } satisfies CatalogScanWorkerResponse)
  }).finally(() => cancelledRequests.delete(request.requestId))
}

export {}
