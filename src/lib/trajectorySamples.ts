import { toPlanarPoint } from './referenceFrame'
import type { BodyPosition, CelestialBody, TrajectorySample, Vector3 } from '../types'

/** Shared by main-thread and worker sampling. Missing states cannot shift body
 * identities or draw a line across a gap; only complete trails are returned. */
export function createTrajectoryAccumulator(bodies: CelestialBody[]) {
  const samples = new Map(bodies.map(body => [body.id, { body, points: [], points3D: [] } as TrajectorySample & { points3D: Vector3[] }]))
  const incomplete = new Set<string>()
  return {
    append(positions: BodyPosition[]) {
      const available = new Map(positions.map(item => [item.body.id, item.position]))
      for (const [id, sample] of samples) {
        const position = available.get(id)
        if (!position) { incomplete.add(id); continue }
        sample.points.push(toPlanarPoint(position))
        sample.points3D.push(position)
      }
    },
    complete(sampleCount: number) {
      return [...samples.values()].filter(sample => !incomplete.has(sample.body.id) && sampleCount > 0 && sample.points.length === sampleCount)
    },
    incompleteBodyIds() {
      return [...incomplete]
    },
  }
}
