import { CartesianStateTable } from './CartesianStateTable'
import { startDynamicsJob, type DynamicsJob } from '../../lib/dynamicsJob'
import { useEffect, useRef, useState } from 'react'
import type { propagateSourceOffsetEnsemble } from '../../engine/dynamics/nonlinearEnsemble'
import type { sampleSbdbCovariance } from '../../engine/ephemeris/covarianceSampling'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { CovarianceCoordinateModel } from './CovarianceCoordinateModel'
import { EnsembleEndpointProjections } from './EnsembleEndpointProjections'
import { ForceModelEvidence } from './ForceModelEvidence'
import { CovarianceFactorizationEvidence } from './CovarianceFactorizationEvidence'
import { TdbEpochReadout } from './TdbEpochReadout'
import { UnsupportedCovarianceAxesNotice, type CovarianceSourceAxis } from './UnsupportedCovarianceAxesNotice'

type Receipt = Awaited<ReturnType<typeof propagateSourceOffsetEnsemble>> & {
  sampling: ReturnType<typeof sampleSbdbCovariance>; schemaVersion: number; calculation: string
  sourceFile: { sha256: string; bytes: number; originalBase64: string; payload: unknown }
}

export function NonlinearOrbitEnsemble({ bytes, dimension, extraAxes, zh }: {
  bytes: ArrayBuffer; dimension: number; extraAxes: readonly CovarianceSourceAxis[]; zh: boolean
}) {
  const [days,setDays] = useState('30'), [count,setCount] = useState('32'), [seed,setSeed] = useState('20260923')
  const [exclusion,setExclusion] = useState('1'), [solar,setSolar] = useState(false)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [result,setResult] = useState<Receipt | null>(null)
  const generation = useRef(0)
  const worker = useRef<DynamicsJob | null>(null)
  const clear = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false); setError(''); setResult(null) }
  useEffect(() => () => { generation.current++; worker.current?.terminate(); worker.current = null }, [])
  const run = () => {
    clear()
    const durationSeconds = Number(days)*86400, sampleCount = Number(count), randomSeed = Number(seed), exclusionKm = Number(exclusion)
    if (![days,count,seed,exclusion].every(v => v.trim()) || !Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365*86400 ||
      !Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > 128 || !Number.isSafeInteger(randomSeed) || randomSeed < 0 || randomSeed > 0xffffffff || !Number.isFinite(exclusionKm) || exclusionKm < 0) {
      setError(zh ? '请输入 ±365 天内的时长、1–128 个样本、32 位非负整数种子与非负排除距离。' : 'Use a duration within ±365 days, 1–128 samples, an unsigned 32-bit seed and nonnegative exclusion distance.'); return
    }
    try {
      const initialBytes = bytes.slice(0)
      const active = startDynamicsJob<Receipt>({ kind: 'ensemble', initialBytes, durationSeconds, sampleCount, seed: randomSeed, exclusionKm, solarRelativity: solar, compareRefinement: false }, [initialBytes], {
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
  const field = (label: string, value: string, setter: (v: string) => void, min: number, max?: number) => <label className="field"><span>{label}</span>
    <input type="number" min={min} max={max} step="any" value={value} onChange={event => { clear(); setter(event.target.value) }} /></label>
  const save = () => {
    const exportGeneration = generation.current
    const json = JSON.stringify({ ...result, build: BUILD_INFO,
      packedArrayConvention: 'Row-major six-component arrays. Invalid endpoints serialize as null; consult valid and failures without dropping draw indices.' },
    (_key,value: unknown) => value instanceof Float64Array || value instanceof Uint8Array ? Array.from(value) : value, 2)
    void saveTextExport(json,'solar-nonlinear-ensemble.json','application/json').catch(reason => { if (exportGeneration === generation.current) setError(String(reason)) })
  }
  return <details className="covariance-time-propagation">
    <summary>{zh ? '非线性轨道样本传播' : 'Propagate nonlinear orbit samples'}</summary>
    <p>{zh ? '从源参数的联合高斯近似抽样，以固定 DE440 条件模型分别积分。样本不是事件概率或真实误差保证；未包含完整拟合模型与星历误差。' : 'Draw from the joint Gaussian approximation in source parameters, then integrate each sample under a fixed conditional DE440 model. Samples are not event probabilities or physical error guarantees; the complete fit model and ephemeris errors are absent.'}</p>
    {dimension !== 6 ? <UnsupportedCovarianceAxesNotice extraAxes={extraAxes} zh={zh} /> : <>
      {field(zh ? '样本传播时长（TDB 天）' : 'Ensemble duration (TDB days)',days,setDays,-365,365)}
      {field(zh ? '联合样本数量' : 'Joint sample count',count,setCount,1,128)}
      {field(zh ? '抽样随机种子' : 'Sampling seed',seed,setSeed,0,0xffffffff)}
      {field(zh ? '样本点质量排除距离（km）' : 'Ensemble point-mass exclusion distance (km)',exclusion,setExclusion,0)}
      <label className="dynamics-check"><input type="checkbox" checked={solar} onChange={event => { clear(); setSolar(event.target.checked) }} />{zh ? '为样本传播采用太阳 1PN 修正' : 'Adopt solar 1PN for ensemble propagation'}</label>
      <p>{zh ? '最多 128 个样本、共享 250,000 次力计算；达到预算即停止。排除距离在力计算时检查，不是连续碰撞检测。' : 'At most 128 samples share 250,000 force evaluations; budget exhaustion stops the run. Exclusion checks are not continuous collision detection.'}</p>
      <button type="button" className="primary-button" disabled={busy} onClick={run}>{zh ? '采用条件模型并传播样本' : 'Adopt conditional model and propagate samples'}</button>
      {busy && <><p role="status">{zh ? '正在校验星历并逐个传播样本…' : 'Verifying ephemeris and integrating samples…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消样本传播' : 'Cancel sample propagation'}</button></>}
    </>}
    <p>{zh ? '每次浏览器实验最多运行 300 秒；超时即终止，可缩短时长或减少样本后重新运行。' : 'Each browser experiment has a 300-second limit; expiry terminates it. Reduce duration or sample count before retrying.'}</p>
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="nonlinear-ensemble-result">
      <ForceModelEvidence evidence={result.forceModel} zh={zh} />
      <CovarianceFactorizationEvidence evidence={result.sampling.factorization} zh={zh} />
      <CovarianceCoordinateModel conversion={result.initial.nominalCoordinateModel} zh={zh} />
      <TdbEpochReadout epoch={result.finalEpoch} title={zh ? '样本终点时刻' : 'Sample endpoint time'} zh={zh} />
      <p>{result.valid.reduce((sum,v) => sum+v,0)}/{result.initial.count} {zh ? '有效终点' : 'valid endpoints'} · {result.evaluations} {zh ? '次力计算' : 'force evaluations'}</p>
      {result.moments.status === 'available' ? <div data-testid="ensemble-moments">
        <p>{zh ? '样本标准差：' : 'Sample standard deviations:'} {result.moments.standardDeviations.map((v,i) => `${['x','y','z','vx','vy','vz'][i]}: ${(v*149597870.7/(i < 3 ? 1 : 86400)).toExponential(4)} ${i < 3 ? 'km' : 'km/s'}`).join(' · ')}</p>
        <p>{zh ? '仅为本批有限样本的描述统计，不代表置信区间、收敛证明或物理误差。' : 'Descriptive statistics of this finite batch only; not confidence intervals, convergence evidence or physical errors.'}</p>
        <p>{zh ? '统计样本数 / 样本协方差分母：' : 'Draw count / sample covariance divisor: '}{result.moments.count} / {result.moments.covarianceDivisor}</p>
        <CartesianStateTable state={result.moments.mean} covariance={result.moments.covariance} title={zh ? '查看样本均值与协方差' : 'Inspect sample mean and covariance'} zh={zh} />
      </div> : <p role="status">{zh ? '有样本失败或不足两个样本，不汇总均值与协方差。' : 'Mean and covariance are unavailable when a draw failed or fewer than two samples exist.'}</p>}
      <EnsembleEndpointProjections states={result.finalStates} valid={result.valid} zh={zh} />
      <p>{zh ? '失败样本保留索引，不重新抽样。下表为日心 J2000 黄道坐标；偏移、种子、力模型与来源见导出。' : 'Failed samples retain their indices and are never redrawn. Table: heliocentric J2000 ecliptic coordinates. Export includes offsets, seed, force model and source.'}</p>
      <div className="uncertainty-table"><table><caption>{zh ? '非线性样本终点' : 'Nonlinear sample endpoints'}</caption><thead><tr><th>#</th><th>{zh ? '状态' : 'Status'}</th><th>{zh ? '力求值次数' : 'Force evaluations'}</th><th>x (AU)</th><th>y (AU)</th><th>z (AU)</th><th>vx (AU/day)</th><th>vy (AU/day)</th><th>vz (AU/day)</th></tr></thead>
        <tbody>{Array.from(result.valid,(valid,index) => <tr key={index}><th>{index+1}</th><td>{valid ? (zh ? '成功' : 'Valid') : (zh ? '失败' : 'Failed')}</td><td>{result.forceEvaluationsByDraw[index]}</td>{[0,1,2,3,4,5].map(axis => <td key={axis}>{valid ? result.finalStates[index*6+axis].toPrecision(12) : '—'}</td>)}</tr>)}</tbody></table></div>
      {result.failures.length > 0 && <p role="status">{zh ? '失败原因' : 'Failure reasons'}: {result.failures.map(f => `#${f.index+1} [${f.stage}]: ${f.reason}`).join('; ')}</p>}
      <button type="button" className="secondary-button" onClick={save}>{zh ? '导出样本、设置与来源 JSON' : 'Export samples, settings and sources JSON'}</button>
    </div>}
  </details>
}
