import * as THREE from 'three'
import type { TrajectorySample } from '../types'

type Source = { id: string; color: string; coordinates: Float64Array; breaks?: Uint8Array }
type Receipt = { sources: Source[]; x: number; y: number; z: number }

/** Two opacity groups preserve per-body colors and disconnected source edges.
 * Coordinates remain Float64 until subtracting the camera target for the GPU. */
export function updateTrailBatch(line: THREE.LineSegments, trajectories: readonly TrajectorySample[],
  smallBodies: boolean, origin: THREE.Vector3) {
  const sources = trajectories.filter(item => item.coordinates.length >= 6 &&
    (item.body.kind === 'asteroid' || item.body.kind === 'comet') === smallBodies)
  const previous = line.userData.trailReceipt as Receipt | undefined
  const changed = !previous || previous.sources.length !== sources.length || sources.some((source, index) => {
    const old = previous.sources[index]
    return old.id !== source.body.id || old.color !== source.body.color || old.coordinates !== source.coordinates || old.breaks !== source.breakBefore
  })
  if (!changed && previous.x === origin.x && previous.y === origin.y && previous.z === origin.z) return
  const vertices = sources.reduce((sum, source) => sum + source.coordinates.length / 3, 0)
  let geometry = line.geometry
  if ((geometry.getAttribute('position')?.count ?? 0) < vertices) {
    const capacity = Math.max(256, 2 ** Math.ceil(Math.log2(vertices)))
    geometry.dispose()
    geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3))
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(capacity * 2), 1))
    line.geometry = geometry
  }
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const edges = geometry.getIndex()
  const color = new THREE.Color()
  let vertex = 0, edge = 0
  for (const source of sources) {
    color.set(source.body.color)
    const count = source.coordinates.length / 3
    for (let index = 0; index < count; index++, vertex++) {
      positions!.setXYZ(vertex, source.coordinates[index * 3] - origin.x, source.coordinates[index * 3 + 2] - origin.y, source.coordinates[index * 3 + 1] - origin.z)
      if (changed) colors!.setXYZ(vertex, color.r, color.g, color.b)
      if (changed && index > 0 && !source.breakBefore?.[index]) { edges!.setX(edge++, vertex - 1); edges!.setX(edge++, vertex) }
    }
  }
  if (positions) { positions.clearUpdateRanges(); positions.addUpdateRange(0, vertices * 3); positions.needsUpdate = true }
  if (changed) {
    if (colors) { colors.clearUpdateRanges(); colors.addUpdateRange(0, vertices * 3); colors.needsUpdate = true }
    if (edges) edges.needsUpdate = true
    geometry.setDrawRange(0, edge)
  }
  line.position.copy(origin)
  line.visible = geometry.drawRange.count > 0 && sources.length > 0
  if (vertices) geometry.computeBoundingSphere()
  line.userData.trailReceipt = { sources: sources.map(source => ({ id: source.body.id, color: source.body.color, coordinates: source.coordinates, breaks: source.breakBefore })), x: origin.x, y: origin.y, z: origin.z } satisfies Receipt
}
