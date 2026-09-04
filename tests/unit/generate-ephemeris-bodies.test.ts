import { describe, expect, it } from 'vitest'
import bodies from '../../src/data/ephemerisBodies.json'

describe('optional SPK body seed artifact', () => {
  it('contains uncovered satellites and all sb441-n16 asteroid targets', () => {
    const ids = new Set(bodies.bodies.map((body) => body.id))
    expect(ids).toContain('naif:632')
    expect(ids).toContain('naif:634')
    for (const number of [2, 3, 4, 7, 10, 15, 16, 31, 52, 65, 87, 88, 107, 511, 704]) expect(ids).toContain(`asteroid:${number}`)
    expect(ids).not.toContain('asteroid:1')
  })

  it('labels every entry as an instantaneous, parent-relative fallback', () => {
    expect(bodies.epochTimeScale).toBe('TDB')
    for (const body of bodies.bodies) {
      expect(body.source).toBe('jpl-spk-osculating-fallback')
      expect(body.parentId).toBeTruthy()
      expect(body.fallback.label).toMatch(/instantaneous two-body osculating ellipse/)
      expect(body.sourceUrl).toMatch(/^https:\/\//)
      for (const value of Object.values(body.parentRelativeStateKm.position)) expect(Number.isFinite(value)).toBe(true)
    }
  })
})
