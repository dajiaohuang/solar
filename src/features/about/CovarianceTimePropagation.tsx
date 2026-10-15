import { ForceModelEvidence } from './ForceModelEvidence'
import { TdbEpochReadout } from './TdbEpochReadout'
import { CartesianStateTable } from './CartesianStateTable'
import { startDynamicsJob, type DynamicsJob } from '../../lib/dynamicsJob'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { propagateDynamicsCovariance } from '../../engine/dynamics/covariancePropagation'
import { covarianceEllipsoid } from '../../engine/ephemeris/covarianceEllipsoid'
import { CovarianceEllipsoid } from './CovarianceEllipsoid'
import { CovarianceCoordinateModel } from './CovarianceCoordinateModel'
import { DynamicsDiagnostics } from './DynamicsDiagnostics'
import { CovarianceFactorizationEvidence } from './CovarianceFactorizationEvidence'
import { UnsupportedCovarianceAxesNotice, type CovarianceSourceAxis } from './UnsupportedCovarianceAxesNotice'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import type { OrbitalPeriodUncertaintyStatus } from '../../engine/ephemeris/orbitalPeriodUncertainty'

const PERIOD_STATUS: Record<OrbitalPeriodUncertaintyStatus, readonly [string, string]> = {
  available: ['可计算的条件一阶结果', 'Computable conditional first-order result'],
  'invalid-or-unrepresentable-state': ['状态退化或数值不可表示', 'Invalid or unrepresentable state'],
  'near-parabolic': ['近抛物线，周期不适用', 'Near-parabolic; period unavailable'],
  'degenerate-orbit': ['轨道面退化，周期不适用', 'Degenerate orbit; period unavailable'],
  'non-elliptic': ['非椭圆轨道，无椭圆周期', 'Nonelliptic orbit; no elliptic period'],
  'unrepresentable-period': ['周期超出数值表示范围', 'Period outside numerical range'],
  'unrepresentable-projection': ['不确定性投影超出数值表示范围', 'Uncertainty projection outside numerical range'],
}

type Receipt = Awaited<ReturnType<typeof propagateDynamicsCovariance>> & {
  schemaVersion: number; calculation: string; sourceFile: { sha256: string; bytes: number; originalBase64: string; payload: unknown }
}

