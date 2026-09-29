import type { cartesianCovarianceAtSolutionEpoch } from '../../engine/ephemeris/orbitCovariance'

type Model = Pick<ReturnType<typeof cartesianCovarianceAtSolutionEpoch>, 'model' | 'numericalDomain' | 'nominalConic'>

/** Describes the nominal coordinate map, separate from temporal forces and
 * from the geometry/probability interpretation of a covariance contour. */
export function CovarianceCoordinateModel({ conversion, zh }: { conversion: Model; zh: boolean }) {
  const { nominalConic: conic, numericalDomain: domain } = conversion
  const names = { elliptic: zh ? '椭圆' : 'Elliptic', parabolic: zh ? '抛物线' : 'Parabolic', hyperbolic: zh ? '双曲线' : 'Hyperbolic' }
  const universal = conversion.model === 'universal-conic-osculating-coordinate-transform'
  return <details>
    <summary>{zh ? '名义轨道与坐标转换范围' : 'Nominal orbit and coordinate-conversion domain'}</summary>
    <dl className="contract-list">
      <div><dt>{zh ? '名义圆锥轨道' : 'Nominal conic'}</dt><dd>{names[conic.classification]}</dd></div>
      <div><dt>{zh ? '偏心率' : 'Eccentricity'}</dt><dd>{conic.eccentricity.toPrecision(12)}</dd></div>
      <div><dt>{zh ? '近日点距离' : 'Periapsis distance'}</dt><dd>{conic.periapsisAU.toPrecision(12)} AU</dd></div>
      <div><dt>{zh ? '解算历元距近日点' : 'Solution epoch from periapsis'}</dt><dd>{conic.elapsedTdbDaysFromPeriapsis.toPrecision(12)} {zh ? 'TDB 天' : 'TDB days'}</dd></div>
      <div><dt>{zh ? '坐标转换方法' : 'Coordinate method'}</dt><dd>{universal ? (zh ? '通用变量解析雅可比' : 'Universal-variable analytic Jacobian') : (zh ? '椭圆偏近点角解析雅可比' : 'Elliptic-anomaly analytic Jacobian')}</dd></div>
    </dl>
    <p>{universal
      ? (zh ? `无量纲时间绝对值上限为 ${domain.maximumAbsoluteDimensionlessTime}；时间尺度为 q / √(GM/q)，q 与 GM 使用 AU 和天的一致单位。` : `Absolute dimensionless time is limited to ${domain.maximumAbsoluteDimensionlessTime}; its time scale is q / √(GM/q), with q and GM in consistent AU/day units.`)
      : (zh ? `累计平近点角绝对值上限为 ${domain.maximumAbsoluteMeanAnomalyRadians} 弧度；雅可比保留完整绕行圈数的灵敏度。` : `Absolute accumulated mean anomaly is limited to ${domain.maximumAbsoluteMeanAnomalyRadians} radians; the Jacobian preserves complete-revolution sensitivity.`)}</p>
    <p>{zh ? '以上是解算历元的名义坐标转换限制，不是未来轨道的物理有效期或误差保证。额外拟合参数在坐标转换中保留；时间传播仍需要匹配其力模型。' : 'These limits apply to the nominal coordinate conversion at the solution epoch, not the physical validity or accuracy of a future orbit. Coordinate conversion retains additional fitted parameters; time propagation still requires their matched force model.'}</p>
  </details>
}
