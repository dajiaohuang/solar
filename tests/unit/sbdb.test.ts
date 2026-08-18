import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/sbdb-bennu.json'
import { parseSbdbBody, SbdbParseError, type SbdbResponse } from '../../src/data/loaders/sbdb'

describe('JPL SBDB parser', () => {
  it('reads values from orbit.elements rather than invented orbit properties', () => {
    const body = parseSbdbBody(fixture as SbdbResponse, 'Bennu')
    expect(body.id).toBe('sbdb:101955')
    expect(body.orbit?.model).toBe('keplerian')
    if (body.orbit?.model !== 'keplerian') throw new Error('unexpected orbit model')
    expect(body.orbit.semiMajorAxisAU).toBeCloseTo(1.126391026, 8)
    expect(body.orbit.eccentricity).toBeCloseTo(0.203745114, 8)
    expect(body.orbit.ascendingNodeDeg).toBeCloseTo(2.060867, 6)
    expect(body.absoluteMagnitude).toBe(20.56)
  })

  it('rejects non-elliptic elements before they can produce NaN positions', () => {
    const hyperbolic = structuredClone(fixture) as SbdbResponse
    hyperbolic.orbit!.elements!.find((element) => element.name === 'e')!.value = '1.2'
    expect(() => parseSbdbBody(hyperbolic, 'test')).toThrow(SbdbParseError)
  })

  it.each([['e', '-0.1'], ['a', '0'], ['n', '0']] as const)(
    'rejects an invalid %s element at the data boundary',
    (name, value) => {
      const invalid = structuredClone(fixture) as SbdbResponse
      invalid.orbit!.elements!.find((element) => element.name === name)!.value = value
      expect(() => parseSbdbBody(invalid, 'test')).toThrow(SbdbParseError)
    },
  )
})
