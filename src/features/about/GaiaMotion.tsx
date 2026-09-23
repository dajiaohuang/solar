import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { loadStellarMotion, stellarSourceBase64, type StellarMotionExperiment } from '../../lib/stellarMotion'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'

export function GaiaMotion() {
  const { language } = useI18n(), zh = language === 'zh'
  const base = import.meta.env.VITE_SOLAR_API_BASE_URL?.trim() || ''
  const [files, setFiles] = useState<File[]>([]), [id, setId] = useState('65212004581252736'), [epoch, setEpoch] = useState('2026')
  const [covariance, setCovariance] = useState(false)
  const [adopt, setAdopt] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [result, setResult] = useState<StellarMotionExperiment | null>(null)
  const generation = useRef(0), active = useRef<AbortController | null>(null)
  const clear = () => { generation.current++; active.current?.abort(); active.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { generation.current++; active.current?.abort() }, [])
  const run = async () => {
    clear(); const token = generation.current, controller = new AbortController(); active.current = controller; setBusy(true)
    try {
      const manifest = files.find(f => f.name === 'manifest.json'), rows = files.find(f => f.name === 'rows.csv')
      if (files.length !== 2 || !manifest || !rows || manifest.size > 1 << 20 || rows.size > 8 << 20) throw new Error(zh ? '请选择原始 manifest.json（≤1 MiB）和 rows.csv（≤8 MiB）。' : 'Select original manifest.json (≤1 MiB) and rows.csv (≤8 MiB).')
      if (!adopt || !epoch.trim()) throw new Error(zh ? '需要目标历元及显式径向速度假设。' : 'An epoch and explicit radial-velocity assumption are required.')
      const [m, r] = await Promise.all([manifest.arrayBuffer(), rows.arrayBuffer()])
      controller.signal.throwIfAborted()
      const next = await loadStellarMotion(base, { originalManifestBase64: stellarSourceBase64(new Uint8Array(m), 1 << 20), originalRowsCsvBase64: stellarSourceBase64(new Uint8Array(r), 8 << 20), sourceId: id, targetEpochJulianYearTCB: Number(epoch), radialVelocityPolicy: 'spectroscopic-as-astrometric', ...(covariance ? { covariancePolicy: 'independent-spectroscopic-rv' as const } : {}) }, controller.signal)
      if (token === generation.current) { setResult(next); setBusy(false); active.current = null }
    } catch (error) { if (token === generation.current) { setError(String(error)); setBusy(false); active.current = null } }
  }
  return <section className="evidence-module glass-panel" aria-label={zh ? '恒星历元传播' : 'Stellar epoch propagation'}>
    <div className="module-heading"><span>{zh ? '恒星历元传播' : 'Stellar epoch propagation'}</span><em>ICRS · TCB</em></div>
    <p>{zh ? '使用原始 Gaia CSV 的完整单星参数计算目标历元状态。需要正视差、自行及径向速度；可选择传播形式协方差；不计算地面视位置。' : 'Propagate a complete single-star model from original Gaia CSV. Positive parallax, proper motion and radial velocity are required. Formal covariance is optional; no ground apparent position.'}</p>
    {!base && <p role="status">{zh ? '尚未配置计算后端。可使用离线 gaia-motion 命令。' : 'No computation backend is configured. The offline gaia-motion command remains available.'}</p>}
    <form onSubmit={event => { event.preventDefault(); void run() }}>
      <label className="field"><span>{zh ? '恒星传播原始清单与 CSV' : 'Stellar original manifest and CSV'}</span><input type="file" multiple accept=".json,.csv" onChange={event => { clear(); setFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} /></label>
      {files.length > 0 && <p>{files.map(f => f.name).join(' · ')}</p>}
      <label className="field"><span>{zh ? 'Gaia 传播源 ID' : 'Gaia propagation source ID'}</span><input required type="text" inputMode="numeric" value={id} onChange={event => { clear(); setId(event.target.value) }} /></label>
      <label className="field"><span>{zh ? '目标 TCB 儒略年' : 'Target TCB Julian year'}</span><input required type="number" min="1916" max="2116" step="any" value={epoch} onChange={event => { clear(); setEpoch(event.target.value) }} /></label>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '12px 0' }}><input style={{ flexShrink: 0, marginTop: 4 }} type="checkbox" checked={adopt} onChange={event => { clear(); setAdopt(event.target.checked) }} />{zh ? '采用光谱径向速度近似天体测量径向速度（未校正天体物理位移）' : 'Adopt spectroscopic RV as astrometric RV (astrophysical shifts uncorrected)'}</label>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '12px 0' }}><input style={{ flexShrink: 0, marginTop: 4 }} type="checkbox" checked={covariance} onChange={event => { clear(); setCovariance(event.target.checked) }} />{zh ? '传播形式协方差，假设径向速度误差独立于天体测量误差' : 'Propagate formal covariance assuming RV errors are independent of astrometry'}</label>
      <button className="secondary-button" disabled={!base || files.length !== 2 || !adopt || busy}>{zh ? '计算恒星状态' : 'Compute stellar state'}</button>
    </form>
    {busy && <><p role="status">{zh ? '正在核验来源并计算' : 'Verifying sources and computing'}</p><button onClick={clear}>{zh ? '取消恒星计算' : 'Cancel stellar calculation'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="stellar-motion-result">
      <p>Gaia DR3 {result.result.sourceId} · J{result.result.targetEpochJulianYearTCB} TCB</p>
      <dl className="contract-list">
        <div><dt>RA / Dec (°)</dt><dd>{result.result.stateTCBCompatible.raDeg.toPrecision(12)} / {result.result.stateTCBCompatible.decDeg.toPrecision(12)}</dd></div>
        <div><dt>{zh ? '视差（mas）' : 'Parallax (mas)'}</dt><dd>{result.result.stateTCBCompatible.parallaxMas.toPrecision(10)}</dd></div>
        <div><dt>μα* / μδ (mas/yr)</dt><dd>{result.result.stateTCBCompatible.pmraMasPerJulianYear.toPrecision(10)} / {result.result.stateTCBCompatible.pmdecMasPerJulianYear.toPrecision(10)}</dd></div>
        <div><dt>RV (km/s)</dt><dd>{result.result.stateTCBCompatible.radialVelocityKmPerSecond.toPrecision(10)}</dd></div>
      </dl>
      <p>{zh ? '匀速单星模型，不含双星加速度、系统误差或观测者改正；显示位数不是精度保证。' : 'Uniform single-star model without binary acceleration, systematics or observer corrections; displayed digits are not an accuracy guarantee.'}</p>
      {result.formalCovariance && <div data-testid="stellar-covariance-result">
        <p>{zh ? '传播后边缘标准差（形式误差）' : 'Propagated marginal standard deviations (formal errors)'}</p>
        <dl className="contract-list">{result.formalCovariance.coordinateLabels.map((label, i) => <div key={label}><dt>{label}</dt><dd>{Math.sqrt(result.formalCovariance!.outputMatrix[i][i]).toPrecision(6)} {result.formalCovariance!.coordinateUnits[i]}</dd></div>)}</dl>
        <p>{zh ? '一阶局部线性近似；标准差不是联合置信区域。不含系统误差，也不保证掩星时间精度。完整相关矩阵与假设随来源导出。' : 'First-order local approximation; standard deviations are not a joint confidence region. No systematics or occultation timing guarantee. Export includes full correlations and assumptions.'}</p>
        <details><summary>{zh ? '协方差假设' : 'Covariance assumptions'}</summary>{result.formalCovariance.assumptions.map(text => <p key={text}>{text}</p>)}</details>
      </div>}
      <details><summary>{zh ? '模型及来源限制' : 'Model and provenance limitations'}</summary>{result.result.limitations.map(text => <p key={text}>{text}</p>)}<p>{result.provenanceBoundary}</p></details>
      <button className="secondary-button" onClick={() => void saveTextExport(JSON.stringify({ build: BUILD_INFO, experiment: result }, null, 2), 'solar-gaia-motion.json', 'application/json').catch(error => setError(String(error)))}>{zh ? '导出恒星计算与原始来源' : 'Export stellar calculation and originals'}</button>
    </div>}
  </section>
}
