import type { Vector3 } from '../../types'

/** Stable unsigned angle between two nonzero directions, in degrees. */
export function angularSeparationRadians(a: Vector3, b: Vector3): number {
  const unit = (value: Vector3): Vector3 | null => {
    const scale = Math.max(Math.abs(value.x), Math.abs(value.y), Math.abs(value.z))
    if (!Number.isFinite(scale) || scale === 0) return null
    const x = value.x / scale, y = value.y / scale, z = value.z / scale
    const magnitude = Math.hypot(x, y, z)
    return { x: x / magnitude, y: y / magnitude, z: z / magnitude }
  }
  const unitA = unit(a), unitB = unit(b)
  if (!unitA || !unitB) return Number.NaN

  const { x: ax, y: ay, z: az } = unitA
  const { x: bx, y: by, z: bz } = unitB
  const cosine = ax * bx + ay * by + az * bz
  const sine = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
  return Math.atan2(sine, cosine)
}

export function angularSeparationDeg(a: Vector3, b: Vector3): number {
  return angularSeparationRadians(a, b) * 180 / Math.PI
}
