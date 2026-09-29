export type CovarianceSourceAxis = { label: string; value: number; units: string | null }

export function UnsupportedCovarianceAxesNotice({ extraAxes, zh }: {
  extraAxes: readonly CovarianceSourceAxis[]; zh: boolean
}) {
  return <div role="status">
    <p>{zh
      ? '当前动力学模型尚未按这些来源拟合参数启用并核验对应的力模型；一阶协方差传播还需要匹配的变分导数。为保留联合协方差及其相关性，不能只用前六轴继续计算。'
      : 'The current dynamics model has not enabled and verified the force law fitted to these source parameters; first-order covariance propagation also needs matched variational derivatives. To preserve the joint covariance and correlations, the calculation cannot proceed with only the first six axes.'}</p>
    {extraAxes.length > 0 && <p>{zh ? '未支持的协方差轴：' : 'Unsupported covariance axes: '}
      {extraAxes.map(axis => `${axis.label}=${axis.value.toExponential(5)}${axis.units ? ` ${axis.units}` : ''}`).join(', ')}
    </p>}
    {extraAxes.some(axis => axis.label === 'DT' && axis.value < 0) && <p>{zh
      ? 'DT 为负；只有在来源符号约定对应 r(t−DT) 时才意味着需要未来日心距离。JPL 将 DT 称为滞后/延迟参数，但当前尚未核实此解的符号映射。'
      : 'DT is negative. It implies a future heliocentric distance only if this source uses the r(t−DT) sign convention. JPL describes DT as a lag/delay parameter, but this solution’s sign mapping has not been verified.'}</p>}
    <p><a href="https://ssd.jpl.nasa.gov/horizons/manual.html#user-specified-small-bodies" target="_blank" rel="noreferrer">
      {zh ? 'JPL Horizons 非引力参数说明' : 'JPL Horizons non-gravitational parameter definitions'}
    </a></p>
  </div>
}
