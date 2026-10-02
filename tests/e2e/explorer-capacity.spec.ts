import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { PREPARE_CANVAS_CAPTURE_EVENT } from '../../src/lib/canvasCapture'

type WorkerAudit = { direction: string; type: string; epoch?: number; row?: number; requestId?: number }
type AuditWindow = Window & { catalogAudit: WorkerAudit[]; catalogStarts: number }
type PickWindow = Window & { realPickPoints: { x: number; y: number }[]; restorePickCapture: () => void }
test.use({ actionTimeout: 15_000 })

// Explicit, bounded real-source check. Normal E2E runs do not load this dataset.
test('measure real MPC catalog computation in the main scene', async ({ page, browser }, info) => {
  test.skip(process.env.SOLAR_REAL_CATALOG_CHECK !== '1', 'Opt in with a local real backend and pinned MPC dataset')
  test.setTimeout(180_000)
  const backend = process.env.SOLAR_AUDIT_BACKEND_URL
  if (!backend || !/^http:\/\/127\.0\.0\.1:\d+$/.test(backend)) throw new Error('A loopback backend URL is required')
  const root = resolve('public/data/asteroids')
  const pin = JSON.parse(await readFile(resolve(root, 'dataset-version.json'), 'utf8'))
  const manifestBytes = await readFile(resolve(root, pin.manifestPath))
  const manifest = JSON.parse(manifestBytes.toString())
  const errors: string[] = []
  let binaryShardReads = 0
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/solar-test-api/**', async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: backend + url.pathname.replace('/solar-test-api', '') + url.search })
    await route.fulfill({ response })
  })
  await page.route('**/data/asteroids/**', async route => {
    const url = new URL(route.request().url())
    const path = resolve(root, decodeURIComponent(url.pathname.split('/data/asteroids/')[1]))
    if (/chunk-.*\.bin$/.test(path)) binaryShardReads++
    const within = relative(root, path)
    if (isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) throw new Error('Dataset path escaped its root')
    await route.fulfill({ body: await readFile(path), contentType: path.endsWith('.json') ? 'application/json' : 'application/octet-stream' })
  })
  await page.addInitScript(() => {
    localStorage.setItem('solar-atlas-first-run-v1', 'complete')
    const audit: WorkerAudit[] = []; (window as AuditWindow).catalogAudit = audit
    ;(window as AuditWindow).catalogStarts = 0
    const record = (direction: string, data: { type: string; julianDay?: number; startRow?: number; requestId?: number }) => {
      audit.push({ direction, type: data.type, epoch: data.julianDay, row: data.startRow, requestId: data.requestId })
      if (audit.length > 40) audit.shift()
    }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      private audited: boolean
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.audited = String(url).includes('catalog-stream.worker')
        if (this.audited) this.addEventListener('message', event => record('receive', event.data))
      }
      override postMessage(data: Parameters<Worker['postMessage']>[0], options?: Transferable[] | StructuredSerializeOptions) {
        if (this.audited) record('send', data)
        if (this.audited && data.type === 'start') (window as AuditWindow).catalogStarts++
        if (Array.isArray(options)) super.postMessage(data, options)
        else super.postMessage(data, options)
      }
    }
  })
  await page.goto('./?v=4&catalogCloud=1&quality=max&lang=en')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await page.locator('.simulation-bar input[type=date]').fill('2026-09-03')
  await page.locator('.simulation-bar .rate-field select').selectOption('1')
  await page.locator('.catalog-scene-controls > summary').click()
  await page.getByLabel('Catalog memory budget', { exact: true }).selectOption('1024')
  const samples = []
  for (const mode of ['3D', '2D'] as const) {
    const startsBefore = await page.evaluate(() => (window as AuditWindow).catalogStarts)
    const readsBefore = binaryShardReads
    const start = performance.now()
    if (mode === '2D') await page.locator('.simulation-bar').getByRole('button', { name: mode, exact: true }).click()
    if (mode === '3D') await page.getByLabel('Catalog population', { exact: true }).selectOption(String(manifest.totalCount))
    const status = page.getByTestId('explorer-catalog-status')
    await expect.poll(async () => {
      const failure = await page.locator('.catalog-cloud-error').allTextContents()
      if (errors.length || failure.length) throw new Error(JSON.stringify({ errors, failure }))
      return Number(await status.getAttribute('data-computed'))
    }, { timeout: 90_000 }).toBe(manifest.totalCount)
    await expect.poll(async () => Number(await status.getAttribute('data-drawn'))).toBeGreaterThan(0)
    const loadMs = performance.now() - start
    const startsAfter = await page.evaluate(() => (window as AuditWindow).catalogStarts)
    if (mode === '2D') {
      expect(startsAfter).toBe(startsBefore)
      expect(binaryShardReads).toBe(readsBefore)
    }
    const initialEpoch = Number(await status.getAttribute('data-epoch'))
    await page.locator('.simulation-bar').getByRole('button', { name: /Play/ }).click()
    try {
      await expect.poll(async () => Number(await status.getAttribute('data-epoch')), { timeout: 30_000 }).toBeGreaterThan(initialEpoch)
    } catch (error) {
      await writeFile(info.outputPath('catalog-worker-audit.json'), JSON.stringify(await page.evaluate(() => (window as AuditWindow).catalogAudit), null, 2))
      throw error
    }
    const canvas = mode === '3D' ? page.getByTestId('trajectory-canvas-3d').locator('canvas') : page.locator('canvas.trajectory-canvas')
    const measurement = await canvas.evaluate(async node => {
      const element = node as HTMLCanvasElement
      const gl = element.getContext('webgl2') ?? element.getContext('webgl')
      if (!gl) throw new Error('No active graphics context')
      const draw = gl.drawArrays.bind(gl)
      let maxPointsSubmitted = 0, pointDrawCalls = 0
      gl.drawArrays = (mode, first, count) => { if (mode === gl.POINTS) { maxPointsSubmitted = Math.max(maxPointsSubmitted, count); pointDrawCalls++ } draw(mode, first, count) }
      const intervals: number[] = []
      let previous = await new Promise<number>(requestAnimationFrame)
      const samplingStarted = previous
      try {
        while (intervals.length < 120 && previous - samplingStarted < 6_000) {
          const now = await new Promise<number>(requestAnimationFrame)
          intervals.push(now - previous); previous = now
        }
      } finally { gl.drawArrays = draw }
      const sorted = [...intervals].sort((a, b) => a - b)
      const debug = gl.getExtension('WEBGL_debug_renderer_info')
      const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
      return { maxPointsSubmitted, pointDrawCalls, intervals, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), contextLost: gl.isContextLost(), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), userAgent: navigator.userAgent }
    })
    await page.locator('.simulation-bar').getByRole('button', { name: /Pause/ }).click()
    const pauseStarted = performance.now()
    await expect(page.locator('.catalog-scene-controls > summary')).toContainText('Time synchronized', { timeout: 30000 })
    const pauseCatchupMs = performance.now() - pauseStarted
    expect(measurement.contextLost).toBe(false)
    expect(measurement.maxPointsSubmitted).toBeGreaterThan(30_000)
    expect(measurement.maxPointsSubmitted).toBeLessThanOrEqual(manifest.totalCount)
    samples.push({ mode, operation: mode === '3D' ? 'initial-load' : 'mode-switch', loadMs,
      streamStarts: startsAfter, newStreamStarts: startsAfter - startsBefore, newBinaryShardReads: binaryShardReads - readsBefore,
      pauseCatchupMs, initialEpoch, computed: Number(await status.getAttribute('data-computed')), drawn: Number(await status.getAttribute('data-drawn')), finalEpoch: Number(await status.getAttribute('data-epoch')), ...measurement })
    await writeFile(info.outputPath('explorer-partial-capacity.json'), JSON.stringify(samples, null, 2))
    await canvas.screenshot({ path: info.outputPath(`catalog-${mode}.png`) })
  }
  // Read a bounded prefix of the actual 2D draw's uploaded clip coordinates.
  // Install after cadence sampling, so this diagnostic never enters its timing.
  const planar = page.locator('canvas.trajectory-canvas')
  await planar.evaluate(node => {
    const canvas = node as HTMLCanvasElement, gl = canvas.getContext('webgl')!
    const audit = window as PickWindow
    audit.realPickPoints = []
    const buffers = new Map<WebGLBuffer, { prefix: Float32Array; tail: Float32Array }>()
    const save = (target: number, offset: number, data: unknown) => {
      if (target !== gl.ARRAY_BUFFER || offset !== 0 || !(data instanceof Float32Array)) return
      buffers.set(gl.getParameter(gl.ARRAY_BUFFER_BINDING), { prefix: data.slice(0, 8192), tail: data.slice(-64) })
    }
    const bufferData = gl.bufferData.bind(gl), bufferSubData = gl.bufferSubData.bind(gl), draw = gl.drawArrays.bind(gl)
    gl.bufferData = ((target: number, data: number | AllowSharedBufferSource | null, usage: number) => {
      save(target, 0, data)
      if (typeof data === 'number') bufferData(target, data, usage)
      else bufferData(target, data, usage)
    }) as typeof gl.bufferData
    gl.bufferSubData = (target, offset, data) => { save(target, offset, data); bufferSubData(target, offset, data) }
    gl.drawArrays = (mode, first, count) => {
      draw(mode, first, count)
      if (mode !== gl.POINTS) return
      const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram
      const location = gl.getAttribLocation(program, 'aPosition')
      if (location < 0) return
      const stored = buffers.get(gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING))
      if (!stored) return
      const points = stored.prefix
      const rect = canvas.getBoundingClientRect(), visible: { x: number; y: number }[] = []
      const catalogCount = Number(document.querySelector('[data-testid="explorer-catalog-status"]')?.getAttribute('data-drawn'))
      const markers = stored.tail.slice(-Math.max(0, count - catalogCount) * 2)
      for (let row = 0; row < Math.min(count, points.length / 2); row++) {
        const x = rect.left + (points[row * 2] + 1) * rect.width / 2
        const y = rect.top + (1 - points[row * 2 + 1]) * rect.height / 2
        let overlapsMarker = false
        for (let offset = 0; offset < markers.length; offset += 2) {
          const markerX = rect.left + (markers[offset] + 1) * rect.width / 2
          const markerY = rect.top + (1 - markers[offset + 1]) * rect.height / 2
          if (Math.hypot(markerX - x, markerY - y) < 12) { overlapsMarker = true; break }
        }
        if (overlapsMarker) continue
        if (x < rect.left + 30 || x > rect.right - 30 || y < rect.top + 150 || y > rect.bottom - 280) continue
        const target = document.elementFromPoint(x, y)
        if (target !== canvas && target !== canvas.parentElement) continue
        if (visible.some(point => Math.hypot(point.x - x, point.y - y) < 30)) continue
        visible.push({ x, y }); if (visible.length === 2) break
      }
      audit.realPickPoints = visible
    }
    audit.restorePickCapture = () => { gl.bufferData = bufferData; gl.bufferSubData = bufferSubData; gl.drawArrays = draw }
  })
  const picks: { clickToInspectorMs: number; selectedName: string }[] = []
  try {
    await page.locator('.simulation-bar input[type=date]').fill('2026-09-26')
    await expect(page.locator('.catalog-scene-controls > summary')).toContainText('Time synchronized', { timeout: 30000 })
    await page.locator('.accessible-scene-controls > summary').click()
    for (let step = 0; step < 3; step++) await page.locator('.accessible-view-actions').getByRole('button', { name: /Zoom in/ }).click()
    await page.locator('.accessible-scene-controls > summary').click()
    await planar.evaluate((node, eventName) => node.dispatchEvent(new Event(eventName)), PREPARE_CANVAS_CAPTURE_EVENT)
    await expect.poll(() => page.evaluate(() => (window as PickWindow).realPickPoints.length)).toBe(2)
    const points = await page.evaluate(() => (window as PickWindow).realPickPoints)
    for (const point of points) {
      const name = page.locator('.inspector-toggle strong'), previous = await name.textContent()
      const started = performance.now()
      await page.mouse.click(point.x, point.y)
      await expect(name).not.toHaveText(previous ?? '', { timeout: 15000 })
      picks.push({ clickToInspectorMs: performance.now() - started, selectedName: await name.innerText() })
      await expect(page.locator('.inspector-header h2')).toHaveText(picks.at(-1)!.selectedName)
    }
  } finally {
    await writeFile(info.outputPath('catalog-pick-audit.json'), JSON.stringify({ points: await page.evaluate(() => (window as PickWindow).realPickPoints), picks }, null, 2))
    await page.evaluate(() => (window as PickWindow).restorePickCapture())
  }
  expect(errors).toEqual([])
  await page.locator('.catalog-scene-controls > summary').click()
  await page.getByRole('button', { name: 'Stop and return to sample', exact: true }).click()
  await expect(page.getByTestId('explorer-catalog-status')).toHaveCount(0)
  const report = info.outputPath('explorer-capacity.json')
  await writeFile(report, JSON.stringify({ capturedAt: new Date().toISOString(), browser: browser.version(), cpu: cpus()[0]?.model,
    dataset: pin, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), samples, picks,
    limitations: ['Local dataset and loopback Go backend; not production network performance.', 'Up to 120 browser frame intervals or six seconds per mode; no GPU completion timing, peak RSS, thermal endurance, or mobile certification.', 'All MPC rows use two-body propagation; point draw submissions are separately counted and can be capped by the adaptive budget.'],
  }, null, 2))
  await info.attach('explorer-capacity.json', { path: report, contentType: 'application/json' })
})
