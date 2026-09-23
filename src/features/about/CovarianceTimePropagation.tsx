import { useEffect, useMemo, useRef, useState } from 'react'
import type { propagateDynamicsCovariance } from '../../engine/dynamics/covariancePropagation'
import { covarianceEllipsoid } from '../../engine/ephemeris/covarianceEllipsoid'
import { CovarianceEllipsoid } from './CovarianceEllipsoid'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'

type Receipt = Awaited<ReturnType<typeof propagateDynamicsCovariance>> & {
  schemaVersion: number; calculation: string; sourceFile: { sha256: string; bytes: number; payload: unknown }
}

export function CovarianceTimePropagation({ bytes, dimension, zh }: { bytes: ArrayBuffer; dimension: number; zh: boolean }) {
  const [days, setDays] = useState('30'), [exclusion, setExclusion] = useState('1')
  const [solarRelativity, setSolarRelativity] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [result, setResult] = useState<Receipt | null>(null)
  const worker = useRef<Worker | null>(null)
  const clear = () => { worker.current?.terminate(); worker.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { worker.current?.terminate(); worker.current = null }, [])
  const geometry = useMemo(() => {
    if (!result) return null
    try { return covarianceEllipsoid(result.finalCoordinates.matrix, 149597870.7) } catch { return null }
  }, [result])
  const run = () => {
    clear()
    const durationSeconds = Number(days)*86400, exclusionKm = Number(exclusion)
    if (!days.trim() || !exclusion.trim() || !Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365*86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0) {
      setError(zh ? '时长须在 ±365 天内，排除距离须非负。' : 'Duration must be within ±365 days and exclusion distance nonnegative.'); return
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
      active.postMessage({ kind: 'covariance', initialBytes, durationSeconds, exclusionKm, solarRelativity, compareRefinement: false }, [initialBytes])
    } catch (reason) { clear(); setError(String(reason)) }
  }
  return <details className="covariance-time-propagation">
    <summary>{zh ? '随时间传播形式协方差' : 'Propagate formal covariance in time'}</summary>
    <p>{zh ? '采用固定 DE440 星历和引力常数的六参数一阶条件传播，不复现完整轨道拟合模型。未包含星历误差、模型误差、非线性分布或事件概率。' : 'Six-parameter first-order conditional propagation with fixed DE440 ephemerides and GMs. This does not reproduce the complete orbit-fit model or include ephemeris/model errors, nonlinear distributions or event probabilities.'}</p>
    {dimension !== 6 ? <p role="status">{zh ? '源协方差含额外参数，尚无匹配的力模型导数，不能传播。仍可检查全部源参数并进行解算历元坐标转换。' : 'Extra source parameters have no matched force derivatives yet, so propagation is unavailable. Source inspection and solution-epoch conversion retain all parameters.'}</p> : <>
      <label className="field"><span>{zh ? '协方差传播时长（TDB 天）' : 'Covariance duration (TDB days)'}</span><input type="number" min="-365" max="365" step="any" value={days} onChange={event => { clear(); setDays(event.target.value) }} /></label>
      <label className="field"><span>{zh ? '协方差点质量排除距离（km）' : 'Covariance point-mass exclusion distance (km)'}</span><input type="number" min="0" step="any" value={exclusion} onChange={event => { clear(); setExclusion(event.target.value) }} /></label>
      <p>{zh ? '正时长向未来传播，负时长向过去传播，起点始终为协方差解算历元。排除距离仅在力计算时检查，不是连续碰撞检测。' : 'Positive duration advances time; negative duration goes backward, always from the covariance solution epoch. Exclusion checks at force evaluations are not continuous collision detection.'}</p>
      <label className="dynamics-check"><input type="checkbox" checked={solarRelativity} onChange={event => { clear(); setSolarRelativity(event.target.checked) }} />{zh ? '为协方差传播采用太阳 1PN 修正' : 'Adopt solar 1PN for covariance propagation'}</label>
      <button type="button" className="primary-button" disabled={busy} onClick={run}>{zh ? '采用条件 DE440 模型并传播' : 'Adopt conditional DE440 model and propagate'}</button>
      {busy && <><p role="status">{zh ? '正在校验星历并传播协方差…' : 'Verifying ephemeris and propagating covariance…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消协方差传播' : 'Cancel covariance propagation'}</button></>}
    </>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="covariance-time-result">
      <p>{zh ? '传播终点' : 'Propagation endpoint'}: JD {result.finalCoordinates.epoch.referenceEpochTdb} TDB + {result.finalCoordinates.epoch.elapsedTdbSeconds} s</p>
      <p>{zh ? '日心 J2000 黄道坐标；下列标准差与椭球仅属于已采用的条件模型。' : 'Heliocentric J2000 ecliptic coordinates; these standard deviations and ellipsoid belong only to the adopted conditional model.'}</p>
      <div className="uncertainty-table"><table><caption>{zh ? '传播后的形式标准差' : 'Propagated formal standard deviations'}</caption><thead><tr><th>{zh ? '分量' : 'Axis'}</th><th>σ</th><th>{zh ? '单位' : 'Unit'}</th></tr></thead><tbody>{result.finalCoordinates.labels.map((label, i) => <tr key={label}><th>{label}</th><td>{(result.finalCoordinates.marginalSigmas[i]*149597870.7/(i < 3 ? 1 : 86400)).toExponential(5)}</td><td>{i < 3 ? 'km' : 'km/s'}</td></tr>)}</tbody></table></div>
      {geometry ? <CovarianceEllipsoid geometry={geometry} zh={zh} /> : <p>{zh ? '传播后的椭球无法可靠分解。' : 'The propagated ellipsoid cannot be factored reliably.'}</p>}
      <p>{result.experiment.numerics.accepted} {zh ? '接受步数' : 'accepted steps'} · {result.experiment.forceModel.solarRelativity ? 'Newtonian + solar 1PN' : 'Newtonian'}</p>
      <button type="button" className="secondary-button" onClick={() => { void saveTextExport(JSON.stringify({ ...result, build: BUILD_INFO }, null, 2), 'solar-propagated-covariance.json', 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出传播协方差与来源 JSON' : 'Export propagated covariance and sources JSON'}</button>
    </div>}
  </details>
}
