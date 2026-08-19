import { describe, expect, it } from 'vitest'
import { decodeUrlState, encodeUrlState } from '../../src/lib/urlState'

describe('reproducible scene URLs', () => {
  it('round-trips dataset, epoch, reference frame, selection and view state', () => {
    const encoded = encodeUrlState({
      route: 'elements', dataset: '2026.08.18.deadbeef-full', mode: 'full', ref: 'earth',
      compareRef: 'jupiter', compare: true, bodies: ['mars', 'asteroid:mpc:00433'], jd: 2461040.5,
      history: 730, speed: 30, view: '2d', filter: 'APO', search: 'eros', focused: 'mars', lang: 'en',
      plot: 'q-Q', aRange: [0.5, 5], eRange: [0, 0.8], iRange: [0, 40], hRange: [5, 30],
      hStatus: 'known', qRange: [0.2, 4], layers: ['ecliptic', 'lagrange', 'spacecraft'], offset: [1.25, -0.5],
    })
    const decoded = decodeUrlState(`?${encoded}`)
    expect(encoded).toContain('v=2')
    expect(decoded.version).toBe(2)
    expect(decoded.dataset).toBe('2026.08.18.deadbeef-full')
    expect(decoded.jd).toBe(2461040.5)
    expect(decoded.bodies).toEqual(['mars', 'asteroid:mpc:00433'])
    expect(decoded.compare).toBe(true)
    expect(decoded.route).toBe('elements')
    expect(decoded.plot).toBe('q-Q')
    expect(decoded.aRange).toEqual([0.5, 5])
    expect(decoded.layers).toEqual(['ecliptic', 'lagrange', 'spacecraft'])
    expect(decoded.offset).toEqual([1.25, -0.5])
    expect(decoded.hStatus).toBe('known')
  })

  it('fails closed for a future scene schema instead of misreading its fields', () => {
    expect(decodeUrlState('?v=99&ref=earth&view=2d')).toEqual({})
  })
})
