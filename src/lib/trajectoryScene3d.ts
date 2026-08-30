import * as THREE from 'three'

export function createTrajectoryScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x05070b)
  return scene
}
