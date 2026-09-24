// Real built application + immutable local MPC release. Local HTTP throughput
// and headless callback cadence are not public-network or display-FPS evidence.
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
const output = resolve(option('--output', '.cache/catalog-stream-app.json'))
const screenshotOutput = output.replace(/\.json$/i, '') + '.png'
const failureOutput = output.replace(/\.json$/i, '') + '.failure.json'
const profileOutput = args.includes('--cpu-profile') ? output.replace(/\.json$/i, '') + '.cpuprofile' : null
const graphicsMode = option('--graphics', 'default')
const detailMode = option('--detail', 'all')
const coordinateMode = option('--mode', '2d')
const sourcePriority = option('--priority', 'source')
const requestedBudgetMiB = Number(option('--budget-mib', '0'))
if (![0, 64, 128, 256, 384, 512].includes(requestedBudgetMiB)) throw new Error('Invalid catalog budget; use a supported UI budget in MiB')
const steadySeconds = Number(option('--steady-seconds', '0'))
if (!Number.isSafeInteger(steadySeconds) || steadySeconds < 0 || steadySeconds > 300) throw new Error('Invalid steady-state window; use an integer from 0 to 300 seconds')
const cancelProbe = args.includes('--cancel-probe')
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
let browser, page, effectiveBudgetBytes = null, profiler
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
  await page.addInitScript(() => {
    localStorage.setItem('solar-atlas-first-run-v1', 'complete')
    const audit = { active: false, intervals: [], longTasks: [], uploads: [], draws: [], allocations: 0, allocationBytes: 0, uploadBytes: 0, glErrors: [], graphics: null, litPixels: null, submittedPoints: 0, firstVisibleMs: null, pendingTiles: 0, peakPendingTiles: 0, indexBytes: 0, peakIndexBytes: 0, indexUploadBytes: 0, workerPerformanceMs: null }
    window.streamAudit = audit
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
          if (event.data.type === 'done' && event.data.performanceMs) audit.workerPerformanceMs = event.data.performanceMs
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
        const start = performance.now(), result = Reflect.apply(original, this, parameters)
        if (this.canvas.getAttribute?.('data-testid') !== 'catalog-stream-canvas') return result
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
  })
  stage = 'workspace-configuration'
  await page.goto(`http://127.0.0.1:${server.address().port}/solar/?v=4&page=catalog&lang=en&jd=2461306.5`)
  await page.locator('canvas.catalog-point-canvas').waitFor()
  const budgetControl = page.getByRole('combobox', { name: 'Catalog array and GPU budget (MiB)', exact: true })
  if (requestedBudgetMiB) await budgetControl.selectOption(String(requestedBudgetMiB * 1024 * 1024))
  effectiveBudgetBytes = Number(await budgetControl.inputValue())
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
  await page.waitForFunction(() => ['complete', 'limited', 'error'].includes(document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-phase')), undefined, { timeout: 120_000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-spatial-pending') === 'false', undefined, { timeout: 30_000 })
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
    window.streamCapture = true
    canvas.dispatchEvent(new Event('solar-atlas-prepare-canvas-capture'))
    return { phase: canvas.getAttribute('data-phase'), drawnRows: Number(canvas.getAttribute('data-drawn-rows')), displayedRows: Number(canvas.getAttribute('data-display-count')), checkedRows: Number(canvas.getAttribute('data-source-rows')), canvasSize: { width: canvas.width, height: canvas.height }, loadMs, spatialSelectionMs, audit: window.streamAudit, userAgent: navigator.userAgent }
  })
  const expectedPhase = requestedRows === manifest.totalCount ? 'complete' : 'limited'
  stage = 'static-contract-checks'
  const maximumCheckedRows = Math.min(manifest.totalCount, requiredShards * manifest.chunkSize)
  if (result.phase !== expectedPhase || result.drawnRows !== requestedRows || !Number.isSafeInteger(result.checkedRows) ||
      result.checkedRows < requestedRows || result.checkedRows > maximumCheckedRows || result.audit.glErrors.length || !result.audit.litPixels) throw new Error(JSON.stringify({ ...result, audit: { glErrors: result.audit.glErrors, litPixels: result.audit.litPixels }, errors }))
  if (detailMode === 'spatial' && (!Number.isFinite(result.spatialSelectionMs) || result.spatialSelectionMs < 0)) throw new Error('Spatial mode did not report a valid worker selection duration')
  if (errors.length) throw new Error(JSON.stringify(errors))
  if (graphicsMode === 'd3d11' && (!/Direct3D11/i.test(result.audit.graphics?.renderer ?? '') || /SwiftShader|software|llvmpipe|basic render/i.test(result.audit.graphics.renderer))) throw new Error('Hardware D3D11 renderer was not established')
  const expandedRequests = requests.slice(requestStart)
  const metadataRequests = expandedRequests.filter(path => /\/meta\/chunk-\d+\.json$/.test(path))
  if (metadataRequests.length !== requiredShards || new Set(metadataRequests).size !== requiredShards ||
      expandedRequests.some(path => path.includes('catalog-sample-') || path.includes('/search/') || path.includes('/lookup/'))) throw new Error('Expanded source metadata screening contract mismatch')
  if (serverAudit.binaryRequests < requiredShards || serverAudit.binaryRequests > maximumFetchedShards || result.audit.allocations !== 3 || result.audit.allocationBytes !== requestedRows * attributeBytesPerPoint || result.audit.uploadBytes !== requestedRows * attributeBytesPerPoint || result.audit.pendingTiles !== 0 || result.audit.peakPendingTiles > 4) throw new Error('Source count, GPU allocation or transfer contract mismatch')
  let rotationAudit = null
  if (coordinateMode === '3d') {
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
    const intervalMs = steadySeconds * 1000 / Math.max(1, cameraInteractions)
    for (let step = 0; step < cameraInteractions; step++) {
      await page.waitForTimeout(intervalMs)
      await page.getByRole('slider', { name: 'Catalog azimuth', exact: true }).press('ArrowRight')
      await page.waitForFunction(() => document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-spatial-pending') === 'false')
      selectionDurationsMs.push(Number(await page.getByTestId('catalog-stream-canvas').getAttribute('data-selection-ms')))
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
    sustainedCapture.additionalArtifactRequests = requests.length - requestIndex
  }
  const summary = values => {
    const sorted = [...values].sort((a, b) => a - b), q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
    return { count: sorted.length, p50Ms: q(.5), p95Ms: q(.95), p99Ms: q(.99), maxMs: sorted.at(-1) ?? null }
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
    spatialSelection: summary(sustainedCapture.spatialSelectionSamplesMs), additionalArtifactRequests: sustainedCapture.additionalArtifactRequests,
    allocationDelta: sustainedCapture.allocationDelta, attributeUploadBytesDelta: sustainedCapture.attributeUploadBytesDelta,
    spatialIndexUploadBytesDelta: sustainedCapture.spatialIndexUploadBytesDelta, glErrors: sustainedCapture.glErrors,
    limits: 'One desktop headless Chromium window with 12 evenly spaced azimuth changes; callback cadence and heap samples are browser observations, not physical display FPS or total process/GPU memory.'
  }
  const report = { schemaVersion: 5, status: 'observed', generatedAt: new Date().toISOString(), measurement: `built-application-MPC-source-tier-${steadySeconds ? `interactive-steady-${steadySeconds}s-` : 'static-'}${coordinateMode.toUpperCase()}-snapshot-local-HTTP`,
    requestedRows, requiredShards, maximumFetchedShards, completeInventory: result.phase === 'complete',
    requestedBudgetMiB: requestedBudgetMiB || null, effectiveBudgetBytes,
    cpuProfile: profileOutput ? { path: profileOutput, scope: 'Main renderer thread only; profiler overhead affects timing; excludes Worker and GPU execution.' } : null,
    graphicsMode, detailMode, coordinateMode, sourcePriority, rotationAudit, steadySeconds, sustainedDisplay, launchOptions, browser: browser.version(), viewport: { width: 1600, height: 1000, pixelRatio: 1 },
    source: { version: manifest.version, rows: manifest.totalCount, shards: manifest.chunkCount, sourceSha256: manifest.sourceSha256, contentSha256: manifest.contentSha256, manifestSha256: sha(readFileSync(manifestFile)), checksumsSha256: sha(checksums) },
    implementationSha256: Object.fromEntries(['src/lib/catalogStreaming.ts', 'src/lib/catalogRecordValidation.ts', 'src/lib/catalogPointRenderer.ts', 'src/lib/catalogSpatialSelection.ts', 'src/lib/catalogProjection.ts', 'src/lib/catalogTransferWindow.ts', 'src/engine/ephemeris/catalogPoints.ts', 'src/engine/ephemeris/kepler.ts', 'src/workers/catalog-stream.worker.ts', 'src/components/CatalogStreamCanvas.tsx'].map(path => [path, sha(readFileSync(path))])),
    builtAssetSha256: builtAssets,
    buildSourceEquivalence: 'not-established; built assets and source checkout are fingerprinted independently',
    heapMemory: { ...result.audit.heap, metric: 'Chromium performance.memory JS heap estimate',
      sampling: 'start/end and animation callbacks at least 250 ms apart; no forced garbage collection',
      scope: 'Browser-reported heap estimate, potentially shared or incomplete; not total process, Worker, GPU or driver memory',
      limits: 'Observed sample maxima can miss peaks; unsupported values remain null. Instrumentation and other page work contribute to this estimate.' },
    cancellation: { status: 'not-measured', reason: 'This run completes a static snapshot; UI cancellation is not evidence of worker or transport settlement.' },
    phase: result.phase, drawnRows: result.drawnRows, displayedRows: result.displayedRows, checkedRows: result.checkedRows, canvasSize: result.canvasSize, loadMs: result.loadMs, spatialSelectionMs: result.spatialSelectionMs,
    spatialSelectionTiming: detailMode === 'spatial' ? 'Worker wall-clock duration from selection start through cooperative yields; excludes main-thread index upload and final draw.' : null, graphics: result.audit.graphics,
    frameIntervals: summary(result.audit.intervals), uploadSubmission: summary(result.audit.uploads), drawSubmission: summary(result.audit.draws), longTasks: summary(result.audit.longTasks), longTaskTimeline: result.audit.longTaskTimeline,
    allocations: result.audit.allocations, gpuAttributeBytes: result.audit.allocationBytes, uploadBytes: result.audit.uploadBytes, litPixels: result.audit.litPixels, glErrors: result.audit.glErrors, pageErrors: errors,
    glErrorObservation: 'Application getError calls are observed and returned unchanged; no additional reads consume renderer error state. Errors never read by the application are not covered.',
    firstNonemptyDrawMs: result.audit.firstVisibleMs, submittedPointsAcrossDraws: result.audit.submittedPoints, peakUnacknowledgedTiles: result.audit.peakPendingTiles,
    spatialIndexBytes: result.audit.indexBytes, peakSpatialIndexBytes: result.audit.peakIndexBytes, spatialIndexUploadBytes: result.audit.indexUploadBytes,
    workerPerformanceMs: result.audit.workerPerformanceMs,
    workerPerformanceTiming: 'Artifact read-and-hash values sum overlapping worker calls; stage times are instrumented wall/CPU intervals. Tile delivery includes visual installation and transfer-window waits; total encloses sub-stages and is not their sum.',
    serverAudit: { ...serverAudit }, expandedArtifactRequests: expandedRequests.length, sourceMetadataRequests: metadataRequests.length, maximumCheckedRows,
    limits: ['Local filesystem/HTTP, not public network throughput.', 'One fixed UTC epoch; not continuous full-catalog simulation or physical display FPS.', 'Headless animation callbacks and CPU GL submission times, not GPU execution timers.', 'Explicit source attribute bytes exclude spatial-index bytes and are not total browser/process/driver memory.', 'drawnRows is the uploaded source count; displayedRows is the actual final draw count, including offscreen points in all mode.', 'Partial tiers follow the selected shard priority, not representative scientific sampling; up to three extra shards can be prefetched before cancellation.', 'Spatial representatives are a visual simplification, not an estimate of density or event probability.', 'This desktop result does not establish native or mobile hardware capacity.'] }
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
    requestedRows, graphicsMode, detailMode, coordinateMode, sourcePriority, cancelProbe,
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
