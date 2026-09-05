import type { TrajectoryFrameData } from '../types'
import { saveTextExport } from './platform'
import { exportBackendTrajectoryAudit } from './backendTrajectories'

export async function exportAsJSON(frame: TrajectoryFrameData) {
  const exportData = {
    exportedAt: new Date().toISOString(),
    maxDistanceAU: frame.maxDistance,
    bodyCount: frame.currentPositions.length,
    trajectoryEvidence: frame.trajectoryAudit ? exportBackendTrajectoryAudit(frame.trajectoryAudit) : undefined,
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
      sampleCount: trajectory.coordinates.length / 3,
      points: Array.from({ length: trajectory.coordinates.length / 3 }, (_, index) => ({
        x: trajectory.coordinates[index * 3], y: trajectory.coordinates[index * 3 + 1],
        z: trajectory.coordinates[index * 3 + 2],
      })),
    })),
  }

  await saveTextExport(JSON.stringify(exportData, null, 2), 'solar-trajectories.json', 'application/json')
}

export async function exportAsCSV(frame: TrajectoryFrameData) {
  const rows: string[] = ['bodyId,bodyName,sampleIndex,x,au,y,au']

  for (const trajectory of frame.trajectories) {
    for (let index = 0; index < trajectory.coordinates.length / 3; index++) {
      rows.push(`${trajectory.body.id},${trajectory.body.name},${index},${trajectory.coordinates[index * 3]},${trajectory.coordinates[index * 3 + 1]}`)
    }
  }

  await saveTextExport(rows.join('\n'), 'solar-trajectories.csv', 'text/csv')
}
