import type { TrajectoryFrameData } from '../types'
import { saveTextExport } from './platform'

export async function exportAsJSON(frame: TrajectoryFrameData) {
  const exportData = {
    exportedAt: new Date().toISOString(),
    maxDistanceAU: frame.maxDistance,
    bodyCount: frame.currentPositions.length,
    currentPositions: Array.from({ length: frame.currentPositions.length }, (_, index) => ({
      bodyId: frame.currentPositions.bodyAt(index).id,
      bodyName: frame.currentPositions.bodyAt(index).name,
      x: frame.currentPositions.coordinateAt(index, 0),
      y: frame.currentPositions.coordinateAt(index, 1),
      distanceAU: frame.currentPositions.distanceAt(index),
    })),
    trajectories: frame.trajectories.map((trajectory) => ({
      bodyId: trajectory.body.id,
      bodyName: trajectory.body.name,
      sampleCount: trajectory.points.length,
      points: trajectory.points.map((point) => ({ x: point.x, y: point.y })),
    })),
  }

  await saveTextExport(JSON.stringify(exportData, null, 2), 'solar-trajectories.json', 'application/json')
}

export async function exportAsCSV(frame: TrajectoryFrameData) {
  const rows: string[] = ['bodyId,bodyName,sampleIndex,x,au,y,au']

  for (const trajectory of frame.trajectories) {
    trajectory.points.forEach((point, index) => {
      rows.push(`${trajectory.body.id},${trajectory.body.name},${index},${point.x},${point.y}`)
    })
  }

  await saveTextExport(rows.join('\n'), 'solar-trajectories.csv', 'text/csv')
}
