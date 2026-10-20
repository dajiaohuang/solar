import { useMemo } from 'react'

const axes = ['x', 'y', 'z']
const auKm = 149597870.7

/** Display only: no fitting, resampling, covariance or probability inference. */
export function EnsembleEndpointProjections({ states, valid, zh }: { states: Float64Array; valid: Uint8Array; zh: boolean }) {
  const plot = useMemo(() => {
    if (!valid.length || valid.length > 128 || states.length !== valid.length*6 || valid.some(flag => flag > 1)) return null
    const anchorIndex = valid.findIndex(flag => flag === 1)
    if (anchorIndex < 0) return null
    const anchor = [0, 1, 2].map(axis => states[anchorIndex*6+axis])
    if (!anchor.every(Number.isFinite)) return null
    const points: { index: number; offsets: number[] }[] = []
    let maximum = 0
    for (let index = 0; index < valid.length; index++) {
      if (!valid[index]) continue
      // Subtract the Float64 AU coordinates before converting to kilometres.
      const offsets = anchor.map((value, axis) => (states[index*6+axis]-value)*auKm)
      if (!offsets.every(Number.isFinite)) return null
      for (const offset of offsets) maximum = Math.max(maximum, Math.abs(offset))
      points.push({ index, offsets })
    }
    const halfExtentKm = maximum ? maximum*1.1 : 1
    if (!Number.isFinite(2*halfExtentKm)) return null
    return { anchorIndex, points, halfExtentKm, coincident: maximum === 0 }
  }, [states, valid])
  if (!plot) return <p role="status">{zh ? '没有可显示的有效终点偏移。' : 'No valid endpoint offsets are available for display.'}</p>
  return <div data-testid="ensemble-endpoint-projections">
    <p>{zh
      ? `终点散点：${plot.points.length} / ${valid.length}。以原始样本 #${plot.anchorIndex+1}（首个有效终点）为参考，图中编号与下表一致；参考点不是名义轨道或均值。`
      : `Endpoint scatter: ${plot.points.length} / ${valid.length}. Reference: original draw #${plot.anchorIndex+1}, the first valid endpoint. Draw numbers match the table; the reference is neither the nominal orbit nor the mean.`}</p>
    <div className="uncertainty-projections">{[[0, 1], [0, 2], [1, 2]].map(([a, b]) => {
      const name = `Δ${axes[a]} / Δ${axes[b]}`
      return <figure key={name}>
        <svg viewBox="0 0 160 160" role="img" aria-label={`${name} ${zh ? '样本终点偏移，单位千米' : 'sample endpoint offsets in kilometres'}`}>
          <path d="M15 80H145M80 15V145" className="uncertainty-axis" />
          {plot.points.map(point => <circle key={point.index} cx={80+65*(point.offsets[a]/plot.halfExtentKm)} cy={80-65*(point.offsets[b]/plot.halfExtentKm)}
            r="2.5" className={point.index === plot.anchorIndex ? 'dynamics-start' : 'dynamics-end'}>
            <title>{`#${point.index+1}: Δ${axes[a]}=${point.offsets[a].toPrecision(8)} km; Δ${axes[b]}=${point.offsets[b].toPrecision(8)} km`}</title>
          </circle>)}
          <text x="145" y="75" textAnchor="end">Δ{axes[a]}</text><text x="85" y="18">Δ{axes[b]}</text>
        </svg>
        <figcaption>{name} · ±{plot.halfExtentKm.toPrecision(4)} km</figcaption>
      </figure>
    })}</div>
    <p>{zh
      ? `三个平面使用同一比例，未拟合椭圆或连接样本。失败 ${valid.length-plot.points.length} 个，未补值、未重新抽样；重合点可能遮挡。散点不是概率密度、置信区间或事件概率。`
      : `All planes share one scale; no ellipse fit or lines connecting draws. ${valid.length-plot.points.length} failed draws are neither filled nor resampled; coincident points can overlap. Scatter is not probability density, a confidence region or an event probability.`}</p>
    {plot.coincident && <p>{zh ? '有效位置全部重合，采用 ±1 km 显示刻度；此刻度不是误差界。' : 'All valid positions coincide; the ±1 km display scale is not an error bound.'}</p>}
  </div>
}
