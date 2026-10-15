import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadPckOrientation } from '../../src/data/loaders/pckOrientation'
import reference from '../fixtures/pck-orientation-reference.json'

let source: ArrayBuffer, orientation: Awaited<ReturnType<typeof loadPckOrientation>>
beforeAll(async () => {
  const bytes = await readFile('src/data/pck00011.tpc')
  source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  orientation = await loadPckOrientation(source)
})

describe('pinned text-PCK orientation', () => {
  it('matches independent CSPICE matrices for all 75 source models at four TDB epochs', async () => {
    expect(orientation.ids()).toEqual(reference.ids)
    expect(orientation.source.sha256).toBe(reference.sourceSha256)
    expect(createHash('sha256').update(await readFile('scripts/reference-pck-orientation.py')).digest('hex')).toBe(reference.generatorSha256)
    let maximum = 0
    for (const row of reference.cases) {
      const actual = orientation.evaluate(row.naifPckId, row.secondsPastJ2000Tdb)!
      for (let i = 0; i < 9; i++) maximum = Math.max(maximum, Math.abs(actual.j2000ToBodyFixed[i] - row.j2000ToBodyFixed[i]))
      expect(actual.physicalOrientationUncertaintyRadians).toBeNull()
    }
    expect(maximum).toBeLessThan(2e-10)
  })
  it('returns orthonormal right-handed matrices and retains the comet-specific epoch', () => {
    for (const id of orientation.ids()) {
      const matrix = orientation.evaluate(id, 843523200)!.j2000ToBodyFixed
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        let dot = 0
        for (let k = 0; k < 3; k++) dot += matrix[i * 3 + k] * matrix[j * 3 + k]
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 14)
      }
      const determinant = matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) - matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) + matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
      expect(determinant).toBeCloseTo(1, 14)
    }
    const epoch = 2455607.694660
    const comet = orientation.evaluate(1000093, (epoch - 2451545) * 86400)!
    expect(comet.constantsEpochTdb).toBe(epoch)
    expect(comet.primeMeridianDegrees).toBeCloseTo(69.2, 12)
  })
  it('does not invent missing body models and does not expose mutable model coefficients', () => {
    expect(orientation.evaluate(123456, 0)).toBeNull()
    const first = orientation.evaluate(499, 0)!
    first.j2000ToBodyFixed.fill(0)
    expect(orientation.evaluate(499, 0)!.j2000ToBodyFixed.some(value => value !== 0)).toBe(true)
    expect(orientation.limitations.join(' ')).toContain('not published physical validity')
    for (const time of [NaN, Infinity, 36525 * 86400 + 1]) expect(() => orientation.evaluate(499, time)).toThrow('TDB seconds')
  })
  it('rejects changed source bytes before parsing orientation data', async () => {
    const changed = source.slice(0)
    new Uint8Array(changed)[0] ^= 1
    await expect(loadPckOrientation(changed)).rejects.toThrow('checksum')
  })
})
