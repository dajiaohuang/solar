import { EphemerisWindow } from './EphemerisWindow'
import { startOccultationJob, type OccultationJob } from '../../lib/occultationJob'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseStellarLimbInput } from '../../engine/events/stellarLimbExperiment'
import { projectLimbForDisplay, projectDirectionForLimbDisplay } from '../../engine/events/limbProjection'
import type { StellarObserverRequest } from '../../lib/stellarObserver'
import type { StellarLimbReceipt } from '../../workers/occultation.protocol'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { LimbContour } from './LimbContour'

export function StellarLimbPanel({ request, originalResponseJson, zh }: {
  request: StellarObserverRequest; originalResponseJson: string; zh: boolean
}) {
  const [target, setTarget] = useState('301'), [model, setModel] = useState<'CN' | 'NONE'>('CN'), [margin, setMargin] = useState('10')
  const [result, setResult] = useState<StellarLimbReceipt | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const worker = useRef<OccultationJob | null>(null)
  const stop = () => {
    worker.current?.terminate(); worker.current = null
  }
  const clear = () => { generation.current++; stop(); setResult(null); setError(''); setBusy(false) }
  useEffect(() => () => { generation.current++; worker.current?.terminate(); worker.current = null }, [])
  const projection = useMemo(() => {
    if (!result) return { view: null, sightline: null, error: '' }
    try {
      const view = projectLimbForDisplay(result.limb, result.observerJ2000Km)
      return { view, sightline: projectDirectionForLimbDisplay(view, result.sightline.directionUnitJ2000), error: '' }
    } catch (reason) { return { view: null, sightline: null, error: String(reason) } }
  }, [result])
  const run = () => {
    clear()
    try {
      if (!target.trim() || model === 'CN' && !margin.trim()) throw new Error(zh ? '请填写目标和光行时余量。' : 'Enter the target and light-time margin.')
      const inputBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, targetId: Number(target), aberration: model,
        ...(model === 'CN' ? { maxLightTimeSeconds: Number(margin) } : {}) })).buffer
      parseStellarLimbInput(inputBytes)
      const observerResponseBytes = new TextEncoder().encode(originalResponseJson).buffer
      if (!observerResponseBytes.byteLength || observerResponseBytes.byteLength > 14*1024*1024) throw new Error('Observer receipt exceeds 14 MiB')
      setBusy(true)
      const active = startOccultationJob({ calculation: 'stellar-limb', inputBytes, observerResponseBytes, observerRequest: request }, [inputBytes, observerResponseBytes], {
        done: response => {
          if (worker.current !== active) return
          worker.current = null; setBusy(false)
          if (response.calculation === 'stellar-limb') setResult(response.receipt)
          else setError('Unexpected station limb worker response')
        },
        error: message => {
          if (worker.current !== active) return
          worker.current = null; setBusy(false); setError(message)
        },
      })
      worker.current = active
    } catch (reason) { clear(); setError(String(reason)) }
  }
  return <section aria-label={zh ? '站点恒星与椭球' : 'Station star and ellipsoid'}>
    <h4>{zh ? '此站点、此时刻的恒星射线' : 'Stellar ray at this station and epoch'}</h4>
    <p>{zh ? '沿上述恒星坐标方向检查目标椭球。复用当前原始报告的站点与时刻，默认目标为月球。结果不代表可见性、接触时刻或掩星概率。' : 'Check a target ellipsoid along the stellar coordinate direction above, using this original report’s station and epoch. The default target is the Moon. This does not establish visibility, contact times or occultation probability.'}</p>
    <label className="field"><span>{zh ? '遮挡天体精确 NAIF 编号' : 'Exact occulting-body NAIF ID'}</span><input type="number" step="1" value={target} onChange={event => { clear(); setTarget(event.target.value) }} /></label>
    <label className="field"><span>{zh ? '站点轮廓光行时模型' : 'Station limb light-time model'}</span><select value={model} onChange={event => { clear(); setModel(event.target.value as 'CN' | 'NONE') }}><option value="CN">CN</option><option value="NONE">NONE</option></select></label>
    {model === 'CN' && <label className="field"><span>{zh ? '站点轮廓光行时余量（秒）' : 'Station limb light-time margin (seconds)'}</span><input type="number" step="any" value={margin} onChange={event => { clear(); setMargin(event.target.value) }} /></label>}
    <button type="button" className="secondary-button" disabled={busy} onClick={run}>{zh ? '计算站点射线与轮廓' : 'Evaluate station ray and limb'}</button>
    <p>{zh ? '30 秒内未完成会终止任务；可调整参数后重新运行。' : 'Jobs that do not finish within 30 seconds are terminated; adjust parameters before retrying.'}</p>
    {busy && <><p role="status">{zh ? '正在核对原始报告、星历并计算…' : 'Checking the original receipt and ephemeris, then calculating…'}</p><button type="button" onClick={clear}>{zh ? '取消站点轮廓' : 'Cancel station limb'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="stellar-limb-result">
      <EphemerisWindow referenceEpochTdb={result.ephemeris.referenceEpochTdb} elapsedRangeSeconds={result.ephemeris.elapsedRangeSeconds} requested={{ kind: 'instant', reception: result.ephemeris.receptionElapsedTdbSeconds, emission: result.ephemeris.emissionElapsedTdbSeconds }} zh={zh} />
      <p>Gaia DR3 {result.sourceId} · {result.utc} · NAIF {result.shape.naifPckId} · {result.ephemeris.aberration}</p>
      <p>{zh ? '原报告的恒星无折射高度角' : 'Stellar airless altitude from the original report'}: {result.stationSkyContext.apparentAirless.altitudeDeg.toFixed(6)}°
        {' · '}{zh ? '无折射方位角' : 'Airless azimuth'}: {result.stationSkyContext.apparentAirless.azimuthDeg.toFixed(6)}°</p>
      <p>{result.stationSkyContext.apparentAirless.altitudeDeg < 0
        ? (zh ? '恒星无折射方向位于站点数学地平线下；下方相交结果仍仅是坐标射线几何，未计算实际可见性。' : 'The airless stellar direction is below the station’s mathematical horizon. The intersection below remains coordinate-ray geometry; actual visibility is not evaluated.')
        : (zh ? '高度角仅供站点背景参考。地形、日光及实际可见性尚未计算；此视方向不用于下方射线相交。' : 'Altitude is station context only. Terrain, daylight and actual visibility are not evaluated; this apparent direction is not used for the ray intersection below.')}</p>
      <p>{result.sightline.classification === 'intercept' ? (zh ? '射线与模型椭球相交。' : 'The ray intersects the model ellipsoid.') : result.sightline.classification === 'miss' ? (zh ? '射线未与模型椭球相交。' : 'The ray misses the model ellipsoid.') : (zh ? '接近轮廓，数值判定未确定。' : 'Near the limb; numerically indeterminate.')}</p>
      {result.sightline.firstInterceptDistanceKm !== null && <p>{zh ? '首个交点距离（km）' : 'First intercept distance (km)'}: {result.sightline.firstInterceptDistanceKm.toPrecision(12)}</p>}
      {projection.view && <LimbContour view={projection.view} sightline={projection.sightline} zh={zh} />}
      {projection.error && <p role="status">{projection.error}</p>}
      <p>{zh ? '恒星标记与目标轮廓使用同一坐标投影；射线判定由三维几何单独计算。尚未计入引力弯曲、地形、环、恒星圆盘或物理不确定性。' : 'The stellar marker and target limb share the same coordinate projection; ray classification is computed separately in 3D. Gravitational ray bending, terrain, rings, stellar disk and physical uncertainty are not included.'}</p>
      <details><summary>{zh ? '站点轮廓来源与限制' : 'Station limb sources and limits'}</summary>
        <p>Observer SHA-256: {result.observerReceipt.sha256}</p><p>SPK SHA-256: {result.kernel.sha256}</p>
        <p>{zh ? '射线使用原报告的站点 BCRS 坐标方向；站点视差已计入，不重复施加。SPK J2000 轴按 ICRS 对齐约定处理。' : 'The ray uses the original station BCRS coordinate direction. Observer parallax is already included and is not applied again. SPK J2000 axes use the ICRS-aligned convention.'}</p>
        {result.limitations.map((text, index) => <p key={index}>{text}</p>)}
      </details>
      <button type="button" className="secondary-button" onClick={() => { const exportGeneration = generation.current; void saveTextExport(JSON.stringify({ ...result, displayProjection: projection.view, displaySightline: projection.sightline, build: BUILD_INFO }, null, 2), 'solar-stellar-limb.json', 'application/json').catch(reason => { if (exportGeneration === generation.current) setError(String(reason)) }) }}>{zh ? '导出站点轮廓与原始报告' : 'Export station limb and original receipt'}</button>
    </div>}
  </section>
}
