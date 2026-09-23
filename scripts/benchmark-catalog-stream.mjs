// Real built application + immutable local MPC release. Local HTTP throughput
// and headless callback cadence are not public-network or display-FPS evidence.
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
const output = resolve(option('--output', '.cache/catalog-stream-app.json'))
const graphicsMode = option('--graphics', 'default')
const detailMode = option('--detail', 'all')
if (!['all', 'spatial'].includes(detailMode)) throw new Error('Invalid detail mode')
if (!['default', 'd3d11'].includes(graphicsMode) || graphicsMode === 'd3d11' && process.platform !== 'win32') throw new Error('Invalid graphics mode')
if (existsSync(output)) throw new Error('Report already exists; choose a new output path')
const sha = value => createHash('sha256').update(value).digest('hex')
const pointer = JSON.parse(readFileSync('public/data/asteroids/dataset-version.json', 'utf8'))
const manifestFile = resolve('public/data/asteroids', pointer.manifestPath)
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const checksums = readFileSync(resolve(dirname(manifestFile), 'checksums.json'))
const roots = { assets: resolve('dist'), data: resolve('public') }
const serverAudit = { binaryRequests: 0, binaryBytes: 0, active: 0, peak: 0 }
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const relative = pathname.startsWith('/solar/') ? pathname.slice('/solar/'.length) : ''
  const root = relative.startsWith('data/') ? roots.data : roots.assets
  const file = resolve(root, relative || 'index.html')
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end(); return }
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
let browser
try {
  const launchOptions = graphicsMode === 'd3d11' ? { channel: 'chromium', args: ['--use-angle=d3d11'] } : {}
  browser = await chromium.launch(launchOptions)
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/data/asteroids/')) requests.push(new URL(request.url()).pathname) })
  await page.addInitScript(() => {
    localStorage.setItem('solar-atlas-first-run-v1', 'complete')
    const audit = { active: false, intervals: [], longTasks: [], uploads: [], draws: [], allocations: 0, allocationBytes: 0, uploadBytes: 0, glErrors: [], graphics: null, litPixels: null, submittedPoints: 0, firstVisibleMs: null, pendingTiles: 0, peakPendingTiles: 0, indexBytes: 0, peakIndexBytes: 0, indexUploadBytes: 0 }
    window.streamAudit = audit
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        this.isCatalogStream = String(url).includes('catalog-stream.worker')
        if (this.isCatalogStream) this.addEventListener('message', event => {
          if (event.data.type === 'tile') { audit.pendingTiles++; audit.peakPendingTiles = Math.max(audit.peakPendingTiles, audit.pendingTiles) }
        })
      }
      postMessage(data, options) {
        if (this.isCatalogStream && data.type === 'ack') audit.pendingTiles--
        super.postMessage(data, options)
      }
    }
    let previous = 0
    const frame = now => { if (audit.active && previous) audit.intervals.push(now - previous); previous = audit.active ? now : 0; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
    new PerformanceObserver(list => { if (audit.active) audit.longTasks.push(...list.getEntries().map(entry => entry.duration)) }).observe({ type: 'longtask', buffered: false })
    const proto = WebGLRenderingContext.prototype
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
        const error = this.getError()
        if (error) audit.glErrors.push(error)
        return result
      }
    }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/solar/?v=4&page=catalog&lang=en&jd=2461306.5`)
  await page.locator('canvas.catalog-point-canvas').waitFor()
  for (const [label, value] of [['a (AU): Maximum', '1000000'], ['e: Maximum', '1'], ['H: Minimum', '-100'], ['H: Maximum', '100'], ['q (AU): Maximum', '1000000']]) {
    await page.getByRole('spinbutton', { name: label, exact: true }).fill(value)
  }
  await page.getByRole('combobox', { name: 'Expanded map point limit' }).selectOption(String(manifest.totalCount))
  await page.getByRole('combobox', { name: 'Map detail', exact: true }).selectOption(detailMode)
  const startButton = page.getByRole('button', { name: /Load expanded snapshot/ })
  if (!await startButton.isEnabled()) throw new Error('Full source streaming is unavailable in this browser')
  const requestStart = requests.length
  await page.evaluate(rows => { window.streamExpectedRows = rows; window.streamAudit.active = true; window.streamStart = performance.now() }, manifest.totalCount)
  await startButton.click()
  const canvas = page.getByTestId('catalog-stream-canvas')
  await page.waitForFunction(() => ['complete', 'limited', 'error'].includes(document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-phase')), undefined, { timeout: 120_000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="catalog-stream-canvas"]')?.getAttribute('data-spatial-pending') === 'false', undefined, { timeout: 30_000 })
  const result = await page.evaluate(() => {
    window.streamAudit.active = false
    const canvas = document.querySelector('[data-testid="catalog-stream-canvas"]')
    const loadMs = performance.now() - window.streamStart
    window.streamCapture = true
    canvas.dispatchEvent(new Event('solar-atlas-prepare-canvas-capture'))
    return { phase: canvas.getAttribute('data-phase'), drawnRows: Number(canvas.getAttribute('data-drawn-rows')), displayedRows: Number(canvas.getAttribute('data-display-count')), checkedRows: Number(canvas.getAttribute('data-source-rows')), canvasSize: { width: canvas.width, height: canvas.height }, loadMs, audit: window.streamAudit, userAgent: navigator.userAgent }
  })
  if (result.phase !== 'complete' || result.drawnRows !== manifest.totalCount || result.checkedRows !== manifest.totalCount || result.audit.glErrors.length || !result.audit.litPixels) throw new Error(JSON.stringify({ ...result, audit: { glErrors: result.audit.glErrors, litPixels: result.audit.litPixels }, errors }))
  if (errors.length) throw new Error(JSON.stringify(errors))
  if (graphicsMode === 'd3d11' && (!/Direct3D11/i.test(result.audit.graphics?.renderer ?? '') || /SwiftShader|software|llvmpipe|basic render/i.test(result.audit.graphics.renderer))) throw new Error('Hardware D3D11 renderer was not established')
  const expandedRequests = requests.slice(requestStart)
  if (expandedRequests.some(path => path.includes('/meta/') || path.includes('catalog-sample-'))) throw new Error('Expanded loading hydrated per-object metadata')
  if (serverAudit.binaryRequests !== manifest.chunkCount || result.audit.allocations !== 3 || result.audit.allocationBytes !== manifest.totalCount * 24 || result.audit.uploadBytes !== manifest.totalCount * 24 || result.audit.pendingTiles !== 0 || result.audit.peakPendingTiles > 4) throw new Error('Source count, GPU allocation or transfer contract mismatch')
  const summary = values => {
    const sorted = [...values].sort((a, b) => a - b), q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
    return { count: sorted.length, p50Ms: q(.5), p95Ms: q(.95), p99Ms: q(.99), maxMs: sorted.at(-1) ?? null }
  }
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), measurement: 'built-application-full-MPC-source-static-2D-snapshot-local-HTTP',
    graphicsMode, detailMode, launchOptions, browser: browser.version(), viewport: { width: 1600, height: 1000, pixelRatio: 1 },
    source: { version: manifest.version, rows: manifest.totalCount, shards: manifest.chunkCount, sourceSha256: manifest.sourceSha256, contentSha256: manifest.contentSha256, manifestSha256: sha(readFileSync(manifestFile)), checksumsSha256: sha(checksums) },
    implementationSha256: Object.fromEntries(['src/lib/catalogStreaming.ts', 'src/lib/catalogPointRenderer.ts', 'src/lib/catalogSpatialSelection.ts', 'src/lib/catalogTransferWindow.ts', 'src/workers/catalog-stream.worker.ts', 'src/components/CatalogStreamCanvas.tsx'].map(path => [path, sha(readFileSync(path))])),
    phase: result.phase, drawnRows: result.drawnRows, displayedRows: result.displayedRows, checkedRows: result.checkedRows, canvasSize: result.canvasSize, loadMs: result.loadMs, graphics: result.audit.graphics,
    frameIntervals: summary(result.audit.intervals), uploadSubmission: summary(result.audit.uploads), drawSubmission: summary(result.audit.draws), longTasks: summary(result.audit.longTasks),
    allocations: result.audit.allocations, gpuAttributeBytes: result.audit.allocationBytes, uploadBytes: result.audit.uploadBytes, litPixels: result.audit.litPixels, glErrors: result.audit.glErrors, pageErrors: errors,
    firstNonemptyDrawMs: result.audit.firstVisibleMs, submittedPointsAcrossDraws: result.audit.submittedPoints, peakUnacknowledgedTiles: result.audit.peakPendingTiles,
    spatialIndexBytes: result.audit.indexBytes, peakSpatialIndexBytes: result.audit.peakIndexBytes, spatialIndexUploadBytes: result.audit.indexUploadBytes,
    serverAudit, expandedArtifactRequests: expandedRequests.length,
    limits: ['Local filesystem/HTTP, not public network throughput.', 'One fixed UTC epoch; not continuous full-catalog simulation or physical display FPS.', 'Headless animation callbacks and CPU GL submission times, not GPU execution timers.', 'Explicit source attribute bytes exclude spatial-index bytes and are not total browser/process/driver memory.', 'drawnRows is the uploaded source count; displayedRows is the actual final draw count, including offscreen points in all mode.', 'Spatial representatives are a visual simplification, not an estimate of density or event probability.', 'This desktop result does not establish native or mobile hardware capacity.'] }
  mkdirSync(dirname(output), { recursive: true })
  await page.locator('.catalog-map').screenshot({ path: output.replace(/\.json$/, '') + '.png' })
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(report, null, 2))
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
