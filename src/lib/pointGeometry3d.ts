import * as THREE from 'three'
import type { CurrentPositions } from './currentPositions'
import type { AsteroidRecord, Vector3 } from '../types'

/** Subtract the pane's heliocentric origin in Float64 before GPU rounding.
 * Only materialize the prefix that this pane will draw; later budget growth
 * extends that prefix without allocating or uploading the hidden catalog tail. */
export function updateCatalogPointGeometry(previous: THREE.BufferGeometry, source: Float64Array, records: AsteroidRecord[], origin: Vector3,
  drawLimit?: number, positionKey?: unknown, appearance?: Uint8Array) {
  const available = Math.min(appearance ? appearance.length / 2 : records.length, Math.floor(source.length / 3))
  if (drawLimit !== undefined && (!Number.isSafeInteger(drawLimit) || drawLimit < 0)) throw new RangeError('Invalid catalog point draw limit')
  const count = Math.min(available, drawLimit ?? available)
  return updatePointGeometry(previous, count, appearance ?? records, (positions, index) => {
    positions[index * 3] = source[index * 3] - origin.x
    positions[index * 3 + 1] = source[index * 3 + 2] - origin.z
    positions[index * 3 + 2] = source[index * 3 + 1] - origin.y
  }, (colors, index) => {
    const record = records[index]
    const offset = index * 3
    if (appearance ? appearance[index * 2 + 1] & 2 : record.isPha) { colors[offset] = 255; colors[offset + 1] = 89; colors[offset + 2] = 77 }
    else if (appearance ? appearance[index * 2 + 1] & 1 : record.isNeo) { colors[offset] = 255; colors[offset + 1] = 158; colors[offset + 2] = 128 }
    else { colors[offset] = 158; colors[offset + 1] = 179; colors[offset + 2] = 194 }
  }, positionKey)
}

/** Bulk current-state layer reads scalar source storage directly. `positionKey`
 * must change whenever the frame or point membership changes. */
export function updateCurrentPointGeometry(previous: THREE.BufferGeometry, source: CurrentPositions, ordinals: Uint32Array, colorKey: unknown = ordinals, positionKey?: unknown) {
  const color = new THREE.Color()
  return updatePointGeometry(previous, ordinals.length, colorKey,
    (values, index) => {
      const ordinal = ordinals[index]
      values[index * 3] = source.coordinateAt(ordinal, 0)
      values[index * 3 + 1] = source.coordinateAt(ordinal, 2)
      values[index * 3 + 2] = source.coordinateAt(ordinal, 1)
    }, (values, index) => {
      color.set(source.bodyAt(ordinals[index]).color)
      values[index * 3] = Math.round(color.r * 255)
      values[index * 3 + 1] = Math.round(color.g * 255)
      values[index * 3 + 2] = Math.round(color.b * 255)
    }, positionKey)
}

/** Keep GPU buffers across epochs; resize geometrically and release old GPU data.
 * A changed `positionKey` rewrites the live prefix. With a stable key, extending
 * the visible prefix writes only newly exposed rows; callers must change the key
 * whenever source coordinates or their relative origin changes. */
export function updatePointGeometry(
  previous: THREE.BufferGeometry,
  count: number,
  colorKey: unknown,
  writePosition: (values: Float32Array, index: number) => void,
  writeColor: (values: Uint8Array, index: number) => void,
  positionKey?: unknown,
) {
  let geometry = previous
  const capacity = previous.getAttribute('position')?.count ?? 0
  if (count > capacity || (capacity > 256 && count < capacity / 4)) {
    const nextCapacity = count ? Math.max(256, 2 ** Math.ceil(Math.log2(count))) : 0
    geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nextCapacity * 3), 3).setUsage(THREE.DynamicDrawUsage))
    // Normalized RGB8 is display-only and cuts per-point color storage by 75%.
    geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(nextCapacity * 3), 3, true))
    previous.dispose()
  }
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const previousCount = Number.isSafeInteger(geometry.userData.pointCount) && geometry.userData.pointCount >= 0
    ? geometry.userData.pointCount as number : 0
  const rewritePositions = positionKey === undefined || geometry.userData.positionKey !== positionKey
  const positionStart = rewritePositions ? 0 : Math.min(previousCount, count)
  const positionsChanged = rewritePositions || count > previousCount
  const colorKeyChanged = geometry.userData.colorKey !== colorKey
  const colorStart = colorKeyChanged ? 0 : Math.min(previousCount, count)
  const colorsChanged = colorKeyChanged || count > previousCount
  for (let index = 0; index < count; index++) {
    if (positionsChanged && (rewritePositions || index >= positionStart)) writePosition(positions!.array as Float32Array, index)
    if (colorsChanged && (colorKeyChanged || index >= colorStart)) writeColor(colors!.array as Uint8Array, index)
  }
  // Both point layers disable frustum culling. Do not compute unused bounds.
  // Capacity grows geometrically, but only newly written live rows need an
  // update range. Preserve earlier pending ranges until the renderer consumes
  // them, since a prefix extension may happen before the next draw.
  if (positions && positionsChanged && count > positionStart) {
    if (rewritePositions) positions.clearUpdateRanges()
    positions.addUpdateRange(positionStart*3,(count-positionStart)*3)
    positions.needsUpdate = true
  }
  if (colors && colorsChanged && count > colorStart) {
    if (colorKeyChanged) colors.clearUpdateRanges()
    colors.addUpdateRange(colorStart*3,(count-colorStart)*3)
    colors.needsUpdate = true
  }
  if (positionKey === undefined) delete geometry.userData.positionKey
  else geometry.userData.positionKey = positionKey
  geometry.userData.colorKey = colorKey
  geometry.userData.pointCount = count
  geometry.setDrawRange(0, count)
  return geometry
}
