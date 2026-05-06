import type { TrajectoryFrameData } from '../types'

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportAsJSON(frame: TrajectoryFrameData) {
  const exportData = {
    exportedAt: new Date().toISOString(),
    maxDistanceAU: frame.maxDistance,
    bodyCount: frame.currentPositions.length,
    currentPositions: frame.currentPositions.map((item) => ({
      bodyId: item.body.id,
      bodyName: item.body.name,
      x: item.planarPosition.x,
      y: item.planarPosition.y,
      distanceAU: item.distance,
    })),
    trajectories: frame.trajectories.map((trajectory) => ({
      bodyId: trajectory.body.id,
      bodyName: trajectory.body.name,
      sampleCount: trajectory.points.length,
      points: trajectory.points.map((point) => ({ x: point.x, y: point.y })),
    })),
  }

  downloadBlob(JSON.stringify(exportData, null, 2), 'solar-trajectories.json', 'application/json')
}

export function exportAsCSV(frame: TrajectoryFrameData) {
  const rows: string[] = ['bodyId,bodyName,sampleIndex,x,au,y,au']

  for (const trajectory of frame.trajectories) {
    trajectory.points.forEach((point, index) => {
      rows.push(`${trajectory.body.id},${trajectory.body.name},${index},${point.x},${point.y}`)
    })
  }

  downloadBlob(rows.join('\n'), 'solar-trajectories.csv', 'text/csv')
}
