import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'

const manifest = JSON.parse(readFileSync(new URL('../src/data/ephemeris-manifest.json', import.meta.url)))
const entry = manifest.files.find(file => file.core)
const bytes = readFileSync(new URL(`../public/data/ephemerides/${entry.path}`, import.meta.url))
if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Benchmark kernel differs from pinned source')
const kernel = new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
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
const result = { node: process.version, platform: process.platform, arch: process.arch,
  kernel: { path: entry.path, sha256: entry.sha256 },
  implementationSha256: createHash('sha256').update(readFileSync(new URL('../src/engine/ephemeris/spk.ts', import.meta.url))).digest('hex'), results }
const output = process.argv[2]
if (output) { mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n') }
console.log(JSON.stringify(result, null, 2))
