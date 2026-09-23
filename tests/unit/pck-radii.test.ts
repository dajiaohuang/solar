import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { loadPckRadii, PCK_RADII_SOURCE } from '../../src/data/loaders/pckRadii'
import reference from '../fixtures/pck-radii-reference.json'

const bytes = () => {
  const data = readFileSync('src/data/pck00011.tpc')
  return data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength)
}

test('all pinned PCK radius assignments agree with the independent CSPICE kernel pool', async () => {
  const radii = await loadPckRadii(bytes())
  expect(radii.ids()).toEqual(reference.bodies.map(body => body.naifPckId))
  expect(radii.ids()).toHaveLength(95)
  for (const body of reference.bodies) {
    const result = radii.get(body.naifPckId)!
    result.radiiKm.forEach((value, index) => expect(Math.abs(value/body.radiiKm[index]-1)).toBeLessThan(2e-15))
    expect(result.uncertaintyKm).toBeNull()
  }
  expect(PCK_RADII_SOURCE.sha256).toBe(reference.sourceSha256)
  expect(createHash('sha256').update(readFileSync('scripts/reference-pck-radii.py')).digest('hex')).toBe(reference.generatorSha256)
})

test('comments are excluded and axes are not silently replaced by a mean sphere or catalog alias', async () => {
  const radii = await loadPckRadii(bytes())
  expect(radii.get(901)?.radiiKm).toEqual([606, 606, 606]) // Commented historical Charon value is 605.
  expect(radii.get(1000041)).toBeNull() // Hartley 2 axes appear only in comments.
  expect(radii.get(399)?.radiiKm).toEqual([6378.1366, 6378.1366, 6356.7519])
  expect(radii.get(399)?.representation).toBe('triaxial-ellipsoid')
  expect(radii.get(10)?.representation).toBe('sphere')
  expect(radii.get(2000433)?.radiiKm).toEqual([17, 5.5, 5.5])
  expect(radii.get(20000433)).toBeNull() // New SPK alias must be mapped explicitly.
  expect(radii.get(3)).toBeNull() // Earth-Moon barycenter is not a shaped body.
})

test('source verification owns bytes before yielding and returned arrays cannot corrupt the catalog', async () => {
  const input = bytes(), pending = loadPckRadii(input)
  new Uint8Array(input).fill(0)
  const radii = await pending
  radii.get(10)!.radiiKm.fill(0)
  radii.ids().fill(0)
  expect(radii.get(10)?.radiiKm).toEqual([695700, 695700, 695700])
  await expect(loadPckRadii(input)).rejects.toThrow('checksum')
  await expect(loadPckRadii(input.slice(1))).rejects.toThrow('size')
})
