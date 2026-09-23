import type { DynamicsSample } from '../../engine/dynamics/trajectorySamples'

export function DynamicsTrajectory({ samples, zh }: { samples: DynamicsSample[]; zh: boolean }) {
  const labels = ['x', 'y', 'z'], auKm = 149597870.7
  return <div className="uncertainty-projections">{[[0, 1], [0, 2], [1, 2]].map(([a, b]) => {
    const points = samples.map(sample => [sample.heliocentricPositionKm[a]/auKm, sample.heliocentricPositionKm[b]/auKm])
    const xs = [0, ...points.map(p => p[0])], ys = [0, ...points.map(p => p[1])]
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const extent = Math.max(maxX-minX, maxY-minY) * 1.2 || 1, cx = (minX+maxX)/2, cy = (minY+maxY)/2
    const x = (value: number) => 80 + (value-cx)/extent*130, y = (value: number) => 80 - (value-cy)/extent*130
    const start = points[0], end = points[points.length-1], name = `${labels[a]} / ${labels[b]}`
    return <figure key={name}><svg viewBox="0 0 160 160" role="img" aria-label={`${name} ${zh ? '日心轨迹投影' : 'heliocentric trajectory projection'}`}>
      <path d={`M15 ${y(0)}H145M${x(0)} 15V145`} className="uncertainty-axis" />
      <polyline points={points.map(p => `${x(p[0])},${y(p[1])}`).join(' ')} className="dynamics-path" />
      <circle cx={x(0)} cy={y(0)} r="3" className="dynamics-sun" />
      {start && <circle cx={x(start[0])} cy={y(start[1])} r="3" className="dynamics-start" />}
      {end && <circle cx={x(end[0])} cy={y(end[1])} r="3" className="dynamics-end" />}
      <text x="145" y={y(0)-5} textAnchor="end">{labels[a]}</text><text x={x(0)+5} y="18">{labels[b]}</text>
    </svg><figcaption>{name} · {zh ? '宽' : 'width'} {extent.toPrecision(3)} AU</figcaption></figure>
  })}</div>
}
