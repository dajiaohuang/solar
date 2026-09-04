import { describe, expect, it } from 'vitest'
import { cameraDistanceForFit, cameraRangeForFit, sceneFramingForRadius } from '../../src/lib/camera3d'

describe('satellite-scale 3D framing', () => {
  it.each([0.00016, 0.0028, 0.013, 0.025])('fits a %s AU system in desktop and portrait viewports', (radius) => {
    for (const aspect of [1.6, 0.5]) {
      const framing = sceneFramingForRadius(radius, aspect, radius / 4)
      const distance = cameraDistanceForFit(framing.fitDistance, 1)
      const halfFov = Math.min(21 * Math.PI / 180, Math.atan(Math.tan(21 * Math.PI / 180) * aspect))
      expect(distance * Math.sin(halfFov)).toBeGreaterThan(radius)
      expect(distance).toBeLessThan(radius * 7)
      // Parent + nearest moon markers occupy less than half their separation.
      expect((0.075 + 0.042) * framing.bodyScale).toBeLessThan(radius / 8)
      const range = cameraRangeForFit(framing.fitDistance, radius)
      expect(range.near).toBeLessThan(radius / 10)
      expect(range.minDistance).toBeLessThan(cameraDistanceForFit(framing.fitDistance, 12))
      expect(range.maxDistance).toBeGreaterThanOrEqual(cameraDistanceForFit(framing.fitDistance, 0.15))
      expect(range.far).toBeGreaterThan(range.maxDistance + radius)
    }
  })

  it('preserves ordinary Solar System framing and finite empty-scene defaults', () => {
    expect(sceneFramingForRadius(30, 1.6).fitDistance).toBe(30 * 1.45 + 1.4)
    expect(sceneFramingForRadius(0, 1)).toEqual({ fitDistance: 2.8, bodyScale: 1, auxiliaryScale: 1 })
    expect(sceneFramingForRadius(NaN, 0)).toEqual(sceneFramingForRadius(0, 1))
    expect(cameraRangeForFit(10, 2)).toMatchObject({ near: .005, minDistance: .08 })
  })

  it('widens the portrait fit without changing AU geometry or marker scale', () => {
    const landscape = sceneFramingForRadius(.00016, 1.6, .00006)
    const portrait = sceneFramingForRadius(.00016, .5, .00006)
    expect(portrait.fitDistance).toBeGreaterThan(landscape.fitDistance)
    expect(portrait.bodyScale).toBe(landscape.bodyScale)
    expect(portrait.auxiliaryScale).toBe(landscape.auxiliaryScale)
  })
})
