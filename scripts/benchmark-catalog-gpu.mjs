// Standalone synthetic rendering evidence using the actual 2D catalog renderer.
// No orbital computation, catalog ingestion, React scene or physical-display FPS.
import { chromium } from '@playwright/test'
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve, dirname } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
const output = resolve(option('--output', '.cache/catalog-gpu-synthetic.json'))
const graphicsMode = option('--graphics', 'default')
if (!['default', 'd3d11'].includes(graphicsMode) || (graphicsMode === 'd3d11' && process.platform !== 'win32')) throw new Error('Supported graphics modes: default, or d3d11 on Windows')
const launchOptions = graphicsMode === 'd3d11' ? { channel: 'chromium', args: ['--use-angle=d3d11'] } : {}
const width = 1280, height = 720, sha = value => createHash('sha256').update(value).digest('hex')
const source = readFileSync('src/lib/catalogPointRenderer.ts', 'utf8')
// This renderer has no runtime imports. Transpile syntax only, keeping its
// shaders, allocation policy and draw calls identical to the application.
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const server = createServer((request, response) => {
  const body = request.url === '/renderer.js' ? javascript : request.url === '/' ? '<!doctype html><title>Synthetic catalog GPU capacity</title><canvas></canvas>' : null
  if (body === null) { response.writeHead(404); response.end(); return }
  response.writeHead(200, { 'Content-Type': request.url === '/renderer.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' })
  response.end(body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch(launchOptions)
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const result = await page.evaluate(async ({ width, height }) => {
    const { createCatalogPointRenderer } = await import('/renderer.js')
    const canvas = document.querySelector('canvas')
    canvas.width = width; canvas.height = height
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) throw new Error('WebGL unavailable')
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    const graphics = { version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      contextAttributes: gl.getContextAttributes() }
    const audit = { allocations: 0, allocationBytes: 0, updates: 0, updateBytes: 0, draws: 0 }
    const allocate = gl.bufferData.bind(gl), update = gl.bufferSubData.bind(gl), draw = gl.drawArrays.bind(gl)
    gl.bufferData = (...parameters) => { audit.allocations++; audit.allocationBytes += typeof parameters[1] === 'number' ? parameters[1] : parameters[1]?.byteLength ?? 0; allocate(...parameters) }
    gl.bufferSubData = (...parameters) => { audit.updates++; audit.updateBytes += parameters[2].byteLength; update(...parameters) }
    gl.drawArrays = (...parameters) => { audit.draws++; draw(...parameters) }
    const summary = values => {
      const sorted = [...values].sort((a, b) => a - b)
      const quantile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
      return { samples: sorted.length, p50Ms: quantile(.5), p95Ms: quantile(.95), p99Ms: quantile(.99), maxMs: sorted.at(-1) ?? null }
    }
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const cases = []
    for (const count of [30_000, 100_000, 300_000, 1_000_000, 1_561_171]) {
      const preparationStart = performance.now()
      const positions = new Float32Array(count * 2), nextPositions = new Float32Array(count * 2)
      const colors = new Float32Array(count * 3), sizes = new Float32Array(count)
      for (let i = 0; i < count; i++) {
        // Deterministic dense disk: many coincident fragments intentionally
        // stress blending. This distribution is synthetic, not MPC geometry.
        const angle = i * 2.399963229728653, radius = 3 * Math.sqrt((i + .5) / count)
        const x = radius * Math.cos(angle), y = radius * Math.sin(angle)
        positions.set([x, y], i * 2)
        nextPositions.set([x * .99995 - y * .01, x * .01 + y * .99995], i * 2)
        colors.set([.45, .65, .79], i * 3); sizes[i] = 1.7
      }
      const preparationMs = performance.now() - preparationStart
      const renderer = createCatalogPointRenderer(gl), before = { ...audit }
      const frame = { positions, colors, sizes, radius: 3.2, opacity: .82 }
      try {
        const initialStart = performance.now()
        renderer.draw(frame, width, height, 1)
        gl.finish() // Explicitly synchronous cold upload+draw measurement only.
        const initialUploadAndFinishMs = performance.now() - initialStart
        for (let i = 0; i < 8; i++) { await nextFrame(); renderer.draw(frame, width, height, 1) }
        const submit = [], intervals = [], uploads = []
        let previous = await nextFrame(), lastUpload = previous, useNext = false
        const start = performance.now()
        for (let i = 0; i < 180 && performance.now() - start < 8000; i++) {
          const now = await nextFrame()
          intervals.push(now - previous); previous = now
          const shouldUpload = now - lastUpload >= 200
          if (shouldUpload) { useNext = !useNext; frame.positions = useNext ? nextPositions : positions; lastUpload = now }
          const drawStart = performance.now()
          renderer.draw(frame, width, height, 1)
          const elapsed = performance.now() - drawStart
          submit.push(elapsed)
          if (shouldUpload) uploads.push(elapsed)
        }
        const drainStart = performance.now(); gl.finish()
        const finalDrainMs = performance.now() - drainStart
        const pixels = new Uint8Array(5 * 5 * 4); gl.readPixels(width / 2 - 2, height / 2 - 2, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        const litProbePixels = Array.from({ length: 25 }, (_, i) => pixels[i * 4]).filter(red => red > 5).length
        const error = gl.getError()
        if (error !== gl.NO_ERROR || gl.isContextLost() || !litProbePixels) throw new Error(`Rendering failed at ${count}: GL=${error}, lit probe pixels=${litProbePixels}`)
        const delta = Object.fromEntries(Object.entries(audit).map(([key, value]) => [key, value - before[key]]))
        if (delta.allocations !== 3 || delta.allocationBytes !== count * 24 || delta.updateBytes !== delta.updates * count * 8) throw new Error(`Unexpected buffer reuse at ${count}`)
        cases.push({ count, preparationMs, initialUploadAndFinishMs, finalDrainMs,
          attributesBytes: count * 24, cpuAttributeArraysBytes: count * 32,
          frameIntervals: summary(intervals), drawSubmission: summary(submit), uploadSubmission: summary(uploads),
          observedLoopHz: intervals.length * 1000 / intervals.reduce((sum, value) => sum + value, 0),
          audit: delta, litProbePixels, glError: error })
      } finally { renderer.dispose() }
    }
    return { graphics, cases, userAgent: navigator.userAgent }
  }, { width, height })
  if (graphicsMode === 'd3d11' && (!result.graphics.unmaskedRenderer || !/Direct3D11/i.test(result.graphics.unmaskedRenderer) || /SwiftShader|llvmpipe|software|basic render/i.test(result.graphics.unmaskedRenderer))) {
    throw new Error(`Requested hardware D3D11 was not established: ${result.graphics.unmaskedRenderer}`)
  }
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), graphicsMode, launchOptions,
    measurement: 'isolated-actual-2D-renderer-synthetic-dense-disk-not-application-streaming-or-display-FPS',
    rendererSourceSha256: sha(source), servedJavaScriptSha256: sha(javascript), browser: browser.version(),
    viewport: { width, height, pixelRatio: 1 }, requestedPositionUploadIntervalMs: 200,
    limits: ['Headless requestAnimationFrame intervals, not physical display presentation.',
      'Draw/upload submission times are CPU wall time, not GPU timer-query measurements.',
      'Explicit finish measurements synchronize the GPU only at the first draw and final drain.',
      'Reported buffer bytes exclude driver, browser, JS heap, orbital state and transient copies.',
      'Synthetic disk geometry and fixed pixel size are not actual full-catalog application coverage.'],
    ...result }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  console.log(JSON.stringify({ output, graphics: result.graphics, cases: result.cases.map(({ count, initialUploadAndFinishMs, frameIntervals, uploadSubmission, observedLoopHz }) => ({ count, initialUploadAndFinishMs, frameIntervals, uploadSubmission, observedLoopHz })) }, null, 2))
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
