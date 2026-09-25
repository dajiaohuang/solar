import * as THREE from 'three'

/** Derive only the active renderer's Float32 XZY buffer, reusing it on ticks. */
export function updateTrajectoryLineGeometry(geometry: THREE.BufferGeometry, coordinates: Float64Array, breakBefore?: Uint8Array) {
  let attribute = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!attribute || attribute.array.length !== coordinates.length) {
    geometry.dispose()
    geometry = new THREE.BufferGeometry()
    attribute = new THREE.BufferAttribute(new Float32Array(coordinates.length), 3)
    geometry.setAttribute('position', attribute)
  }
  const values = attribute.array as Float32Array
  for (let offset = 0; offset < coordinates.length; offset += 3) {
    values[offset] = coordinates[offset]
    values[offset + 1] = coordinates[offset + 2]
    values[offset + 2] = coordinates[offset + 1]
  }
  attribute.needsUpdate = true
  // Indexed independent edges retain one vertex buffer and never join across
  // an explicitly reported source transition. Used with THREE.LineSegments.
  const capacity = Math.max(0, coordinates.length / 3 - 1) * 2
  let edges = geometry.getIndex()
  if (!edges || edges.array.length !== capacity) {
    edges = new THREE.BufferAttribute(new Uint32Array(capacity), 1)
    geometry.setIndex(edges)
  }
  let edgeCount = 0
  for (let vertex = 1; vertex < coordinates.length / 3; vertex++) {
    if (!breakBefore?.[vertex]) { edges.setX(edgeCount++, vertex - 1); edges.setX(edgeCount++, vertex) }
  }
  edges.needsUpdate = true
  geometry.setDrawRange(0, edgeCount)
  geometry.computeBoundingSphere()
  return geometry
}

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
