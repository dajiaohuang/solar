/// <reference lib="webworker" />

import { fetchImmutableArrayBuffer, fetchImmutableGzipJson, fetchImmutableJson } from '../data/cache/indexedDb'
import { validateBinaryElements } from '../lib/catalogLoader'
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
const compactIndexCache = new Map<string, ArrayBuffer>()
const MAX_COMPACT_INDEX_ENTRIES = 2
let activeRequestId = 0
let activeController: AbortController | null = null

function chunkId(index: number) {
  return `chunk-${String(index).padStart(4, '0')}`
}

function yieldToWorker() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function isCancelled(request: CatalogScanWorkerRequest) {
  return activeRequestId !== request.requestId
}

function binaryValues(metadata: AsteroidIndexEntry[], buffer: ArrayBuffer) {
  const values = new Float64Array(buffer)
  const stride = 8
  if (values.length !== metadata.length * stride) {
    throw new Error(`Binary asteroid shard has ${values.length} values; expected ${metadata.length * stride}`)
  }
  return values
}

async function loadBinaryChunk(request: CatalogScanWorkerRequest, index: number, signal: AbortSignal) {
  const id = chunkId(index)
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  const [metadata, buffer] = await Promise.all([
    request.manifest.capabilities?.includes('gzip-json-v1')
      ? fetchImmutableGzipJson<AsteroidIndexEntry[]>(`${root}/meta/${id}.json.gz`, signal)
      : fetchImmutableJson<AsteroidIndexEntry[]>(`${root}/meta/${id}.json`, signal),
    fetchImmutableArrayBuffer(`${root}/binary/${id}.bin`, validateBinaryElements, signal),
  ])
  return { metadata, values: binaryValues(metadata, buffer) }
}

async function loadJsonChunk(request: CatalogScanWorkerRequest, index: number, signal: AbortSignal) {
  const id = chunkId(index)
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  return request.manifest.capabilities?.includes('gzip-json-v1')
    ? fetchImmutableGzipJson<AsteroidRecord[]>(`${root}/chunks/${id}.json.gz`, signal)
    : fetchImmutableJson<AsteroidRecord[]>(`${root}/chunks/${id}.json`, signal)
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

async function scanCompactIndex(request: CatalogScanWorkerRequest, signal: AbortSignal) {
  const compactIndex = request.manifest.compactIndex
  if (!compactIndex) return false
  if (compactIndex.format !== 'catalog-index-v1' || compactIndex.strideBytes !== 24 ||
      !Number.isSafeInteger(compactIndex.count) || compactIndex.count < 0) throw new Error('Invalid compact catalog index contract')
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  const url = `${root}/${compactIndex.path}`
  // Only completed, validated buffers enter this cache. A replacement scan
  // must never inherit a rejected promise owned by the cancelled generation.
  const validate = (buffer: ArrayBuffer) => {
    if (buffer.byteLength !== compactIndex.count * compactIndex.strideBytes) throw new Error(`Compact catalog index has ${buffer.byteLength} bytes; expected ${compactIndex.count * compactIndex.strideBytes}`)
  }
  const buffer = compactIndexCache.get(url) ?? await fetchImmutableArrayBuffer(url, validate, signal)
  if (isCancelled(request)) return true
  try { validate(buffer) }
  catch (error) {
    compactIndexCache.delete(url)
    throw error
  }
  compactIndexCache.delete(url)
  compactIndexCache.set(url, buffer)
  while (compactIndexCache.size > MAX_COMPACT_INDEX_ENTRIES) compactIndexCache.delete(compactIndexCache.keys().next().value!)

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
    if (chunkIndex >= request.manifest.chunkCount || rowIndex >= request.manifest.chunkSize || compactRow >= compactIndex.count) {
      throw new Error(`Search locator is outside compact index: ${chunkIndex}:${rowIndex}`)
    }
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

async function scan(request: CatalogScanWorkerRequest, signal: AbortSignal) {
  activeRequestId = request.requestId
  if (request.candidateLocators && request.candidateLocators.length % 2 !== 0) throw new Error('Catalog locators must contain chunk/row pairs')
  if ((!request.filters.query.trim() || request.candidateLocators) && await scanCompactIndex(request, signal)) return

  const matches = createCatalogFieldMatcher(request.filters)
  let total = 0
  if (request.manifest.format === 'binary-v1') {
    const sampler = new StratifiedCatalogSampler<CatalogLocator>(Math.max(1, request.sampleLimit))
    for (let index = 0; index < request.manifest.chunkCount; index += 1) {
      if (isCancelled(request)) return
      const { metadata, values } = await loadBinaryChunk(request, index, signal)
      if (isCancelled(request)) return
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
    const records = await loadJsonChunk(request, index, signal)
    if (isCancelled(request)) return
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
    if (activeRequestId === event.data.requestId) { activeRequestId = 0; activeController?.abort(); activeController = null }
    return
  }
  const request = event.data
  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  void scan(request, controller.signal).catch((error: unknown) => {
    controller.abort() // Also stop a sibling shard if metadata or binary fails.
    if (isCancelled(request)) return
    workerScope.postMessage({
      type: 'error', requestId: request.requestId, scanKey: request.scanKey,
      error: error instanceof Error ? error.message : String(error),
    } satisfies CatalogScanWorkerResponse)
  }).finally(() => { if (activeController === controller) activeController = null })
}

export {}
