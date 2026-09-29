// Real built application + immutable local MPC release. Local HTTP throughput
// and headless callback cadence are not public-network or display-FPS evidence.
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
const output = resolve(option('--output', '.cache/catalog-stream-app.json'))
const screenshotOutput = output.replace(/\.json$/i, '') + '.png'
const failureOutput = output.replace(/\.json$/i, '') + '.failure.json'
const profileOutput = args.includes('--cpu-profile') ? output.replace(/\.json$/i, '') + '.cpuprofile' : null
const GPU_TIMER_SAMPLE_STRIDE = 4
const graphicsMode = option('--graphics', 'default')
const detailMode = option('--detail', 'all')
const coordinateMode = option('--mode', '2d')
const sourcePriority = option('--priority', 'source')
const requestedBudgetMiB = Number(option('--budget-mib', '0'))
if (![0, 64, 128, 256, 384, 512].includes(requestedBudgetMiB)) throw new Error('Invalid catalog budget; use a supported UI budget in MiB')
const steadySeconds = Number(option('--steady-seconds', '0'))
if (!Number.isSafeInteger(steadySeconds) || steadySeconds < 0 || steadySeconds > 300) throw new Error('Invalid steady-state window; use an integer from 0 to 300 seconds')
const epochSeconds = Number(option('--epoch-seconds', '0'))
if (!Number.isSafeInteger(epochSeconds) || epochSeconds < 0 || epochSeconds > 300 || epochSeconds > 0 && epochSeconds < 5) {
  throw new Error('Invalid retained-epoch window; use 0 or an integer from 5 to 300 seconds')
}
const playbackStartJulianDay = 2461306.5
const playbackRateDaysPerSecond = 0.001
const cancelProbe = args.includes('--cancel-probe')
const retainEpochs = args.includes('--retain-epochs')
if (epochSeconds > 0 && !retainEpochs) throw new Error('--epoch-seconds requires --retain-epochs')
if (epochSeconds > 0 && (steadySeconds > 0 || cancelProbe)) throw new Error('--epoch-seconds cannot be combined with --steady-seconds or --cancel-probe')
if (!['source', 'neo-first', 'pha-first'].includes(sourcePriority)) throw new Error('Invalid source priority')
if (!['2d', '3d'].includes(coordinateMode)) throw new Error('Invalid coordinate mode')
const attributeBytesPerPoint = coordinateMode === '3d' ? 28 : 24
if (!['all', 'spatial'].includes(detailMode)) throw new Error('Invalid detail mode')
if (!['default', 'd3d11'].includes(graphicsMode) || graphicsMode === 'd3d11' && process.platform !== 'win32') throw new Error('Invalid graphics mode')
if ([output, screenshotOutput, failureOutput, ...(profileOutput ? [profileOutput] : [])].some(existsSync)) throw new Error('Report artifacts already exist; choose a new output path')
const sha = value => createHash('sha256').update(value).digest('hex')
const pointer = JSON.parse(readFileSync('public/data/asteroids/dataset-version.json', 'utf8'))
const manifestFile = resolve('public/data/asteroids', pointer.manifestPath)
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const requestedRows = Number(option('--rows', manifest.totalCount))
if (![30_000, 100_000, 300_000, 1_000_000, manifest.totalCount].includes(requestedRows) || requestedRows > manifest.totalCount) throw new Error('Invalid source row tier')
const requiredShards = Math.ceil(requestedRows / manifest.chunkSize)
const maximumFetchedShards = Math.min(manifest.chunkCount, requiredShards + 3)
const checksums = readFileSync(resolve(dirname(manifestFile), 'checksums.json'))
const roots = { assets: resolve('dist'), data: resolve('public') }
// Fingerprint what this run serves, independently of the source checkout.
// This identifies a stale build but does not assert source/build equivalence.
const builtAssets = {}
const fingerprintBuiltAssets = (directory, prefix = '') => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name), relative = prefix + entry.name
    if (entry.isDirectory()) fingerprintBuiltAssets(path, relative + '/')
    else if (entry.isFile()) builtAssets[relative] = sha(readFileSync(path))
    else throw new Error('Unsupported built asset entry')
  }
}
builtAssets['index.html'] = sha(readFileSync(resolve(roots.assets, 'index.html')))
fingerprintBuiltAssets(resolve(roots.assets, 'assets'), 'assets/')
const serverAudit = { binaryRequests: 0, binaryBytes: 0, active: 0, peak: 0, artifactActive: 0, artifactRequests: 0 }
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const relative = pathname.startsWith('/solar/') ? pathname.slice('/solar/'.length) : ''
  const root = relative.startsWith('data/') ? roots.data : roots.assets
  const file = resolve(root, relative || 'index.html')
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end(); return }
  if (relative.startsWith('data/asteroids/')) {
    serverAudit.artifactActive++; serverAudit.artifactRequests++
    response.once('close', () => { serverAudit.artifactActive-- })
  }
  const isBinary = relative.includes('/binary/chunk-')
  if (isBinary) {
    serverAudit.binaryRequests++; serverAudit.binaryBytes += statSync(file).size
    serverAudit.active++; serverAudit.peak = Math.max(serverAudit.peak, serverAudit.active)
    response.once('close', () => { serverAudit.active-- })
  }
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[extname(file)] ?? 'application/octet-stream'
  response.writeHead(200, { 'Content-Type': mime, 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' })
  const stream = createReadStream(file)
  response.on('close', () => stream.destroy())
  stream.on('error', error => response.destroy(error)); stream.pipe(response)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser, page, effectiveBudgetBytes = null, effectiveRetainEpochs = null, profiler
let stage = 'browser-launch'
const errors = [], requests = []
const pendingArtifactRequests = new Set()
try {
  const launchOptions = graphicsMode === 'd3d11' ? { channel: 'chromium', args: ['--use-angle=d3d11'] } : {}
  browser = await chromium.launch(launchOptions)
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.url().includes('/data/asteroids/')) { requests.push(new URL(request.url()).pathname); pendingArtifactRequests.add(request) }
  })
  page.on('requestfinished', request => pendingArtifactRequests.delete(request))
  page.on('requestfailed', request => pendingArtifactRequests.delete(request))
  await page.addInitScript((gpuTimerSampleStride) => {
    localStorage.setItem('solar-atlas-first-run-v1', 'complete')
    const audit = { active: false, intervals: [], longTasks: [], uploads: [], draws: [], allocations: 0, allocationBytes: 0, uploadBytes: 0, glErrors: [], graphics: null, litPixels: null, submittedPoints: 0, firstVisibleMs: null, pendingTiles: 0, peakPendingTiles: 0, indexBytes: 0, peakIndexBytes: 0, indexUploadBytes: 0, workerPerformanceMs: null, initialLoadReceipt: null, epochUpdates: [], epochUpdateDroppedCount: 0, liveDisplaySampling: false, liveDisplaySamples: [], liveDisplaySampleDroppedCount: 0, lastLiveDisplaySampleAtMs: -Infinity }
    audit.gpuTimer = { status: 'not-probed', drawCalls: 0, sampledDrawCalls: 0, unsampledDrawCalls: 0, queryBusySkips: 0,
      droppedSamples: 0, disjointObservations: 0, invalidatedQueries: 0, queryFailures: 0, pendingQueries: 0, peakPendingQueries: 0, samples: [] }
    window.streamAudit = audit
    const epochUpdatesById = new Map()
    const maximumEpochUpdateReceipts = 128
    const heap = { status: 'unavailable', samples: 0, firstUsedBytes: null, lastUsedBytes: null, peakObservedUsedBytes: null,
      peakObservedTotalBytes: null, reportedLimitBytes: null, firstAtMs: null, lastAtMs: null }
    audit.heap = heap
    let lastHeapSample = -Infinity
    window.streamSampleHeap = () => {
      const memory = performance.memory
      if (!memory || ![memory.usedJSHeapSize, memory.totalJSHeapSize, memory.jsHeapSizeLimit].every(value => Number.isFinite(value) && value >= 0)) return
      const now = performance.now(), used = memory.usedJSHeapSize
      if (!heap.samples) { heap.firstUsedBytes = used; heap.firstAtMs = now-window.streamStart }
      heap.status = 'observed'; heap.samples++
      heap.lastUsedBytes = used; heap.lastAtMs = now-window.streamStart
      heap.peakObservedUsedBytes = Math.max(heap.peakObservedUsedBytes ?? 0, used)
      heap.peakObservedTotalBytes = Math.max(heap.peakObservedTotalBytes ?? 0, memory.totalJSHeapSize)
      heap.reportedLimitBytes = memory.jsHeapSizeLimit
      if (Array.isArray(window.streamSteadyHeapSamples)) window.streamSteadyHeapSamples.push({ usedBytes: used, totalBytes: memory.totalJSHeapSize })
      lastHeapSample = now
    }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        this.isCatalogStream = String(url).includes('catalog-stream.worker')
        this.cancelProbe = this.isCatalogStream ? window.streamCancelProbe : null
        if (this.isCatalogStream) this.addEventListener('message', event => {
          if (event.data.type === 'tile') { audit.pendingTiles++; audit.peakPendingTiles = Math.max(audit.peakPendingTiles, audit.pendingTiles) }
          if (event.data.type === 'done') {
            audit.workerPerformanceMs = event.data.performanceMs ?? null
            audit.initialLoadReceipt = {
              receivedAtMs: performance.now() - window.streamStart,
              complete: event.data.complete === true,
              sourceRows: event.data.sourceRows,
              drawnRows: event.data.drawnRows,
              retainedEpochs: event.data.retainedEpochs === true,
              workerPerformanceMs: event.data.performanceMs ?? null,
              audit: { allocations: audit.allocations, allocationBytes: audit.allocationBytes, uploadBytes: audit.uploadBytes,
                pendingTiles: audit.pendingTiles, peakPendingTiles: audit.peakPendingTiles, indexBytes: audit.indexBytes,
                peakIndexBytes: audit.peakIndexBytes, indexUploadBytes: audit.indexUploadBytes,
                glErrors: [...audit.glErrors], graphics: audit.graphics,
                uploadCount: audit.uploads.length, drawCount: audit.draws.length, intervalCount: audit.intervals.length,
                longTaskCount: audit.longTasks.length, longTaskTimelineCount: audit.longTaskTimeline.length,
                submittedPoints: audit.submittedPoints, firstVisibleMs: audit.firstVisibleMs }
            }
          }
          const update = epochUpdatesById.get(event.data.requestId)
          if (update) {
            const now = performance.now() - window.streamStart
            if (event.data.type === 'epoch-start') {
              update.status = 'started'; update.startedAtMs = now; update.sourceRows = event.data.count
            } else if (event.data.type === 'epoch-tile') {
              update.tileCount++; update.computedRows += event.data.count
              update.transferredPositionBytes += event.data.positions?.byteLength ?? 0
            } else if (event.data.type === 'epoch-reuse') {
              update.reusedBlockCount++; update.reusedRows += event.data.count
            } else if (event.data.type === 'epoch-done') {
              update.status = 'done'; update.finishedAtMs = now
              update.supersededAtMs = null; update.supersededByRequestId = null
              update.workerTimingMs = event.data.workerTimingMs ?? null
              update.blockCount = event.data.blockEpochs ? event.data.blockEpochs.length / 4 : null
              update.recomputedRows = event.data.recomputedRows ?? null
              update.reusedRows = event.data.reusedRows ?? update.reusedRows
              update.maximumDisplacementAU = event.data.maximumDisplacementAU ?? null
              update.computedEpochRange = event.data.computedEpochRange ?? null
            } else if (event.data.type === 'epoch-error') {
              update.status = 'error'; update.finishedAtMs = now
              update.supersededAtMs = null; update.supersededByRequestId = null
              update.error = String(event.data.error ?? 'Unknown epoch update error').slice(0, 1024)
            }
          }
          const probe = this.cancelProbe
          if (!probe) return
          const now = performance.now()
          if (event.data.type === 'tile') {
            if (probe.requestedAtMs !== null) probe.tilesAfterRequest++
            if (!probe.triggered) {
              probe.triggered = true; probe.firstTileAtMs = now
              queueMicrotask(() => {
                const button = document.querySelector('[data-testid="catalog-stream-cancel"]')
                if (!button || button.disabled) { probe.error = 'Cancellation control unavailable at first tile'; return }
                button.click()
              })
            }
          }
          if (['cancelled', 'done', 'error'].includes(event.data.type)) {
            probe.terminalType = event.data.type; probe.terminalAtMs = now
          }
        })
        if (this.cancelProbe) {
          this.addEventListener('error', event => { this.cancelProbe.error = event.message || 'Worker execution failed' })
          this.addEventListener('messageerror', () => { this.cancelProbe.error = 'Worker response could not be decoded' })
        }
      }
      postMessage(data, options) {
        if (this.isCatalogStream && data.type === 'start') {
          audit.workerPerformanceMs = null
          data = { ...data, capturePerformanceReceipt: true }
        }
        if (this.isCatalogStream && data.type === 'epoch') {
          const now = performance.now() - window.streamStart
          for (const prior of audit.epochUpdates) {
            if (!['done', 'error', 'superseded'].includes(prior.status)) {
              prior.status = 'superseded'; prior.supersededAtMs = now; prior.supersededByRequestId = data.requestId
            }
          }
          if (audit.epochUpdates.length < maximumEpochUpdateReceipts) {
            const update = { requestId: data.requestId, julianDay: data.julianDay, requestedAtMs: now, status: 'requested',
              startedAtMs: null, finishedAtMs: null, supersededAtMs: null, supersededByRequestId: null,
              sourceRows: null, tileCount: 0, computedRows: 0, reusedBlockCount: 0, reusedRows: 0,
              transferredPositionBytes: 0, workerTimingMs: null, blockCount: null,
              maximumDisplacementAU: null, computedEpochRange: null, recomputedRows: null, error: null }
            audit.epochUpdates.push(update); epochUpdatesById.set(data.requestId, update)
          } else audit.epochUpdateDroppedCount++
        }
        if (this.isCatalogStream && data.type === 'ack') audit.pendingTiles--
        if (this.cancelProbe && data.type === 'start') this.cancelProbe.startedAtMs = performance.now()
        if (this.cancelProbe && data.type === 'cancel') {
          this.cancelProbe.requestedAtMs = performance.now()
          this.cancelProbe.rowsAtRequest = Number(document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-drawn-rows'))
          this.cancelProbe.uploadBytesAtRequest = audit.uploadBytes
        }
        super.postMessage(data, options)
      }
      terminate() {
        if (this.cancelProbe && this.cancelProbe.terminatedAtMs === null) this.cancelProbe.terminatedAtMs = performance.now()
        return super.terminate()
      }
    }
    let previous = 0
    const frame = now => {
      if (audit.active) {
        if (previous) audit.intervals.push(now-previous)
        if (now-lastHeapSample >= 250) window.streamSampleHeap()
        if (audit.liveDisplaySampling && now-audit.lastLiveDisplaySampleAtMs >= 100) {
          audit.lastLiveDisplaySampleAtMs = now
          const canvas = document.querySelector('[data-testid="catalog-stream-canvas"]')
          const value = name => { const raw = canvas?.getAttribute(name); return raw === null || raw === undefined ? null : Number(raw) }
          const epochLabel = document.querySelector('[data-testid="catalog-point-epoch"]')
          const epochRangeEvidence = document.querySelector('[data-testid="catalog-block-epochs"]')
          const targetJulianDay = value('data-target-utc-jd')
          const computedJulianDay = epochLabel?.getAttribute('data-utc-jd') ? Number(epochLabel.getAttribute('data-utc-jd')) : null
          const minimumComputedJulianDay = epochRangeEvidence?.getAttribute('data-min-computed-utc-jd')
          const maximumComputedJulianDay = epochRangeEvidence?.getAttribute('data-max-computed-utc-jd')
          const computedEpochRangeJulianDay = minimumComputedJulianDay !== null && maximumComputedJulianDay !== null
            && Number.isFinite(Number(minimumComputedJulianDay)) && Number.isFinite(Number(maximumComputedJulianDay))
            ? [Number(minimumComputedJulianDay), Number(maximumComputedJulianDay)] : null
          if (audit.liveDisplaySamples.length < 4096) audit.liveDisplaySamples.push({
            afterWindowStartMs: now-window.streamEpochWindowStart,
            phase: canvas?.getAttribute('data-phase') ?? null,
            sourceRows: value('data-drawn-rows'), rendererRows: value('data-display-count'),
            inViewportRows: value('data-viewport-candidates'), edgeCandidates: value('data-edge-candidates'),
            countOverlayRows: value('data-count-overlay-rows'), countOverlayCells: value('data-count-overlay-cells'),
            countOverlayMaximumCell: value('data-count-overlay-max'),
            displayMode: canvas?.getAttribute('data-display-mode') ?? null,
            selectionRows: value('data-selection-rows'), spatialPending: canvas?.getAttribute('data-spatial-pending') ?? null,
            temporalBudgetAU: value('data-temporal-budget-au'),
            targetJulianDay, computedJulianDay, computedEpochRangeJulianDay,
            maximumDisplacementAU: epochRangeEvidence?.getAttribute('data-maximum-displacement-au') === null
              ? null : Number(epochRangeEvidence?.getAttribute('data-maximum-displacement-au')),
            targetMinusComputedSimulationSeconds: Number.isFinite(targetJulianDay) && Number.isFinite(computedJulianDay)
              ? (targetJulianDay-computedJulianDay)*86400 : null,
          })
          else audit.liveDisplaySampleDroppedCount++
        }
      }
      previous = audit.active ? now : 0
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    audit.longTaskTimeline = []
    new PerformanceObserver(list => {
      if (!audit.active) return
      for (const entry of list.getEntries()) {
        audit.longTasks.push(entry.duration)
        audit.longTaskTimeline.push({ startAfterDispatchMs: entry.startTime-window.streamStart, durationMs: entry.duration })
      }
    }).observe({ type: 'longtask', buffered: false })
    const proto = WebGLRenderingContext.prototype
    const maximumGpuTimerSamples = 4096, maximumPendingGpuTimerQueries = 16
    const timerPending = []
    let timerContext = null, timerExtension = null
    const deletePendingGpuTimerQueries = () => {
      if (!timerExtension) return
      for (const pending of timerPending) {
        try { timerExtension.deleteQueryEXT(pending.query) } catch { audit.gpuTimer.queryFailures++ }
      }
      timerPending.length = 0
      audit.gpuTimer.pendingQueries = 0
    }
    const pollGpuTimerQueries = gl => {
      if (gl !== timerContext || !timerExtension) return
      let disjoint
      try { disjoint = Boolean(gl.getParameter(timerExtension.GPU_DISJOINT_EXT)) }
      catch {
        audit.gpuTimer.queryFailures++; audit.gpuTimer.status = 'partial'
        audit.gpuTimer.invalidatedQueries += timerPending.length
        deletePendingGpuTimerQueries()
        return
      }
      if (disjoint) {
        audit.gpuTimer.disjointObservations++
        audit.gpuTimer.invalidatedQueries += timerPending.length
        deletePendingGpuTimerQueries()
        return
      }
      while (timerPending.length) {
        const pending = timerPending[0]
        let available
        try { available = timerExtension.getQueryObjectEXT(pending.query, timerExtension.QUERY_RESULT_AVAILABLE_EXT) }
        catch {
          timerPending.shift()
          audit.gpuTimer.queryFailures++; audit.gpuTimer.droppedSamples++; audit.gpuTimer.status = 'partial'
          try { timerExtension.deleteQueryEXT(pending.query) } catch { audit.gpuTimer.queryFailures++ }
          continue
        }
        if (!available) break
        timerPending.shift()
        try {
          const nanoseconds = Number(timerExtension.getQueryObjectEXT(pending.query, timerExtension.QUERY_RESULT_EXT))
          timerExtension.deleteQueryEXT(pending.query)
          if (!Number.isFinite(nanoseconds) || nanoseconds < 0 || audit.gpuTimer.samples.length >= maximumGpuTimerSamples) {
            audit.gpuTimer.droppedSamples++
          } else {
            audit.gpuTimer.samples.push({ drawCall: pending.drawCall, method: pending.method, primitive: 'POINTS', submittedPoints: pending.submittedPoints,
              submittedAtMs: pending.submittedAtMs, gpuElapsedMs: nanoseconds / 1_000_000 })
          }
        } catch {
          audit.gpuTimer.queryFailures++; audit.gpuTimer.droppedSamples++; audit.gpuTimer.status = 'partial'
          try { timerExtension.deleteQueryEXT(pending.query) } catch { audit.gpuTimer.queryFailures++ }
        }
      }
      audit.gpuTimer.pendingQueries = timerPending.length
    }
    const probeGpuTimerExtension = gl => {
      if (timerContext) return gl === timerContext ? timerExtension : null
      timerContext = gl
      try { timerExtension = gl.getExtension('EXT_disjoint_timer_query') }
      catch { timerExtension = null; audit.gpuTimer.queryFailures++ }
      audit.gpuTimer.status = timerExtension ? 'available' : 'unsupported'
      return timerExtension
    }
    const beginGpuTimerQuery = (gl, method, submittedPoints) => {
      const drawCall = ++audit.gpuTimer.drawCalls
      if ((drawCall - 1) % gpuTimerSampleStride !== 0) { audit.gpuTimer.unsampledDrawCalls++; return null }
      audit.gpuTimer.sampledDrawCalls++
      const extension = probeGpuTimerExtension(gl)
      if (!extension) return null
      pollGpuTimerQueries(gl)
      if (timerPending.length >= maximumPendingGpuTimerQueries) { audit.gpuTimer.droppedSamples++; return null }
      let query = null
      try {
        if (extension.getQueryEXT(extension.TIME_ELAPSED_EXT, extension.CURRENT_QUERY_EXT) != null) {
          audit.gpuTimer.queryBusySkips++
          return null
        }
        query = extension.createQueryEXT()
        if (!query) { audit.gpuTimer.droppedSamples++; return null }
        extension.beginQueryEXT(extension.TIME_ELAPSED_EXT, query)
        return { query, method, submittedPoints, drawCall, submittedAtMs: performance.now() - window.streamStart }
      } catch {
        audit.gpuTimer.queryFailures++; audit.gpuTimer.status = 'partial'
        if (query) { try { extension.deleteQueryEXT(query) } catch { audit.gpuTimer.queryFailures++ } }
        return null
      }
    }
    const endGpuTimerQuery = pending => {
      if (!pending || !timerExtension) return
      try {
        timerExtension.endQueryEXT(timerExtension.TIME_ELAPSED_EXT)
        timerPending.push(pending)
        audit.gpuTimer.pendingQueries = timerPending.length
        audit.gpuTimer.peakPendingQueries = Math.max(audit.gpuTimer.peakPendingQueries, timerPending.length)
      } catch {
        audit.gpuTimer.queryFailures++; audit.gpuTimer.status = 'partial'
        try { timerExtension.deleteQueryEXT(pending.query) } catch { audit.gpuTimer.queryFailures++ }
      }
    }
    window.streamCollectGpuTimerSamples = () => {
      if (timerContext) pollGpuTimerQueries(timerContext)
      audit.gpuTimer.pendingQueries = timerPending.length
      return audit.gpuTimer
    }
    // Observe the application's reads without consuming its GL error state.
    // Calling getError after each instrumented upload would hide allocation
    // errors from the renderer's own rejection/cleanup path.
    const originalGetError = proto.getError
    proto.getError = function (...parameters) {
      const error = Reflect.apply(originalGetError, this, parameters)
      if (error && this.canvas.getAttribute?.('data-testid') === 'catalog-stream-canvas') audit.glErrors.push(error)
      return error
    }
    for (const method of ['bufferData', 'bufferSubData', 'drawArrays', 'drawElements']) {
      const original = proto[method]
      proto[method] = function (...parameters) {
        const isCatalogCanvas = this.canvas.getAttribute?.('data-testid') === 'catalog-stream-canvas'
        const gpuQuery = isCatalogCanvas && (method === 'drawArrays' || method === 'drawElements')
          ? beginGpuTimerQuery(this, method, method === 'drawArrays' ? parameters[2] : parameters[1]) : null
        const start = performance.now()
        let result
        try { result = Reflect.apply(original, this, parameters) }
        finally { if (gpuQuery) endGpuTimerQuery(gpuQuery) }
        if (!isCatalogCanvas) return result
        const elapsed = performance.now() - start
        if (method === 'bufferData' && parameters[0] === this.ARRAY_BUFFER) { audit.allocations++; audit.allocationBytes += typeof parameters[1] === 'number' ? parameters[1] : parameters[1].byteLength }
        if (method === 'bufferSubData' && parameters[0] === this.ARRAY_BUFFER) { audit.uploads.push(elapsed); audit.uploadBytes += parameters[2].byteLength }
        if (method === 'bufferData' && parameters[0] === this.ELEMENT_ARRAY_BUFFER) {
          const bytes = typeof parameters[1] === 'number' ? parameters[1] : parameters[1].byteLength
          audit.indexBytes = bytes; audit.peakIndexBytes = Math.max(audit.peakIndexBytes, bytes); audit.indexUploadBytes += bytes
        }
        if (method === 'bufferSubData' && parameters[0] === this.ELEMENT_ARRAY_BUFFER) audit.indexUploadBytes += parameters[2].byteLength
        if (method === 'drawArrays' || method === 'drawElements') {
          const count = method === 'drawArrays' ? parameters[2] : parameters[1]
          audit.draws.push(elapsed)
          audit.submittedPoints += count
          if (count > 0 && audit.firstVisibleMs === null) audit.firstVisibleMs = performance.now() - window.streamStart
          if (!audit.graphics) {
            const debug = this.getExtension('WEBGL_debug_renderer_info')
            audit.graphics = { version: this.getParameter(this.VERSION), renderer: debug ? this.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null }
          }
          if (window.streamCapture) {
            window.streamCapture = false
            const pixels = new Uint8Array(this.drawingBufferWidth * this.drawingBufferHeight * 4)
            this.readPixels(0, 0, this.drawingBufferWidth, this.drawingBufferHeight, this.RGBA, this.UNSIGNED_BYTE, pixels)
            let lit = 0
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 40 || pixels[i + 1] > 40 || pixels[i + 2] > 40) lit++
            audit.litPixels = lit
          }
        }
        return result
      }
    }
  }, GPU_TIMER_SAMPLE_STRIDE)
  stage = 'workspace-configuration'
  const appRoot = `http://127.0.0.1:${server.address().port}/solar/`
  if (epochSeconds > 0) {
    await page.goto(`${appRoot}?v=4&page=explorer&lang=en&jd=${playbackStartJulianDay}&speed=${playbackRateDaysPerSecond}`)
    await page.getByRole('button', { name: '▶ Play', exact: true }).click()
    await page.locator('.primary-navigation').getByRole('button', { name: /Catalog/ }).click()
  } else await page.goto(`${appRoot}?v=4&page=catalog&lang=en&jd=2461306.5`)
  await page.locator('canvas.catalog-point-canvas').waitFor()
  const budgetControl = page.getByRole('combobox', { name: 'Catalog array and GPU budget (MiB)', exact: true })
  if (requestedBudgetMiB) await budgetControl.selectOption(String(requestedBudgetMiB * 1024 * 1024))
  effectiveBudgetBytes = Number(await budgetControl.inputValue())
  const retainEpochsControl = page.getByRole('checkbox', { name: 'Retain orbits and follow time changes', exact: true })
  if ((await retainEpochsControl.isChecked()) !== retainEpochs) {
    if (retainEpochs) await retainEpochsControl.check()
    else await retainEpochsControl.uncheck()
  }
  effectiveRetainEpochs = await retainEpochsControl.isChecked()
  if (effectiveRetainEpochs !== retainEpochs) throw new Error('Retained-epoch benchmark configuration did not take effect')
  for (const [label, value] of [['a (AU): Maximum', '1000000'], ['e: Maximum', '1'], ['H: Minimum', '-100'], ['H: Maximum', '100'], ['q (AU): Maximum', '1000000']]) {
    await page.getByRole('spinbutton', { name: label, exact: true }).fill(value)
  }
  await page.getByRole('combobox', { name: 'Expanded map point limit' }).selectOption(String(requestedRows))
  await page.getByRole('combobox', { name: 'Map detail', exact: true }).selectOption(detailMode)
  await page.getByRole('combobox', { name: 'Catalog snapshot projection', exact: true }).selectOption(coordinateMode)
  await page.getByRole('combobox', { name: 'Source shard order', exact: true }).selectOption(sourcePriority)
  const startButton = page.getByRole('button', { name: /Load expanded snapshot/ })
  if (!await startButton.isEnabled()) throw new Error('Requested source tier is unavailable in this browser')
  const requestStart = requests.length
  stage = 'static-source-loading'
  if (profileOutput) {
    profiler = await page.context().newCDPSession(page)
    await profiler.send('Profiler.enable')
    await profiler.send('Profiler.start')
  }
  await page.evaluate(rows => { window.streamExpectedRows = rows; window.streamAudit.active = true; window.streamStart = performance.now(); window.streamSampleHeap() }, requestedRows)
  await startButton.click()
  const canvas = page.getByTestId('catalog-stream-canvas')
  if (epochSeconds > 0) {
    await page.waitForFunction(() => window.streamAudit?.initialLoadReceipt ||
      document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-phase') === 'error', undefined, { timeout: 120_000 })
  } else {
    await page.waitForFunction(() => ['complete', 'limited', 'error'].includes(document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-phase')), undefined, { timeout: 120_000 })
    await page.waitForFunction(() => document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-spatial-pending') === 'false', undefined, { timeout: 30_000 })
  }
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop')
    mkdirSync(dirname(profileOutput), { recursive: true })
    writeFileSync(profileOutput, JSON.stringify(profile), { flag: 'wx' })
    await profiler.detach()
    profiler = null
  }
  const result = await page.evaluate(() => {
    window.streamSampleHeap()
    window.streamAudit.active = false
    const canvas = document.querySelector('[data-testid="catalog-stream-canvas"]')
    const loadMs = performance.now() - window.streamStart
    const selectionMsValue = canvas.getAttribute('data-selection-ms')
    const spatialSelectionMs = selectionMsValue === null ? null : Number(selectionMsValue)
    const testedRowsValue = canvas.getAttribute('data-tested-rows')
    const skippedRowsValue = canvas.getAttribute('data-skipped-rows')
    const spatialWork = testedRowsValue === null || skippedRowsValue === null ? null : {
      testedRows: Number(testedRowsValue), skippedRows: Number(skippedRowsValue),
    }
    window.streamCapture = true
    canvas.dispatchEvent(new Event('solar-atlas-prepare-canvas-capture'))
    window.streamCollectGpuTimerSamples?.()
    return { phase: canvas.getAttribute('data-phase'), drawnRows: Number(canvas.getAttribute('data-drawn-rows')), displayedRows: Number(canvas.getAttribute('data-display-count')), checkedRows: Number(canvas.getAttribute('data-source-rows')), canvasSize: { width: canvas.width, height: canvas.height }, loadMs, spatialSelectionMs, spatialWork, audit: window.streamAudit, userAgent: navigator.userAgent }
  })
  const initialLoadReceipt = result.audit.initialLoadReceipt
  const initialLoadAudit = initialLoadReceipt?.audit ?? result.audit
  const auditResult = { ...result.audit, ...initialLoadAudit,
    uploads: result.audit.uploads.slice(0, initialLoadAudit.uploadCount ?? result.audit.uploads.length),
    draws: result.audit.draws.slice(0, initialLoadAudit.drawCount ?? result.audit.draws.length),
    intervals: result.audit.intervals.slice(0, initialLoadAudit.intervalCount ?? result.audit.intervals.length),
    longTasks: result.audit.longTasks.slice(0, initialLoadAudit.longTaskCount ?? result.audit.longTasks.length),
    longTaskTimeline: result.audit.longTaskTimeline.slice(0, initialLoadAudit.longTaskTimelineCount ?? result.audit.longTaskTimeline.length),
    glErrors: result.audit.glErrors,
    workerPerformanceMs: initialLoadReceipt?.workerPerformanceMs ?? result.audit.workerPerformanceMs }
  const gpuTimer = result.audit.gpuTimer
  const initialLoadGpuSamples = initialLoadReceipt
    ? gpuTimer.samples.filter(sample => sample.submittedAtMs <= initialLoadReceipt.receivedAtMs)
    : []
  const expectedPhase = requestedRows === manifest.totalCount ? 'complete' : 'limited'
  const measuredSourcePhase = initialLoadReceipt ? initialLoadReceipt.complete ? 'complete' : 'limited' : result.phase
  const measuredDrawnRows = initialLoadReceipt?.drawnRows ?? result.drawnRows
  stage = 'static-contract-checks'
  const maximumCheckedRows = Math.min(manifest.totalCount, requiredShards * manifest.chunkSize)
  if (epochSeconds > 0 && (!initialLoadReceipt || !initialLoadReceipt.retainedEpochs)) throw new Error('Retained-epoch playback did not provide a completed initial source receipt')
  if (measuredSourcePhase !== expectedPhase || measuredDrawnRows !== requestedRows || !Number.isSafeInteger(result.checkedRows) ||
      result.checkedRows < requestedRows || result.checkedRows > maximumCheckedRows || auditResult.glErrors.length || initialLoadAudit.glErrors.length ||
      epochSeconds === 0 && !result.audit.litPixels) throw new Error(JSON.stringify({ ...result, audit: { glErrors: result.audit.glErrors, litPixels: result.audit.litPixels }, errors }))
  if (epochSeconds === 0 && detailMode === 'spatial' && (!Number.isFinite(result.spatialSelectionMs) || result.spatialSelectionMs < 0)) throw new Error('Spatial mode did not report a valid worker selection duration')
  if (epochSeconds === 0 && detailMode === 'spatial' && (!result.spatialWork || !Number.isSafeInteger(result.spatialWork.testedRows) || !Number.isSafeInteger(result.spatialWork.skippedRows) ||
      result.spatialWork.testedRows < 0 || result.spatialWork.skippedRows < 0 || result.spatialWork.testedRows + result.spatialWork.skippedRows !== measuredDrawnRows)) {
    throw new Error('Spatial mode did not report consistent point-screening and block-skip counts')
  }
  if (errors.length) throw new Error(JSON.stringify(errors))
  if (graphicsMode === 'd3d11' && (!/Direct3D11/i.test(auditResult.graphics?.renderer ?? '') || /SwiftShader|software|llvmpipe|basic render/i.test(auditResult.graphics.renderer))) throw new Error('Hardware D3D11 renderer was not established')
  const expandedRequests = requests.slice(requestStart)
  const metadataRequests = expandedRequests.filter(path => /\/meta\/chunk-\d+\.json$/.test(path))
  if (metadataRequests.length !== requiredShards || new Set(metadataRequests).size !== requiredShards ||
      expandedRequests.some(path => path.includes('catalog-sample-') || path.includes('/search/') || path.includes('/lookup/'))) throw new Error('Expanded source metadata screening contract mismatch')
  if (serverAudit.binaryRequests < requiredShards || serverAudit.binaryRequests > maximumFetchedShards || auditResult.allocations !== 3 || auditResult.allocationBytes !== requestedRows * attributeBytesPerPoint || auditResult.uploadBytes !== requestedRows * attributeBytesPerPoint || auditResult.pendingTiles !== 0 || auditResult.peakPendingTiles > 4) throw new Error('Source count, GPU allocation or transfer contract mismatch')
  let epochUpdateCapture = null
  if (epochSeconds > 0) {
    stage = 'retained-epoch-observation'
    const epochRequestIndex = requests.length, initialArtifactRequests = serverAudit.artifactRequests
    const baseline = await page.evaluate(() => {
      const audit = window.streamAudit
      const canvas = document.querySelector('[data-testid="catalog-stream-canvas"]')
      const startedAt = performance.now()
      audit.active = true
      audit.liveDisplaySampling = true
      audit.lastLiveDisplaySampleAtMs = -Infinity
      window.streamEpochWindowStart = startedAt
      return { startedAt, dispatchOffsetMs: startedAt - window.streamStart,
        intervalIndex: audit.intervals.length, longTaskIndex: audit.longTasks.length,
        liveDisplaySampleIndex: audit.liveDisplaySamples.length,
        liveDisplaySampleDroppedCount: audit.liveDisplaySampleDroppedCount,
        droppedRequestCount: audit.epochUpdateDroppedCount,
        activeRequestIds: audit.epochUpdates.filter(update => !['done', 'error', 'superseded'].includes(update.status)).map(update => update.requestId),
        uploadBytes: audit.uploadBytes, spatialIndexUploadBytes: audit.indexUploadBytes, glErrorIndex: audit.glErrors.length,
        targetJulianDay: Number(canvas?.getAttribute('data-target-utc-jd')),
        epochLabel: document.querySelector('[data-testid="catalog-point-epoch"]')?.textContent?.trim() ?? null }
    })
    await page.waitForTimeout(epochSeconds * 1000)
    epochUpdateCapture = await page.evaluate(start => {
      const audit = window.streamAudit, canvas = document.querySelector('[data-testid="catalog-stream-canvas"]')
      audit.active = false; audit.liveDisplaySampling = false
      const activeAtStart = new Set(start.activeRequestIds)
      const updates = audit.epochUpdates.filter(update => update.requestedAtMs >= start.dispatchOffsetMs || activeAtStart.has(update.requestId))
      const drawnRows = canvas?.getAttribute('data-drawn-rows')
      const rendererRows = canvas?.getAttribute('data-display-count')
      const selectionRows = canvas?.getAttribute('data-selection-rows')
      return { requestedSeconds: start.requestedSeconds, actualDurationMs: performance.now() - start.startedAt,
        records: updates.map(update => ({ ...update, overlappedWindowStart: activeAtStart.has(update.requestId) && update.requestedAtMs < start.dispatchOffsetMs })),
        droppedRequestCount: audit.epochUpdateDroppedCount - start.droppedRequestCount,
        liveDisplaySamples: audit.liveDisplaySamples.slice(start.liveDisplaySampleIndex),
        liveDisplaySampleDroppedCount: audit.liveDisplaySampleDroppedCount - start.liveDisplaySampleDroppedCount,
        initialTargetJulianDay: start.targetJulianDay,
        frameIntervals: audit.intervals.slice(start.intervalIndex), longTasks: audit.longTasks.slice(start.longTaskIndex),
        attributeUploadBytesDelta: audit.uploadBytes - start.uploadBytes,
        spatialIndexUploadBytesDelta: audit.indexUploadBytes - start.spatialIndexUploadBytes,
        glErrors: audit.glErrors.slice(start.glErrorIndex),
        litPixels: audit.litPixels,
        initialEpochLabel: start.epochLabel,
        canvas: { phase: canvas?.getAttribute('data-phase') ?? null,
          drawnRows: drawnRows === undefined || drawnRows === null ? null : Number(drawnRows),
          rendererRows: rendererRows === undefined || rendererRows === null ? null : Number(rendererRows),
          selectionRows: selectionRows === undefined || selectionRows === null ? null : Number(selectionRows),
          spatialPending: canvas?.getAttribute('data-spatial-pending') ?? null,
          epochLabel: document.querySelector('[data-testid="catalog-point-epoch"]')?.textContent?.trim() ?? null } }
    }, { ...baseline, requestedSeconds: epochSeconds })
    epochUpdateCapture.additionalArtifactRequests = requests.length - epochRequestIndex
    epochUpdateCapture.additionalServerArtifactRequests = serverAudit.artifactRequests - initialArtifactRequests
    if (epochUpdateCapture.glErrors.length || errors.length) throw new Error('Retained-epoch observation recorded a renderer or page error')
  }
  let rotationAudit = null
  if (epochSeconds > 0) rotationAudit = { status: 'not-measured', reason: 'The bounded playback window uses animation callbacks for epoch cadence.' }
  else if (coordinateMode === '3d') {
    stage = 'rotation-observation'
    const beforeRequests = requests.length
    const started = performance.now()
    for (let step = 0; step < 12; step++) {
      await page.getByRole('slider', { name: 'Catalog azimuth', exact: true }).press('ArrowRight')
      await page.waitForFunction(() => document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-spatial-pending') === 'false')
    }
    const after = await page.evaluate(() => ({ allocations: window.streamAudit.allocations, uploadBytes: window.streamAudit.uploadBytes, glErrors: window.streamAudit.glErrors }))
    rotationAudit = { steps: 12, automationElapsedMs: performance.now() - started, additionalRequests: requests.length - beforeRequests, additionalAllocations: after.allocations - result.audit.allocations, additionalAttributeUploadBytes: after.uploadBytes - result.audit.uploadBytes }
    if (rotationAudit.additionalRequests || rotationAudit.additionalAllocations || rotationAudit.additionalAttributeUploadBytes || after.glErrors.length || errors.length) throw new Error('Rotation reloaded source data, reuploaded attributes or failed rendering')
  }
  let sustainedCapture = null
  if (steadySeconds > 0) {
    stage = 'steady-state-observation'
    const harnessStartedAt = performance.now()
    const baseline = await page.evaluate(() => {
      window.streamAudit.active = true
      window.streamSteadyHeapSamples = []
      const audit = window.streamAudit, memory = performance.memory
      return { startedAt: performance.now(), intervalIndex: audit.intervals.length, longTaskIndex: audit.longTasks.length,
        longTaskTimelineIndex: audit.longTaskTimeline.length, allocationCount: audit.allocations,
        attributeUploadBytes: audit.uploadBytes, spatialIndexUploadBytes: audit.indexUploadBytes,
        glErrorIndex: audit.glErrors.length, heapUsedBytes: memory && Number.isFinite(memory.usedJSHeapSize) ? memory.usedJSHeapSize : null }
    })
    const requestIndex = requests.length
    const cameraInteractions = coordinateMode === '3d' ? 12 : 0
    const selectionDurationsMs = []
    const selectionWorkSamples = []
    const intervalMs = steadySeconds * 1000 / Math.max(1, cameraInteractions)
    for (let step = 0; step < cameraInteractions; step++) {
      await page.waitForTimeout(intervalMs)
      await page.getByRole('slider', { name: 'Catalog azimuth', exact: true }).press('ArrowRight')
      await page.waitForFunction(() => document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-spatial-pending') === 'false')
      const canvas = page.getByTestId('catalog-stream-canvas')
      selectionDurationsMs.push(Number(await canvas.getAttribute('data-selection-ms')))
      const workSample = {
        drawnRows: Number(await canvas.getAttribute('data-drawn-rows')),
        testedRows: await canvas.getAttribute('data-tested-rows'),
        skippedRows: await canvas.getAttribute('data-skipped-rows'),
        displayedRows: Number(await canvas.getAttribute('data-display-count')),
      }
      if (detailMode === 'spatial' && (workSample.testedRows === null || workSample.skippedRows === null ||
          !Number.isSafeInteger(Number(workSample.testedRows)) || !Number.isSafeInteger(Number(workSample.skippedRows)) ||
          Number(workSample.testedRows) < 0 || Number(workSample.skippedRows) < 0 ||
          Number(workSample.testedRows) + Number(workSample.skippedRows) !== workSample.drawnRows)) {
        throw new Error('Spatial rotation did not report consistent point-screening and block-skip counts')
      }
      selectionWorkSamples.push({ ...workSample,
        testedRows: workSample.testedRows === null ? null : Number(workSample.testedRows),
        skippedRows: workSample.skippedRows === null ? null : Number(workSample.skippedRows),
      })
    }
    if (cameraInteractions === 0) await page.waitForTimeout(steadySeconds * 1000)
    const harnessElapsedMs = performance.now() - harnessStartedAt
    sustainedCapture = await page.evaluate(start => {
      const audit = window.streamAudit, memory = performance.memory
      const heapSamples = window.streamSteadyHeapSamples ?? []
      window.streamSteadyHeapSamples = null
      const capture = { actualDurationMs: performance.now() - start.startedAt,
        intervals: audit.intervals.slice(start.intervalIndex), longTasks: audit.longTasks.slice(start.longTaskIndex),
        longTaskTimeline: audit.longTaskTimeline.slice(start.longTaskTimelineIndex),
        allocationDelta: audit.allocations - start.allocationCount,
        attributeUploadBytesDelta: audit.uploadBytes - start.attributeUploadBytes,
        spatialIndexUploadBytesDelta: audit.indexUploadBytes - start.spatialIndexUploadBytes,
        glErrors: audit.glErrors.slice(start.glErrorIndex), heapSamples,
        heapUsedAtStartBytes: start.heapUsedBytes,
        heapUsedAtEndBytes: memory && Number.isFinite(memory.usedJSHeapSize) ? memory.usedJSHeapSize : null }
      audit.active = false
      return capture
    }, baseline)
    if (sustainedCapture.intervals.length === 0) throw new Error('Sustained window recorded no animation-frame intervals')
    sustainedCapture.requestedSeconds = steadySeconds
    sustainedCapture.harnessElapsedMs = harnessElapsedMs
    sustainedCapture.cameraInteractions = cameraInteractions
    sustainedCapture.spatialSelectionSamplesMs = selectionDurationsMs
    sustainedCapture.spatialSelectionWorkSamples = selectionWorkSamples
    sustainedCapture.additionalArtifactRequests = requests.length - requestIndex
  }
  const summary = values => {
    const sorted = [...values].sort((a, b) => a - b), q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
    return { count: sorted.length, p50Ms: q(.5), p95Ms: q(.95), p99Ms: q(.99), maxMs: sorted.at(-1) ?? null }
  }
  const summarySeconds = values => {
    const sorted = [...values].sort((a, b) => a - b), q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
    return { count: sorted.length, p50Seconds: q(.5), p95Seconds: q(.95), p99Seconds: q(.99), maxSeconds: sorted.at(-1) ?? null }
  }
  const summaryAU = values => {
    const sorted = [...values].sort((a, b) => a - b), q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
    return { count: sorted.length, p50AU: q(.5), p95AU: q(.95), p99AU: q(.99), maxAU: sorted.at(-1) ?? null }
  }
  const sustainedDisplay = sustainedCapture === null ? null : {
    status: 'observed', requestedSeconds: sustainedCapture.requestedSeconds, actualDurationMs: sustainedCapture.actualDurationMs,
    harnessElapsedMs: sustainedCapture.harnessElapsedMs, cameraInteractions: sustainedCapture.cameraInteractions,
    frameIntervals: summary(sustainedCapture.intervals),
    lateFrameCallbacks: { thresholdMs: 25, count: sustainedCapture.intervals.filter(value => value > 25).length,
      ratio: sustainedCapture.intervals.length ? sustainedCapture.intervals.filter(value => value > 25).length / sustainedCapture.intervals.length : null,
      interpretation: 'Intervals over 25 ms are a missed-cadence proxy, not physical dropped-frame measurement.' },
    longTasks: summary(sustainedCapture.longTasks), longTaskTimeline: sustainedCapture.longTaskTimeline,
    heap: { samples: sustainedCapture.heapSamples.length, startUsedBytes: sustainedCapture.heapUsedAtStartBytes,
      endUsedBytes: sustainedCapture.heapUsedAtEndBytes,
      peakSampledUsedBytes: sustainedCapture.heapSamples.reduce((peak, sample) => Math.max(peak, sample.usedBytes), 0) },
    spatialSelection: summary(sustainedCapture.spatialSelectionSamplesMs), spatialSelectionWorkSamples: sustainedCapture.spatialSelectionWorkSamples,
    additionalArtifactRequests: sustainedCapture.additionalArtifactRequests,
    allocationDelta: sustainedCapture.allocationDelta, attributeUploadBytesDelta: sustainedCapture.attributeUploadBytesDelta,
    spatialIndexUploadBytesDelta: sustainedCapture.spatialIndexUploadBytesDelta, glErrors: sustainedCapture.glErrors,
    limits: 'One desktop headless Chromium window with 12 evenly spaced azimuth changes; callback cadence and heap samples are browser observations, not physical display FPS or total process/GPU memory.'
  }
  const completedEpochUpdates = epochUpdateCapture?.records.filter(update => update.status === 'done') ?? []
  const epochTimingSummary = field => summary(completedEpochUpdates.map(update => update.workerTimingMs?.[field]).filter(Number.isFinite))
  const liveDisplaySamples = epochUpdateCapture?.liveDisplaySamples ?? []
  const settledDisplaySamples = liveDisplaySamples.filter(sample => ['complete', 'limited'].includes(sample.phase) && sample.spatialPending === 'false')
  const rowDistribution = values => {
    const sorted = [...values].filter(value => Number.isSafeInteger(value) && value >= 0).sort((a, b) => a - b)
    const q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
    return { count: sorted.length, p50Rows: q(.5), p95Rows: q(.95), maxRows: sorted.at(-1) ?? null }
  }
  const ratioDistribution = values => {
    const sorted = [...values].filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
    const q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
    return { count: sorted.length, p50Ratio: q(.5), p95Ratio: q(.95), maxRatio: sorted.at(-1) ?? null }
  }
  const settledSubmittedToLoadedRatios = settledDisplaySamples.flatMap(sample => Number.isSafeInteger(sample.sourceRows)
    && sample.sourceRows > 0 && Number.isSafeInteger(sample.rendererRows) ? [sample.rendererRows/sample.sourceRows] : [])
  const settledCountOverlayCoverageRatios = settledDisplaySamples.flatMap(sample => Number.isSafeInteger(sample.inViewportRows)
    && sample.inViewportRows > 0 && Number.isSafeInteger(sample.countOverlayRows) ? [sample.countOverlayRows/sample.inViewportRows] : [])
  const lagValues = liveDisplaySamples.map(sample => sample.targetMinusComputedSimulationSeconds).filter(Number.isFinite)
  const sortedAbsoluteLag = lagValues.map(Math.abs).sort((a, b) => a - b)
  const absoluteLagQuantile = p => sortedAbsoluteLag[Math.max(0, Math.ceil(sortedAbsoluteLag.length*p)-1)] ?? null
  const rangeLagIntervals = liveDisplaySamples.flatMap(sample => {
    if (!Number.isFinite(sample.targetJulianDay) || !Array.isArray(sample.computedEpochRangeJulianDay)
      || sample.computedEpochRangeJulianDay.length !== 2 || !sample.computedEpochRangeJulianDay.every(Number.isFinite)) return []
    const endpointA = (sample.targetJulianDay-sample.computedEpochRangeJulianDay[1])*86400
    const endpointB = (sample.targetJulianDay-sample.computedEpochRangeJulianDay[0])*86400
    return [{ minimumSignedSeconds: Math.min(endpointA, endpointB), maximumSignedSeconds: Math.max(endpointA, endpointB),
      maximumAbsoluteSeconds: Math.max(Math.abs(endpointA), Math.abs(endpointB)) }]
  })
  let previousTargetJulianDay = epochUpdateCapture?.initialTargetJulianDay ?? null
  const targetChangesAfterWindowStartMs = []
  for (const sample of liveDisplaySamples) {
    if (Number.isFinite(sample.targetJulianDay) && sample.targetJulianDay !== previousTargetJulianDay) {
      targetChangesAfterWindowStartMs.push(sample.afterWindowStartMs)
      previousTargetJulianDay = sample.targetJulianDay
    }
  }
  const targetChangeIntervalsMs = targetChangesAfterWindowStartMs.slice(1).map((time, index) => time-targetChangesAfterWindowStartMs[index])
  const liveDisplayObservation = epochUpdateCapture === null ? { status: 'not-measured', reason: 'No playback window was requested.' } : {
    status: 'observed', targetSampleIntervalMs: 100, sampleCount: liveDisplaySamples.length,
    droppedSamples: epochUpdateCapture.liveDisplaySampleDroppedCount,
    settledDisplaySampleCount: settledDisplaySamples.length,
    settledDisplaySampleRatio: liveDisplaySamples.length ? settledDisplaySamples.length / liveDisplaySamples.length : null,
    samplesWithComputedEpochLabel: liveDisplaySamples.filter(sample => Number.isFinite(sample.computedJulianDay)).length,
    observedTargetChangeCount: targetChangesAfterWindowStartMs.length,
    firstObservedTargetChangeAfterWindowStartMs: targetChangesAfterWindowStartMs[0] ?? null,
    observedTargetChangeIntervals: summary(targetChangeIntervalsMs),
    displayModesObserved: [...new Set(liveDisplaySamples.map(sample => sample.displayMode).filter(Boolean))],
    loadedSourceRows: rowDistribution(liveDisplaySamples.map(sample => sample.sourceRows)),
    settledLoadedSourceRows: rowDistribution(settledDisplaySamples.map(sample => sample.sourceRows)),
    rendererRows: rowDistribution(liveDisplaySamples.map(sample => sample.rendererRows)),
    settledRendererRows: rowDistribution(settledDisplaySamples.map(sample => sample.rendererRows)),
    inViewportRows: rowDistribution(liveDisplaySamples.map(sample => sample.inViewportRows)),
    settledInViewportRows: rowDistribution(settledDisplaySamples.map(sample => sample.inViewportRows)),
    countOverlaySourceRows: rowDistribution(liveDisplaySamples.map(sample => sample.countOverlayRows)),
    settledCountOverlaySourceRows: rowDistribution(settledDisplaySamples.map(sample => sample.countOverlayRows)),
    settledCountOverlayCoverageRatio: ratioDistribution(settledCountOverlayCoverageRatios),
    settledCountOverlayOccupiedCells: rowDistribution(settledDisplaySamples.map(sample => sample.countOverlayCells)),
    settledCountOverlayMaximumCell: rowDistribution(settledDisplaySamples.map(sample => sample.countOverlayMaximumCell)),
    settledSubmittedToLoadedSourceRowRatio: ratioDistribution(settledSubmittedToLoadedRatios),
    targetMinusComputedSimulationSeconds: { count: lagValues.length,
      p50SignedSeconds: lagValues.length ? [...lagValues].sort((a, b) => a-b)[Math.ceil(lagValues.length*.5)-1] : null,
      p95AbsoluteSeconds: absoluteLagQuantile(.95), minSignedSeconds: lagValues.length ? Math.min(...lagValues) : null,
      maxSignedSeconds: lagValues.length ? Math.max(...lagValues) : null, maxAbsoluteSeconds: absoluteLagQuantile(1) },
    targetMinusComputedEpochRangeSimulationSeconds: { count: rangeLagIntervals.length,
      minimumSignedSeparation: summarySeconds(rangeLagIntervals.map(interval => interval.minimumSignedSeconds)),
      maximumSignedSeparation: summarySeconds(rangeLagIntervals.map(interval => interval.maximumSignedSeconds)),
      maximumAbsoluteSeparation: summarySeconds(rangeLagIntervals.map(interval => interval.maximumAbsoluteSeconds)),
      maximumDisplacementAU: summaryAU(liveDisplaySamples.map(sample => sample.maximumDisplacementAU).filter(Number.isFinite)) },
    interpretation: 'Target is the latest Julian day propagated to CatalogStreamCanvas; while playing, CatalogWorkspace itself samples the simulation clock every 5 seconds. The 100 ms sample localizes target-value changes to that interval. The signed target-minus-computed gap and target-to-computed-range interval are simulation-time separations, not wall-clock latency or orbital accuracy; a positive temporal displacement budget can make some separation intentional. Renderer rows come from data-display-count: selected point rows submitted for drawing, not pixel-visible bodies; all mode may include offscreen rows. In spatial mode, countOverlayRows is the exact sum of all mathematical-viewport source rows binned into equal-area projected screen cells; it is not depth-normalized 3D physical density or event probability. The settled count-overlay coverage ratio compares that sum with inViewportRows. Settled samples require complete/limited phase and no pending spatial selection. A 100 ms headless DOM sample is an occupancy proxy, not physical display presentation; DOM sampling and readback add measurement overhead.',
    samples: liveDisplaySamples,
  }
  const epochUpdateObservation = epochUpdateCapture === null ? { status: 'not-measured', reason: 'No playback epoch window was requested.' } : {
    status: epochUpdateCapture.records.length ? 'observed' : 'no-updates-observed',
    requestedSeconds: epochUpdateCapture.requestedSeconds, actualDurationMs: epochUpdateCapture.actualDurationMs,
    requestCount: epochUpdateCapture.records.length,
    completedCount: epochUpdateCapture.records.filter(update => update.status === 'done').length,
    supersededCount: epochUpdateCapture.records.filter(update => update.status === 'superseded').length,
    failedCount: epochUpdateCapture.records.filter(update => update.status === 'error').length,
    unfinishedCount: epochUpdateCapture.records.filter(update => ['requested', 'started'].includes(update.status)).length,
    droppedRequestCount: epochUpdateCapture.droppedRequestCount,
    completedRecomputedRows: completedEpochUpdates.reduce((total, update) => total + (update.recomputedRows ?? 0), 0),
    completedReusedRows: completedEpochUpdates.reduce((total, update) => total + (update.reusedRows ?? 0), 0),
    observedTileRows: epochUpdateCapture.records.reduce((total, update) => total + update.computedRows, 0),
    observedReusedRows: epochUpdateCapture.records.reduce((total, update) => total + update.reusedRows, 0),
    tileUploadWindow: { rowsPerTile: completedEpochUpdates[0]?.workerTimingMs?.tileRows ?? null,
      configuredSlots: completedEpochUpdates[0]?.workerTimingMs?.maxUnacknowledgedTiles ?? null,
      peakUnacknowledgedTiles: summary(completedEpochUpdates.map(update => update.workerTimingMs?.peakUnacknowledgedTiles).filter(Number.isFinite)) },
    workerTimingMs: { computeAndYield: epochTimingSummary('computeAndYield'), tileOwnershipWait: epochTimingSummary('tileOwnershipWait'),
      reuseAckWait: epochTimingSummary('reuseAckWait'), total: epochTimingSummary('total') },
    animationCallbackIntervals: summary(epochUpdateCapture.frameIntervals),
    lateFrameCallbacks: { thresholdMs: 25, count: epochUpdateCapture.frameIntervals.filter(value => value > 25).length,
      ratio: epochUpdateCapture.frameIntervals.length ? epochUpdateCapture.frameIntervals.filter(value => value > 25).length / epochUpdateCapture.frameIntervals.length : null,
      interpretation: 'Intervals over 25 ms are a missed-cadence proxy, not physical dropped-frame measurement.' },
    longTasks: summary(epochUpdateCapture.longTasks),
    gpuAttributeUploadBytesDuringWindow: epochUpdateCapture.attributeUploadBytesDelta,
    spatialIndexUploadBytesDuringWindow: epochUpdateCapture.spatialIndexUploadBytesDelta,
    additionalArtifactRequests: epochUpdateCapture.additionalArtifactRequests,
    additionalServerArtifactRequests: epochUpdateCapture.additionalServerArtifactRequests,
    glErrors: epochUpdateCapture.glErrors,
    litPixels: epochUpdateCapture.litPixels,
    display: liveDisplayObservation,
    initialEpochLabel: epochUpdateCapture.initialEpochLabel,
    finalEpochLabel: epochUpdateCapture.canvas.epochLabel,
    liveCanvas: epochUpdateCapture.canvas,
    records: epochUpdateCapture.records,
    limits: 'Starts the application clock before catalog navigation and samples the real Worker protocol for a bounded interval. Superseded, unfinished and completed requests remain distinct. Worker wall-time and headless callback cadence are diagnostics, not GPU execution time, physical FPS or orbital accuracy. 100 ms DOM sampling and one readback observation add harness overhead.'
  }
  const report = { schemaVersion: 8, status: 'observed', generatedAt: new Date().toISOString(), measurement: `built-application-MPC-source-tier-${epochSeconds ? `playback-epochs-${epochSeconds}s-` : steadySeconds ? `interactive-steady-${steadySeconds}s-` : 'static-'}${coordinateMode.toUpperCase()}-${retainEpochs ? 'retained-epochs' : 'no-retained-epochs'}-snapshot-local-HTTP`,
    requestedRows, requiredShards, maximumFetchedShards, completeInventory: measuredSourcePhase === 'complete',
    requestedBudgetMiB: requestedBudgetMiB || null, effectiveBudgetBytes,
    cpuProfile: profileOutput ? { path: profileOutput, scope: epochSeconds > 0 ? 'Main renderer initial-source-load window only; excludes playback sampling, Worker, and GPU execution; profiler overhead affects timing.' : 'Main renderer thread only; profiler overhead affects timing; excludes Worker and GPU execution.' } : null,
    graphicsMode, detailMode, coordinateMode, retainEpochsRequested: retainEpochs, retainEpochsEffective: effectiveRetainEpochs, epochSeconds, simulationClock: epochSeconds > 0 ? { startJulianDay: playbackStartJulianDay, requestedRateDaysPerSecond: playbackRateDaysPerSecond } : null, epochUpdates: epochUpdateObservation, sourcePriority, rotationAudit, steadySeconds, sustainedDisplay, launchOptions, browser: browser.version(), viewport: { width: 1600, height: 1000, pixelRatio: 1 },
    source: { version: manifest.version, rows: manifest.totalCount, shards: manifest.chunkCount, sourceSha256: manifest.sourceSha256, contentSha256: manifest.contentSha256, manifestSha256: sha(readFileSync(manifestFile)), checksumsSha256: sha(checksums) },
    benchmarkHarnessSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    implementationSha256: Object.fromEntries(['src/lib/catalogStreaming.ts', 'src/lib/catalogRecordValidation.ts', 'src/lib/catalogPointRenderer.ts', 'src/lib/catalogSpatialSelection.ts', 'src/lib/catalogProjection.ts', 'src/lib/catalogTransferWindow.ts', 'src/lib/catalogEpochStore.ts', 'src/engine/ephemeris/catalogPoints.ts', 'src/engine/ephemeris/kepler.ts', 'src/engine/clock/SimulationClock.ts', 'src/engine/clock/useSimulationClock.ts', 'src/features/explorer/SimulationControls.tsx', 'src/features/catalog/CatalogWorkspace.tsx', 'src/workers/catalog-stream.worker.ts', 'src/components/CatalogStreamCanvas.tsx'].map(path => [path, sha(readFileSync(path))])),
    builtAssetSha256: builtAssets,
    buildSourceEquivalence: 'not-established; built assets and source checkout are fingerprinted independently',
    heapMemory: { ...result.audit.heap, metric: 'Chromium performance.memory JS heap estimate',
      sampling: 'start/end and animation callbacks at least 250 ms apart; no forced garbage collection',
      scope: 'Browser-reported heap estimate, potentially shared or incomplete; not total process, Worker, GPU or driver memory',
      limits: 'Observed sample maxima can miss peaks; unsupported values remain null. Instrumentation and other page work contribute to this estimate.' },
    cancellation: { status: 'not-measured', reason: epochSeconds > 0 ? 'This run observes a bounded playback window; UI cancellation is not evidence of worker or transport settlement.' : 'This run completes a static snapshot; UI cancellation is not evidence of worker or transport settlement.' },
    phase: measuredSourcePhase, livePhaseAfterLoadCapture: result.phase, drawnRows: measuredDrawnRows, displayedRows: result.displayedRows, checkedRows: result.checkedRows, canvasSize: result.canvasSize, loadMs: result.loadMs, spatialSelectionMs: result.spatialSelectionMs,
    spatialWork: result.spatialWork,
    spatialSelectionTiming: detailMode === 'spatial' ? 'Worker wall-clock duration from selection start through cooperative yields; excludes main-thread index upload and final draw.' : null, graphics: auditResult.graphics,
    gpuDrawTime: { status: gpuTimer.status, sampleEveryNthCatalogDrawCall: GPU_TIMER_SAMPLE_STRIDE,
      allRun: summary(gpuTimer.samples.map(sample => sample.gpuElapsedMs)),
      initialLoad: summary(initialLoadGpuSamples.map(sample => sample.gpuElapsedMs)),
      samples: gpuTimer.samples, sampledDrawCalls: gpuTimer.sampledDrawCalls, unsampledDrawCalls: gpuTimer.unsampledDrawCalls,
      submissionCountMeaning: 'All instrumented calls use POINTS. drawArrays count is vertex count; drawElements count is the 32-bit index count, with one index per representative vertex.',
      queryBusySkips: gpuTimer.queryBusySkips, droppedSamples: gpuTimer.droppedSamples, disjointObservations: gpuTimer.disjointObservations,
      invalidatedQueries: gpuTimer.invalidatedQueries, queryFailures: gpuTimer.queryFailures, pendingQueriesAtCapture: gpuTimer.pendingQueries,
      scope: 'Optional EXT_disjoint_timer_query measurements of individual catalog WebGL draw commands. They exclude CPU submission, buffer uploads, framebuffer blits, browser composition and physical display cadence; unsupported extensions, busy queries and disjoint results do not become timings.' },
    frameIntervals: summary(auditResult.intervals), uploadSubmission: summary(auditResult.uploads), drawSubmission: summary(auditResult.draws), longTasks: summary(auditResult.longTasks), longTaskTimeline: auditResult.longTaskTimeline,
    allocations: auditResult.allocations, gpuAttributeBytes: auditResult.allocationBytes, uploadBytes: auditResult.uploadBytes, litPixels: result.audit.litPixels, glErrors: result.audit.glErrors, pageErrors: errors,
    glErrorObservation: 'Application getError calls are observed and returned unchanged; no additional reads consume renderer error state. Errors never read by the application are not covered.',
    firstNonemptyDrawMs: auditResult.firstVisibleMs, submittedPointsAcrossDraws: auditResult.submittedPoints, peakUnacknowledgedTiles: auditResult.peakPendingTiles,
    spatialIndexBytes: auditResult.indexBytes, peakSpatialIndexBytes: auditResult.peakIndexBytes, spatialIndexUploadBytes: auditResult.indexUploadBytes,
    workerPerformanceMs: auditResult.workerPerformanceMs,
    workerPerformanceTiming: 'Artifact read-and-hash values sum overlapping worker calls; stage times are instrumented wall/CPU intervals. Tile delivery includes visual installation and transfer-window waits; total encloses sub-stages and is not their sum.',
    serverAudit: { ...serverAudit }, expandedArtifactRequests: expandedRequests.length, sourceMetadataRequests: metadataRequests.length, maximumCheckedRows,
    limits: ['Local filesystem/HTTP, not public network throughput.', epochSeconds > 0 ? 'Playback mode samples a finite number of real retained-epoch Worker requests; superseded work is reported separately, and the run is not continuous full-catalog acceptance or physical display FPS.' : 'One fixed UTC epoch; not continuous full-catalog simulation or physical display FPS.', 'Animation callbacks remain headless cadence evidence. Optional GPU timer-query samples cover individual draw commands only, not upload, presentation, composition or physical display cadence; unsupported or disjoint samples remain excluded.', 'Timer queries are sampled every fourth catalog draw call and add instrumentation overhead; compare timed and uninstrumented runs, and treat query durations as diagnostic.', 'Explicit source attribute bytes exclude spatial-index bytes and are not total browser/process/driver memory.', 'drawnRows is the uploaded source count; displayedRows is the actual final draw count, including offscreen points in all mode.', 'Partial tiers follow the selected shard priority, not representative scientific sampling; up to three extra shards can be prefetched before cancellation.', 'Spatial representatives are a visual simplification, not an estimate of density or event probability.', 'This desktop result does not establish native or mobile hardware capacity.'] }
  mkdirSync(dirname(output), { recursive: true })
  stage = 'snapshot-capture'
  const screenshot = await page.locator('.catalog-map').screenshot()
  writeFileSync(screenshotOutput, screenshot, { flag: 'wx' })
  if (cancelProbe) {
    stage = 'cancellation-observation'
    await page.evaluate(() => {
      const probe = { triggered: false, startedAtMs: null, firstTileAtMs: null, requestedAtMs: null, uiAtMs: null,
        terminalAtMs: null, terminalType: null, terminatedAtMs: null, rowsAtRequest: null, uploadBytesAtRequest: null, tilesAfterRequest: 0, error: null }
      window.streamCancelProbe = probe
      const observer = new MutationObserver(() => {
        if (probe.requestedAtMs !== null && document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-phase') === 'cancelled') {
          probe.uiAtMs = performance.now(); observer.disconnect()
        }
      })
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-phase'] })
    })
    const nodeProbeStarted = performance.now(), probeRequestStart = requests.length
    await page.getByRole('button', { name: /Refresh expanded snapshot/ }).click()
    await page.waitForFunction(() => {
      const probe = window.streamCancelProbe
      return probe.error || probe.terminatedAtMs !== null || probe.terminalType && (probe.terminalType !== 'cancelled' || probe.uiAtMs !== null)
    }, undefined, { timeout: 30_000 })
    const terminal = await page.evaluate(() => window.streamCancelProbe)
    if (terminal.error || terminal.terminatedAtMs !== null || terminal.terminalType !== 'cancelled' || terminal.requestedAtMs === null ||
        terminal.terminalAtMs < terminal.requestedAtMs || terminal.uiAtMs < terminal.requestedAtMs) throw new Error(`Cancellation probe did not establish settlement: ${JSON.stringify(terminal)}`)
    // Observe both browser request completion/failure and server response
    // closure. A quiet interval is bounded evidence, not proof of future idle.
    const observationStarted = performance.now()
    let quietSince = null, lastRequests = requests.length, lastServerRequests = serverAudit.artifactRequests
    while (true) {
      const now = performance.now()
      const idle = pendingArtifactRequests.size === 0 && serverAudit.artifactActive === 0
      if (!idle || requests.length !== lastRequests || serverAudit.artifactRequests !== lastServerRequests) quietSince = null
      if (idle && quietSince === null) quietSince = now
      lastRequests = requests.length; lastServerRequests = serverAudit.artifactRequests
      if (quietSince !== null && now-quietSince >= 1000) break
      if (now-observationStarted >= 10_000) throw new Error('Cancellation transport did not reach a one-second quiet interval')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const stopped = await page.evaluate(() => ({ probe: window.streamCancelProbe,
      phase: document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-phase'),
      rows: Number(document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-drawn-rows')),
      uploadBytes: window.streamAudit.uploadBytes, glErrors: window.streamAudit.glErrors }))
    if (stopped.phase !== 'cancelled' || stopped.rows !== terminal.rowsAtRequest || stopped.uploadBytes !== terminal.uploadBytesAtRequest ||
        stopped.probe.error || stopped.probe.terminatedAtMs !== null || stopped.probe.terminalType !== 'cancelled' || stopped.glErrors.length || errors.length) throw new Error('Cancelled snapshot changed or failed after worker settlement')
    report.cancellation = { status: 'observed', scenario: 'refresh then click the real cancel control on first received source tile, before its scheduled GPU upload',
      firstTileFromWorkerStartMs: terminal.firstTileAtMs-terminal.startedAtMs,
      uiStateAfterRequestMs: terminal.uiAtMs-terminal.requestedAtMs,
      workerTerminalAfterRequestMs: terminal.terminalAtMs-terminal.requestedAtMs,
      workerTerminated: false,
      transportQuietObservedFromRefreshDispatchMs: performance.now()-nodeProbeStarted, quietObservationMs: 1000,
      artifactRequests: requests.length-probeRequestStart, pendingBrowserRequests: pendingArtifactRequests.size,
      activeServerResponses: serverAudit.artifactActive, tilesReceivedAfterRequest: stopped.probe.tilesAfterRequest,
      retainedRows: stopped.rows, attributeUploadBytesAfterRequest: stopped.uploadBytes-terminal.uploadBytesAtRequest,
      limits: 'Single warm-page local-HTTP initial-load cancellation. Queued tiles may arrive after request. Worker stays alive for retained spatial views; terminal means source-load settlement, not worker termination or memory reclamation. Does not cover epoch updates, metadata-only searches, remote transports or devices.' }
  }
  stage = 'report-write'
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  // Node-side observations remain available even when the renderer is hung or
  // closed. Do not start another browser operation to obtain failure evidence.
  const diagnostic = { schemaVersion: 1, status: 'failed', generatedAt: new Date().toISOString(), stage,
    error: { name: error instanceof Error ? error.name : 'Error', message: String(error instanceof Error ? error.message : error).slice(0, 8192),
      stack: error instanceof Error ? error.stack?.slice(0, 16384) : undefined },
    requestedRows, graphicsMode, detailMode, coordinateMode, retainEpochsRequested: retainEpochs, retainEpochsEffective: effectiveRetainEpochs,
    epochSeconds, epochUpdates: { status: epochSeconds > 0 ? 'failed-or-incomplete' : 'not-measured', requestedSeconds: epochSeconds }, sourcePriority, cancelProbe,
    requestedBudgetMiB: requestedBudgetMiB || null, effectiveBudgetBytes, steadySeconds,
    source: { version: manifest.version, contentSha256: manifest.contentSha256 }, builtAssetSha256: builtAssets,
    pageUrl: page?.url() ?? null, pageErrorCount: errors.length, recentPageErrors: errors.slice(-20).map(message => message.slice(0, 8192)),
    artifactRequestCount: requests.length, recentArtifactRequests: requests.slice(-50),
    pendingBrowserArtifactRequests: pendingArtifactRequests.size, serverAudit: { ...serverAudit },
    limits: 'Partial Node-side failure diagnostics, not a successful capacity result. No renderer state, resource settlement or source/build equivalence is inferred. Pre-launch input/build-file failures are outside this runtime catch.' }
  try {
    mkdirSync(dirname(failureOutput), { recursive: true })
    writeFileSync(failureOutput, JSON.stringify(diagnostic, null, 2) + '\n', { flag: 'wx' })
  } catch (diagnosticError) { console.error('Could not write failure diagnostics:', diagnosticError) }
  throw error
} finally {
  try { await browser?.close() }
  finally { await new Promise(resolve => server.close(resolve)) }
}
