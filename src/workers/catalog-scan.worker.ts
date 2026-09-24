/// <reference lib="webworker" />

import { fetchImmutableArrayBuffer, fetchImmutableGzipJson, fetchImmutableJson } from '../data/cache/indexedDb'
import { validateBinaryElements } from '../lib/catalogLoader'
import { validateCatalogMetadata, validateCatalogRecords } from '../lib/catalogRecordValidation'
import { bindCatalogChecksums, catalogSha256 } from '../lib/catalogIntegrity'
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

async function loadBinaryChunk(request: CatalogScanWorkerRequest, index: number, signal: AbortSignal, checksum?: (path: string) => string) {
  const id = chunkId(index)
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  const metadataHash = checksum?.(`meta/${id}.json`)
  const binaryHash = checksum?.(`binary/${id}.bin`)
  const [metadata, buffer] = await Promise.all([
    request.manifest.capabilities?.includes('gzip-json-v1')
      ? fetchImmutableGzipJson<AsteroidIndexEntry[]>(`${root}/meta/${id}.json.gz`, signal, metadataHash)
      : fetchImmutableJson<AsteroidIndexEntry[]>(`${root}/meta/${id}.json`, signal, metadataHash),
    fetchImmutableArrayBuffer(`${root}/binary/${id}.bin`, async bytes => {
      validateBinaryElements(bytes)
      if (binaryHash && await catalogSha256(bytes) !== binaryHash) throw new Error('Catalog source shard SHA-256 mismatch')
      signal.throwIfAborted()
    }, signal),
  ])
  validateCatalogMetadata(metadata, id)
  return { metadata, values: binaryValues(metadata, buffer) }
}

