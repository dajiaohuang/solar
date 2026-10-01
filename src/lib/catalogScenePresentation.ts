/** Bounded deterministic sampling prevents a distant outlier from flattening
 * the initial scene. It changes framing only, never point admission. */
export function catalogFramingRadius(positions: Float64Array, dimensions: 2 | 3, count: number, origin: { x: number; y: number; z?: number }) {
  const available = Math.min(count, Math.floor(positions.length / dimensions))
  const samples = Math.min(2048, available), radii: number[] = []
  for (let sample = 0; sample < samples; sample++) {
    const offset = Math.floor(sample * available / samples) * dimensions
    const radius = Math.hypot(positions[offset] - origin.x, positions[offset + 1] - origin.y,
      dimensions === 3 ? positions[offset + 2] - (origin.z ?? 0) : 0)
    if (Number.isFinite(radius)) radii.push(radius)
  }
  radii.sort((a, b) => a - b)
  return radii.length ? radii[Math.floor((radii.length - 1) * .95)] * 1.08 : 0
}

export type SceneLabel = { id: string; x: number; y: number; width: number }
/** Priority order is supplied by the caller; crowded/offscreen labels hide. */
export function placeSceneLabels(labels: SceneLabel[], width: number, height: number) {
  const placed: SceneLabel[] = []
  for (const label of labels) {
    for (const [dx, dy] of [[7, -8], [7, 10], [-label.width - 7, -8], [-label.width - 7, 10]]) {
      const candidate = { ...label, x: label.x + dx, y: label.y + dy }
      if (candidate.x < 2 || candidate.y < 2 || candidate.x + candidate.width > width - 2 || candidate.y + 14 > height - 2) continue
      if (placed.some(other => candidate.x < other.x + other.width + 4 && candidate.x + candidate.width + 4 > other.x && candidate.y < other.y + 18 && candidate.y + 18 > other.y)) continue
      placed.push(candidate); break
    }
  }
  return placed
}
