import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { propagateCatalogElementPositions } from '../../src/engine/ephemeris/catalogPoints'
import { orbitToHeliocentricVector } from '../../src/lib/ephemeris'

describe('catalog point propagation', () => {
  it('preserves the source elements and every derived coordinate across independent mode jobs', () => {
    const count = 513, elements = new Float64Array(count * 8), expected = new Float32Array(count * 3)
    for (let index = 0; index < count; index++) {
      const orbit = { model: 'keplerian' as const, epochJd: 2451545, semiMajorAxisAU: 1 + index / 13,
        eccentricity: (index % 80) / 100, inclinationDeg: index % 180, ascendingNodeDeg: index % 360,
        argPeriapsisDeg: index % 270, meanAnomalyDeg: index % 90, meanMotionDegPerDay: .2 }
      elements.set([orbit.epochJd, orbit.semiMajorAxisAU, orbit.eccentricity, orbit.inclinationDeg,
        orbit.ascendingNodeDeg, orbit.argPeriapsisDeg, orbit.meanAnomalyDeg, orbit.meanMotionDegPerDay], index * 8)
      const position = orbitToHeliocentricVector(orbit, 2461287.5)
      expected.set([position.x, position.y, position.z], index * 3)
    }
    const before = Buffer.from(new Uint8Array(elements.buffer))
    const planar = propagateCatalogElementPositions(elements, 2461287.5, '2d')
    const spatial = propagateCatalogElementPositions(elements, 2461287.5, '3d')
    expect(Buffer.from(spatial.buffer).equals(Buffer.from(expected.buffer))).toBe(true)
    for (let index = 0; index < count; index++) {
      expect(Object.is(planar[index * 2], expected[index * 3])).toBe(true)
      expect(Object.is(planar[index * 2 + 1], expected[index * 3 + 1])).toBe(true)
    }
    expect(Buffer.from(elements.buffer).equals(before)).toBe(true)
  })

  it('rejects malformed mode, epoch, element stride and unsupported or nonfinite orbits', () => {
    const valid = new Float64Array([2451545, 1, .1, 0, 0, 0, 0, 1])
    expect(() => propagateCatalogElementPositions(valid, 2451545, 'invalid' as '2d')).toThrow(/mode/)
    for (const epoch of [NaN, Infinity, -Infinity]) expect(() => propagateCatalogElementPositions(valid, epoch, '2d')).toThrow(/epoch/)
    expect(() => propagateCatalogElementPositions(valid.subarray(1), 2451545, '3d')).toThrow(/stride/)
    for (let field = 0; field < 8; field++) {
      const invalid = valid.slice(); invalid[field] = NaN
      expect(() => propagateCatalogElementPositions(invalid, 2451545, '3d')).toThrow(/nonfinite/)
    }
    for (const eccentricity of [-.1, 1, 1.1]) {
      const invalid = valid.slice(); invalid[2] = eccentricity
      expect(() => propagateCatalogElementPositions(invalid, 2451545, '2d')).toThrow(/elliptic/)
    }
    expect(propagateCatalogElementPositions(new Float64Array(), 2451545, '2d')).toHaveLength(0)
  })

  it('matches the focus-mode elliptic propagator', () => {
    const orbit = {
      model: 'keplerian' as const, epochJd: 2451545, semiMajorAxisAU: 2.4, eccentricity: 0.31,
      inclinationDeg: 12, ascendingNodeDeg: 82, argPeriapsisDeg: 44,
      meanAnomalyDeg: 20, meanMotionDegPerDay: 0.264,
    }
    const jd = 2460000.5
    const points = propagateCatalogElementPositions(new Float64Array([
      orbit.epochJd, orbit.semiMajorAxisAU, orbit.eccentricity, orbit.inclinationDeg,
      orbit.ascendingNodeDeg, orbit.argPeriapsisDeg, orbit.meanAnomalyDeg, orbit.meanMotionDegPerDay,
    ]), jd, '2d')
    const expected = orbitToHeliocentricVector(orbit, jd)
    expect(points[0]).toBeCloseTo(expected.x, 5)
    expect(points[1]).toBeCloseTo(expected.y, 5)
    const spatial = propagateCatalogElementPositions(new Float64Array([
      orbit.epochJd, orbit.semiMajorAxisAU, orbit.eccentricity, orbit.inclinationDeg,
      orbit.ascendingNodeDeg, orbit.argPeriapsisDeg, orbit.meanAnomalyDeg, orbit.meanMotionDegPerDay,
    ]), jd, '3d')
    expect(spatial.subarray(0, 2)).toEqual(points)
    expect(spatial[0]).toBeCloseTo(expected.x, 5)
    expect(spatial[1]).toBeCloseTo(expected.y, 5)
    expect(spatial[2]).toBeCloseTo(expected.z, 5)
  })

  it('converges at perihelion for an MPCORB-width high-eccentricity record', () => {
    const orbit = {
      model: 'keplerian' as const, epochJd: 2451545, semiMajorAxisAU: 1, eccentricity: 0.9999999,
      inclinationDeg: 0, ascendingNodeDeg: 0, argPeriapsisDeg: 0,
      meanAnomalyDeg: 0, meanMotionDegPerDay: 1,
    }
    const spatial = propagateCatalogElementPositions(new Float64Array([
      orbit.epochJd, orbit.semiMajorAxisAU, orbit.eccentricity, orbit.inclinationDeg,
      orbit.ascendingNodeDeg, orbit.argPeriapsisDeg, orbit.meanAnomalyDeg, orbit.meanMotionDegPerDay,
    ]), orbit.epochJd, '3d')
    const expected = orbitToHeliocentricVector(orbit, orbit.epochJd)

    expect(spatial[0]).toBeCloseTo(1e-7, 12)
    expect(spatial[1]).toBe(0)
    expect(spatial[0]).toBeCloseTo(expected.x, 12)
    expect(spatial[1]).toBeCloseTo(expected.y, 12)
    expect(spatial[2]).toBeCloseTo(expected.z, 12)
  })

  it.each(['2d', '3d'] as const)('keeps million-row propagation to one %s buffer', (mode) => {
    const count = 1_000_000
    const elements = new Float64Array(count * 8)
    for (let index = 0; index < count; index += 1) {
      const offset = index * 8
      elements[offset] = 2451545
      elements[offset + 1] = 2.4
      elements[offset + 2] = index === 0 ? 0.9999999 : 0.31
      elements[offset + 6] = index % 360
      elements[offset + 7] = 0.264
    }

    const result = propagateCatalogElementPositions(elements, 2451545, mode)
    expect(result).toBeInstanceOf(Float32Array)
    expect(result).toHaveLength(count * (mode === '2d' ? 2 : 3))
    expect(result.buffer.byteLength).toBe(count * (mode === '2d' ? 8 : 12))
    expect(result[0]).toBeCloseTo(2.4e-7, 12)
    expect(Number.isFinite(result.at(-1))).toBe(true)
  }, 10_000)
})
