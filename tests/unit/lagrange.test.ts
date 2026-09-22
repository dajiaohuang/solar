import { describe, expect, it } from 'vitest'
import { majorBodies } from '../../src/data/majorBodies'
import { computeLagrangePoints, MASS_RATIOS } from '../../src/lib/lagrange'

describe('heliocentric Lagrange schematic', () => {
  it.each(['earth', 'jupiter'])('satisfies first-order rotating-frame balance at %s L3', id => {
    const body = majorBodies.find(body => body.id === id)!
    const ratio = MASS_RATIOS[id], mu = ratio / (1 + ratio)
    const point = computeLagrangePoints(body, { x: 1, y: 0 }).find(point => point.label === 'L3')!
    const x = point.position.x
    // Sun is at zero, planet at one, barycenter at mu. The omitted terms
    // of a first-order small-mass approximation must be O(ratio^2), not O(ratio).
    const balance = x - mu - (1 - mu) * x / Math.abs(x) ** 3 - mu * (x - 1) / Math.abs(x - 1) ** 3
    expect(Math.abs(balance)).toBeLessThan(10 * ratio ** 2)
    expect(Math.abs(point.position.y)).toBe(0)
  })
})
