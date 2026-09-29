/// <reference lib="webworker" />
import { decodeGaiaManifest, gaiaHash, streamGaiaChunks } from '../lib/gaiaChunks'
import { readBounded } from '../lib/stateTiles'
import { GaiaSourceCache } from '../lib/gaiaCache'
import { packGaiaSourcesAndDisplay } from '../lib/gaiaPackedSources'
import { planGaiaCollection } from '../lib/gaiaCollection'
import { readScientificSourceFile } from '../lib/scientificSourceFile'
import capacity from '../data/gaiaCapacity.json'
import { GAIA_UPLOAD_MAX_ROWS, GAIA_UPLOAD_SLOTS, validateGaiaLoadRequest, type GaiaWorkerResponse } from './gaia.protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (message: GaiaWorkerResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer)
const cache = new GaiaSourceCache()
type PendingUpload = { finish: (error?: unknown) => void; promise: Promise<void>; rows: number }
const pendingUploads = new Map<number, PendingUpload>()
const uploadCreditWaiters: (() => void)[] = []
let started = false, sequence = 0

type RegionRecord = Extract<GaiaWorkerResponse, { type: 'manifest' }>['regions'][number]
type PreparedRegion = RegionRecord & { baseUrl: string; localFiles?: Map<string, File> }

function allocateChunkSlots(regions: readonly PreparedRegion[], maximumSlots: number) {
  const available = regions.map(region => region.manifest.chunks.length)
  const slots: number[] = available.map(count => count > 0 ? 1 : 0)
  let allocated = slots.reduce((sum, count) => sum + count, 0)
  while (allocated < maximumSlots) {
    let target = -1
    for (let index = 0; index < slots.length; index++) {
      if (slots[index] < available[index] && (target < 0 || available[index] - slots[index] > available[target] - slots[target])) target = index
    }
    if (target < 0) break
    slots[target]++; allocated++
  }
  return slots
}

function planReadGroups(regions: readonly PreparedRegion[]) {
  const groups: PreparedRegion[][] = []
  let current: PreparedRegion[] = [], currentBytes = 0, currentRows = 0
  const descriptorMaximum = (region: PreparedRegion) => {
    let bytes = 0, rows = 0
    for (const chunk of region.manifest.chunks) { bytes = Math.max(bytes, chunk.bytes); rows = Math.max(rows, chunk.rows) }
    return { bytes, rows }
  }
  for (const region of regions) {
    const maximum = descriptorMaximum(region)
    if (current.length && (current.length >= capacity.maxCatalogsPerChart ||
        currentBytes + maximum.bytes > capacity.defaultInFlightBytes || currentRows + maximum.rows > capacity.defaultInFlightRows)) {
      groups.push(current); current = []; currentBytes = 0; currentRows = 0
    }
    current.push(region); currentBytes += maximum.bytes; currentRows += maximum.rows
  }
  if (current.length) groups.push(current)
  return groups.map(group => {
    const maxima = group.map(descriptorMaximum), extraBytes = capacity.defaultInFlightBytes - maxima.reduce((sum, item) => sum + item.bytes, 0)
    const extraRows = capacity.defaultInFlightRows - maxima.reduce((sum, item) => sum + item.rows, 0)
    return {
      regions: group,
      byteBudgets: maxima.map((item, index) => item.bytes + Math.floor(extraBytes / group.length) + (index < extraBytes % group.length ? 1 : 0)),
      rowBudgets: maxima.map((item, index) => item.rows + Math.floor(extraRows / group.length) + (index < extraRows % group.length ? 1 : 0)),
    }
  })
}

function waitForRegionTurn(turn: Promise<void>, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', cancel)
      if (error !== undefined) reject(error)
      else resolve()
    }
    const cancel = () => finish(signal.reason ?? new DOMException('Gaia loading cancelled', 'AbortError'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    void turn.then(() => signal.aborted ? cancel() : finish(), finish)
  })
}

