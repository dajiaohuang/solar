import { useState } from 'react'
import type { covarianceEllipsoid } from '../../engine/ephemeris/covarianceEllipsoid'

type Geometry = ReturnType<typeof covarianceEllipsoid>
export function CovarianceEllipsoid({ geometry, zh }: { geometry: Geometry; zh: boolean }) {
  const [yaw, setYaw] = useState(35), [pitch, setPitch] = useState(25), [level, setLevel] = useState(0)
  const radius = geometry.levels[level].radius, bound = geometry.radiusBound*3 || 1
  const probability = geometry.levels[level].gaussianProbability3d
  const cy = Math.cos(yaw*Math.PI/180), sy = Math.sin(yaw*Math.PI/180), cp = Math.cos(pitch*Math.PI/180), sp = Math.sin(pitch*Math.PI/180)
  const project = (p: number[]) => [160+108*(cy*p[0]-sy*p[1])/bound, 130-108*(cp*p[2]-sp*(sy*p[0]+cy*p[1]))/bound]
  const point = (latitude: number, longitude: number) => {
    const sphere = [Math.cos(latitude)*Math.cos(longitude), Math.cos(latitude)*Math.sin(longitude), Math.sin(latitude)]
    return project(geometry.factor.map(row => radius*row.reduce((sum, value, i) => sum+value*sphere[i], 0))).join(',')
  }
  const lines = [-60, -30, 0, 30, 60].map(latitude => Array.from({ length: 65 }, (_, i) => point(latitude*Math.PI/180, i*Math.PI/32)).join(' '))
  for (let longitude = 0; longitude < 12; longitude++) lines.push(Array.from({ length: 33 }, (_, i) => point(-Math.PI/2+i*Math.PI/32, longitude*Math.PI/6)).join(' '))
  return <div className="covariance-ellipsoid">
    <p>{zh ? '三维位置协方差椭球 · 日心 J2000 黄道坐标偏差' : '3D position covariance ellipsoid · heliocentric J2000 ecliptic offsets'}</p>
    <svg viewBox="0 0 320 260" role="img" aria-label={zh ? '可旋转的三维协方差椭球' : 'Rotatable 3D covariance ellipsoid'}>
      {['x', 'y', 'z'].map((label, i) => { const axis = [0, 0, 0]; axis[i] = bound; const endpoint = project(axis); return <g key={label}><path d={`M160 130L${endpoint[0]} ${endpoint[1]}`} className="uncertainty-axis" /><text x={endpoint[0]+4} y={endpoint[1]-4}>Δ{label}</text></g> })}
      {lines.map((points, i) => <polyline key={i} points={points} className="covariance-mesh" />)}
      <circle cx="160" cy="130" r="2" className="dynamics-sun"><title>{zh ? '名义位置，坐标偏差为零' : 'Nominal position, zero coordinate offset'}</title></circle>
    </svg>
    <p>{zh ? '马氏半径' : 'Mahalanobis radius'} {radius} · {probability !== null ? `${(probability*100).toFixed(2)}% ${zh ? '三维高斯概率质量' : '3D Gaussian probability mass'}` : (zh ? '退化协方差，不报告三维概率质量' : 'Degenerate covariance; no 3D probability mass reported')}</p>
    <p>{zh ? '坐标轴长度' : 'Coordinate-axis length'}: {bound.toExponential(3)} km. {zh ? '中心为名义位置，保持真实轴比例；不是碰撞概率或误差保证。' : 'Centered on the nominal position with true axis ratios; not collision probability or an error guarantee.'}</p>
    <label className="field"><span>{zh ? '椭球轮廓' : 'Ellipsoid contour'}</span><select aria-label={zh ? '椭球轮廓' : 'Ellipsoid contour'} value={level} onChange={event => setLevel(Number(event.target.value))}>{geometry.levels.map((value, i) => <option key={value.radius} value={i}>{zh ? '马氏半径' : 'Mahalanobis radius'} {value.radius}</option>)}</select></label>
    <label className="field"><span>{zh ? '椭球方位角' : 'Ellipsoid azimuth'}: {yaw}°</span><input type="range" min="-180" max="180" value={yaw} onChange={event => setYaw(Number(event.target.value))} /></label>
    <label className="field"><span>{zh ? '椭球俯仰角' : 'Ellipsoid elevation'}: {pitch}°</span><input type="range" min="-90" max="90" value={pitch} onChange={event => setPitch(Number(event.target.value))} /></label>
    <button type="button" className="secondary-button" onClick={() => { setYaw(35); setPitch(25); setLevel(0) }}>{zh ? '重置椭球视图' : 'Reset ellipsoid view'}</button>
  </div>
}
