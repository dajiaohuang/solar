import { describe, expect, it } from 'vitest'
import { angularSeparationDeg } from '../../src/engine/events/angularSeparation'

describe('stable angular separation', () => {
  it('retains milliarcsecond-scale separation when the normalized dot product rounds to one', () => {
    const radians = Math.PI / (180 * 3600 * 1000)
    const angle = angularSeparationDeg({ x: 1, y: 0, z: 0 }, { x: Math.cos(radians), y: Math.sin(radians), z: 0 })
    expect(angle).toBeCloseTo(1 / 3_600_000, 12)
  })

  it('retains small distance from an opposition when the dot product rounds to minus one', () => {
    const radians = Math.PI / (180 * 3600)
    const angle = angularSeparationDeg({ x: 1, y: 0, z: 0 }, { x: -Math.cos(radians), y: Math.sin(radians), z: 0 })
    expect(180 - angle).toBeCloseTo(1 / 3600, 10)
  })

  it('normalizes without multiplying magnitudes or rejecting small but nonzero vectors', () => {
    const a = { x: 1e300, y: 0, z: 0 }
    const b = { x: 0, y: 1e-300, z: 0 }
    expect(angularSeparationDeg(a, b)).toBe(90)
    expect(angularSeparationDeg({ x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: 0 }, { x: 0, y: Number.MIN_VALUE, z: 0 })).toBe(45)
    expect(angularSeparationDeg({ x: 0, y: 0, z: 0 }, b)).toBeNaN()
  })
})
