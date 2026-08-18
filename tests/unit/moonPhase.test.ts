import { describe, expect, it } from 'vitest'
import { computeMoonPhase } from '../../src/engine/ephemeris/moonPhase'

const sun = { x: 0, y: 0, z: 0 }
const earth = { x: 1, y: 0, z: 0 }

describe('Moon phase geometry', () => {
  it('derives new and full moon from Sun–Earth–Moon geometry', () => {
    const newMoon = computeMoonPhase(sun, earth, { x: 0.997, y: 0, z: 0 })
    const fullMoon = computeMoonPhase(sun, earth, { x: 1.003, y: 0, z: 0 })
    expect(newMoon.name).toBe('new')
    expect(newMoon.illuminatedFraction).toBeCloseTo(0, 8)
    expect(fullMoon.name).toBe('full')
    expect(fullMoon.illuminatedFraction).toBeCloseTo(1, 8)
  })

  it('uses signed elongation to distinguish waxing from waning', () => {
    const firstQuarter = computeMoonPhase(sun, earth, { x: 1, y: -0.003, z: 0 })
    const lastQuarter = computeMoonPhase(sun, earth, { x: 1, y: 0.003, z: 0 })
    expect(firstQuarter.name).toBe('first-quarter')
    expect(lastQuarter.name).toBe('last-quarter')
    expect(firstQuarter.illuminatedFraction).toBeCloseTo(0.5, 2)
  })
})
