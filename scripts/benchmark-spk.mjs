import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'

const manifest = JSON.parse(readFileSync(new URL('../src/data/ephemeris-manifest.json', import.meta.url)))
const entry = manifest.files.find(file => file.core)
const bytes = readFileSync(new URL(`../public/data/ephemerides/${entry.path}`, import.meta.url))
if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Benchmark kernel differs from pinned source')
const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const provenance = JSON.parse(readFileSync(new URL('../tests/fixtures/spk21-provenance.json', import.meta.url)))
const type21Fixtures = ['spk21-synthetic.bsp', 'spk21-horizons-eris.bsp', 'spk21-horizons-haumea.bsp', 'spk21-horizons-makemake.bsp']
const constructionWarmupBatches = 2
const constructionRuns = 7
const constructionsPerSample = 50
const construction = []
for (const path of type21Fixtures) {
  const source = readFileSync(new URL(`../tests/fixtures/${path}`, import.meta.url))
  const identity = provenance.fixtures.find(fixture => fixture.path === path)
  const sha256 = createHash('sha256').update(source).digest('hex')
  if (!identity || identity.bytes !== source.byteLength || sha256 !== identity.sha256) {
    throw new Error(`SPK Type 21 benchmark fixture differs from its provenance record: ${path}`)
  }
  const arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
  let parsed
  const constructBatch = () => {
    for (let i = 0; i < constructionsPerSample; i++) parsed = new SpkKernel(arrayBuffer)
  }
  for (let i = 0; i < constructionWarmupBatches; i++) constructBatch()
  const milliseconds = []
  for (let run = 0; run < constructionRuns; run++) {
    const start = performance.now()
    constructBatch()
    milliseconds.push((performance.now() - start) / constructionsPerSample)
  }
  const type21 = parsed.segments.filter(segment => segment.type === 21)
  if (!type21.length) throw new Error(`SPK Type 21 benchmark fixture has no Type 21 segments: ${path}`)
  const recordCounts = type21.map(segment => segment.recordCount)
  const type21Metadata = type21.map(segment => segment.type21)
  construction.push({
    path, sha256, bytes: source.byteLength,
    warmupBatches: constructionWarmupBatches,
    constructionsPerSample,
    runs: constructionRuns,
    milliseconds,
    medianMs: [...milliseconds].sort((a, b) => a - b)[Math.floor(constructionRuns / 2)],
    type21Segments: type21.length,
    totalType21Records: recordCounts.reduce((total, count) => total + count, 0),
    dimensions: [...new Set(type21Metadata.map(meta => meta.dimension))].sort((a, b) => a - b),
    differenceLineWordsPerConstruction: type21Metadata.reduce((total, meta) => total + meta.recordCount * meta.recordSize, 0),
    maximumRecordsInSegment: Math.max(...recordCounts),
  })
}
const iterations = 100_000, runs = 7, results = []
for (const target of [399, 301]) {
  const sample = index => kernel.evaluate(target, 840_000_000 + (index % 10_000) * 100)
  for (let i = 0; i < 5_000; i++) sample(i)
  const milliseconds = []
  let checksum = 0
  for (let run = 0; run < runs; run++) {
    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
      const state = sample(i)
      if (!state) throw new Error('Missing benchmark state')
      checksum += state.position.x + state.position.y + state.position.z + state.velocity.x + state.velocity.y + state.velocity.z
    }
    milliseconds.push(performance.now() - start)
  }
  const medianMs = [...milliseconds].sort((a, b) => a - b)[Math.floor(runs / 2)]
  results.push({ target, iterations, milliseconds, medianMs, checksum })
}
const result = { node: process.version, platform: process.platform, arch: process.arch, cpuModel: cpus()[0]?.model ?? 'unknown',
  kernel: { path: entry.path, sha256: entry.sha256 },
  implementationSha256: {
    benchmark: createHash('sha256').update(readFileSync(new URL('./benchmark-spk.mjs', import.meta.url))).digest('hex'),
    spk: createHash('sha256').update(readFileSync(new URL('../src/engine/ephemeris/spk.ts', import.meta.url))).digest('hex'),
    type21: createHash('sha256').update(readFileSync(new URL('../src/engine/ephemeris/spkType21.ts', import.meta.url))).digest('hex'),
  }, type21Construction: construction, results }
const output = process.argv[2]
if (output) { mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n') }
console.log(JSON.stringify(result, null, 2))
