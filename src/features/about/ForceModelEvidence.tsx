import type { createDe440Dynamics } from '../../engine/dynamics/de440Dynamics'

type Evidence = Awaited<ReturnType<typeof createDe440Dynamics>>['evidence']

/** Renders adopted receipt values; does not fetch sources or evaluate forces. */
export function ForceModelEvidence({ evidence, zh }: { evidence: Evidence; zh: boolean }) {
  const radiation = evidence.solarRadiationPressure, pn = evidence.solarRelativity
  return <details data-testid="force-model-evidence">
    <summary>{zh ? '查看采用的力模型、参数与来源' : 'Inspect adopted force model, parameters and sources'}</summary>
    <p>{evidence.model}</p>
    <p>{zh ? '积分坐标系 / 原点 / 时标 / 像差处理' : 'Integration frame / origin / time scale / aberration'}: {evidence.frame} / {evidence.origin} / {evidence.timeScale} / {evidence.aberration}</p>
    <p>JD {evidence.referenceEpochTdb} TDB · {zh ? '采用的相对时间窗口' : 'Adopted elapsed-time window'}: [{evidence.elapsedRangeSeconds.join(', ')}] s</p>
    <p>{zh ? '核文件标识' : 'Kernel identity'}: {evidence.kernel.id}<br />{evidence.kernel.source}<br />SHA-256: {evidence.kernel.sha256}</p>
    <p>{zh ? 'GM 来源' : 'GM source'}: {evidence.kernel.gmSource}<br />SHA-256: {evidence.kernel.gmSha256}</p>
    <div className="uncertainty-table"><table>
      <caption>{zh ? '采用的引力天体与排除距离' : 'Adopted force bodies and exclusion distances'}</caption>
      <thead><tr><th scope="col">NAIF</th><th scope="col">GM (km³/s²)</th><th scope="col">{zh ? '排除距离' : 'Exclusion'} (km)</th></tr></thead>
      <tbody>{evidence.masses.map(mass => <tr key={mass.naifId}><th scope="row">{mass.naifId}</th><td>{String(mass.gmKm3PerSecond2)}</td><td>{String(mass.exclusionKm)}</td></tr>)}</tbody>
    </table></div>
    {pn ? <>
      <p>{pn.model} · c = {pn.speedOfLightKmPerSecond} km/s · {zh ? '展开参数上限' : 'Maximum expansion parameter'}: {pn.maxExpansionParameter}</p>
      <p>{pn.approximation}</p><p>{pn.reference}</p>
    </> : <p>{zh ? '太阳 1PN 修正：未启用' : 'Solar 1PN: not adopted'}</p>}
    {radiation ? <>
      <p>{radiation.parameters.model} · {radiation.parameters.illumination}</p>
      <dl>
        <dt>{zh ? '1 AU 处光压' : 'Pressure at 1 AU'} (N/m²)</dt><dd>{String(radiation.parameters.pressureAt1AuNewtonPerSquareMeter)}</dd>
        <dt>{zh ? '有效面积' : 'Effective area'} (m²)</dt><dd>{String(radiation.parameters.areaSquareMeters)}</dd>
        <dt>{zh ? '质量' : 'Mass'} (kg)</dt><dd>{String(radiation.parameters.massKg)}</dd>
        <dt>{zh ? '反射系数（无量纲）' : 'Reflectivity coefficient (dimensionless)'}</dt><dd>{String(radiation.parameters.reflectivityCoefficient)}</dd>
        <dt>{zh ? '参数来源声明' : 'Declared parameter source'}</dt><dd>{radiation.parameters.source}</dd>
      </dl>
      <p>{radiation.limitation}</p><p>{radiation.reference}</p>
    </> : <p>{zh ? '太阳光压：未启用' : 'Solar radiation pressure: not adopted'}</p>}
    <p>{zh ? '模型参数和引力天体轨迹固定。积分坐标系可能不同于结果坐标系。排除距离不代表连续碰撞检测，展开参数上限不是误差界；参数来源声明不是独立认证。' : 'Force parameters and prescribed mass trajectories are fixed. Integration and output frames may differ. Exclusions are not continuous collision detection; the expansion cutoff is not an error bound. Parameter source declarations are not independent authentication.'}</p>
    <ul>{evidence.limitations.map((note, index) => <li key={index}>{note}</li>)}</ul>
  </details>
}