async function fetchRegionManifest(value: string, signal: AbortSignal, checkDeadline: () => void): Promise<PreparedRegion> {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid Gaia manifest URL')
  const response = await fetch(url, { signal, redirect: 'error' })
  try { checkDeadline() } catch (error) { await response.body?.cancel().catch(() => undefined); throw error }
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`Gaia manifest HTTP ${response.status}`) }
  const bytes = await readBounded(response, 'application/json', capacity.maxManifestBytes, signal)
  checkDeadline()
  const manifest = decodeGaiaManifest(bytes), manifestSha256 = await gaiaHash(bytes)
  checkDeadline()
  const originalManifestJson = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  return { manifest, manifestSha256, originalManifestJson, manifestBytes: bytes.byteLength,
    source: { kind: 'remote-url', url: url.href }, baseUrl: new URL('./', url).href }
}

function wakeUploadCreditWaiters() {
  while (uploadCreditWaiters.length) uploadCreditWaiters.shift()?.()
}

function pendingUploadRows() {
  let rows = 0
  for (const upload of pendingUploads.values()) rows += upload.rows
  return rows
}

async function waitForUploadCredit(signal: AbortSignal, rows: number) {
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > GAIA_UPLOAD_MAX_ROWS) throw new Error('Gaia upload row reservation exceeds its budget')
  while (pendingUploads.size >= GAIA_UPLOAD_SLOTS || pendingUploadRows() + rows > GAIA_UPLOAD_MAX_ROWS) {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', cancel)
        const index = uploadCreditWaiters.indexOf(onCredit)
        if (index >= 0) uploadCreditWaiters.splice(index, 1)
        if (error !== undefined) reject(error)
        else resolve()
      }
      const cancel = () => finish(signal.reason ?? new DOMException('Gaia loading cancelled', 'AbortError'))
      const onCredit = () => finish()
      uploadCreditWaiters.push(onCredit)
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })
  }
}

function waitForUpload(
  sequenceNumber: number,
  rows: number,
  signal: AbortSignal,
  controller: AbortController,
  peaks: { pendingChunks: number; pendingInputRows: number },
): Promise<void> {
  let resolvePromise!: () => void, rejectPromise!: (error: unknown) => void
  const promise = new Promise<void>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject })
  let settled = false
  const finish = (error?: unknown) => {
    if (settled) return
    settled = true; clearTimeout(timeout)
    signal.removeEventListener('abort', cancel)
    if (pendingUploads.get(sequenceNumber)?.finish === finish) pendingUploads.delete(sequenceNumber)
    wakeUploadCreditWaiters()
    if (error !== undefined) rejectPromise(error)
    else resolvePromise()
  }
  const cancel = () => finish(signal.reason ?? new DOMException('Gaia loading cancelled', 'AbortError'))
  const timeout = setTimeout(() => {
    const error = new Error('Gaia display upload acknowledgement timed out after 30 seconds')
    finish(error); controller.abort(error)
  }, 30000)
  signal.addEventListener('abort', cancel, { once: true })
  pendingUploads.set(sequenceNumber, { finish, promise, rows })
  peaks.pendingChunks = Math.max(peaks.pendingChunks, pendingUploads.size)
  peaks.pendingInputRows = Math.max(peaks.pendingInputRows, pendingUploadRows())
  // The load drains this promise after streaming. Handle cancellation before
  // that drain without surfacing an unhandled rejection in the worker.
  void promise.catch(() => undefined)
  if (signal.aborted) cancel()
  return promise
}

