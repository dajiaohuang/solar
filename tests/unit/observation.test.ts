import { describe, expect, it } from 'vitest'
import { deriveParentRelativeObservation } from '../../src/engine/ephemeris/observation'
import { AU_IN_KM } from '../../src/engine/units'

const jd = 2_451_545
describe('deriveParentRelativeObservation', () => {
  it('keeps parent-relative AU elements separate from observer-relative apparent km', () => {
    const resolve = (id: string, epoch: number) => {
      if (id === 'parent') return { position: [10 * AU_IN_KM, 0, 0] as const, velocity: [0, 0, 0] as const }
      if (id === 'target') return { position: [10 * AU_IN_KM, AU_IN_KM, 0] as const, velocity: [-Math.sqrt(0.0002959122082855911) * AU_IN_KM / 86400, 0, 0] as const }
      if (id === 'observer') return { position: [0, 0, 0] as const, velocity: [0, 0, 0] as const }
      return null
    }
    const result = deriveParentRelativeObservation({ targetId: 'target', parentId: 'parent', observerId: 'observer', julianDay: jd, gmAU3PerDay2: 0.0002959122082855911, resolve, referenceFrame: 'eclipj2000', apparentMode: 'geometric' })!
    expect(result.referenceFrame).toBe('eclipj2000')
    expect(result.centerId).toBe('parent')
    expect(result.state.positionAU).toEqual({ x: 0, y: 1, z: 0 })
    expect(result.osculatingElements!.semiMajorAxisAU).toBeCloseTo(1, 5)
    expect(result.osculatingElements!.eccentricity).toBeCloseTo(0, 5)
    expect(result.apparent.positionKm.x).toBeCloseTo(10 * AU_IN_KM, -3)
    expect(result.assumptions.join(' ')).toMatch(/instantaneous two-body osculating snapshot/)
  })
  it('returns null when a body-center chain is unavailable', () => {
    const resolve = (id: string) => id === 'observer' ? { position: [0, 0, 0] as const, velocity: [0, 0, 0] as const } : null
    expect(deriveParentRelativeObservation({ targetId: 'target', parentId: 'parent', observerId: 'observer', julianDay: jd, gmAU3PerDay2: 1, resolve })).toBeNull()
  })
})
