// Run after a production build. Real MPC input in an isolated browser worker;
// this deliberately does not claim production streaming, GPU capacity or FPS.
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { resolve, dirname, extname } from 'node:path'

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !extname(specifier)) return next(`${specifier}.ts`, context)
  return next(specifier, context)
} })
const { propagateCatalogElementPositions } = await import('../src/engine/ephemeris/catalogPoints.ts')
const { utcJulianDayToTt } = await import('../src/engine/ephemeris/timeScales.ts')

const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
const release = resolve(option('--release', 'public/data/asteroids/releases/mpcorb-26bbcb75e45b7cbb-full'))
const output = resolve(option('--output', '.cache/catalog-worker-browser.json'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = readFileSync(resolve(release, 'manifest.json')), checksumBytes = readFileSync(resolve(release, 'checksums.json'))
const manifest = JSON.parse(manifestBytes), checksums = JSON.parse(checksumBytes).files
const workerName = readdirSync('dist/assets').find(name => /^catalog-points\.worker-.*\.js$/.test(name))
if (!workerName || manifest.format !== 'binary-v1') throw new Error('Build the production catalog worker and provide a binary release first')
const workerBytes = readFileSync(resolve('dist/assets', workerName))
const elements = Buffer.alloc(manifest.totalCount * 64)
let offset = 0
for (let i = 0; i < manifest.chunkCount; i++) {
  const name = `binary/chunk-${String(i).padStart(4, '0')}.bin`, bytes = readFileSync(resolve(release, name))
  if (sha(bytes) !== checksums[name] || bytes.length % 64) throw new Error(`Invalid source shard ${name}`)
  bytes.copy(elements, offset); offset += bytes.length
}
if (offset !== elements.length) throw new Error('Catalog row count mismatch')
const server = createServer((req, res) => {
  const body = req.url === '/worker.js' ? workerBytes : req.url === '/elements.bin' ? elements : req.url === '/' ? Buffer.from('<!doctype html><title>Isolated catalog worker benchmark</title>') : null
  if (!body) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': req.url === '/worker.js' ? 'text/javascript' : req.url === '/elements.bin' ? 'application/octet-stream' : 'text/html', 'content-length': body.length, 'cache-control': 'no-store' }); res.end(body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const result = await page.evaluate(async ({ count, inputSha256 }) => {
    const hex = buffer => [...new Uint8Array(buffer)].map(n => n.toString(16).padStart(2, '0')).join('')
    const source = await (await fetch('/elements.bin')).arrayBuffer()
    if (source.byteLength !== count * 64 || hex(await crypto.subtle.digest('SHA-256', source)) !== inputSha256) throw new Error('Browser input identity mismatch')
    const worker = new Worker('/worker.js', { type: 'module' }), pending = new Map(), lateResults = []
    let sequence = 0, cancelledId = null, onProgress = null
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress?.(data); return }
      if (data.type === 'result' && data.requestId === cancelledId) lateResults.push(data.requestId)
      const job = pending.get(data.requestId)
      if (job) { clearTimeout(job.timer); pending.delete(data.requestId); data.type === 'error' ? job.reject(new Error(data.error)) : job.resolve(data) }
    }
    const request = (type, fields = {}, transfer = []) => {
      const requestId = ++sequence
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Worker benchmark timed out')) }, 30_000)
        pending.set(requestId, { resolve, reject, timer }); worker.postMessage({ type, requestId, ...fields }, transfer)
      })
    }
    const heartbeat = []; let previous = performance.now()
    const ticker = setInterval(() => { const now = performance.now(); heartbeat.push(now - previous); previous = now }, 16)
    const cases = []
    try {
      for (const size of [...new Set([30_000, 100_000, 300_000, 1_000_000, count].filter(n => n <= count))]) {
        const elements = new Float64Array(source.slice(0, size * 64)), start = performance.now()
        await request('initialize', { elements }, [elements.buffer])
        const initializeMs = performance.now() - start, milliseconds = []; let outputSha256 = ''
        for (let i = 0; i < 7; i++) {
          const start = performance.now(), data = await request('compute', { julianDay: 2461306.5 + i / 24, mode: '3d' })
          milliseconds.push(performance.now() - start)
          if (data.positions.length !== size * 3 || !Number.isFinite(data.positions[0]) || !Number.isFinite(data.positions.at(-1))) throw new Error('Invalid worker result')
          if (i === 6) outputSha256 = hex(await crypto.subtle.digest('SHA-256', data.positions.buffer))
        }
        const sorted = [...milliseconds].sort((a, b) => a - b)
        cases.push({ count: size, initializeMs, milliseconds, medianMs: sorted[3], maxMs: sorted[6], finalOutputSha256: outputSha256 })
      }
      // Reset after the first compute chunk; then prove the worker can process
      // a fresh empty job and the interrupted full job never publishes.
      const started = performance.now()
      const firstProgress = new Promise(resolve => { onProgress = resolve })
      cancelledId = ++sequence
      worker.postMessage({ type: 'compute', requestId: cancelledId, julianDay: 2461308.5, mode: '3d' })
      await Promise.race([firstProgress, new Promise((_, reject) => setTimeout(() => reject(new Error('No progress before cancellation')), 5000))])
      const atCancel = performance.now(); onProgress = null
      worker.postMessage({ type: 'reset', requestId: ++sequence })
      const empty = await request('compute', { julianDay: 2461308.5, mode: '3d' })
      const resetAndEmptyResultMs = performance.now() - atCancel
      await new Promise(resolve => setTimeout(resolve, 50))
      if (empty.positions.length !== 0 || lateResults.length) throw new Error('Cancelled work published a stale result')
      const sorted = [...heartbeat].sort((a, b) => a - b)
      return { cases, cancellation: { firstProgressMs: atCancel - started, resetAndEmptyResultMs, staleResults: lateResults.length }, heartbeat: { metric: '16ms main-thread timer intervals; not rendered frames', samples: heartbeat.length, p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], p99Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .99) - 1)], maxMs: sorted.at(-1) }, userAgent: navigator.userAgent }
    } finally {
      clearInterval(ticker); worker.terminate()
      for (const job of pending.values()) clearTimeout(job.timer)
    }
  }, { count: manifest.totalCount, inputSha256: sha(elements) })
  for (const row of result.cases) {
    const source = new Float64Array(elements.buffer, elements.byteOffset, row.count * 8)
    const reference = propagateCatalogElementPositions(source, utcJulianDayToTt(2461306.5 + 6 / 24), '3d')
    if (sha(new Uint8Array(reference.buffer)) !== row.finalOutputSha256) throw new Error(`Worker/reference mismatch at ${row.count} actual records`)
  }
  const report = { schemaVersion: 1, measurement: 'isolated-production-browser-worker-real-MPC-input-not-GPU-or-app-streaming', generatedAt: new Date().toISOString(), browser: browser.version(), workerAsset: workerName, workerSha256: sha(workerBytes), release: { version: manifest.version, count: manifest.totalCount, manifestSha256: sha(manifestBytes), checksumsSha256: sha(checksumBytes), validatedBinaryShards: manifest.chunkCount }, inputScale: 'UTC-converted-to-TT-by-worker', finalOutputReference: 'all-final-components-hash-match-legacy-propagator-at-same-TT-epoch', ...result }
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ output, cases: result.cases.map(({ count, initializeMs, medianMs, maxMs }) => ({ count, initializeMs, medianMs, maxMs })), cancellation: result.cancellation, heartbeat: result.heartbeat }, null, 2))
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