scope.onmessage = async event => {
  if (event.data?.type === 'ack') {
    const pending = Number.isSafeInteger(event.data.sequence) && event.data.sequence > 0
      ? pendingUploads.get(event.data.sequence) : undefined
    if (started && pending) pending.finish()
    return
  }
  if (started) return
  started = true
  sequence = 0
  const controller = new AbortController()
  const uploadPeaks = { pendingChunks: 0, pendingInputRows: 0 }
  const manifestDeadline = performance.now() + 30000
  const manifestTimeout = () => new Error('Gaia manifest preparation exceeded 30 seconds')
  const checkManifest = () => {
    if (performance.now() >= manifestDeadline) controller.abort(manifestTimeout())
    controller.signal.throwIfAborted()
  }
  const manifestTimer = setTimeout(() => controller.abort(manifestTimeout()), 30000)
  try {
    checkManifest()
    const request = validateGaiaLoadRequest(event.data)
    const localFiles = request.files ? new Map<string, File>(request.files.map(file => [file.name, file])) : undefined
    let regions: PreparedRegion[]
    if (localFiles) {
      const file = localFiles.get('manifest.json')
      if (!file) throw new Error('Missing Gaia manifest')
      const bytes = new Uint8Array(await readScientificSourceFile(file, controller.signal, capacity.maxManifestBytes))
      checkManifest()
      const manifest = decodeGaiaManifest(bytes), manifestSha256 = await gaiaHash(bytes)
      checkManifest()
      regions = [{ manifest, manifestSha256,
        originalManifestJson: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
        manifestBytes: bytes.byteLength, source: { kind: 'local-files', files: [...localFiles.keys()].sort() },
        baseUrl: 'https://local-gaia.invalid/', localFiles }]
    } else {
      const urls = request.manifestUrls ?? [request.manifestUrl!]
      regions = await Promise.all(urls.map(url => fetchRegionManifest(url, controller.signal, checkManifest)))
    }
    checkManifest()
    const totalManifestBytes = regions.reduce((sum, region) => sum + region.manifestBytes, 0)
    if (totalManifestBytes > capacity.maxCollectionManifestBytes) throw new Error('Gaia manifest collection exceeds its aggregate byte budget')
    const plan = planGaiaCollection(regions.map(region => region.manifest))
    checkManifest()
    post({ type: 'manifest', regions: regions.map(({ manifest, manifestSha256, originalManifestJson, manifestBytes, source }) => ({ manifest, manifestSha256, originalManifestJson, manifestBytes, source })),
      declaredRows: plan.declaredRows, selectedBytes: plan.selectedBytes, chunkCount: plan.chunkCount, totalManifestBytes, projection: plan.projection })
    clearTimeout(manifestTimer)

    // Each region stream already rejects duplicate IDs across its own chunks.
    // Keep a second, collection-wide index only when IDs can repeat between regions.
    const seenSourceIds = regions.length > 1 ? new Set<bigint>() : undefined
    const summaries: Awaited<ReturnType<typeof streamGaiaChunks>>[] = []
    const streamActivity = { bytes: 0, rows: 0, chunks: 0, peakBytes: 0, peakRows: 0, peakChunks: 0 }
    const onReservationChange = (bytes: number, rows: number, chunks: number) => {
      streamActivity.bytes += bytes; streamActivity.rows += rows; streamActivity.chunks += chunks
      streamActivity.peakBytes = Math.max(streamActivity.peakBytes, streamActivity.bytes)
      streamActivity.peakRows = Math.max(streamActivity.peakRows, streamActivity.rows)
      streamActivity.peakChunks = Math.max(streamActivity.peakChunks, streamActivity.chunks)
    }
    const activeReadsByManifest = regions.map(() => 0)
    const sourceReadActivity = { reads: 0, manifests: 0, peakReads: 0, peakManifests: 0 }
    const onSourceReadChange = (catalogIndex: number, delta: number) => {
      const prior = activeReadsByManifest[catalogIndex], next = prior + delta
      if (next < 0) throw new Error('Gaia source-read activity counter underflow')
      if (prior === 0 && next > 0) sourceReadActivity.manifests++
      if (prior > 0 && next === 0) sourceReadActivity.manifests--
      activeReadsByManifest[catalogIndex] = next
      sourceReadActivity.reads += delta
      sourceReadActivity.peakReads = Math.max(sourceReadActivity.peakReads, sourceReadActivity.reads)
      sourceReadActivity.peakManifests = Math.max(sourceReadActivity.peakManifests, sourceReadActivity.manifests)
    }
    let uniqueRows = 0, duplicateRows = 0
    const readGroups = planReadGroups(regions)
    const maxConcurrentManifests = Math.max(...readGroups.map(group => group.regions.length))
    let groupStart = 0
    for (const readGroup of readGroups) {
      const group = readGroup.regions
      const slots = allocateChunkSlots(group, capacity.maxParallelChunks)
      const turns = group.map(() => {
        let release!: () => void
        const done = new Promise<void>(resolve => { release = resolve })
        return { done, release }
      })
      const groupResults = await Promise.allSettled(group.map(async (region, groupIndex) => {
        const catalogIndex = groupStart + groupIndex
        const readChunk = region.localFiles ? async (name: string, expectedBytes: number, signal: AbortSignal) => {
          signal.throwIfAborted()
          const file = region.localFiles!.get(name)
          if (!file) throw new Error(`Missing Gaia chunk: ${name}`)
          if (file.size !== expectedBytes) throw new Error(`Gaia local chunk size differs from manifest: ${name}`)
          return new Uint8Array(await readScientificSourceFile(file, signal, expectedBytes))
        } : undefined
        try {
          return await streamGaiaChunks({ manifest: region.manifest, baseUrl: region.baseUrl, signal: controller.signal,
            readChunk, cache: region.localFiles ? undefined : cache,
            includeDirections: false, retainSourceIdStrings: false,
            concurrency: Math.max(1, slots[groupIndex]), maxInFlightBytes: readGroup.byteBudgets[groupIndex], maxInFlightRows: readGroup.rowBudgets[groupIndex],
            onReservationChange,
            onSourceReadChange: delta => onSourceReadChange(catalogIndex, delta),
            waitForDecodeTurn: groupIndex === 0 ? undefined : signal => waitForRegionTurn(turns[groupIndex - 1].done, signal),
            region: { raStartDeg: 0, raEndDeg: 360, decMinDeg: -90, decMaxDeg: 90, epochJulianYear: 2016 },
            onChunk: async (chunk, chunkSignal) => {
              chunkSignal.throwIfAborted()
              await waitForUploadCredit(chunkSignal, chunk.descriptor.rows)
              chunkSignal.throwIfAborted()
              const packed = await packGaiaSourcesAndDisplay(chunk, region.manifest.schemaVersion,
                { ...plan.projection, maximumRadiusDeg: capacity.maxProjectionRadiusDegrees }, chunkSignal, seenSourceIds)
              uniqueRows += packed.sources.rowCount; duplicateRows += packed.duplicateRows
              sequence++
              const ack = waitForUpload(sequence, chunk.descriptor.rows, chunkSignal, controller, uploadPeaks)
              try {
                chunkSignal.throwIfAborted()
                post({ type: 'chunk', catalogIndex, sequence, path: chunk.descriptor.path, inputRows: chunk.descriptor.rows,
                  duplicateRows: packed.duplicateRows, sources: packed.sources, display: packed.display },
                [packed.sources.sourceIds.buffer, packed.sources.values.buffer, packed.sources.nullFlags.buffer, packed.display.buffer])
                // Source columns and display coordinates have transferred. The bounded
                // upload-credit window permits later worker packing to overlap GPU work.
                chunk.sources = []
                chunk.sourceIds = new BigInt64Array(0)
                chunk.directionsICRS = new Float64Array(0)
              } catch (error) { controller.abort(error); await ack.catch(() => undefined); throw error }
            } })
        } catch (error) {
          controller.abort(error)
          throw error
        } finally {
          if (groupIndex > 0) await turns[groupIndex - 1].done
          turns[groupIndex].release()
        }
      }))
      const groupSummaries: Awaited<ReturnType<typeof streamGaiaChunks>>[] = []
      for (const result of groupResults) {
        if (result.status === 'rejected') throw result.reason
        groupSummaries.push(result.value)
      }
      summaries.push(...groupSummaries)
      controller.signal.throwIfAborted()
      groupStart += group.length
    }
    if (streamActivity.bytes !== 0 || streamActivity.rows !== 0 || streamActivity.chunks !== 0 ||
        sourceReadActivity.reads !== 0 || sourceReadActivity.manifests !== 0) {
      throw new Error('Gaia collection resource reservations did not drain')
    }
    await Promise.all(Array.from(pendingUploads.values(), item => item.promise))
    const summary = summaries[0]
    if (!summary) throw new Error('Gaia collection has no region summaries')
    const selectedPaths = summaries.flatMap((item, index) => item.selection.selectedPaths.map(path => `${index}:${path}`))
    const verifiedRows = summaries.reduce((sum, item) => sum + item.verifiedRows, 0)
    const verifiedChunks = summaries.reduce((sum, item) => sum + item.verifiedChunks, 0)
    const complete = {
      ...summary,
      selection: { ...summary.selection, selectedPaths,
        omittedManifestChunks: summaries.reduce((sum, item) => sum + item.selection.omittedManifestChunks, 0),
        allManifestChunksVerified: summaries.every(item => item.selection.allManifestChunksVerified),
        limitation: 'Every selected region manifest and chunk was verified. Overlapping source IDs were counted once, keeping the first manifest occurrence. This does not establish sky or catalog completeness.' },
      selectedChunks: summaries.reduce((sum, item) => sum + item.selectedChunks, 0),
      verifiedChunks, verifiedRows,
      totalBytes: summaries.reduce((sum, item) => sum + item.totalBytes, 0),
      peakReservedBytes: streamActivity.peakBytes,
      peakReservedRows: streamActivity.peakRows,
      peakActiveChunks: streamActivity.peakChunks,
      loadingBudget: { concurrency: capacity.maxParallelChunks, maxInFlightBytes: capacity.defaultInFlightBytes,
        maxInFlightRows: capacity.defaultInFlightRows, maxTotalBytes: capacity.maxSelectedBytes },
      sourceReadWindow: { maxConcurrentManifests, peakConcurrentManifests: sourceReadActivity.peakManifests },
      cacheHits: summaries.reduce((sum, item) => sum + item.cacheHits, 0),
      cacheHitBytes: summaries.reduce((sum, item) => sum + item.cacheHitBytes, 0),
      sourceReadChunks: summaries.reduce((sum, item) => sum + item.sourceReadChunks, 0),
      sourceReadBytes: summaries.reduce((sum, item) => sum + item.sourceReadBytes, 0),
      cacheRetainedBytes: cache.retainedBytes,
      manifestCount: regions.length, uniqueRows, duplicateRows,
      deduplication: 'first-manifest-order-by-gaia-source-id' as const,
      uploadWindow: {
        maxPendingChunks: GAIA_UPLOAD_SLOTS,
        maxInputRows: GAIA_UPLOAD_MAX_ROWS,
        peakPendingChunks: uploadPeaks.pendingChunks,
        peakPendingInputRows: uploadPeaks.pendingInputRows,
      },
    }
    if (verifiedRows !== plan.declaredRows || complete.totalBytes !== plan.selectedBytes || verifiedChunks !== plan.chunkCount ||
        uniqueRows + duplicateRows !== verifiedRows || selectedPaths.length !== plan.chunkCount) throw new Error('Gaia region summaries do not reconcile with aggregate admission')
    post({ type: 'done', summary: complete })
  } catch (error) { post({ type: 'error', error: String(error) }) }
  finally { clearTimeout(manifestTimer); controller.abort(); started = false }
}
