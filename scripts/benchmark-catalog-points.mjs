// Real immutable MPC binary rows. CPU propagation only: no FPS/GPU claim.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { cpus, totalmem } from 'node:os'
import { resolve, dirname, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const release = resolve(option('--release', 'public/data/asteroids/releases/mpcorb-26bbcb75e45b7cbb-full'))
const output = resolve(option('--output', '.cache/catalog-points-benchmark.json'))
const modulePath = resolve(option('--module', 'src/engine/ephemeris/catalogPoints.ts'))
const snapshot = option('--snapshot', null)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !extname(specifier)) return next(`${specifier}.ts`, context)
  return next(specifier, context)
} })
const implementation = await import(pathToFileURL(modulePath).href)
const manifestBytes = readFileSync(resolve(release, 'manifest.json')), checksumBytes = readFileSync(resolve(release, 'checksums.json'))
const manifest = JSON.parse(manifestBytes), checksums = JSON.parse(checksumBytes).files
if (manifest.format !== 'binary-v1' || !Number.isSafeInteger(manifest.totalCount) || manifest.totalCount < 1) throw new Error('Expected a binary catalog release')
const elements = new Float64Array(manifest.totalCount * 8)
let count = 0
for (let i = 0; i < manifest.chunkCount; i++) {
  const name = `binary/chunk-${String(i).padStart(4, '0')}.bin`, bytes = readFileSync(resolve(release, name))
  if (sha(bytes) !== checksums[name] || bytes.length % 64 !== 0) throw new Error(`Invalid source shard ${name}`)
  const data = new Float64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  elements.set(data, count * 8); count += data.length / 8
}
if (count !== manifest.totalCount) throw new Error('Source count does not match manifest')
if (snapshot) {
  mkdirSync(resolve(snapshot), { recursive: true })
  copyFileSync(modulePath, resolve(snapshot, 'catalogPoints.ts'))
  copyFileSync(resolve(dirname(modulePath), 'kepler.ts'), resolve(snapshot, 'kepler.ts'))
}
const results = []
for (const size of [...new Set([30_000, 100_000, 300_000, 1_000_000, count].filter(n => n <= count))]) {
  const source = elements.subarray(0, size * 8)
  const start = performance.now()
  const prepared = implementation.prepareCatalogElements?.(source)
  const prepareMs = performance.now() - start
  const compute = jd => prepared
    ? implementation.propagatePreparedCatalogPositions(prepared, jd, '3d')
    : implementation.propagateCatalogElementPositions(source, jd, '3d')
  compute(2461306.5)
  const durations = []; let last
  for (let i = 0; i < 7; i++) { const start = performance.now(); last = compute(2461306.5 + i / 24); durations.push(performance.now() - start) }
  const sorted = [...durations].sort((a, b) => a - b)
  results.push({ count: size, prepareMs, retainedElementBytes: prepared?.data.byteLength ?? source.byteLength, outputBytes: last.byteLength, milliseconds: durations, medianMs: sorted[3], maxMs: sorted[6], finalOutputSha256: sha(new Uint8Array(last.buffer, last.byteOffset, last.byteLength)) })
}
const report = { schemaVersion: 1, measurement: 'real-MPC-CPU-propagation-only-not-rendering-or-physical-accuracy', generatedAt: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem() }, release: { version: manifest.version, count, sourceSha256: manifest.sourceSha256, manifestSha256: sha(manifestBytes), checksumsSha256: sha(checksumBytes), validatedBinaryShards: manifest.chunkCount }, implementationSha256: sha(readFileSync(modulePath)), mode: '3d', inputScale: 'TT', results }
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ output, results: results.map(({ count, prepareMs, medianMs, maxMs }) => ({ count, prepareMs, medianMs, maxMs })) }, null, 2))
