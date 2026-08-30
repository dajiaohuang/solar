import { describe, expect, it } from 'vitest'
import { VIEW_CAPABILITIES } from '../../src/lib/viewCapabilities'
import { cameraDistanceForFit, cameraRangeForFit } from '../../src/lib/camera3d'

describe('view capability contract', () => {
  it('keeps shared zoom in both renderers and identifies 2D-only controls', () => {
    expect(VIEW_CAPABILITIES['2d']).toEqual({
      zoom: true,
      offset: true,
      fullOrbits: true,
      hillSphere: true,
      laplaceSoi: true,
      ecliptic: true,
      lagrange: true,
      spacecraft: true,
      catalogCloud: true,
    })
    expect(VIEW_CAPABILITIES['3d']).toEqual({
      zoom: true,
      offset: false,
      fullOrbits: false,
      hillSphere: false,
      laplaceSoi: false,
      ecliptic: true,
      lagrange: true,
      spacecraft: true,
      catalogCloud: true,
    })
  })

  it('maps zoom to a stable fit distance without clipping minimum zoom', () => {
    expect(cameraDistanceForFit(10, 2)).toBeCloseTo(cameraDistanceForFit(10, 1) / 2)
    expect(cameraDistanceForFit(10, 0.15)).toBeGreaterThan(cameraDistanceForFit(10, 1))
    const range = cameraRangeForFit(260, 180)
    expect(range.far).toBeGreaterThan(range.maxDistance)
    expect(range.maxDistance).toBeGreaterThanOrEqual(cameraDistanceForFit(260, 0.15))
  })
})
