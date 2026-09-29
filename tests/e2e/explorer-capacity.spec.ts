import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { cpus } from 'node:os'

type WorkerAudit = { direction: string; type: string; epoch?: number; row?: number; requestId?: number }
type AuditWindow = Window & { catalogAudit: WorkerAudit[] }
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
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/solar-test-api/**', async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: backend + url.pathname.replace('/solar-test-api', '') + url.search })
    await route.fulfill({ response })
  })
  await page.route('**/data/asteroids/**', async route => {
    const url = new URL(route.request().url())
    const path = resolve(root, decodeURIComponent(url.pathname.split('/data/asteroids/')[1]))
    const within = relative(root, path)
    if (isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) throw new Error('Dataset path escaped its root')
    await route.fulfill({ body: await readFile(path), contentType: path.endsWith('.json') ? 'application/json' : 'application/octet-stream' })
  })
  await page.addInitScript(() => {
    localStorage.setItem('solar-atlas-first-run-v1', 'complete')
    const audit: WorkerAudit[] = []; (window as AuditWindow).catalogAudit = audit
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
        if (Array.isArray(options)) super.postMessage(data, options)
        else super.postMessage(data, options)
      }
    }
  })
  await page.goto('./?v=4&catalogCloud=1&quality=max&lang=en')
  await expect(page.getByTestId('trajectory-canvas-3d')).toBeVisible()
  await page.locator('.simulation-bar input[type=date]').fill('2026-09-03')
  await page.locator('.simulation-bar .rate-field select').selectOption('1')
  await page.getByLabel('Catalog memory budget', { exact: true }).selectOption('1024')
  const samples = []
  for (const mode of ['3D', '2D'] as const) {
    if (mode === '2D') await page.locator('.simulation-bar').getByRole('button', { name: mode, exact: true }).click()
    const start = performance.now()
    if (mode === '3D') await page.getByLabel('Catalog population', { exact: true }).selectOption(String(manifest.totalCount))
    const status = page.getByTestId('explorer-catalog-status')
    await expect.poll(async () => {
      const failure = await page.locator('.catalog-cloud-error').allTextContents()
      if (errors.length || failure.length) throw new Error(JSON.stringify({ errors, failure }))
      return Number(await status.getAttribute('data-computed'))
    }, { timeout: 90_000 }).toBe(manifest.totalCount)
    await expect.poll(async () => Number(await status.getAttribute('data-drawn'))).toBeGreaterThan(0)
    const loadMs = performance.now() - start
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
    expect(measurement.contextLost).toBe(false)
    expect(measurement.maxPointsSubmitted).toBeGreaterThan(30_000)
    expect(measurement.maxPointsSubmitted).toBeLessThanOrEqual(manifest.totalCount)
    samples.push({ mode, loadMs, initialEpoch, computed: Number(await status.getAttribute('data-computed')), drawn: Number(await status.getAttribute('data-drawn')), finalEpoch: Number(await status.getAttribute('data-epoch')), ...measurement })
    await writeFile(info.outputPath('explorer-partial-capacity.json'), JSON.stringify(samples, null, 2))
    await canvas.screenshot({ path: info.outputPath(`catalog-${mode}.png`) })
  }
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Stop and return to sample', exact: true }).click()
  await expect(page.getByTestId('explorer-catalog-status')).toHaveCount(0)
  const report = info.outputPath('explorer-capacity.json')
  await writeFile(report, JSON.stringify({ capturedAt: new Date().toISOString(), browser: browser.version(), cpu: cpus()[0]?.model,
    dataset: pin, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), samples,
    limitations: ['Local dataset and loopback Go backend; not production network performance.', 'Up to 120 browser frame intervals or six seconds per mode; no GPU completion timing, peak RSS, thermal endurance, or mobile certification.', 'All MPC rows use two-body propagation; point draw submissions are separately counted and can be capped by the adaptive budget.'],
  }, null, 2))
  await info.attach('explorer-capacity.json', { path: report, contentType: 'application/json' })
})
