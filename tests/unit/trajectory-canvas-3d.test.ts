import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createTrajectoryScene } from '../../src/lib/trajectoryScene3d'

describe('3D trajectory scene', () => {
  it('keeps distant content visible instead of fading it into the background', () => {
    const scene = createTrajectoryScene()

    expect(scene.fog).toBeNull()
    expect(scene.background).toBeInstanceOf(THREE.Color)
    expect((scene.background as THREE.Color).getHex()).toBe(0x05070b)
  })
})
