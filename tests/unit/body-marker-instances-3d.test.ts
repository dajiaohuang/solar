import { expect, it } from 'vitest'
import * as THREE from 'three'
import { updateBodyMarkerInstances } from '../../src/lib/bodyMarkerInstances3d'

it('batches only visible markers and preserves close offsets around a distant camera target', () => {
  const geometry = new THREE.SphereGeometry(1, 8, 6)
  const instances = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2)
  const first = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#ff8000' }))
  first.position.set(1e9 + .125, -2, 4); first.scale.setScalar(.01)
  const second = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#00ff00' }))
  second.position.set(1e9 + .25, 3, 5)
  const meshes = new Map([['first', first], ['second', second]])
  const origin = new THREE.Vector3(1e9, 0, 0), matrix = new THREE.Matrix4(), color = new THREE.Color()
  updateBodyMarkerInstances(instances, meshes, origin)
  expect(instances.count).toBe(2)
  instances.getMatrixAt(0, matrix)
  expect(matrix.elements[12]).toBe(.125)
  expect(matrix.elements[0]).toBeCloseTo(.01)
  expect(first.matrix.elements[12]).toBe(1e9 + .125)
  expect(instances.position.x).toBe(1e9)
  instances.getColorAt(0, color)
  expect(color.r).toBeCloseTo((first.material as THREE.MeshBasicMaterial).color.r)
  const version = instances.instanceColor!.version
  updateBodyMarkerInstances(instances, meshes, origin)
  expect(instances.instanceColor!.version).toBe(version)
  first.visible = false
  updateBodyMarkerInstances(instances, meshes, origin)
  expect(instances.count).toBe(1)
  instances.getMatrixAt(0, matrix); expect(matrix.elements[12]).toBe(.25)
  instances.getColorAt(0, color); expect(color.g).toBe(1)
  second.visible = false
  updateBodyMarkerInstances(instances, meshes, origin)
  expect(instances.visible).toBe(false)
  expect(instances.count).toBe(0)
})
