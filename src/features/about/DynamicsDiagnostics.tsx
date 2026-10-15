import type { orbitalTimescaleComparison, stateToConicDiagnostics } from '../../engine/ephemeris/osculating'

type Diagnostic = ReturnType<typeof stateToConicDiagnostics>
type Sample = { elapsedTdbSeconds: number; osculating: Diagnostic }
export function DynamicsDiagnostics({ samples, comparison, zh }: { samples: readonly Sample[]; comparison: ReturnType<typeof orbitalTimescaleComparison>; zh: boolean }) {
  const first = samples[0]?.osculating, last = samples[samples.length-1]?.osculating
  const rows: [string, keyof NonNullable<Diagnostic>, number, string][] = [
    [zh ? '半长轴' : 'Semimajor axis', 'semiMajorAxisKm', 1/149597870.7, 'AU'],
    [zh ? '半长轴倒数' : 'Reciprocal semimajor axis', 'reciprocalSemiMajorAxisPerKm', 149597870.7, 'AU⁻¹'],
    [zh ? '偏心率' : 'Eccentricity', 'eccentricity', 1, ''],
    [zh ? '倾角' : 'Inclination', 'inclinationDeg', 1, '°'],
    [zh ? '近日点距离' : 'Periapsis distance', 'periapsisKm', 1/149597870.7, 'AU'],
    [zh ? '远日点距离' : 'Apoapsis distance', 'apoapsisKm', 1/149597870.7, 'AU'],
    [zh ? '瞬时二体周期' : 'Instantaneous two-body period', 'orbitalPeriodSeconds', 1/86400, zh ? '日' : 'days'],
    [zh ? '二体比能' : 'Two-body specific energy', 'specificKeplerEnergyKm2PerSecond2', 1, 'km²/s²'],
  ]
  const initialPeriods = comparison.absoluteDurationInInitialPeriods
  const format = (value: number | boolean | null | undefined, scale: number) => typeof value === 'number' && Number.isFinite(value*scale) ? (value*scale).toPrecision(9) : (zh ? '未定义' : 'Undefined')
  const ranges = rows.map(([, key, scale]) => {
    let minimum: { value: number; time: number } | null = null
    let maximum: { value: number; time: number } | null = null
    let valid = 0
    for (const sample of samples) {
      const value = sample.osculating?.[key]
      if (typeof value !== 'number' || !Number.isFinite(value*scale) || !Number.isFinite(sample.elapsedTdbSeconds)) continue
      valid++
      if (!minimum || value < minimum.value) minimum = { value, time: sample.elapsedTdbSeconds }
      if (!maximum || value > maximum.value) maximum = { value, time: sample.elapsedTdbSeconds }
    }
    return { minimum, maximum, valid }
  })
  const extremum = (value: { value: number; time: number } | null, scale: number) => value
    ? <>{format(value.value, scale)}<small>{zh ? '相对 TDB 秒：' : 'Elapsed TDB s: '}{value.time.toPrecision(9)}</small></>
    : (zh ? '未定义' : 'Undefined')
  return <details className="dynamics-diagnostics"><summary>{zh ? '查看瞬时轨道诊断' : 'Inspect instantaneous orbit diagnostics'}</summary>
    <p>{zh ? '日心 J2000 赤道面；使用固定太阳 GM 的瞬时牛顿二体诊断。摄动或 1PN 模型下这些量并不守恒，其变化不等同于积分误差或长期不稳定。' : 'Sun-centered, J2000 equatorial plane; instantaneous Newtonian two-body diagnostics with fixed solar GM. These quantities are not conserved under perturbations or 1PN; changes do not by themselves establish integration error or long-term instability.'}</p>
    <p>{zh ? '实验时长 / 初始瞬时二体周期：' : 'Experiment duration / initial osculating two-body period: '}{format(initialPeriods, 1)}.
      {' '}{zh ? '这是时间尺度对照，不是实测绕行圈数、共振判定或长期稳定性证明。周期仅用于非退化椭圆轨道；远日点与周期均随摄动变化。' : 'This is a timescale comparison, not a measured revolution count, resonance classification or long-term stability proof. Periods apply only to nondegenerate ellipses; apoapsis and period both vary under perturbations.'}</p>
    <div className="uncertainty-table"><table><caption>{zh ? '起点与终点的瞬时轨道' : 'Initial and final osculating orbit'}</caption><thead><tr><th>{zh ? '量 / 单位' : 'Quantity / unit'}</th><th>{zh ? '起点' : 'Initial'}</th><th>{zh ? '终点' : 'Final'}</th></tr></thead><tbody>{rows.map(([label, key, scale, unit]) => <tr key={key}><th>{label}<small>{unit}</small></th><td>{format(first?.[key], scale)}</td><td>{format(last?.[key], scale)}</td></tr>)}</tbody></table></div>
    <div className="uncertainty-table"><table>
      <caption>{zh ? '保留积分节点中的诊断范围' : 'Diagnostic ranges among retained integration nodes'}</caption>
      <thead><tr><th>{zh ? '量 / 单位' : 'Quantity / unit'}</th><th>{zh ? '采样最小值' : 'Sampled minimum'}</th><th>{zh ? '采样最大值' : 'Sampled maximum'}</th><th>{zh ? '有效 / 总节点' : 'Valid / total nodes'}</th></tr></thead>
      <tbody>{rows.map(([label, key, scale, unit], index) => <tr key={key}>
        <th>{label}<small>{unit}</small></th>
        <td>{extremum(ranges[index].minimum, scale)}</td><td>{extremum(ranges[index].maximum, scale)}</td>
        <td>{ranges[index].valid} / {samples.length}</td>
      </tr>)}</tbody>
    </table></div>
    <p>{zh ? '仅统计抽稀后保留的积分节点；节点间隔不均匀，可能漏掉更大变化。时刻为相对参考历元的 TDB 秒，重复极值取积分顺序中的首次出现。未定义节点不参与范围统计，但计入总数；范围不是连续极值、误差界、共振或稳定性判定。' : 'Only retained, decimated integration nodes are summarized. Spacing is nonuniform and larger changes may be missed. Times are TDB seconds from the reference epoch; tied extrema use the first node in integration order. Undefined nodes are excluded from ranges but remain in the total. Ranges are not continuous extrema, error bounds, resonance or stability classifications.'}</p>
    <p>{zh ? '近抛物线的半长轴及退化轨道面的倾角标为未定义；负半长轴表示瞬时双曲线。近日点是瞬时二体量，不是实际最近接预测。显示位数不代表物理精度。' : 'Near-parabolic semimajor axes and degenerate-plane inclinations are undefined; a negative semimajor axis represents an instantaneous hyperbola. Periapsis is a two-body diagnostic, not an actual closest-approach prediction. Display digits do not establish physical accuracy.'}</p>
  </details>
}