export function CovarianceTimePropagation({ bytes, dimension, extraAxes, zh }: {
  bytes: ArrayBuffer; dimension: number; extraAxes: readonly CovarianceSourceAxis[]; zh: boolean
}) {
  const [days, setDays] = useState('30'), [exclusion, setExclusion] = useState('1')
  const [solarRelativity, setSolarRelativity] = useState(false)
  const [compareRefinement, setCompareRefinement] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [result, setResult] = useState<Receipt | null>(null)
  const generation = useRef(0)
  const worker = useRef<DynamicsJob | null>(null)
  const clear = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { generation.current++; worker.current?.terminate(); worker.current = null }, [])
  const geometry = useMemo(() => {
    if (!result) return null
    try { return covarianceEllipsoid(result.finalCoordinates.matrix, 149597870.7) } catch { return null }
  }, [result])
  const periodComparisons = result ? [
    { label: zh ? '解算历元' : 'Solution epoch', elapsedDays: 0, value: result.initialCoordinates.orbitalPeriodUncertainty },
    { label: zh ? '传播终点（基准）' : 'Endpoint (baseline)', elapsedDays: result.experiment.finalEpoch.elapsedTdbSeconds/86400, value: result.finalCoordinates.orbitalPeriodUncertainty },
    ...(result.covarianceRefinement ? [{ label: zh ? '传播终点（加严）' : 'Endpoint (refined)', elapsedDays: result.experiment.finalEpoch.elapsedTdbSeconds/86400, value: result.covarianceRefinement.orbitalPeriodUncertainty }] : []),
  ] : []
  const periodNumber = (value: number | null) => value !== null && Number.isFinite(value)
    ? value.toPrecision(9) : (zh ? '未定义' : 'Undefined')
  const run = () => {
    clear()
    const durationSeconds = Number(days)*86400, exclusionKm = Number(exclusion)
    if (!days.trim() || !exclusion.trim() || !Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365*86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0) {
      setError(zh ? '时长须在 ±365 天内，排除距离须非负。' : 'Duration must be within ±365 days and exclusion distance nonnegative.'); return
    }
    try {
      const initialBytes = bytes.slice(0)
      const active = startDynamicsJob<Receipt>({ kind: 'covariance', initialBytes, durationSeconds, exclusionKm, solarRelativity, compareRefinement }, [initialBytes], {
        done: receipt => {
          if (worker.current !== active) return
          worker.current = null; setBusy(false); setResult(receipt)
        },
        error: message => {
          if (worker.current !== active) return
          worker.current = null; setBusy(false); setResult(null); setError(message)
        },
      })
      worker.current = active; setBusy(true)
    } catch (reason) { clear(); setError(String(reason)) }
  }
  return <details className="covariance-time-propagation">
    <summary>{zh ? '随时间传播形式协方差' : 'Propagate formal covariance in time'}</summary>
    <p>{zh ? '采用固定 DE440 星历和引力常数的六参数一阶条件传播，不复现完整轨道拟合模型。未包含星历误差、模型误差、非线性分布或事件概率。' : 'Six-parameter first-order conditional propagation with fixed DE440 ephemerides and GMs. This does not reproduce the complete orbit-fit model or include ephemeris/model errors, nonlinear distributions or event probabilities.'}</p>
    {dimension !== 6 ? <UnsupportedCovarianceAxesNotice extraAxes={extraAxes} zh={zh} /> : <>
      <label className="field"><span>{zh ? '协方差传播时长（TDB 天）' : 'Covariance duration (TDB days)'}</span><input type="number" min="-365" max="365" step="any" value={days} onChange={event => { clear(); setDays(event.target.value) }} /></label>
      <label className="field"><span>{zh ? '协方差点质量排除距离（km）' : 'Covariance point-mass exclusion distance (km)'}</span><input type="number" min="0" step="any" value={exclusion} onChange={event => { clear(); setExclusion(event.target.value) }} /></label>
      <p>{zh ? '正时长向未来传播，负时长向过去传播，起点始终为协方差解算历元。排除距离仅在力计算时检查，不是连续碰撞检测。' : 'Positive duration advances time; negative duration goes backward, always from the covariance solution epoch. Exclusion checks at force evaluations are not continuous collision detection.'}</p>
      <label className="dynamics-check"><input type="checkbox" checked={solarRelativity} onChange={event => { clear(); setSolarRelativity(event.target.checked) }} />{zh ? '为协方差传播采用太阳 1PN 修正' : 'Adopt solar 1PN for covariance propagation'}</label>
      <label className="dynamics-check"><input type="checkbox" checked={compareRefinement} onChange={event => { clear(); setCompareRefinement(event.target.checked) }} />{zh ? '额外积分一次，对照加严容差后的协方差' : 'Integrate again to compare covariance with tighter tolerances'}</label>
      <p>{zh ? '对照将相对及绝对容差缩小为十分之一、初始及最大步长减半；两次积分共用同一任务时限，各自保留步数预算。差值不是物理不确定性或全局误差界。' : 'The comparison uses one-tenth relative and absolute tolerances and halves initial and maximum steps. Both integrations share the job deadline, with separate attempt budgets. Differences are not physical uncertainty or global error bounds.'}</p>
      <button type="button" className="primary-button" disabled={busy} onClick={run}>{zh ? '采用条件 DE440 模型并传播' : 'Adopt conditional DE440 model and propagate'}</button>
      {busy && <><p role="status">{zh ? '正在校验星历并传播协方差…' : 'Verifying ephemeris and propagating covariance…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消协方差传播' : 'Cancel covariance propagation'}</button></>}
    </>}
    <p>{zh ? '每次浏览器实验最多运行 300 秒；超时即终止，可缩短时长或减少样本后重新运行。' : 'Each browser experiment has a 300-second limit; expiry terminates it. Reduce duration or sample count before retrying.'}</p>
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="covariance-time-result">
      <ForceModelEvidence evidence={result.experiment.forceModel} zh={zh} />
      <dl className="contract-list">
        <div><dt>{zh ? 'SBDB 源解算星历（PE / SB）' : 'SBDB source-fit ephemerides (PE / SB)'}</dt><dd>{result.source.planetaryEphemeris ?? '—'} / {result.source.smallBodyEphemeris ?? '—'}</dd></div>
        <div><dt>{zh ? '本次采用的传播核' : 'Adopted propagation kernel'}</dt><dd>{result.experiment.forceModel.kernel.id}</dd></div>
      </dl>
      <p>{zh ? '这些标识用于直接对照来源与本次采用的计算输入，不表示复现了 SBDB 的轨道拟合力模型。' : 'These identifiers expose the source and adopted computation inputs for comparison; they do not mean the SBDB orbit-fit force model was reproduced.'}</p>
      <CovarianceFactorizationEvidence evidence={result.sourceFactorization} zh={zh} />
      <CovarianceCoordinateModel conversion={result.initialCoordinates} zh={zh} />
      <TdbEpochReadout epoch={result.finalCoordinates.epoch} title={zh ? '传播终点' : 'Propagation endpoint'} zh={zh} />
      <p>{zh ? '日心 J2000 黄道坐标；下列标准差与椭球仅属于已采用的条件模型。' : 'Heliocentric J2000 ecliptic coordinates; these standard deviations and ellipsoid belong only to the adopted conditional model.'}</p>
      <div className="uncertainty-table"><table><caption>{zh ? '传播后的形式标准差' : 'Propagated formal standard deviations'}</caption><thead><tr><th>{zh ? '分量' : 'Axis'}</th><th>σ</th><th>{zh ? '单位' : 'Unit'}</th></tr></thead><tbody>{result.finalCoordinates.labels.map((label, i) => <tr key={label}><th>{label}</th><td>{(result.finalCoordinates.marginalSigmas[i]*149597870.7/(i < 3 ? 1 : 86400)).toExponential(5)}</td><td>{i < 3 ? 'km' : 'km/s'}</td></tr>)}</tbody></table></div>
      <CartesianStateTable state={result.finalCoordinates.nominal} covariance={result.finalCoordinates.matrix} title={zh ? '查看终点状态与完整协方差' : 'Inspect endpoint state and complete covariance'} zh={zh} />
      {geometry ? <CovarianceEllipsoid geometry={geometry} zh={zh} /> : <p>{zh ? '传播后的椭球无法可靠分解。' : 'The propagated ellipsoid cannot be factored reliably.'}</p>}
      {result.covarianceRefinement && <details>
        <summary>{zh ? '查看加严容差的协方差对照' : 'Inspect covariance refinement comparison'}</summary>
        <div className="uncertainty-table"><table>
          <caption>{zh ? '两组数值设置下的形式标准差' : 'Formal standard deviations under two numerical settings'}</caption>
          <thead><tr><th>{zh ? '分量 / 单位' : 'Axis / unit'}</th><th>{zh ? '基准 σ' : 'Baseline σ'}</th><th>{zh ? '加严 σ' : 'Refined σ'}</th><th>|Δσ|</th></tr></thead>
          <tbody>{result.finalCoordinates.labels.map((label, i) => {
            const scale = 149597870.7/(i < 3 ? 1 : 86400), comparison = result.covarianceRefinement!
            return <tr key={label}><th>{label} [{i < 3 ? 'km' : 'km/s'}]</th><td>{(result.finalCoordinates.marginalSigmas[i]*scale).toExponential(5)}</td><td>{(comparison.marginalSigmas[i]*scale).toExponential(5)}</td><td>{(comparison.marginalSigmaAbsoluteDifference[i]*scale).toExponential(5)}</td></tr>
          })}</tbody>
        </table></div>
        <CartesianStateTable state={result.covarianceRefinement.nominal} covariance={result.covarianceRefinement.matrix} title={zh ? '查看加严积分终点与完整协方差' : 'Inspect refined endpoint and full covariance'} zh={zh} />
        <p>{zh ? '两次计算使用相同来源与力模型；对照不是独立验证、全局误差界或物理精度证明。零时长的一致性不提供积分收敛证据。导出保留两组设置、状态转移矩阵和协方差平方根。' : 'Both runs use the same source and force model. This is not independent validation, a global error bound or proof of physical accuracy. Zero-duration agreement supplies no integration-convergence evidence. The export retains both settings, transition matrices and covariance roots.'}</p>
      </details>}
      <p>{result.experiment.numerics.accepted} {zh ? '接受步数' : 'accepted steps'} · {result.experiment.forceModel.solarRelativity ? 'Newtonian + solar 1PN' : 'Newtonian'}</p>
      <details>
        <summary>{zh ? '查看传播前后的瞬时周期形式不确定性' : 'Inspect osculating-period formal uncertainty before and after propagation'}</summary>
        <div className="uncertainty-table"><table>
          <caption>{zh ? '同一条件模型的解算历元与终点周期诊断' : 'Solution-epoch and endpoint period diagnostics under the same conditional model'}</caption>
          <thead><tr><th>{zh ? '量 / 单位' : 'Quantity / unit'}</th>{periodComparisons.map(entry => <th key={entry.label}>{entry.label}</th>)}</tr></thead>
          <tbody>
            <tr><th>{zh ? '相对解算历元（TDB 日）' : 'From solution epoch (TDB days)'}</th>{periodComparisons.map(entry => <td key={entry.label}>{periodNumber(entry.elapsedDays)}</td>)}</tr>
            <tr><th>{zh ? '计算状态' : 'Calculation status'}</th>{periodComparisons.map(entry => <td key={entry.label}>{PERIOD_STATUS[entry.value.periodStatus][zh ? 0 : 1]}</td>)}</tr>
            <tr><th>{zh ? '名义周期（日）' : 'Nominal period (days)'}</th>{periodComparisons.map(entry => <td key={entry.label}>{periodNumber(entry.value.nominalPeriodDays)}</td>)}</tr>
            <tr><th>{zh ? '条件一阶 σ（日）' : 'Conditional first-order σ (days)'}</th>{periodComparisons.map(entry => <td key={entry.label}>{periodNumber(entry.value.periodSigmaDays)}</td>)}</tr>
            <tr><th>{zh ? '半长轴倒数 α（AU⁻¹）' : 'Reciprocal semimajor axis α (AU⁻¹)'}</th>{periodComparisons.map(entry => <td key={entry.label}>{periodNumber(entry.value.reciprocalSemiMajorAxisPerAu)}</td>)}</tr>
            <tr><th>{zh ? 'α 的条件一阶 σ（AU⁻¹）' : 'Conditional first-order σ of α (AU⁻¹)'}</th>{periodComparisons.map(entry => <td key={entry.label}>{periodNumber(entry.value.reciprocalSemiMajorAxisSigmaPerAu)}</td>)}</tr>
            <tr><th>{zh ? 'α 的线性一倍标准差区间触及零' : 'Linear one-sigma α interval reaches zero'}</th>{periodComparisons.map(entry => <td key={entry.label}>{entry.value.linearOneSigmaAlphaIntervalReachesZero === null ? (zh ? '未定义' : 'Undefined') : entry.value.linearOneSigmaAlphaIntervalReachesZero ? (zh ? '是' : 'Yes') : (zh ? '否' : 'No')}</td>)}</tr>
          </tbody>
        </table></div>
        {periodComparisons.some(entry => entry.value.linearOneSigmaAlphaIntervalReachesZero === true) && <p>{zh ? '至少一组半长轴倒数的线性一倍标准差区间触及零；椭圆与非椭圆边界附近的一阶周期近似可能失效。未触及零也不是线性近似有效性的证明。' : 'At least one linear one-sigma interval of reciprocal semimajor axis reaches zero; first-order period approximation can fail near the elliptic/nonelliptic boundary. Not reaching zero does not prove the linear approximation is valid.'}</p>}
        {result.covarianceRefinement && <p>{zh ? '两个传播终点列只改变数值积分设置。周期或标准差的一致不等于独立验证；零时长的一致不提供积分收敛证据。' : 'Only numerical integration settings differ between the two endpoint columns. Agreement in period or sigma is not independent validation; zero-duration agreement supplies no integration-convergence evidence.'}</p>}
        <p>{zh ? '使用各历元的完整协方差平方根和解析导数，保留分量相关性；太阳 GM 与星历固定。这不是实际回归时刻的不确定性、非线性周期分布或置信区间，传播前后的变化也不等于积分误差。未定义或不可表示的值不提供标准差；导出保留导数和采用的 GM。' : 'Uses the complete covariance root and analytic derivatives at each epoch, retaining component correlations; solar GM and ephemerides are fixed. This is not uncertainty in an actual return time, a nonlinear period distribution or a confidence interval; changes across epochs are not integration error. Undefined or unrepresentable values provide no sigma; exports retain derivatives and adopted GM.'}</p>
      </details>
      <p>{zh ? '下方轨道诊断仅描述条件模型的名义轨迹，使用日心 J2000 赤道面；上方坐标协方差使用 J2000 黄道面。除单独列出的瞬时周期形式标准差外，未计算远日点等派生量的不确定性。' : 'The orbit diagnostics below describe only the conditional model’s nominal trajectory in the heliocentric J2000 equatorial frame; the coordinate covariance above uses the J2000 ecliptic frame. Apart from the separately reported formal period sigma, uncertainties of apoapsis and other derived quantities are not computed.'}</p>
      <DynamicsDiagnostics samples={result.experiment.trajectory.samples} comparison={result.experiment.diagnostics.timescaleComparison} zh={zh} />
      <details>
        <summary>{zh ? '查看局部积分诊断与模型限制' : 'Inspect local integration diagnostics and model limitations'}</summary>
        <dl>
          <dt>{zh ? '拒绝步数 / 求值次数' : 'Rejected steps / evaluations'}</dt><dd>{result.experiment.numerics.rejected} / {result.experiment.numerics.evaluations}</dd>
          <dt>{zh ? '最小 / 最大接受步长（s）' : 'Smallest / largest accepted step (s)'}</dt><dd>{result.experiment.numerics.smallestAcceptedStep ?? (zh ? '无接受步' : 'No accepted steps')} / {result.experiment.numerics.largestAcceptedStep}</dd>
          <dt>{zh ? '最大接受局部误差比' : 'Maximum accepted local error ratio'}</dt><dd>{result.experiment.numerics.maxAcceptedErrorRatio}</dd>
          <dt>{zh ? '相对容差' : 'Relative tolerance'}</dt><dd>{result.experiment.numerics.relativeTolerance}</dd>
        </dl>
        <p>{zh ? '误差比是接受步中按分量归一化的嵌入式局部误差估计最大值，不是全局误差界、来源不确定性或物理精度。导出保留绝对容差及状态转移矩阵布局。零时长没有接受步，诊断值为零不代表精度已验证。' : 'The ratio is the maximum component-normalized embedded local error estimate across accepted steps, not a global error bound, source uncertainty or physical accuracy. Absolute tolerances and state-transition layout are retained in the export. Zero duration has no accepted steps; zero diagnostics do not establish accuracy.'}</p>
        <ul>{[...result.limitations, ...result.experiment.forceModel.limitations].map((note, index) => <li key={index}>{note}</li>)}</ul>
      </details>
      <button type="button" className="secondary-button" onClick={() => { const exportGeneration = generation.current; void saveTextExport(JSON.stringify({ ...result, build: BUILD_INFO }, null, 2), 'solar-propagated-covariance.json', 'application/json').catch(reason => { if (exportGeneration === generation.current) setError(String(reason)) }) }}>{zh ? '导出传播协方差与来源 JSON' : 'Export propagated covariance and sources JSON'}</button>
    </div>}
  </details>
}
