import { readFile } from 'node:fs/promises'
import { test,expect } from 'vitest'
import { decodeSbdbConic } from '../../src/data/loaders/sbdbConic'
import receipt from '../fixtures/sbdb-borisov-20260923/receipt.json'
type Fixture = {orbit:{equinox:string; elements:Array<{name:string;units:string|null;value:unknown}>};object:{orbit_id:string};signature:{version:string}}
const bytes=await readFile('tests/fixtures/sbdb-borisov-20260923/response.json')

test('real Borisov source preserves hyperbolic elements and non-gravitational fit metadata',async()=>{
  const result=await decodeSbdbConic(bytes)
  expect(result.sourceSha256).toBe(receipt.sha256); expect(result.sourceBytes).toBe(receipt.bytes)
  expect(result.parameters.eccentricity).toBe(3.356475782676596)
  expect(result.parameters.periapsisKm).toBe(2.006520878500843*149597870.7)
  expect(result.periapsisTdbJd).toBe(Number('2458826.052845906059'))
  expect(result.periapsisTdb).toEqual({day:2458826,fraction:Number('0.052845906059')})
  expect(result.frame).toBe('ECLIPJ2000'); expect(result.center).toBe('Sun')
  expect(result.modelParameters).toEqual(JSON.parse(bytes.toString()).orbit.model_pars)
  expect(result.parameters).not.toHaveProperty('gmKm3PerSecond2')
  expect(result.modelParameters).toHaveLength(9)
})
test('ambiguous units, solution identity, missing fields and wrong frames fail',async()=>{
  for(const mutate of [
    (r:Fixture)=>{r.orbit.equinox='J2050'},
    (r:Fixture)=>{r.orbit.elements.find(e=>e.name==='tp')!.units='UTC'},
    (r:Fixture)=>{r.orbit.elements.push(r.orbit.elements[0])},
    (r:Fixture)=>{r.orbit.elements.find(e=>e.name==='q')!.value=true},
    (r:Fixture)=>{r.object.orbit_id='different'},
    (r:Fixture)=>{r.signature.version='9'},
  ]) {
    const raw=JSON.parse(bytes.toString());mutate(raw)
    await expect(decodeSbdbConic(new TextEncoder().encode(JSON.stringify(raw)))).rejects.toThrow()
  }
})
