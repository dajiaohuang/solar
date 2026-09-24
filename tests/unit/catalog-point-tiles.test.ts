import { expect, it } from 'vitest'
import { prepareCatalogElements, propagatePreparedCatalogTile } from '../../src/engine/ephemeris/catalogPoints'

const epoch = 2451545
const prepared = () => prepareCatalogElements(new Float64Array([
  epoch,2,0,0,0,0,0,360,
  epoch,3,0,0,0,0,0,360,
  epoch,4,0,0,0,0,0,360,
]))

it.each(['2d','3d'] as const)('writes an offset source range into a bounded %s Float64 tile', mode => {
  const source = prepared(), copy = source.data.slice(), dimensions = mode === '2d' ? 2 : 3
  const output = new Float64Array(2*dimensions).fill(NaN)
  expect(propagatePreparedCatalogTile(source,epoch+0.25,mode,1,3,output)).toBe(output)
  // Independent circular-orbit geometry at one quarter revolution.
  for (let row = 0; row < 2; row++) {
    expect(output[row*dimensions]).toBeCloseTo(0,13)
    expect(output[row*dimensions+1]).toBe(3+row)
    if (mode === '3d') expect(output[row*dimensions+2]).toBe(0)
  }
  expect(source.data).toEqual(copy)
  propagatePreparedCatalogTile(source,epoch,mode,0,2,output)
  expect(output[0]).toBe(2)
  expect(output[dimensions]).toBe(3)
})

it('rejects invalid tile ranges and capacities before writing the output', () => {
  const source = prepared(), output = new Float64Array(2).fill(17)
  for (const [start,end] of [[-1,0],[3,4],[0.5,1.5]]) {
    expect(() => propagatePreparedCatalogTile(source,epoch,'2d',start,end,output)).toThrow()
    expect([...output]).toEqual([17,17])
  }
  expect(() => propagatePreparedCatalogTile(source,NaN,'2d',0,1,output)).toThrow('epoch')
  expect(() => propagatePreparedCatalogTile(source,epoch,'3d',0,1,output)).toThrow('capacity')
  expect([...output]).toEqual([17,17])
})