async function loadJsonChunk(request: CatalogScanWorkerRequest, index: number, signal: AbortSignal) {
  const id = chunkId(index)
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  const records = await (request.manifest.capabilities?.includes('gzip-json-v1')
    ? fetchImmutableGzipJson<AsteroidRecord[]>(`${root}/chunks/${id}.json.gz`, signal)
    : fetchImmutableJson<AsteroidRecord[]>(`${root}/chunks/${id}.json`, signal))
  return validateCatalogRecords(records, id)
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

async function loadScanChecksums(request: CatalogScanWorkerRequest, signal: AbortSignal) {
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  let checksumReport: unknown
  await fetchImmutableArrayBuffer(`${root}/checksums.json`, bytes => {
    if (bytes.byteLength > 2*1024*1024) throw new Error('Catalog checksum map exceeds 2 MiB')
    checksumReport = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }, signal)
  return bindCatalogChecksums(checksumReport, request.manifest, signal)
}

async function scanCompactIndex(request: CatalogScanWorkerRequest, signal: AbortSignal) {
  const compactIndex = request.manifest.compactIndex
  if (!compactIndex) return false
  if (compactIndex.format !== 'catalog-index-v1' || compactIndex.strideBytes !== 24 ||
      !Number.isSafeInteger(compactIndex.count) || compactIndex.count < 0 || compactIndex.count !== request.manifest.totalCount ||
      !Number.isSafeInteger(request.manifest.chunkSize) || request.manifest.chunkSize < 1 ||
      request.manifest.chunkCount !== Math.ceil(compactIndex.count/request.manifest.chunkSize) ||
      !Array.isArray(compactIndex.classCodes) || !compactIndex.classCodes.length || compactIndex.classCodes.length > 256 ||
      new Set(compactIndex.classCodes).size !== compactIndex.classCodes.length || compactIndex.classCodes.some(code => typeof code !== 'string' || !code) ||
      !/^[a-zA-Z0-9_-]+\.bin$/.test(compactIndex.path)) throw new Error('Invalid compact catalog index contract')
  if (request.manifest.format !== 'binary-v1') return false
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  const url = `${root}/${compactIndex.path}`
  const checksum = await loadScanChecksums(request, signal)
  const expectedIndexHash = checksum(compactIndex.path)
  const cacheKey = JSON.stringify([url, request.manifest.version, request.manifest.contentSha256, request.manifest.sourceSha256, compactIndex])
  // Only completed, validated buffers enter this cache. A replacement scan
  // must never inherit a rejected promise owned by the cancelled generation.
  const validate = async (buffer: ArrayBuffer) => {
    if (buffer.byteLength !== compactIndex.count * compactIndex.strideBytes) throw new Error(`Compact catalog index has ${buffer.byteLength} bytes; expected ${compactIndex.count * compactIndex.strideBytes}`)
    if (await catalogSha256(buffer) !== expectedIndexHash) throw new Error('Compact catalog index SHA-256 mismatch')
    signal.throwIfAborted()
  }
  const cached = compactIndexCache.get(cacheKey)
  const buffer = cached ?? await fetchImmutableArrayBuffer(url, validate, signal)
  if (isCancelled(request)) return true
  try { if (cached) await validate(buffer) }
  catch (error) {
    compactIndexCache.delete(cacheKey)
    throw error
  }
  compactIndexCache.delete(cacheKey)
  compactIndexCache.set(cacheKey, buffer)
  while (compactIndexCache.size > MAX_COMPACT_INDEX_ENTRIES) compactIndexCache.delete(compactIndexCache.keys().next().value!)

  // Quantized e/i/H and derived perihelion cannot decide exact source matches.
  // Use only the Float64 semimajor axis and class to admit source shards.
  const coarse = createCatalogFieldMatcher({ ...request.filters, query: '', eccentricity: [0, 1],
    inclination: [0, 180], perihelion: [0, Infinity], absoluteMagnitude: [-Infinity, Infinity], magnitudeStatus: 'all' })
  const matches = createCatalogFieldMatcher(request.filters)
  const sampler = new StratifiedCatalogSampler<CatalogLocator>(Math.max(1, request.sampleLimit))
  const view = new DataView(buffer)
  const candidateCount = request.candidateLocators ? request.candidateLocators.length / 2 : compactIndex.count
  const progressInterval = Math.max(1, Math.floor(candidateCount / 100))
  let total = 0
  const admittedChunks = new Set<number>()
  const candidates = request.candidateLocators ? new Set<number>() : null

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
    if (candidates?.has(compactRow)) throw new Error('Duplicate catalog candidate locator')
    candidates?.add(compactRow)
    const semiMajorAxisAU = view.getFloat64(offset, true)
    const eccentricity = view.getUint32(offset + 8, true) / 1_000_000_000
    const inclinationDeg = view.getUint32(offset + 12, true) / 1_000_000
    const magnitudeFixed = view.getInt16(offset + 16, true)
    const magnitudeValue = magnitudeFixed === 0x7fff ? undefined : magnitudeFixed / 100
    const classIndex = view.getUint8(offset + 18)
    const flags = view.getUint8(offset + 19)
    if (!Number.isFinite(semiMajorAxisAU) || semiMajorAxisAU <= 0 || eccentricity > 1 || inclinationDeg > 180 ||
        classIndex >= compactIndex.classCodes.length || flags > 7 || Boolean(flags & 4) !== (magnitudeFixed !== 0x7fff) ||
        view.getUint16(offset+20, true) !== chunkIndex || view.getUint16(offset+22, true) !== rowIndex) throw new Error('Invalid compact catalog row')
    const orbitClassCode = compactIndex.classCodes[classIndex]
    if (coarse('', orbitClassCode, magnitudeValue, semiMajorAxisAU, 0, 0)) admittedChunks.add(chunkIndex)
    if (candidateIndex > 0 && candidateIndex % progressInterval === 0) {
      if (isCancelled(request)) return true
      workerScope.postMessage({
        type: 'progress', requestId: request.requestId, scanKey: request.scanKey,
        progress: .25*candidateIndex / Math.max(candidateCount, 1),
      } satisfies CatalogScanWorkerResponse)
      await yieldToWorker()
    }
  }
  let completedChunks = 0
  for (const chunkIndex of admittedChunks) {
    if (isCancelled(request)) return true
    const { metadata, values } = await loadBinaryChunk(request, chunkIndex, signal, checksum)
    if (isCancelled(request)) return true
    const expectedRows = Math.min(request.manifest.chunkSize, compactIndex.count-chunkIndex*request.manifest.chunkSize)
    if (metadata.length !== expectedRows) throw new Error('Catalog source shard count differs from compact index')
    for (let rowIndex = 0; rowIndex < metadata.length; rowIndex++) {
      if (rowIndex && rowIndex % 1024 === 0) {
        await yieldToWorker()
        if (isCancelled(request)) return true
        signal.throwIfAborted()
      }
      const sourceRow = chunkIndex*request.manifest.chunkSize+rowIndex
      if (candidates && !candidates.has(sourceRow)) continue
      const entry = metadata[rowIndex], offset = rowIndex*8, indexOffset = sourceRow*24
      const expectedMagnitude = entry.absoluteMagnitude === undefined ? 0x7fff : Math.round(entry.absoluteMagnitude*100)
      const expectedFlags = (entry.isNeo ? 1 : 0) | (entry.isPha ? 2 : 0) | (entry.absoluteMagnitude !== undefined ? 4 : 0)
      if (view.getFloat64(indexOffset, true) !== values[offset+1] || compactIndex.classCodes[view.getUint8(indexOffset+18)] !== entry.orbitClassCode ||
          view.getUint32(indexOffset+8, true) !== Math.round(values[offset+2]*1_000_000_000) ||
          view.getUint32(indexOffset+12, true) !== Math.round(values[offset+3]*1_000_000) ||
          view.getInt16(indexOffset+16, true) !== expectedMagnitude || view.getUint8(indexOffset+19) !== expectedFlags) {
        throw new Error('Compact index differs from its source shard')
      }
      if (!matches(entry.searchKey, entry.orbitClassCode, entry.absoluteMagnitude, values[offset+1], values[offset+2], values[offset+3])) continue
      total++
      const decision = sampler.consider(entry.id, entry.orbitClassCode, values[offset+1], values[offset+2], values[offset+3], entry.absoluteMagnitude)
      if (decision) sampler.commit(decision, { chunkIndex, rowIndex })
    }
    completedChunks++
    workerScope.postMessage({ type: 'progress', requestId: request.requestId, scanKey: request.scanKey,
      progress: .25+.75*completedChunks/Math.max(1, admittedChunks.size) } satisfies CatalogScanWorkerResponse)
    await yieldToWorker()
  }
  if (!isCancelled(request)) postLocatorResult(request, total, sampler.values())
  return true
}

