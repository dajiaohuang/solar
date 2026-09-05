import * as THREE from 'three'

export function createTrajectoryScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x05070b)
  return scene
}

export function createCatalogPointMaterial() {
  return new THREE.PointsMaterial({
    size: 2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
  })
}
