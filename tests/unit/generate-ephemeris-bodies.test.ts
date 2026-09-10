import { describe, expect, it } from 'vitest'
import bodies from '../../src/data/ephemerisBodies.json'
import { majorBodiesById } from '../../src/data/majorBodies'

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
    for (const [naifId, name] of [[55501, 'S/2003 J2'], [55502, 'S/2003 J4'], [55503, 'S/2003 J9'], [55504, 'S/2003 J10']] as const) {
      expect(ids).toContain(`naif:${naifId}`)
      expect(bodies.bodies.find((body) => body.id === `naif:${naifId}`)).toMatchObject({ name, parentId: 'jupiter', sourceKernelId: `satellite-jup347-${naifId}-2020-2031` })
    }
    for (const [naifId, name] of [[610, 'Janus'], [611, 'Epimetheus'], [615, 'Atlas'], [616, 'Prometheus'], [617, 'Pandora'], [618, 'Pan'], [633, 'Pallene'], [649, 'Anthe'], [653, 'Aegaeon']] as const) {
      expect(ids).toContain(`naif:${naifId}`)
      expect(bodies.bodies.find((body) => body.id === `naif:${naifId}`)).toMatchObject({ name, parentId: 'saturn', source: 'jpl-spk-osculating-fallback' })
    }
    for (const [naifId, name] of [[55505, 'S/2003 J12'], [55506, 'S/2003 J16'], [55507, 'S/2003 J23'], [55508, 'S/2003 J24']] as const) {
      expect(ids).toContain(`naif:${naifId}`)
      expect(bodies.bodies.find((body) => body.id === `naif:${naifId}`)).toMatchObject({ name, parentId: 'jupiter', source: 'jpl-spk-osculating-fallback' })
    }
    for (const number of [2, 3, 4, 7, 10, 15, 16, 31, 52, 65, 87, 88, 107, 511, 704, 17, 23, 26, 28, 32, 51, 2060, 5145, 10199, 20000]) expect(ids).toContain(`asteroid:${number}`)
    expect(ids).not.toContain('asteroid:1')
    for (const designation of ['243', '433', '951', '25143', '99942', '162173', '3200', '3122', '65803', '4179', '1036', '1580', '2867', '52768', '29075', '231937', '486958', '132524', '152830', '341843', '469219', '162421', '6', '9', '14', '18', '19', '90', '216', '11', '13', '21', '24', '29', '39', '44', '3753', '6489', '6178', '46610', '98943', '5', '8', '12', '20', '40', '22', '45', '93', '121', '130', '25', '27', '30', '34', '37']) expect(ids).toContain(`asteroid:${designation}`)
    expect(majorBodiesById.get('asteroid:243')).toMatchObject({ name: '小行星 Ida', shortName: 'Ida', naifId: 20000243 })
    for (const [id, naifId, batch] of [['asteroid:87', 20000087, 'batch12'], ['asteroid:107', 20000107, 'batch12'], ['asteroid:511', 20000511, 'batch12'], ['asteroid:704', 20000704, 'batch12'], ['asteroid:17', 20000017, 'batch13'], ['asteroid:23', 20000023, 'batch13'], ['asteroid:26', 20000026, 'batch13'], ['asteroid:28', 20000028, 'batch13'], ['asteroid:32', 20000032, 'batch13'], ['asteroid:51', 20000051, 'batch14'], ['asteroid:2060', 20002060, 'batch14'], ['asteroid:5145', 20005145, 'batch14'], ['asteroid:10199', 20010199, 'batch14'], ['asteroid:20000', 20020000, 'batch14'] ] as const) {
      expect(bodies.bodies.find((body) => body.id === id)).toMatchObject({ naifId, sourceKernelId: expect.stringContaining(`horizons-asteroids-${batch}-20260909`) })
    }
  })

  it('labels every entry as an instantaneous, parent-relative fallback', () => {
    expect(new Set(bodies.bodies.map((body) => body.id)).size).toBe(bodies.bodies.length)
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
