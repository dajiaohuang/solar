import { useEffect, useRef, useState } from 'react'
import type { propagateSourceOffsetEnsemble } from '../../engine/dynamics/nonlinearEnsemble'
import type { sampleSbdbCovariance } from '../../engine/ephemeris/covarianceSampling'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'

type Receipt = Awaited<ReturnType<typeof propagateSourceOffsetEnsemble>> & {
  sampling: ReturnType<typeof sampleSbdbCovariance>; schemaVersion: number; calculation: string
  sourceFile: { sha256: string; bytes: number; payload: unknown }
}

export function NonlinearOrbitEnsemble({ bytes, dimension, zh }: { bytes: ArrayBuffer; dimension: number; zh: boolean }) {
  const [days,setDays] = useState('30'), [count,setCount] = useState('32'), [seed,setSeed] = useState('20260923')
  const [exclusion,setExclusion] = useState('1'), [solar,setSolar] = useState(false)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [result,setResult] = useState<Receipt | null>(null)
  const worker = useRef<Worker | null>(null)
  const clear = () => { worker.current?.terminate(); worker.current = null; setBusy(false); setError(''); setResult(null) }
  useEffect(() => () => worker.current?.terminate(), [])
  const run = () => {
    clear()
    const durationSeconds = Number(days)*86400, sampleCount = Number(count), randomSeed = Number(seed), exclusionKm = Number(exclusion)
    if (![days,count,seed,exclusion].every(v => v.trim()) || !Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365*86400 ||
      !Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > 128 || !Number.isSafeInteger(randomSeed) || randomSeed < 0 || randomSeed > 0xffffffff || !Number.isFinite(exclusionKm) || exclusionKm < 0) {
      setError(zh ? '请输入 ±365 天内的时长、1–128 个样本、32 位非负整数种子与非负排除距离。' : 'Use a duration within ±365 days, 1–128 samples, an unsigned 32-bit seed and nonnegative exclusion distance.'); return
    }
    try {
      const active = new Worker(new URL('../../workers/dynamics.worker.ts', import.meta.url), { type: 'module' })
      worker.current = active; setBusy(true)
      active.onmessage = (event: MessageEvent<{ type: 'done'; receipt: Receipt } | { type: 'error'; error: string }>) => {
        if (worker.current !== active) return
        active.terminate(); worker.current = null; setBusy(false)
        if (event.data.type === 'done') setResult(event.data.receipt)
        else setError(event.data.error)
      }
      active.onerror = event => { if (worker.current === active) { clear(); setError(event.message || 'Worker failed') } }
      const initialBytes = bytes.slice(0)
      active.postMessage({ kind: 'ensemble', initialBytes, durationSeconds, sampleCount, seed: randomSeed,
        exclusionKm, solarRelativity: solar, compareRefinement: false }, [initialBytes])
    } catch (reason) { clear(); setError(String(reason)) }
  }
  const field = (label: string, value: string, setter: (v: string) => void, min: number, max?: number) => <label className="field"><span>{label}</span>
    <input type="number" min={min} max={max} step="any" value={value} onChange={event => { clear(); setter(event.target.value) }} /></label>
  const save = () => {
    const json = JSON.stringify({ ...result, build: BUILD_INFO,
      packedArrayConvention: 'Row-major six-component arrays. Invalid endpoints serialize as null; consult valid and failures without dropping draw indices.' },
    (_key,value: unknown) => value instanceof Float64Array || value instanceof Uint8Array ? Array.from(value) : value, 2)
    void saveTextExport(json,'solar-nonlinear-ensemble.json','application/json').catch(reason => setError(String(reason)))
  }
  return <details className="covariance-time-propagation">
    <summary>{zh ? '非线性轨道样本传播' : 'Propagate nonlinear orbit samples'}</summary>
    <p>{zh ? '从源参数的联合高斯近似抽样，以固定 DE440 条件模型分别积分。样本不是事件概率或真实误差保证；未包含完整拟合模型与星历误差。' : 'Draw from the joint Gaussian approximation in source parameters, then integrate each sample under a fixed conditional DE440 model. Samples are not event probabilities or physical error guarantees; the complete fit model and ephemeris errors are absent.'}</p>
    {dimension !== 6 ? <p role="status">{zh ? '额外拟合参数尚无匹配的力模型，不能丢弃后传播。' : 'Additional fitted parameters have no matched force model and cannot be dropped for propagation.'}</p> : <>
      {field(zh ? '样本传播时长（TDB 天）' : 'Ensemble duration (TDB days)',days,setDays,-365,365)}
      {field(zh ? '联合样本数量' : 'Joint sample count',count,setCount,1,128)}
      {field(zh ? '抽样随机种子' : 'Sampling seed',seed,setSeed,0,0xffffffff)}
      {field(zh ? '样本点质量排除距离（km）' : 'Ensemble point-mass exclusion distance (km)',exclusion,setExclusion,0)}
      <label className="dynamics-check"><input type="checkbox" checked={solar} onChange={event => { clear(); setSolar(event.target.checked) }} />{zh ? '为样本传播采用太阳 1PN 修正' : 'Adopt solar 1PN for ensemble propagation'}</label>
      <p>{zh ? '最多 128 个样本、共享 250,000 次力计算；达到预算即停止。排除距离在力计算时检查，不是连续碰撞检测。' : 'At most 128 samples share 250,000 force evaluations; budget exhaustion stops the run. Exclusion checks are not continuous collision detection.'}</p>
      <button type="button" className="primary-button" disabled={busy} onClick={run}>{zh ? '采用条件模型并传播样本' : 'Adopt conditional model and propagate samples'}</button>
      {busy && <><p role="status">{zh ? '正在校验星历并逐个传播样本…' : 'Verifying ephemeris and integrating samples…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消样本传播' : 'Cancel sample propagation'}</button></>}
    </>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="nonlinear-ensemble-result">
      <p>{zh ? '终点' : 'Endpoint'}: JD {result.finalEpoch.referenceEpochTdb} TDB + {result.finalEpoch.elapsedTdbSeconds} s</p>
      <p>{result.valid.reduce((sum,v) => sum+v,0)}/{result.initial.count} {zh ? '有效终点' : 'valid endpoints'} · {result.evaluations} {zh ? '次力计算' : 'force evaluations'}</p>
      <p>{zh ? '失败样本保留索引，不重新抽样。下表为日心 J2000 黄道坐标；完整速度、偏移、种子、力模型与来源见导出。' : 'Failed samples retain their indices and are never redrawn. Table: heliocentric J2000 ecliptic coordinates. Export includes velocities, offsets, seed, force model and source.'}</p>
      <div className="uncertainty-table"><table><caption>{zh ? '非线性样本终点' : 'Nonlinear sample endpoints'}</caption><thead><tr><th>#</th><th>x (AU)</th><th>y (AU)</th><th>z (AU)</th></tr></thead>
        <tbody>{Array.from(result.valid,(valid,index) => <tr key={index}><th>{index+1}</th>{[0,1,2].map(axis => <td key={axis}>{valid ? result.finalStates[index*6+axis].toPrecision(12) : '—'}</td>)}</tr>)}</tbody></table></div>
      {result.failures.length > 0 && <p role="status">{zh ? '失败原因' : 'Failure reasons'}: {result.failures.map(f => `#${f.index+1}: ${f.reason}`).join('; ')}</p>}
      <button type="button" className="secondary-button" onClick={save}>{zh ? '导出样本、设置与来源 JSON' : 'Export samples, settings and sources JSON'}</button>
    </div>}
  </details>
}
