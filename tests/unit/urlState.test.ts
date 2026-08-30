import { describe, expect, it } from 'vitest'
import { decodeUrlState, encodeUrlState } from '../../src/lib/urlState'

describe('reproducible scene URLs', () => {
  it('round-trips dataset, epoch, reference frame, selection and view state', () => {
    const encoded = encodeUrlState({
      route: 'elements', dataset: '2026.08.18.deadbeef-full', mode: 'full', catalogSample: 'mobile', catalogSampleCount: 8_000, ref: 'earth',
      compareRef: 'jupiter', compare: true, bodies: ['mars', 'asteroid:mpc:00433'], jd: 2461040.5,
      history: 730, samples: 240, speed: 30, view: '2d', filter: 'APO', search: 'eros', focused: 'mars', lang: 'en',
      catalogCloud: true, quality: 'max',
      plot: 'q-Q', aRange: [0.5, 5], eRange: [0, 0.8], iRange: [0, 40], hRange: [5, 30],
      hStatus: 'known', qRange: [0.2, 4], layers: ['ecliptic', 'lagrange', 'spacecraft'], offset: [1.25, -0.5],
      story: 'retrograde-mars', step: 2, guide: true, missionFrom: 'earth', missionTo: 'mars', departureDate: '2026-11-15', arrivalDate: '2027-08-01',
    })
    const decoded = decodeUrlState(`?${encoded}`)
    expect(encoded).toContain('v=4')
    expect(decoded.version).toBe(4)
    expect(decoded.dataset).toBe('2026.08.18.deadbeef-full')
    expect(decoded.catalogSample).toBe('mobile')
    expect(decoded.catalogSampleCount).toBe(8_000)
    expect(decoded.catalogSampleCountRaw).toBeUndefined()
    expect(decoded.catalogCloud).toBe(true)
    expect(decoded.quality).toBe('max')
    expect(decoded.jd).toBe(2461040.5)
    expect(decoded.bodies).toEqual(['mars', 'asteroid:mpc:00433'])
    expect(decoded.compare).toBe(true)
    expect(decoded.route).toBe('elements')
    expect(decoded.plot).toBe('q-Q')
    expect(decoded.aRange).toEqual([0.5, 5])
    expect(decoded.layers).toEqual(['ecliptic', 'lagrange', 'spacecraft'])
    expect(decoded.samples).toBe(240)
    expect(decoded.offset).toEqual([1.25, -0.5])
    expect(decoded.hStatus).toBe('known')
    expect(decoded.story).toBe('retrograde-mars')
    expect(decoded.step).toBe(2)
    expect(decoded.guide).toBe(true)
    expect(decoded.missionFrom).toBe('earth')
    expect(decoded.arrivalDate).toBe('2027-08-01')
  })

  it('keeps legacy v2 and v3 scene links readable without reading v4 catalog fields', () => {
    for (const version of [2, 3]) {
      const decoded = decodeUrlState(`?v=${version}&ref=earth&view=2d&catalogSample=mobile&catalogSampleCount=8000&catalogCloud=1&quality=max`)
      expect(decoded.version).toBe(version)
      expect(decoded.ref).toBe('earth')
      expect(decoded.view).toBe('2d')
      expect(decoded.catalogSample).toBeUndefined()
      expect(decoded.catalogSampleCount).toBeUndefined()
      expect(decoded.catalogCloud).toBeUndefined()
      expect(decoded.quality).toBeUndefined()
    }
  })

  it('accepts scene URL versions by exact string only', () => {
    for (const version of ['', '02', '2.0', '2e0', '04']) {
      expect(decodeUrlState(`?v=${version}&ref=earth`)).toEqual({})
    }
  })

  it('canonicalizes a valid catalog sample count while retaining an invalid raw count', () => {
    const valid = decodeUrlState('?v=4&catalogSample=mobile&catalogSampleCount=008000')
    expect(valid.catalogSampleCount).toBe(8_000)
    expect(valid.catalogSampleCountRaw).toBeUndefined()
    expect(encodeUrlState(valid)).toContain('catalogSampleCount=8000')

    const invalid = decodeUrlState('?v=4&catalogSample=mobile&catalogSampleCount=8.5')
    expect(invalid.catalogSampleCount).toBeUndefined()
    expect(invalid.catalogSampleCountRaw).toBe('8.5')
  })

  it('retains a malformed catalog tuple while other scene fields continue to update', () => {
    const decoded = decodeUrlState('?v=4&page=catalog&catalogSample=mobile&catalogSampleCount=oops')
    expect(decoded.catalogSampleInvalid).toBe(true)
    expect(decoded.catalogSampleCountRaw).toBe('oops')

    const reencoded = encodeUrlState({ ...decoded, route: 'elements' })
    expect(reencoded).toContain('page=elements')
    expect(reencoded).toContain('catalogSample=mobile')
    expect(reencoded).toContain('catalogSampleCount=oops')
  })

  it('makes every implicit internal entry 3D-first while preserving explicit 2D links', () => {
    expect(encodeUrlState({ route: 'explorer', view: '2d' })).toContain('view=2d')
    expect(encodeUrlState({ route: 'explorer', view: '3d' })).toContain('view=3d')
    expect(decodeUrlState('').view).toBe('3d')
    expect(decodeUrlState('?v=3&page=explorer&bodies=earth,mars').view).toBe('3d')
    expect(decodeUrlState('?v=3&page=home&lang=en').view).toBe('3d')
    expect(decodeUrlState('?v=4&page=stories&story=retrograde-mars&lang=en').view).toBe('3d')
    expect(decodeUrlState('?v=4&page=catalog&search=ceres&lang=en').view).toBe('3d')
    expect(decodeUrlState('?v=4&page=mission&from=earth&to=mars&view=2d').view).toBe('2d')
  })

  it('fails closed for a future scene schema instead of misreading its fields', () => {
    expect(decodeUrlState('?v=99&ref=earth&view=2d')).toEqual({})
  })

  it('ignores impossible mission dates while preserving valid calendar dates', () => {
    const decoded = decodeUrlState('?v=3&depart=2026-99-99&arrive=2028-02-29')
    expect(decoded.departureDate).toBeUndefined()
    expect(decoded.arrivalDate).toBe('2028-02-29')
  })
})
