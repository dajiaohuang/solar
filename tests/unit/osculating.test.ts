import { describe, expect, it } from 'vitest'
import { orbitToHeliocentricVector } from '../../src/lib/ephemeris'
import { stateToOsculatingElements } from '../../src/engine/ephemeris/osculating'
import type { Vector3 } from '../../src/types'

const mu = 0.0002959122082855911
const rotate = (x: number, y: number, i: number, n: number, w: number): Vector3 => ({
  x: (Math.cos(w) * Math.cos(n) - Math.sin(w) * Math.sin(n) * Math.cos(i)) * x + (-Math.sin(w) * Math.cos(n) - Math.cos(w) * Math.sin(n) * Math.cos(i)) * y,
  y: (Math.cos(w) * Math.sin(n) + Math.sin(w) * Math.cos(n) * Math.cos(i)) * x + (-Math.sin(w) * Math.sin(n) + Math.cos(w) * Math.cos(n) * Math.cos(i)) * y,
  z: Math.sin(w) * Math.sin(i) * x + Math.cos(w) * Math.sin(i) * y,
})
const stateFor = (a: number, e: number, i: number, n: number, w: number, nu: number) => {
  const p = a * (1 - e * e)
  const r = p / (1 + e * Math.cos(nu))
  const factor = Math.sqrt(mu / p)
  return { positionAU: rotate(r * Math.cos(nu), r * Math.sin(nu), i, n, w), velocityAUPerDay: rotate(-factor * Math.sin(nu), factor * (e + Math.cos(nu)), i, n, w) }
}

describe('stateToOsculatingElements', () => {
  it('uses stable conventions for circular inclined states', () => {
    const state = stateFor(1, 0, 40 * Math.PI / 180, 70 * Math.PI / 180, 0, 25 * Math.PI / 180)
    const elements = stateToOsculatingElements(state.positionAU, state.velocityAUPerDay, mu)
    expect(elements).not.toBeNull()
    expect(elements!.eccentricity).toBeCloseTo(0, 10)
    expect(elements!.inclinationDeg).toBeCloseTo(40, 8)
    expect(elements!.ascendingNodeDeg).toBeCloseTo(70, 8)
    expect(elements!.argPeriapsisDeg).toBe(0)
    expect(elements!.meanAnomalyDeg).toBeCloseTo(25, 8)
  })
  it('recovers general elements and reconstructs the position', () => {
    const state = stateFor(1.7, 0.31, 23 * Math.PI / 180, 112 * Math.PI / 180, 48 * Math.PI / 180, 137 * Math.PI / 180)
    const elements = stateToOsculatingElements(state.positionAU, state.velocityAUPerDay, mu)!
    expect(elements.semiMajorAxisAU).toBeCloseTo(1.7, 8)
    expect(elements.eccentricity).toBeCloseTo(0.31, 8)
    expect(elements.inclinationDeg).toBeCloseTo(23, 8)
    const reconstructed = orbitToHeliocentricVector({ model: 'keplerian', epochJd: 2451545, semiMajorAxisAU: elements.semiMajorAxisAU, eccentricity: elements.eccentricity, inclinationDeg: elements.inclinationDeg, ascendingNodeDeg: elements.ascendingNodeDeg, argPeriapsisDeg: elements.argPeriapsisDeg, meanAnomalyDeg: elements.meanAnomalyDeg, meanMotionDegPerDay: elements.meanMotionDegPerDay }, 2451545)
    expect(reconstructed.x).toBeCloseTo(state.positionAU.x, 7)
    expect(reconstructed.y).toBeCloseTo(state.positionAU.y, 7)
    expect(reconstructed.z).toBeCloseTo(state.positionAU.z, 7)
  })
  it('rejects unbound and degenerate states', () => {
    expect(stateToOsculatingElements({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, mu)).toBeNull()
    expect(stateToOsculatingElements({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, mu)).toBeNull()
  })
})
