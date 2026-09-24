import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { loadStellarMotion, stellarSourceBase64, type StellarMotionExperiment } from '../../lib/stellarMotion'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { loadStellarObserverReceipt, type StellarObserverReport, type StellarObserverRequest } from '../../lib/stellarObserver'
import { StellarLimbPanel } from './StellarLimbPanel'

export function GaiaMotion() {
  const { language } = useI18n(), zh = language === 'zh'
  const base = import.meta.env.VITE_SOLAR_API_BASE_URL?.trim() || ''
  const [files, setFiles] = useState<File[]>([]), [id, setId] = useState('65212004581252736'), [epoch, setEpoch] = useState('2026')
  const [covariance, setCovariance] = useState(false)
  const [mode, setMode] = useState<'catalog' | 'station'>('catalog')
  const [utc, setUtc] = useState(''), [longitude, setLongitude] = useState(''), [latitude, setLatitude] = useState(''), [height, setHeight] = useState('')
  const [observerResult, setObserverResult] = useState<StellarObserverReport | null>(null)
  const [observerInput, setObserverInput] = useState<{ request: StellarObserverRequest; originalResponseJson: string; generation: number } | null>(null)
  const [refraction, setRefraction] = useState(false), [weather, setWeather] = useState(['', '', '', ''])
  const [adopt, setAdopt] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [result, setResult] = useState<StellarMotionExperiment | null>(null)
  const generation = useRef(0), active = useRef<AbortController | null>(null)
  const clear = () => { generation.current++; active.current?.abort(); active.current = null; setBusy(false); setResult(null); setObserverResult(null); setObserverInput(null); setError('') }
  useEffect(() => () => { generation.current++; active.current?.abort() }, [])
  const run = async () => {
    clear(); const token = generation.current, controller = new AbortController(); active.current = controller; setBusy(true)
    try {
      const manifest = files.find(f => f.name === 'manifest.json'), rows = files.find(f => f.name === 'rows.csv')
      if (files.length !== 2 || !manifest || !rows || manifest.size > 1 << 20 || rows.size > 16 << 20) throw new Error(zh ? '请选择原始 manifest.json（≤1 MiB）和 rows.csv（≤16 MiB）。' : 'Select original manifest.json (≤1 MiB) and rows.csv (≤16 MiB).')
      if (!adopt || (mode === 'catalog' ? !epoch.trim() : [utc, longitude, latitude, height].some(value => !value.trim()))) throw new Error(zh ? '请填写历元或全部站点字段，并选择径向速度假设。' : 'Complete the epoch or all station fields and adopt the radial-velocity assumption.')
      if (mode === 'station' && refraction && weather.some(value => !value.trim())) throw new Error(zh ? '折射需要填写全部四项气象与波长数值。' : 'Refraction requires all four weather and wavelength values.')
      const [m, r] = await Promise.all([manifest.arrayBuffer(), rows.arrayBuffer()])
      controller.signal.throwIfAborted()
      const source = { originalManifestBase64: stellarSourceBase64(new Uint8Array(m), 1 << 20), originalRowsCsvBase64: stellarSourceBase64(new Uint8Array(r), 16 << 20), sourceId: id, radialVelocityPolicy: 'spectroscopic-as-astrometric' as const }
      if (mode === 'station') {
        const request: StellarObserverRequest = { ...source, utc, station: { longitudeDeg: Number(longitude), latitudeDeg: Number(latitude), heightMeters: Number(height) },
          ...(refraction ? { atmosphere: { pressureHPa: Number(weather[0]), temperatureC: Number(weather[1]), relativeHumidity: Number(weather[2]), wavelengthMicrometers: Number(weather[3]) } } : {}) }
        const next = await loadStellarObserverReceipt(base, request, controller.signal)
        if (token === generation.current) { setObserverResult(next.report); setObserverInput({ request, originalResponseJson: next.originalResponseJson, generation: token }); setResult(next.report.experiment.stellar); setBusy(false); active.current = null }
        return
      }
      const next = await loadStellarMotion(base, { ...source, targetEpochJulianYearTCB: Number(epoch), ...(covariance ? { covariancePolicy: 'independent-spectroscopic-rv' as const } : {}) }, controller.signal)
      if (token === generation.current) { setResult(next); setBusy(false); active.current = null }
    } catch (error) { if (token === generation.current) { setError(String(error)); setBusy(false); active.current = null } }
  }
  return <section className="evidence-module glass-panel" aria-label={zh ? '恒星历元传播' : 'Stellar epoch propagation'}>
    <div className="module-heading"><span>{zh ? '恒星历元传播' : 'Stellar epoch propagation'}</span><em>ICRS · TCB</em></div>
    <p>{zh ? '使用原始 Gaia CSV 的完整单星参数传播星表状态，或计算显式地面站点的方向。需要正视差、自行及径向速度；星表模式可选择传播形式协方差。' : 'Propagate a complete single-star model from original Gaia CSV, or calculate directions for an explicit ground station. Positive parallax, proper motion and radial velocity are required. Catalog mode can propagate formal covariance.'}</p>
    {!base && <p role="status">{mode === 'station' ? (zh ? '站点方向需要配置含 SPK/IERS 数据的计算后端。' : 'Station directions require a configured backend with SPK/IERS data.') : (zh ? '尚未配置计算后端。可使用离线 gaia-motion 命令。' : 'No computation backend is configured. The offline gaia-motion command remains available.')}</p>}
    <form onSubmit={event => { event.preventDefault(); void run() }}>
      <label className="field"><span>{zh ? '恒星计算模式' : 'Stellar calculation mode'}</span><select value={mode} onChange={event => { clear(); setMode(event.target.value as 'catalog' | 'station') }}><option value="catalog">{zh ? '星表历元传播' : 'Catalog epoch propagation'}</option><option value="station">{zh ? '地面站坐标方向' : 'Station coordinate direction'}</option></select></label>
      <label className="field"><span>{zh ? '恒星传播原始清单与 CSV' : 'Stellar original manifest and CSV'}</span><input type="file" multiple accept=".json,.csv" onChange={event => { clear(); setFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} /></label>
      {files.length > 0 && <p>{files.map(f => f.name).join(' · ')}</p>}
      <label className="field"><span>{zh ? 'Gaia 传播源 ID' : 'Gaia propagation source ID'}</span><input required type="text" inputMode="numeric" value={id} onChange={event => { clear(); setId(event.target.value) }} /></label>
      {mode === 'catalog' ? <label className="field"><span>{zh ? '目标 TCB 儒略年' : 'Target TCB Julian year'}</span><input required type="number" min="1916" max="2116" step="any" value={epoch} onChange={event => { clear(); setEpoch(event.target.value) }} /></label> : <>
        <label className="field"><span>UTC (YYYY-MM-DDTHH:mm:ssZ)</span><input required type="text" value={utc} placeholder="YYYY-MM-DDTHH:mm:ssZ" onChange={event => { clear(); setUtc(event.target.value) }} /></label>
        {[{ label: zh ? '东经（度）' : 'East longitude (degrees)', value: longitude, set: setLongitude }, { label: zh ? '纬度（度）' : 'Latitude (degrees)', value: latitude, set: setLatitude }, { label: zh ? 'WGS84 椭球高（米）' : 'WGS84 ellipsoidal height (meters)', value: height, set: setHeight }].map(field => <label className="field" key={field.label}><span>{field.label}</span><input required type="number" step="any" value={field.value} onChange={event => { clear(); field.set(event.target.value) }} /></label>)}
        <p>{zh ? '历元由站点 UTC 推导，需要后端 SPK 和 IERS 覆盖。分别输出视差修正后的坐标方向，以及加入太阳偏折和光行差的无大气地平视方向；暂不传播站点方向协方差。' : 'The epoch is derived from station UTC and requires backend SPK/IERS coverage. Separate outputs show the parallax-corrected coordinate direction and the airless horizontal direction with solar deflection and aberration. Station-direction covariance is not propagated.'}</p>
        <label className="dynamics-check"><input type="checkbox" checked={refraction} onChange={event => { clear(); setRefraction(event.target.checked) }} />{zh ? '使用显式气象参数估算折射' : 'Estimate refraction with explicit weather inputs'}</label>
        {refraction && <>
          {(zh ? ['气压（hPa）', '气温（°C）', '相对湿度（0–1）', '波长（微米）'] : ['Pressure (hPa)', 'Temperature (°C)', 'Relative humidity (0–1)', 'Wavelength (micrometers)']).map((label, index) => <label className="field" key={index}><span>{label}</span><input required type="number" step="any" value={weather[index]} onChange={event => { clear(); setWeather(previous => previous.map((value, axis) => axis === index ? event.target.value : value)) }} /></label>)}
          <p>{zh ? '只在无大气高度角 ≥5° 时提供折射结果；这不保证当地大气的实际精度。' : 'Refraction is returned only for airless altitude ≥5°. This does not certify accuracy for the local atmosphere.'}</p>
        </>}
      </>}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '12px 0' }}><input style={{ flexShrink: 0, marginTop: 4 }} type="checkbox" checked={adopt} onChange={event => { clear(); setAdopt(event.target.checked) }} />{zh ? '采用光谱径向速度近似天体测量径向速度（未校正天体物理位移）' : 'Adopt spectroscopic RV as astrometric RV (astrophysical shifts uncorrected)'}</label>
      {mode === 'catalog' && <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '12px 0' }}><input style={{ flexShrink: 0, marginTop: 4 }} type="checkbox" checked={covariance} onChange={event => { clear(); setCovariance(event.target.checked) }} />{zh ? '传播形式协方差，假设径向速度误差独立于天体测量误差' : 'Propagate formal covariance assuming RV errors are independent of astrometry'}</label>}
      <button className="secondary-button" disabled={!base || files.length !== 2 || !adopt || busy}>{zh ? '计算恒星状态' : 'Compute stellar state'}</button>
    </form>
    {busy && <><p role="status">{zh ? '正在核验来源并计算' : 'Verifying sources and computing'}</p><button onClick={clear}>{zh ? '取消恒星计算' : 'Cancel stellar calculation'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="stellar-motion-result">
      {observerResult && <div>
        <p>{zh ? '站点无大气视方向' : 'Station airless apparent direction'}</p>
        <dl className="contract-list">
          <div><dt>{zh ? '方位角 / 高度角（度）' : 'Azimuth / altitude (degrees)'}</dt><dd>{observerResult.experiment.observed.apparentAirless.azimuthDeg.toPrecision(12)} / {observerResult.experiment.observed.apparentAirless.altitudeDeg.toPrecision(12)}</dd></div>
          <div><dt>CIRS RA / Dec (°)</dt><dd>{observerResult.experiment.observed.cirsRaDeg.toPrecision(12)} / {observerResult.experiment.observed.cirsDecDeg.toPrecision(12)}</dd></div>
          <div><dt>{zh ? '坐标太阳距角（度）' : 'Coordinate solar elongation (degrees)'}</dt><dd>{observerResult.experiment.observed.solarElongationDeg.toPrecision(10)}</dd></div>
          {observerResult.experiment.observed.refracted && <div><dt>{zh ? '折射后方位角 / 高度角（度）' : 'Refracted azimuth / altitude (degrees)'}</dt><dd>{observerResult.experiment.observed.refracted.azimuthDeg.toPrecision(12)} / {observerResult.experiment.observed.refracted.altitudeDeg.toPrecision(12)}</dd></div>}
        </dl>
        {observerResult.experiment.observed.refractionStatus === 'outside-altitude-domain' && <p role="status">{zh ? '无大气高度角低于 5°，未提供折射结果；无大气结果仍有效。' : 'Airless altitude is below 5°; no refracted result is supplied. The airless result remains available.'}</p>}
        <p>{zh ? '方位角以北为零、向东递增。高度角和太阳距角不是可见性判断；未检查地形、日光背景或天体圆盘遮挡，显示位数不代表物理精度。' : 'Azimuth is north-zero and east-positive. Altitude and solar elongation are not visibility judgments: terrain, daylight and body-disk occultation are unchecked. Displayed digits do not establish physical accuracy.'}</p>
        {observerResult.experiment.observed.solarDeflectionLimited && <p role="status">{zh ? '接近太阳中心，太阳偏折模型已触发限制。' : 'The solar-deflection limiter is active near the Sun’s center.'}</p>}
        <p>{zh ? '站点坐标方向（BCRS，未加光行差）' : 'Station coordinate direction (BCRS, without aberration)'}</p>
        <dl className="contract-list">
          <div><dt>RA / Dec (°)</dt><dd>{observerResult.experiment.raDeg.toPrecision(12)} / {observerResult.experiment.decDeg.toPrecision(12)}</dd></div>
          <div><dt>{zh ? '方向单位向量' : 'Unit direction'}</dt><dd>{observerResult.experiment.coordinateDirectionBcrs.map(value => value.toPrecision(12)).join(', ')}</dd></div>
          <div><dt>{zh ? 'TDB 两部分儒略日' : 'Two-part TDB Julian date'}</dt><dd>{observerResult.experiment.epochJdTdbParts.join(' + ')}</dd></div>
        </dl>
        <details><summary>{zh ? '站点来源、警告与限制' : 'Station sources, warnings and limits'}</summary>
          <p>IERS SHA-256: {observerResult.earthOrientation.sha256}</p>
          {observerResult.experiment.observation.sources.map((source, index) => <p key={index}>{source.bodyId}: {source.source} · {source.kernelSha256}</p>)}
          {[...observerResult.experiment.observation.warnings, ...observerResult.experiment.limitations, ...observerResult.experiment.observed.warnings, ...observerResult.experiment.observed.limitations].map((text, index) => <p key={index}>{text}</p>)}
        </details>
        {observerInput && <StellarLimbPanel key={observerInput.generation} request={observerInput.request} originalResponseJson={observerInput.originalResponseJson} zh={zh} />}
        <p>{zh ? '以下为传播后的质心星表状态，尚未加入站点修正：' : 'The following is the propagated barycentric catalog state before station corrections:'}</p>
      </div>}
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
      <button className="secondary-button" onClick={() => { const exportGeneration = generation.current; void saveTextExport(observerInput?.originalResponseJson ?? JSON.stringify({ build: BUILD_INFO, experiment: result }, null, 2), observerInput ? 'solar-gaia-observer.json' : 'solar-gaia-motion.json', 'application/json').catch(error => { if (exportGeneration === generation.current) setError(String(error)) }) }}>{zh ? '导出恒星计算与原始来源' : 'Export stellar calculation and originals'}</button>
      {observerInput && <button className="secondary-button" onClick={() => { const exportGeneration = generation.current; void saveTextExport(JSON.stringify(observerInput.request, null, 2), 'solar-gaia-observer-request.json', 'application/json').catch(error => { if (exportGeneration === generation.current) setError(String(error)) }) }}>{zh ? '导出站点请求供离线复算' : 'Export station request for offline reproduction'}</button>}
    </div>}
  </section>
}
