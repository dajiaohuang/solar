import { EphemerisWindow } from './EphemerisWindow'
import { useEffect, useMemo, useRef, useState } from 'react'
import example from '../../data/moon-limb-example.json'
import { parseSpkLimbInput, type runSpkLimbExperiment } from '../../engine/events/spkLimbExperiment'
import { useI18n } from '../../i18n/context'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { projectLimbForDisplay, projectDirectionForLimbDisplay } from '../../engine/events/limbProjection'
import { LimbContour } from './LimbContour'
import { startOccultationJob, type OccultationJob } from '../../lib/occultationJob'

type Receipt = Awaited<ReturnType<typeof runSpkLimbExperiment>>
export function SpkLimbPanel() {
  const { language } = useI18n(), zh = language === 'zh'
  const [target, setTarget] = useState(String(example.targetId)), [observer, setObserver] = useState(String(example.observerId))
  const [epoch, setEpoch] = useState(String(example.referenceEpochTdb)), [elapsed, setElapsed] = useState('0')
  const [margin, setMargin] = useState('10'), [model, setModel] = useState<'NONE' | 'CN'>('CN')
  const [useSightline, setUseSightline] = useState(false), [sightline, setSightline] = useState(['1', '0', '0'])
  const [result, setResult] = useState<Receipt | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const worker = useRef<OccultationJob | null>(null)
  const projection = useMemo(() => {
    if (!result) return { view: null, sightline: null, error: '' }
    try {
      const view = projectLimbForDisplay(result.limb, result.observerJ2000Km)
      return { view, sightline: result.sightline ? projectDirectionForLimbDisplay(view, result.sightline.directionUnitJ2000) : null, error: '' }
    } catch (reason) { return { view: null, sightline: null, error: String(reason) } }
  }, [result])
  const clear = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { generation.current++; worker.current?.terminate(); worker.current = null }, [])
  const run = () => {
    clear()
    try {
      if ([target, observer, epoch, elapsed, ...(model === 'CN' ? [margin] : []), ...(useSightline ? sightline : [])].some(value => !value.trim())) throw new Error(zh ? '请填写所有所需数值。' : 'Enter all required values.')
      const inputBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, targetId: Number(target), observerId: Number(observer),
        referenceEpochTdb: Number(epoch), elapsedTdbSeconds: Number(elapsed), frame: 'J2000', timeScale: 'TDB', aberration: model,
        ...(model === 'CN' ? { maxLightTimeSeconds: Number(margin) } : {}),
        ...(useSightline ? { sightlineJ2000: sightline.map(Number) } : {}) })).buffer
      parseSpkLimbInput(inputBytes)
      setBusy(true)
      const active = startOccultationJob({ calculation: 'limb', inputBytes }, [inputBytes], {
        done: response => {
          if (worker.current !== active) return
          worker.current = null; setBusy(false)
          if (response.calculation === 'limb') setResult(response.receipt)
          else setError('Unexpected occultation calculation response')
        },
        error: message => {
          if (worker.current !== active) return
          worker.current = null; setBusy(false); setError(message)
        },
      })
      worker.current = active
    } catch (reason) { clear(); setError(String(reason)) }
  }
  const fields = [
    { label: zh ? '目标 NAIF 编号' : 'Target NAIF ID', value: target, set: setTarget },
    { label: zh ? '观察者 NAIF 编号' : 'Observer NAIF ID', value: observer, set: setObserver },
    { label: zh ? '参考历元（TDB 儒略日）' : 'Reference epoch (TDB JD)', value: epoch, set: setEpoch },
    { label: zh ? '参考历元后的 TDB 秒' : 'Elapsed TDB seconds', value: elapsed, set: setElapsed },
  ]
  return <section className="evidence-module glass-panel" aria-label={zh ? '星历椭球轮廓' : 'SPK ellipsoid limb'}>
    <div className="module-heading"><span>{zh ? '星历椭球轮廓' : 'SPK ellipsoid limb'}</span><em>DE440 · PCK</em></div>
    <p>{zh ? '使用固定 DE440 天体中心状态与原始 PCK 计算单时刻轮廓。默认是从地心观察月球；不代表地面站可见性。编号必须有精确星历和形状，不能用系统质心替代行星。' : 'Evaluate one limb using pinned DE440 body-center states and original PCK. The default is Moon seen from Earth’s center, not ground-station visibility. Exact state and shape identities are required; system barycenters cannot replace planets.'}</p>
    {fields.map(field => <label className="field" key={field.label}><span>{field.label}</span><input type="number" step="any" value={field.value} onChange={event => { clear(); field.set(event.target.value) }} /></label>)}
    <label className="field"><span>{zh ? '轮廓光行时模型' : 'Limb light-time model'}</span><select aria-label={zh ? '轮廓光行时模型' : 'Limb light-time model'} value={model} onChange={event => { clear(); setModel(event.target.value as 'NONE' | 'CN') }}><option value="CN">CN</option><option value="NONE">NONE</option></select></label>
    {model === 'CN' && <label className="field"><span>{zh ? '光行时来源余量（秒）' : 'Light-time source margin (seconds)'}</span><input type="number" value={margin} onChange={event => { clear(); setMargin(event.target.value) }} /></label>}
    <label className="dynamics-check"><input type="checkbox" checked={useSightline} onChange={event => { clear(); setUseSightline(event.target.checked) }} />{zh ? '计算自定义视线与椭球的交点' : 'Intersect a custom sightline with the ellipsoid'}</label>
    {useSightline && <>
      <p>{zh ? '输入从观察者向外的 J2000 方向向量，长度任意但不可为零。默认 +X 仅为示例，不是恒星数据；需自行提供与所选模型一致的方向。按无限远点源视线处理。' : 'Enter an outward J2000 direction from the observer, with arbitrary nonzero length. Default +X is illustrative, not star data; supply a direction consistent with the chosen model. The ray represents an infinitely distant point source.'}</p>
      {sightline.map((value, index) => <label className="field" key={index}><span>{zh ? '视线方向' : 'Sightline direction'} {'XYZ'[index]}</span><input type="number" step="any" value={value} onChange={event => { clear(); setSightline(previous => previous.map((old, axis) => axis === index ? event.target.value : old)) }} /></label>)}
    </>}
    <p>{zh ? 'CN：观察者在接收时刻，天体姿态在中心发射时刻。NONE：同时几何位置。均不含边缘差分光行时、恒星光行差、引力偏折、地形或大气。' : 'CN: observer at reception, orientation at center emission. NONE: simultaneous geometry. Neither includes differential limb light time, stellar aberration, gravitational deflection, terrain or atmosphere.'}</p>
    <button className="primary-button" disabled={busy} onClick={run}>{zh ? '计算星历轮廓' : 'Evaluate SPK limb'}</button>
    <p>{zh ? '30 秒内未完成会终止任务；可调整参数后重新运行。' : 'Jobs that do not finish within 30 seconds are terminated; adjust parameters before retrying.'}</p>
    {busy && <><p role="status">{zh ? '正在校验星历并计算…' : 'Verifying ephemeris and calculating…'}</p><button className="secondary-button" onClick={clear}>{zh ? '取消轮廓计算' : 'Cancel limb calculation'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="spk-limb-result">
      <EphemerisWindow referenceEpochTdb={result.ephemeris.referenceEpochTdb} elapsedRangeSeconds={result.ephemeris.elapsedRangeSeconds} requested={{ kind: 'instant', reception: result.ephemeris.receptionElapsedTdbSeconds, emission: result.ephemeris.emissionElapsedTdbSeconds }} zh={zh} />
      <p>{result.ephemeris.aberration} · {result.shape.naifPckId} ← {result.inputFile.payload.observerId} · {zh ? 'J2000，天体中心为原点，km' : 'J2000, body-center origin, km'}</p>
      <dl className="contract-list">
        <div><dt>{zh ? '接收 / 发射相对 TDB 秒' : 'Reception / emission elapsed TDB seconds'}</dt><dd>{result.ephemeris.receptionElapsedTdbSeconds} / {result.ephemeris.emissionElapsedTdbSeconds.toPrecision(12)}</dd></div>
        <div><dt>{zh ? '观察者相对天体的位置' : 'Body-relative observer'}</dt><dd>{result.observerJ2000Km.map(value => value.toPrecision(10)).join(', ')}</dd></div>
        <div><dt>{zh ? '轮廓中心' : 'Limb center'}</dt><dd>{result.limb.centerJ2000Km.map(value => value.toPrecision(10)).join(', ')}</dd></div>
        {result.limb.generatorsJ2000Km.map((axis, i) => <div key={i}><dt>{zh ? `生成向量 ${i+1}` : `Generator ${i+1}`}</dt><dd>{axis.map(value => value.toPrecision(10)).join(', ')}</dd></div>)}
      </dl>
      {projection.view && <LimbContour view={projection.view} sightline={projection.sightline} zh={zh} />}
      {projection.error && <p role="status">{zh ? '轮廓图不可用，原始几何结果仍可导出：' : 'Contour display unavailable; original geometry can still be exported: '}{projection.error}</p>}
      {result.sightline && <div>
        <p>{zh ? '视线几何判定：' : 'Sightline geometry: '}{result.sightline.classification === 'intercept' ? (zh ? '与模型表面相交' : 'intersects the model surface') : result.sightline.classification === 'miss' ? (zh ? '不与模型表面相交' : 'misses the model surface') : (zh ? '接近轮廓，数值判定未确定' : 'near the limb; numerically indeterminate')}</p>
        {result.sightline.firstInterceptDistanceKm !== null && <p>{zh ? '首个交点距观察者' : 'Observer distance to first intercept'}: {result.sightline.firstInterceptDistanceKm.toPrecision(12)} km</p>}
        {result.sightline.pointBodyFixedKm && <p>{zh ? '天体固定坐标交点' : 'Body-fixed intercept'}: {result.sightline.pointBodyFixedKm.map(value => value.toPrecision(10)).join(', ')} km</p>}
        <p>{zh ? '仅为固定椭球与单条无限射线的几何关系；不是有限距离天体、恒星圆盘、接触时刻或事件概率。接近轮廓的筛查余量不是物理误差界。' : 'Only the geometry of one infinite ray and a frozen ellipsoid; not a finite-distance body, stellar disk, contact time or event probability. The near-limb screening margin is not a physical error bound.'}</p>
      </div>}
      <p>{zh ? '轮廓点 = 中心 + 向量 1 × cos(θ) + 向量 2 × sin(θ)。生成向量不一定是主半轴。物理不确定性未知；未执行掩星接触搜索，月球姿态为文本 PCK 近似。' : 'Limb point = center + generator 1 × cos(θ) + generator 2 × sin(θ). Generators are not necessarily principal axes. Physical uncertainty is unknown; no occultation contact search is performed and lunar orientation is the text-PCK approximation.'}</p>
      <button className="secondary-button" onClick={() => { const exportGeneration = generation.current; void saveTextExport(JSON.stringify({ ...result, displayProjection: projection.view, displaySightline: projection.sightline, build: BUILD_INFO }, null, 2), 'solar-spk-limb.json', 'application/json').catch(reason => { if (exportGeneration === generation.current) setError(String(reason)) }) }}>{zh ? '导出星历轮廓与来源' : 'Export SPK limb and sources'}</button>
    </div>}
  </section>
}
