import type { stateToConicDiagnostics } from '../../engine/ephemeris/osculating'

type Diagnostic = ReturnType<typeof stateToConicDiagnostics>
export function DynamicsDiagnostics({ first, last, zh }: { first: Diagnostic; last: Diagnostic; zh: boolean }) {
  const rows: [string, keyof NonNullable<Diagnostic>, number, string][] = [
    [zh ? '半长轴' : 'Semimajor axis', 'semiMajorAxisKm', 1/149597870.7, 'AU'],
    [zh ? '半长轴倒数' : 'Reciprocal semimajor axis', 'reciprocalSemiMajorAxisPerKm', 149597870.7, 'AU⁻¹'],
    [zh ? '偏心率' : 'Eccentricity', 'eccentricity', 1, ''],
    [zh ? '倾角' : 'Inclination', 'inclinationDeg', 1, '°'],
    [zh ? '近日点距离' : 'Periapsis distance', 'periapsisKm', 1/149597870.7, 'AU'],
    [zh ? '二体比能' : 'Two-body specific energy', 'specificKeplerEnergyKm2PerSecond2', 1, 'km²/s²'],
  ]
  const format = (value: number | boolean | null | undefined, scale: number) => typeof value === 'number' ? (value*scale).toPrecision(9) : (zh ? '未定义' : 'Undefined')
  return <details className="dynamics-diagnostics"><summary>{zh ? '查看瞬时轨道诊断' : 'Inspect instantaneous orbit diagnostics'}</summary>
    <p>{zh ? '日心 J2000 赤道面；使用固定太阳 GM 的瞬时牛顿二体诊断。摄动或 1PN 模型下这些量并不守恒，其变化不等同于积分误差或长期不稳定。' : 'Sun-centered, J2000 equatorial plane; instantaneous Newtonian two-body diagnostics with fixed solar GM. These quantities are not conserved under perturbations or 1PN; changes do not by themselves establish integration error or long-term instability.'}</p>
    <div className="uncertainty-table"><table><caption>{zh ? '起点与终点的瞬时轨道' : 'Initial and final osculating orbit'}</caption><thead><tr><th>{zh ? '量 / 单位' : 'Quantity / unit'}</th><th>{zh ? '起点' : 'Initial'}</th><th>{zh ? '终点' : 'Final'}</th></tr></thead><tbody>{rows.map(([label, key, scale, unit]) => <tr key={key}><th>{label}<small>{unit}</small></th><td>{format(first?.[key], scale)}</td><td>{format(last?.[key], scale)}</td></tr>)}</tbody></table></div>
    <p>{zh ? '近抛物线的半长轴及退化轨道面的倾角标为未定义；负半长轴表示瞬时双曲线。近日点是瞬时二体量，不是实际最近接预测。显示位数不代表物理精度。' : 'Near-parabolic semimajor axes and degenerate-plane inclinations are undefined; a negative semimajor axis represents an instantaneous hyperbola. Periapsis is a two-body diagnostic, not an actual closest-approach prediction. Display digits do not establish physical accuracy.'}</p>
  </details>
}
