import { performance } from 'node:perf_hooks'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.env.MPCORB_OUTPUT_DIR ?? resolve(import.meta.dirname, '..', 'public', 'data', 'asteroids'))
const syntheticCount = Number(process.env.CATALOG_BENCHMARK_COUNT ?? 1_550_000)
const strideBytes = 24

async function readInstalledIndex() {
  try {
    const pointer = JSON.parse(await readFile(resolve(root, 'dataset-version.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(resolve(root, pointer.manifestPath), 'utf8'))
    if (!manifest.compactIndex || !manifest.precomputedSamples) return null
    const release = resolve(root, pointer.manifestPath, '..')
    const index = await readFile(resolve(release, manifest.compactIndex.path))
    const desktopMetadata = await stat(resolve(release, manifest.precomputedSamples.desktop.metadataPath))
    const desktopBinary = await stat(resolve(release, manifest.precomputedSamples.desktop.binaryPath))
    const mobileMetadata = await stat(resolve(release, manifest.precomputedSamples.mobile.metadataPath))
    const mobileBinary = await stat(resolve(release, manifest.precomputedSamples.mobile.binaryPath))
    return {
      source: manifest.version,
      count: manifest.compactIndex.count,
      strideBytes: manifest.compactIndex.strideBytes,
      index,
      desktopFirstScreenBytes: desktopMetadata.size + desktopBinary.size,
      mobileFirstScreenBytes: mobileMetadata.size + mobileBinary.size,
      desktopRecords: manifest.precomputedSamples.desktop.count,
      mobileRecords: manifest.precomputedSamples.mobile.count,
    }
  } catch {
    return null
  }
}

function createSyntheticIndex(count) {
  const index = Buffer.allocUnsafe(count * strideBytes)
  for (let row = 0; row < count; row += 1) {
    const offset = row * strideBytes
    index.writeDoubleLE(1.5 + (row % 5000) / 1000, offset)
    index.writeUInt32LE(Math.round((row % 900) / 1000 * 1_000_000_000), offset + 8)
    index.writeUInt32LE((row % 180) * 1_000_000, offset + 12)
    index.writeInt16LE(row % 17 === 0 ? 0x7fff : Math.round((8 + (row % 240) / 10) * 100), offset + 16)
    index.writeUInt8(row % 11, offset + 18)
    index.writeUInt8(row % 5 === 0 ? 1 : 0, offset + 19)
    index.writeUInt16LE(Math.floor(row / 5000), offset + 20)
    index.writeUInt16LE(row % 5000, offset + 22)
  }
  return index
}

function scan(index, count, stride) {
  let matches = 0
  for (let row = 0; row < count; row += 1) {
    const offset = row * stride
    const a = index.readDoubleLE(offset)
    const e = index.readUInt32LE(offset + 8) / 1_000_000_000
    const inclination = index.readUInt32LE(offset + 12) / 1_000_000
    const hFixed = index.readInt16LE(offset + 16)
    const h = hFixed === 0x7fff ? undefined : hFixed / 100
    if (a >= 2 && a <= 3.5 && e <= 0.35 && inclination <= 30 && h !== undefined && h <= 22) matches += 1
  }
  return matches
}

const installed = await readInstalledIndex()
const benchmark = installed ?? {
  source: 'synthetic-v1',
  count: syntheticCount,
  strideBytes,
  index: createSyntheticIndex(syntheticCount),
  desktopFirstScreenBytes: null,
  mobileFirstScreenBytes: null,
  desktopRecords: 30_000,
  mobileRecords: 8_000,
}
const start = performance.now()
const matches = scan(benchmark.index, benchmark.count, benchmark.strideBytes)
const scanMilliseconds = performance.now() - start
const result = {
  source: benchmark.source,
  rows: benchmark.count,
  indexMiB: Number((benchmark.index.byteLength / 1024 / 1024).toFixed(2)),
  scanMilliseconds: Number(scanMilliseconds.toFixed(2)),
  matches,
  desktopFirstScreenMiB: benchmark.desktopFirstScreenBytes === null ? null : Number((benchmark.desktopFirstScreenBytes / 1024 / 1024).toFixed(2)),
  mobileFirstScreenMiB: benchmark.mobileFirstScreenBytes === null ? null : Number((benchmark.mobileFirstScreenBytes / 1024 / 1024).toFixed(2)),
  desktopMainThreadRecords: benchmark.desktopRecords,
  mobileMainThreadRecords: benchmark.mobileRecords,
}
console.log(JSON.stringify(result, null, 2))

if (benchmark.desktopRecords > 30_000 || benchmark.mobileRecords > 8_000) throw new Error('Main-thread record budget exceeded')
if (benchmark.desktopFirstScreenBytes !== null && benchmark.desktopFirstScreenBytes > 15 * 1024 * 1024) throw new Error('Desktop first-screen data budget exceeded')
if (benchmark.mobileFirstScreenBytes !== null && benchmark.mobileFirstScreenBytes > 5 * 1024 * 1024) throw new Error('Mobile first-screen data budget exceeded')
