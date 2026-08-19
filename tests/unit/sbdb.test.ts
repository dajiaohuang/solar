import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/sbdb-bennu.json'
import { finiteNumberOrNull, parseSbdbBody, SbdbParseError, type SbdbResponse } from '../../src/data/loaders/sbdb'

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

  it('does not coerce null or blank SBDB values to zero', () => {
    expect(finiteNumberOrNull(null)).toBeNull()
    expect(finiteNumberOrNull('  ')).toBeNull()

    const missingEpoch = structuredClone(fixture) as SbdbResponse
    missingEpoch.orbit!.epoch = ' '
    expect(() => parseSbdbBody(missingEpoch, 'test')).toThrow(/finite epoch/)

    const missingElement = structuredClone(fixture) as SbdbResponse
    missingElement.orbit!.elements!.find((element) => element.name === 'e')!.value = null
    expect(() => parseSbdbBody(missingElement, 'test')).toThrow(/finite e element/)

    const missingMagnitude = structuredClone(fixture) as SbdbResponse
    missingMagnitude.phys_par!.find((entry) => entry.name === 'H')!.value = ' '
    expect(parseSbdbBody(missingMagnitude, 'test').absoluteMagnitude).toBeUndefined()
  })

  it.each([['e', '-0.1'], ['a', '0'], ['n', '0']] as const)(
    'rejects an invalid %s element at the data boundary',
    (name, value) => {
      const invalid = structuredClone(fixture) as SbdbResponse
      invalid.orbit!.elements!.find((element) => element.name === name)!.value = value
      expect(() => parseSbdbBody(invalid, 'test')).toThrow(SbdbParseError)
    },
  )

  it('rejects incompatible element units and missing mean motion', () => {
    const wrongUnits = structuredClone(fixture) as SbdbResponse
    wrongUnits.orbit!.elements!.find((element) => element.name === 'a')!.units = 'km'
    expect(() => parseSbdbBody(wrongUnits, 'test')).toThrow(/unsupported units/)

    const missingMotion = structuredClone(fixture) as SbdbResponse
    missingMotion.orbit!.elements = missingMotion.orbit!.elements!.filter((element) => element.name !== 'n')
    expect(() => parseSbdbBody(missingMotion, 'test')).toThrow(/missing the n element/)
  })
})
