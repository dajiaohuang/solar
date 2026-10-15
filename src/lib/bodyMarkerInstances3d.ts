import * as THREE from 'three'

const matrix = new THREE.Matrix4()

/** Batch display markers; subtract the camera target in Float64 before the
 * instance buffer rounds to Float32. Picking keeps the original world meshes. */
export function updateBodyMarkerInstances(instances: THREE.InstancedMesh,
  meshes: ReadonlyMap<string, THREE.Mesh>, origin: THREE.Vector3) {
  const active = [...meshes].filter(([, mesh]) => mesh.visible)
  if (active.length > instances.instanceMatrix.count) throw new RangeError('Body marker instance budget exceeded')
  const colorKey = active.map(([id]) => id).join('\0')
  const colorsChanged = instances.userData.markerColorKey !== colorKey
  for (let index = 0; index < active.length; index++) {
    const mesh = active[index][1]
    mesh.updateMatrix()
    matrix.copy(mesh.matrix)
    matrix.elements[12] -= origin.x
    matrix.elements[13] -= origin.y
    matrix.elements[14] -= origin.z
    instances.setMatrixAt(index, matrix)
    if (colorsChanged) instances.setColorAt(index, (mesh.material as THREE.MeshBasicMaterial).color)
  }
  instances.position.copy(origin)
  instances.count = active.length
  instances.visible = active.length > 0
  instances.instanceMatrix.needsUpdate = true
  if (colorsChanged && instances.instanceColor) instances.instanceColor.needsUpdate = true
  instances.userData.markerColorKey = colorKey
}
