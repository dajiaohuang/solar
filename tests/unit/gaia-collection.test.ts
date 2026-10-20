import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import capacity from '../../src/data/gaiaCapacity.json'
import { decodeGaiaManifest, streamGaiaChunks, type GaiaChunk } from '../../src/lib/gaiaChunks'
import { planGaiaCollection } from '../../src/lib/gaiaCollection'
import { GaiaSourceStore, gaiaNumericFieldCount, isGaiaPackedSourceBatch, packGaiaSourcesAndDisplay } from '../../src/lib/gaiaPackedSources'
import { validateGaiaLoadRequest } from '../../src/workers/gaia.protocol'

const fixtureRoot = 'tests/fixtures/gaia-pleiades-20260923/'
const fixtureBytes = await readFile(fixtureRoot+'manifest.json')
const manifest = decodeGaiaManifest(fixtureBytes)
const schemaV2Manifest = decodeGaiaManifest(await readFile('tests/fixtures/gaia-six-20260923/manifest.json'))
const allSky: Parameters<typeof streamGaiaChunks>[0]['region'] = {
  raStartDeg:0, raEndDeg:360, decMinDeg:-90, decMaxDeg:90, epochJulianYear:2016,
}
const response = (bytes: Uint8Array) => new Response(bytes as Uint8Array<ArrayBuffer>, {
  headers:{'Content-Type':'application/json','Content-Length':String(bytes.byteLength)},
})

test('plans a shared wrap-aware tangent view and rejects an unstable or overwide collection', () => {
  const west = structuredClone(manifest), east = structuredClone(manifest)
  west.settings = { ...west.settings, raDeg:359, decDeg:0, radiusDeg:1 }
  east.settings = { ...east.settings, raDeg:1, decDeg:0, radiusDeg:1 }
  const plan = planGaiaCollection([west,east])
  expect(Math.min(plan.projection.centerRaDeg,360-plan.projection.centerRaDeg)).toBeLessThan(1e-9)
  expect(plan.projection.centerDecDeg).toBeCloseTo(0,12)
  expect(plan.projection.radiusDeg).toBeCloseTo(2,10)
  const far = structuredClone(east)
  west.settings = { ...west.settings, raDeg:0, decDeg:0, radiusDeg:2 }
  far.settings = { ...far.settings, raDeg:160, decDeg:0, radiusDeg:2 }
  expect(() => planGaiaCollection([west,far])).toThrow(/tangent-plane field/)
  far.settings = { ...far.settings, raDeg:180 }
  expect(() => planGaiaCollection([west,far])).toThrow(/stable tangent-plane center/)
  expect(() => planGaiaCollection(Array(9).fill(manifest))).toThrow(/1 to 8/)
})

test('rejects mixed schemas and aggregate row, byte and chunk budgets before chunk reads', () => {
  expect(() => planGaiaCollection([manifest,schemaV2Manifest])).toThrow(/same source-column schema/)
  const fullRegion = maximumRowsManifest()
  expect(planGaiaCollection([fullRegion,fullRegion]).declaredRows).toBe(capacity.maxChartRows)
  expect(() => planGaiaCollection([fullRegion,fullRegion,fullRegion])).toThrow(/aggregate row, byte or chunk budget/)

  const oversizedBytes = structuredClone(manifest)
  oversizedBytes.chunks = oversizedBytes.chunks.map(chunk => ({ ...chunk, bytes:capacity.maxChunkBytes }))
  expect(() => planGaiaCollection(Array(5).fill(oversizedBytes))).toThrow(/aggregate row, byte or chunk budget/)

  const dense = denseManifest()
  expect(() => planGaiaCollection([dense,dense])).toThrow(/aggregate row, byte or chunk budget/)
})

test('retains the aggregate chart capacity for packed source records', () => {
  expect(() => new GaiaSourceStore(manifest.schemaVersion,capacity.maxChartRows)).not.toThrow()
  expect(() => new GaiaSourceStore(manifest.schemaVersion,capacity.maxChartRows+1)).toThrow(/packed-source capacity/)
})

