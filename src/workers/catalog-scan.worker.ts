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

async function loadPrecomputedSample(request: CatalogScanWorkerRequest) {
  const size = request.sampleLimit <= 8_000 ? 'mobile' : 'desktop'
  const artifact = request.manifest.precomputedSamples?.[size]
  if (!artifact) return []
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  const [metadata, buffer] = await Promise.all([
    fetchImmutableJson<AsteroidIndexEntry[]>(`${root}/${artifact.metadataPath}`),
    fetchImmutableArrayBuffer(`${root}/${artifact.binaryPath}`),
  ])
  const values = binaryValues(metadata, buffer)
  return metadata.map((entry, index) => materializeRecord(entry, values, index * 8))
}

async function scanCompactIndex(request: CatalogScanWorkerRequest) {
  const compactIndex = request.manifest.compactIndex
  if (!compactIndex) return false
  const root = request.manifest.releasePath ?? `${import.meta.env.BASE_URL}data/asteroids`
  const [buffer, sample] = await Promise.all([
    fetchImmutableArrayBuffer(`${root}/${compactIndex.path}`),
    loadPrecomputedSample(request),
  ])
  if (buffer.byteLength !== compactIndex.count * compactIndex.strideBytes) {
    throw new Error(`Compact catalog index has ${buffer.byteLength} bytes; expected ${compactIndex.count * compactIndex.strideBytes}`)
  }
  const matches = createCatalogFieldMatcher(request.filters)
  const view = new DataView(buffer)
  let total = 0
  const progressInterval = Math.max(1, Math.floor(compactIndex.count / 100))
  for (let index = 0; index < compactIndex.count; index += 1) {
    const offset = index * compactIndex.strideBytes
    const semiMajorAxisAU = view.getFloat64(offset, true)
    const eccentricity = view.getUint32(offset + 8, true) / 1_000_000_000
    const inclinationDeg = view.getUint32(offset + 12, true) / 1_000_000
    const magnitudeFixed = view.getInt16(offset + 16, true)
    const magnitudeValue = magnitudeFixed === 0x7fff ? undefined : magnitudeFixed / 100
    const classIndex = view.getUint8(offset + 18)
    if (matches(
      '', compactIndex.classCodes[classIndex] ?? 'OTHER',
      magnitudeValue,
      semiMajorAxisAU, eccentricity, inclinationDeg,
    )) total += 1
    if (index > 0 && index % progressInterval === 0) {
      workerScope.postMessage({
        type: 'progress', requestId: request.requestId, scanKey: request.scanKey,
        progress: index / compactIndex.count,
      } satisfies CatalogScanWorkerResponse)
    }
  }
  const records = sample.filter((record) => matches(
    record.searchKey, record.orbitClassCode, record.absoluteMagnitude,
    record.semiMajorAxisAU, record.eccentricity, record.inclinationDeg,
  )).slice(0, request.sampleLimit)
  workerScope.postMessage({
    type: 'result', requestId: request.requestId, scanKey: request.scanKey,
    progress: 1, total, records,
  } satisfies CatalogScanWorkerResponse)
  return true
}

async function scan(request: CatalogScanWorkerRequest) {
  if (!request.filters.query.trim() && await scanCompactIndex(request)) return
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
      scanKey: request.scanKey,
      progress: (index + 1) / Math.max(request.manifest.chunkCount, 1),
    } satisfies CatalogScanWorkerResponse)
  }
  workerScope.postMessage({
    type: 'result', requestId: request.requestId, scanKey: request.scanKey, progress: 1, total, records: sampler.values(),
  } satisfies CatalogScanWorkerResponse)
}

workerScope.onmessage = (event: MessageEvent<CatalogScanWorkerRequest>) => {
  void scan(event.data).catch((error: unknown) => workerScope.postMessage({
    type: 'error',
    requestId: event.data.requestId,
    scanKey: event.data.scanKey,
    error: error instanceof Error ? error.message : String(error),
  } satisfies CatalogScanWorkerResponse))
}

export {}
