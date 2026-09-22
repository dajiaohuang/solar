import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { gzipSync } from 'node:zlib'
import { packRuntimeJson } from './lib/pack-runtime-json.ts'
import { unpackRuntimeJson } from '../src/data/runtimeJson.ts'
import { runtimeEphemerisManifest } from '../src/engine/ephemeris/runtimeManifest.ts'
import { productDelivery } from './lib/product-delivery.ts'

function medianTime(operation) {
  for (let index = 0; index < 10; index++) operation()
  const samples = Array.from({ length: 51 }, () => {
    const start = performance.now()
    operation()
    return performance.now() - start
  }).sort((a, b) => a - b)
  return Number(samples[25].toFixed(3))
}

const datasets = ['ephemerisBodies.json', 'satelliteCatalog.json'].map(name => [
  name, JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8')),
])
for (const profile of ['full', 'preview']) datasets.push([
  `${profile} runtime manifest`, JSON.parse(JSON.stringify(runtimeEphemerisManifest(productDelivery(profile).manifest))),
])
console.log(JSON.stringify(datasets.map(([name, data]) => {
  const original = JSON.stringify(data), packed = JSON.stringify(packRuntimeJson(data))
  if (JSON.stringify(unpackRuntimeJson(JSON.parse(packed))) !== original) throw new Error(`Round trip differs: ${name}`)
  return {
    name, originalBytes: Buffer.byteLength(original), packedBytes: Buffer.byteLength(packed),
    originalGzipBytes: gzipSync(original).length, packedGzipBytes: gzipSync(packed).length,
    parseMedianMs: medianTime(() => JSON.parse(original)),
    parseAndUnpackMedianMs: medianTime(() => unpackRuntimeJson(JSON.parse(packed))),
  }
}), null, 2))
