// Isolate row-copy allocation cost on original MPC shards. This is not a
// network/render benchmark, nor a physical FPS or total-memory measurement.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { cpus } from 'node:os'

const [output, ...extra] = process.argv.slice(2)
if (!output || extra.length || !global.gc) throw new Error('Usage: node --expose-gc scripts/benchmark-catalog-row-copy.mjs <new-report.json>')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const pointer = JSON.parse(await readFile('public/data/asteroids/dataset-version.json', 'utf8'))
const manifestPath = resolve('public/data/asteroids', pointer.manifestPath)
const manifestBytes = await readFile(manifestPath), manifest = JSON.parse(manifestBytes)
const directory = dirname(manifestPath), checksums = JSON.parse(await readFile(resolve(directory, 'checksums.json')))
const shards = []
for (let i = 0; i < manifest.chunkCount; i++) {
  const path = `binary/chunk-${String(i).padStart(4, '0')}.bin`, bytes = await readFile(resolve(directory, path))
  if (sha(bytes) !== checksums.files[path]) throw new Error(`Original shard checksum mismatch: ${path}`)
  shards.push(new Float64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength)))
}
const variant = (method, retainEvery) => {
  let ms = 0, rows = 0
  const hash = createHash('sha256')
  for (const elements of shards) {
    const selected = new Float64Array(elements.length)
    let used = 0
    const start = performance.now()
    for (let row = 0; row < elements.length/8; row += retainEvery) {
      const source = row*8, target = used*8
      if (method === 'subarray-set') selected.set(elements.subarray(source, source+8), target)
      else for (let column = 0; column < 8; column++) selected[target+column] = elements[source+column]
      used++
    }
    ms += performance.now()-start; rows += used
    hash.update(new Uint8Array(selected.buffer, 0, used*64))
  }
  return { ms, rows, sha256: hash.digest('hex') }
}
const results = []
for (const retainEvery of [1, 2, 100]) {
  for (let warm = 0; warm < 2; warm++) { variant('subarray-set', retainEvery); variant('scalar-copy', retainEvery) }
  const samples = { 'subarray-set': [], 'scalar-copy': [] }
  let reference
  for (let repeat = 0; repeat < 10; repeat++) {
    for (const method of repeat%2 ? ['scalar-copy', 'subarray-set'] : ['subarray-set', 'scalar-copy']) {
      global.gc()
      const result = variant(method, retainEvery)
      reference ??= result
      if (result.sha256 !== reference.sha256 || result.rows !== reference.rows) throw new Error('Copy variants changed original Float64 bytes')
      samples[method].push(result.ms)
    }
  }
  const summarize = values => { const sorted = [...values].sort((a, b) => a-b); return { samplesMs: values, medianMs: (sorted[4]+sorted[5])/2, p95Ms: sorted[9] } }
  results.push({ retainEvery, selectedRows: reference.rows, outputSha256: reference.sha256,
    subarraySet: summarize(samples['subarray-set']), scalarCopy: summarize(samples['scalar-copy']) })
}
const report = { schemaVersion: 1, node: process.version, platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model,
  manifestSha256: sha(manifestBytes), sourceRows: shards.reduce((sum, rows) => sum+rows.length/8, 0), shards: shards.length,
  results, benchmarkSha256: sha(await readFile(new URL(import.meta.url))),
  scope: 'Original shard Float64 row copies with synthetic retention strides. Alternating warmed methods; GC before each sample. Destination-buffer allocation and output hashing excluded; per-row view allocation included in timers. Not full pipeline, browser GC, GPU time, display FPS or physical accuracy.' }
await writeFile(output, JSON.stringify(report, null, 2)+'\n', { flag: 'wx' })
console.log(JSON.stringify({ output, results: results.map(row => ({ retainEvery: row.retainEvery, selectedRows: row.selectedRows,
  subarrayMedianMs: row.subarraySet.medianMs, scalarMedianMs: row.scalarCopy.medianMs })) }))