function maximumRowsManifest() {
  const rowsPerChunk = capacity.maxCatalogRows/4
  const chunks = Array.from({length:4}, (_,index) => {
    const ra = 10+index, dec = 22
    return { ...structuredClone(manifest.chunks[0]), path:`r${ra}-d${dec}.json`, bytes:1, rows:rowsPerChunk,
      raRangeDeg:[ra*5,(ra+1)*5] as [number,number], decRangeDeg:[dec*5-90,(dec+1)*5-90] as [number,number] }
  })
  return { ...structuredClone(manifest), rows:capacity.maxCatalogRows, chunks,
    settings:{ ...manifest.settings, maxRows:capacity.maxCatalogRows }, queryCountMatched:true, rowCountEvidence:undefined }
}

function denseManifest() {
  const chunks = Array.from({length:capacity.maxChunks}, (_,index) => {
    const ra = Math.floor(index/36), dec = index%36
    return { path:`r${ra}-d${dec}.json`, sha256:'a'.repeat(64), bytes:1, rows:1,
      raRangeDeg:[ra*5,(ra+1)*5] as [number,number], decRangeDeg:[dec*5-90,(dec+1)*5-90] as [number,number] }
  })
  return { ...structuredClone(manifest), rows:capacity.maxChunks, chunks,
    settings:{ ...manifest.settings, maxRows:capacity.maxChunks }, queryCountMatched:true, rowCountEvidence:undefined }
}

test('validates unique bounded multi-manifest URL requests', () => {
  const manifestUrls = ['https://example.test/a/manifest.json','https://example.test/b/manifest.json']
  expect(validateGaiaLoadRequest({manifestUrls})).toEqual({manifestUrls})
  expect(() => validateGaiaLoadRequest({manifestUrls:[manifestUrls[0],manifestUrls[0]]})).toThrow(/Duplicate Gaia manifest URL/)
  expect(() => validateGaiaLoadRequest({manifestUrls:['https://user:pass@example.test/manifest.json','https://example.test/b.json']})).toThrow(/Invalid Gaia manifest URL/)
  expect(() => validateGaiaLoadRequest({manifestUrls:['ftp://example.test/a.json','https://example.test/b.json']})).toThrow(/Invalid Gaia manifest URL/)
  expect(() => validateGaiaLoadRequest({manifestUrls:Array(9).fill('https://example.test/manifest.json').map((url,index) => `https://example.test/${index}.json`)})).toThrow(/2 to 8/)
})

test('deduplicates typed Gaia source IDs before packing display and export columns', async () => {
  const chunks: GaiaChunk[] = []
  await streamGaiaChunks({manifest,region:allSky,baseUrl:'https://example.test/gaia/',signal:new AbortController().signal,
    fetcher:async () => response(await readFile(fixtureRoot+manifest.chunks[0].path)), onChunk:async chunk => { chunks.push(chunk) } })
  expect(chunks).toHaveLength(1)
  const seen = new Set<bigint>(), displaySettings = {
    centerRaDeg:manifest.settings.raDeg, centerDecDeg:manifest.settings.decDeg,
    radiusDeg:manifest.settings.radiusDeg,
  }
  const first = await packGaiaSourcesAndDisplay(chunks[0],manifest.schemaVersion,displaySettings,new AbortController().signal,seen)
  expect(first.sources.rowCount).toBe(manifest.rows)
  expect(first.duplicateRows).toBe(0)
  expect(isGaiaPackedSourceBatch(first.sources,manifest.rows,gaiaNumericFieldCount(manifest.schemaVersion))).toBe(true)

  const duplicate = await packGaiaSourcesAndDisplay(chunks[0],manifest.schemaVersion,displaySettings,new AbortController().signal,seen)
  expect(duplicate.duplicateRows).toBe(manifest.rows)
  expect(duplicate.sources.rowCount).toBe(0)
  expect(duplicate.display).toHaveLength(0)
  expect(isGaiaPackedSourceBatch(duplicate.sources,0,gaiaNumericFieldCount(manifest.schemaVersion))).toBe(true)
})