async function scan(request: CatalogScanWorkerRequest, signal: AbortSignal) {
  activeRequestId = request.requestId
  const { totalCount, chunkCount, chunkSize } = request.manifest
  if (!Number.isSafeInteger(totalCount) || totalCount < 0 || !Number.isSafeInteger(chunkSize) || chunkSize < 1 ||
      !Number.isSafeInteger(chunkCount) || chunkCount < 0 || chunkCount > 0x100000000 || chunkSize > 0x100000000 ||
      chunkCount !== Math.ceil(totalCount/chunkSize)) throw new Error('Invalid catalog scan dimensions')
  if (request.candidateLocators && request.candidateLocators.length % 2 !== 0) throw new Error('Catalog locators must contain chunk/row pairs')
  if ((!request.filters.query.trim() || request.candidateLocators) && await scanCompactIndex(request, signal)) return

  const matches = createCatalogFieldMatcher(request.filters)
  let total = 0
  if (request.manifest.format === 'binary-v1') {
    const checksum = request.manifest.contentSha256 !== undefined ? await loadScanChecksums(request, signal) : undefined
    const sampler = new StratifiedCatalogSampler<CatalogLocator>(Math.max(1, request.sampleLimit))
    for (let index = 0; index < request.manifest.chunkCount; index += 1) {
      if (isCancelled(request)) return
      const { metadata, values } = await loadBinaryChunk(request, index, signal, checksum)
      if (isCancelled(request)) return
      if (metadata.length !== Math.min(chunkSize, totalCount-index*chunkSize)) throw new Error('Catalog shard count differs from manifest')
      for (let recordIndex = 0; recordIndex < metadata.length; recordIndex += 1) {
        if (recordIndex && recordIndex % 1024 === 0) {
          await yieldToWorker()
          if (isCancelled(request)) return
          signal.throwIfAborted()
        }
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
    if (records.length !== Math.min(chunkSize, totalCount-index*chunkSize)) throw new Error('Catalog shard count differs from manifest')
    for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
      if (recordIndex && recordIndex % 1024 === 0) {
        await yieldToWorker()
        if (isCancelled(request)) return
        signal.throwIfAborted()
      }
      const record = records[recordIndex]
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
