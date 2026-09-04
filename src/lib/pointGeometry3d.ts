import * as THREE from 'three'

/** Keep GPU buffers across epochs; resize geometrically and release old GPU data. */
export function updatePointGeometry(
  previous: THREE.BufferGeometry,
  count: number,
  colorKey: unknown,
  writePosition: (values: Float32Array, index: number) => void,
  writeColor: (values: Float32Array, index: number) => void,
) {
  let geometry = previous
  const capacity = previous.getAttribute('position')?.count ?? 0
  if (count > capacity || (capacity > 256 && count < capacity / 4)) {
    const nextCapacity = count ? Math.max(256, 2 ** Math.ceil(Math.log2(count))) : 0
    geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nextCapacity * 3), 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nextCapacity * 3), 3))
    previous.dispose()
  }
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const recolor = geometry.userData.colorKey !== colorKey || geometry.userData.pointCount !== count
  for (let index = 0; index < count; index++) {
    writePosition(positions!.array as Float32Array, index)
    if (recolor) writeColor(colors!.array as Float32Array, index)
  }
  if (positions) positions.needsUpdate = true
  if (colors && recolor) colors.needsUpdate = true
  geometry.userData.colorKey = colorKey
  geometry.userData.pointCount = count
  geometry.setDrawRange(0, count)
  return geometry
}
