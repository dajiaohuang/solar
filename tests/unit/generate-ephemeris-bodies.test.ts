import { describe, expect, it } from 'vitest'
import bodies from '../../src/data/ephemerisBodies.json'

const AU_KM = 149597870.7
const deg = Math.PI / 180
function reconstruct(body: (typeof bodies.bodies)[number]) {
  const o = body.orbit
  const a = o.semiMajorAxisAU * AU_KM
  const e = o.eccentricity
  const m = o.meanAnomalyDeg * deg
  let E = m
  for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E))
  const xOrb = a * (Math.cos(E) - e)
  const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E)
  const w = o.argPeriapsisDeg * deg, node = o.ascendingNodeDeg * deg, inc = o.inclinationDeg * deg
  const cw = Math.cos(w), sw = Math.sin(w), cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(inc), si = Math.sin(inc)
  return { x: (cn * cw - sn * sw * ci) * xOrb + (-cn * sw - sn * cw * ci) * yOrb,
    y: (sn * cw + cn * sw * ci) * xOrb + (-sn * sw + cn * cw * ci) * yOrb,
    z: (sw * si) * xOrb + (cw * si) * yOrb }
}

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

  it('reconstructs each sampled ECLIPJ2000 position within 1 km', () => {
    for (const body of bodies.bodies) {
      const expected = body.parentRelativeStateKm.position
      const actual = reconstruct(body)
      expect(Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z), body.id).toBeLessThan(1)
      expect(body.parentId).toMatch(/^(sun|mercury|venus|earth|mars|jupiter|saturn|uranus|neptune|pluto)$/)
    }
  })
})
