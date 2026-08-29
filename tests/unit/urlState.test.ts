import { describe, expect, it } from 'vitest'
import { decodeUrlState, encodeUrlState } from '../../src/lib/urlState'

describe('reproducible scene URLs', () => {
  it('round-trips dataset, epoch, reference frame, selection and view state', () => {
    const encoded = encodeUrlState({
      route: 'elements', dataset: '2026.08.18.deadbeef-full', mode: 'full', ref: 'earth',
      compareRef: 'jupiter', compare: true, bodies: ['mars', 'asteroid:mpc:00433'], jd: 2461040.5,
      history: 730, samples: 240, speed: 30, view: '2d', filter: 'APO', search: 'eros', focused: 'mars', lang: 'en',
      plot: 'q-Q', aRange: [0.5, 5], eRange: [0, 0.8], iRange: [0, 40], hRange: [5, 30],
      hStatus: 'known', qRange: [0.2, 4], layers: ['ecliptic', 'lagrange', 'spacecraft'], offset: [1.25, -0.5],
      story: 'retrograde-mars', step: 2, guide: true, missionFrom: 'earth', missionTo: 'mars', departureDate: '2026-11-15', arrivalDate: '2027-08-01',
    })
    const decoded = decodeUrlState(`?${encoded}`)
    expect(encoded).toContain('v=3')
    expect(decoded.version).toBe(3)
    expect(decoded.dataset).toBe('2026.08.18.deadbeef-full')
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

  it('keeps legacy v2 scene links readable', () => {
    const decoded = decodeUrlState('?v=2&ref=earth&view=2d')
    expect(decoded.version).toBe(2)
    expect(decoded.ref).toBe('earth')
    expect(decoded.view).toBe('2d')
  })

  it('writes the view explicitly while preserving old implicit-3D scene links', () => {
    expect(encodeUrlState({ route: 'explorer', view: '2d' })).toContain('view=2d')
    expect(encodeUrlState({ route: 'explorer', view: '3d' })).toContain('view=3d')
    expect(decodeUrlState('?v=3&page=explorer&bodies=earth,mars').view).toBe('3d')
    expect(decodeUrlState('?v=3&page=home&lang=en').view).toBeUndefined()
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
