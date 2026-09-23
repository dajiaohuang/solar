import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { columnsForSchema, parseCount, parseSources, sha256, spatialChunks } from '../../scripts/lib/gaia-dr3.mjs'
import { decodeGaiaManifest, streamGaiaChunks, type GaiaSource } from '../../src/lib/gaiaChunks'

const root = 'tests/fixtures/gaia-six-20260923/'
const bytes = await readFile(root+'manifest.json')
const original = JSON.parse(bytes.toString())
test('real version-two ESA source preserves all 15 six-parameter records and original hashes', async () => {
  for (const item of [...original.sources,...original.chunks]) {
    const bytes = await readFile(root+item.path)
    expect(bytes.length).toBe(item.bytes); expect(sha256(bytes)).toBe(item.sha256)
  }
  const count = parseCount(await readFile(root+'count.csv'),1024)
  const rows = parseSources(await readFile(root+'rows.csv'),original.settings,count,2)
  expect(count).toBe(94)
  expect(rows.filter((row: GaiaSource)=>row.astrometric_params_solved===95)).toHaveLength(15)
  expect(rows.find((row: GaiaSource)=>row.source_id==='65212966653827840')).toMatchObject({pseudocolour:1.3467354,pseudocolour_error:.03115847,pmdec_pseudocolour_corr:-.25432906})
  expect(spatialChunks(rows)[0]).toEqual(JSON.parse(await readFile(root+original.chunks[0].path,'utf8')))
  expect(()=>parseSources(Buffer.from(''),original.settings,count,3)).toThrow(/schema/)
})
test('browser decoding uses the declared schema and retains original extended rows', async () => {
  const manifest = decodeGaiaManifest(bytes), sources: GaiaSource[] = []
  const result = await streamGaiaChunks({manifest,region:{raStartDeg:0,raEndDeg:360,decMinDeg:-90,decMaxDeg:90,epochJulianYear:2016},baseUrl:'https://example.test/',signal:new AbortController().signal,
    fetcher:async url=>{ const bytes=await readFile(root+new URL(String(url)).pathname.slice(1)); return new Response(bytes,{headers:{'Content-Type':'application/json','Content-Length':String(bytes.length)}}) },
    onChunk:async chunk=>{ sources.push(...chunk.sources) }})
  expect(result.verifiedRows).toBe(94)
  expect(Object.keys(sources[0])).toHaveLength(35)
  expect(sources).toEqual(JSON.parse(await readFile(root+original.chunks[0].path,'utf8')).sources)
  const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value))
  expect(()=>decodeGaiaManifest(encode({...original,schemaVersion:1}))).toThrow(/columns/)
  expect(()=>decodeGaiaManifest(encode({...original,columns:columnsForSchema(1)}))).toThrow(/columns/)
})
