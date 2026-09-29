import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import type { runEllipsoidRayContactExperiment } from '../../engine/events/ellipsoidRayContactExperiment'
import { parseEllipsoidRayContactInput, type EllipsoidRayContactInput } from '../../lib/ellipsoidRayContactInput'
import { startOccultationJob, type OccultationJob } from '../../lib/occultationJob'
import { readScientificSourceFile } from '../../lib/scientificSourceFile'
import { dynamicsSourceBase64 } from '../../lib/dynamicsSourceBytes'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { EphemerisWindow } from './EphemerisWindow'

type Source = { name: string; bytes: number; originalBase64: string }
type Settings = Pick<EllipsoidRayContactInput, 'aberration' | 'maxStepSeconds' | 'toleranceSeconds'>
type Receipt = Awaited<ReturnType<typeof runEllipsoidRayContactExperiment>> & {
  preparation: { source: Source; originalSettings: Settings; submittedSettings: Settings; changedFields: (keyof Settings)[] }
}

export function EllipsoidRayContactsPanel() {
  const { language } = useI18n(), zh = language === 'zh'
  const [input, setInput] = useState<EllipsoidRayContactInput | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [model, setModel] = useState<'NONE' | 'CN'>('CN'), [step, setStep] = useState('60'), [tolerance, setTolerance] = useState('0.01')
  const [result, setResult] = useState<Receipt | null>(null), [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState('')
  const worker = useRef<OccultationJob | null>(null), generation = useRef(0), sourceRead = useRef<AbortController | null>(null)
  const clear = () => { generation.current++; sourceRead.current?.abort(); sourceRead.current = null; setReading(false); worker.current?.terminate(); worker.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { generation.current++; sourceRead.current?.abort(); sourceRead.current = null; worker.current?.terminate(); worker.current = null }, [])
  const read = async (file: File) => {
    clear(); setInput(null); setSource(null)
    const current = generation.current, controller = new AbortController(), deadline = performance.now()+30000
    const check = () => { controller.signal.throwIfAborted(); if (performance.now() >= deadline) throw new Error(zh ? '读取实验文件超过 30 秒时限。' : 'Experiment file import exceeded its 30-second limit.') }
    sourceRead.current = controller; setReading(true)
    try {
      if (file.size > 65536) throw new Error(zh ? '文件超过 64 KiB 上限。' : 'The file exceeds the 64 KiB limit.')
      const bytes = await readScientificSourceFile(file, controller.signal, 65536)
      if (current !== generation.current) return
      check()
      const parsed = parseEllipsoidRayContactInput(bytes)
      setInput(parsed); setSource({ name: file.name, bytes: bytes.byteLength, originalBase64: dynamicsSourceBase64(bytes) })
      setModel(parsed.aberration); setStep(String(parsed.maxStepSeconds)); setTolerance(String(parsed.toleranceSeconds))
    } catch (reason) { if (current === generation.current) setError(String(reason)) }
    finally { if (sourceRead.current === controller) sourceRead.current = null; if (current === generation.current) setReading(false) }
  }
  const run = () => {
    clear()
    if (!input || !source) return
    try {
      if (!step.trim() || !tolerance.trim()) throw new Error(zh ? '请填写扫描步长和时间容差。' : 'Enter the scan step and time tolerance.')
      const originalSettings: Settings = { aberration: input.aberration, maxStepSeconds: input.maxStepSeconds, toleranceSeconds: input.toleranceSeconds }
      const submittedSettings: Settings = { aberration: model, maxStepSeconds: Number(step), toleranceSeconds: Number(tolerance) }
      const fields: (keyof Settings)[] = ['aberration', 'maxStepSeconds', 'toleranceSeconds']
      const preparation = { source, originalSettings, submittedSettings, changedFields: fields.filter(key => originalSettings[key] !== submittedSettings[key]) }
      const submittedInput = { ...input, ...submittedSettings }
      if (model === 'NONE') delete submittedInput.maxLightTimeSeconds
      const inputBytes = new TextEncoder().encode(JSON.stringify(submittedInput)).buffer
      parseEllipsoidRayContactInput(inputBytes)
      setBusy(true)
      const active = startOccultationJob({ calculation: 'ellipsoid-ray-contacts', inputBytes }, [inputBytes], {
        done: response => {
          if (worker.current !== active) return
          worker.current = null; setBusy(false)
          if (response.calculation === 'ellipsoid-ray-contacts') setResult({ ...response.receipt, preparation })
          else setError('Unexpected occultation calculation response')
        },
        error: message => { if (worker.current === active) { worker.current = null; setBusy(false); setError(message) } },
      })
      worker.current = active
    } catch (reason) { clear(); setError(String(reason)) }
  }
  return <section className="evidence-module glass-panel" aria-label={zh ? '三轴椭球点源接触搜索' : 'Triaxial ellipsoid point-source contact search'}>
    <div className="module-heading"><span>{zh ? '有向椭球与点源接触' : 'Oriented ellipsoid and point-source contacts'}</span><em>SPK + PCK</em></div>
    <p>{zh ? '搜索固定 J2000 方向点源的前向射线与 PCK 三轴椭球边缘接触。输入方向由用户提供，不会冒充星表天体测量；CN 仅对目标中心做接收光行时改正。' : 'Search limb contacts between a user-supplied fixed J2000 point-source direction and a forward ray through a PCK triaxial ellipsoid. The direction is not presented as catalog astrometry; CN corrects target-center reception light time only.'}</p>
    <details><summary>{zh ? 'JSON 输入字段' : 'JSON input fields'}</summary><p>{zh ? '必填：schemaVersion=1、targetId（精确 PCK NAIF ID）、observerId（不同的 DE440 NAIF ID）、directionJ2000（三个有限非零分量，方向从观测者指向点源）、referenceEpochTdb（JD TDB）、startSeconds/endSeconds（相对参考历元的 TDB 秒）、maxStepSeconds/toleranceSeconds（秒）、aberration（NONE 或 CN）。CN 可选 maxLightTimeSeconds，默认 36000 秒。方向长度会归一化；没有默认恒星或隐式恒星目录映射。' : 'Required: schemaVersion=1; targetId (exact PCK NAIF ID); a distinct DE440 observerId; three finite nonzero directionJ2000 components directed from observer to point source; referenceEpochTdb (JD TDB); startSeconds/endSeconds (TDB seconds relative to that epoch); maxStepSeconds/toleranceSeconds (seconds); aberration (NONE or CN). CN accepts optional maxLightTimeSeconds, defaulting to 36,000 s. Direction length is normalized; no default star or implicit catalog mapping is supplied.'}</p></details>
    <label className="field"><span>{zh ? '椭球射线接触实验 JSON' : 'Ellipsoid-ray contact experiment JSON'}</span><input type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file) }} /></label>
    {input && source && <>
      <p>{zh ? '输入字节会保留在结果中；文件名和来源声明不是真实性认证。' : 'Original input bytes are retained in the result; a filename or source declaration is not authentication.'}</p>
      <dl className="contract-list">
        <div><dt>{zh ? '目标椭球 / 观测者 NAIF ID' : 'Target ellipsoid / observer NAIF IDs'}</dt><dd>{input.targetId} / {input.observerId}</dd></div>
        <div><dt>{zh ? 'J2000 方向向量' : 'J2000 direction vector'}</dt><dd>{input.directionJ2000.join(', ')}</dd></div>
        <div><dt>{zh ? '参考历元与 TDB 搜索区间' : 'Reference epoch and TDB search interval'}</dt><dd>JD {input.referenceEpochTdb} · {input.startSeconds} → {input.endSeconds} s</dd></div>
      </dl>
      <details><summary>{zh ? '查看导入设置' : 'Inspect imported settings'}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(input, null, 2)}</pre></details>
    </>}
    <label className="field"><span>{zh ? '目标中心光行时模型' : 'Target-center light-time model'}</span><select aria-label={zh ? '目标中心光行时模型' : 'Target-center light-time model'} value={model} onChange={event => { clear(); setModel(event.target.value as 'NONE' | 'CN') }}><option value="CN">CN · {zh ? '迭代接收光行时' : 'converged reception light time'}</option><option value="NONE">NONE · {zh ? '同时几何位置' : 'simultaneous geometric positions'}</option></select></label>
    <label className="field"><span>{zh ? '最大扫描步长（秒）' : 'Maximum scan step (seconds)'}</span><input type="number" step="any" value={step} onChange={event => { clear(); setStep(event.target.value) }} /></label>
    <label className="field"><span>{zh ? '接触根定位容差（秒）' : 'Contact root-localization tolerance (seconds)'}</span><input type="number" step="any" value={tolerance} onChange={event => { clear(); setTolerance(event.target.value) }} /></label>
    <p>{zh ? '标量间隙是前向半射线在缩放单位球空间中的有符号间隙：最近点位于观测者前方时为冲击参数减一；最近点在观测者后方时，按观测者到单位球面的缩放距离计算。负值表示前向射线穿过椭球。固定步长扫描可能漏掉擦边或单个区间内多次穿越；根容差不是物理时间误差。搜索最多 20,000 次几何求值并在 30 秒后取消，不返回部分回执。' : 'The signed gap is the forward half-ray clearance in scaled unit-sphere space: impact parameter minus one when the closest point is forward of the observer, and the observer’s scaled distance from the unit sphere when it is behind. Negative values mean the forward ray intersects the ellipsoid. Fixed-step scanning can miss tangencies or multiple crossings within one interval; root tolerance is not physical timing error. Searches are capped at 20,000 geometry evaluations and canceled after 30 seconds without a partial receipt.'}</p>
    <button type="button" className="primary-button" disabled={!input || busy} onClick={run}>{zh ? '搜索椭球边缘接触' : 'Search ellipsoid-limb contacts'}</button>
    {busy && <><p role="status">{zh ? '正在校验来源并搜索…' : 'Verifying sources and searching…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消搜索' : 'Cancel search'}</button></>}
    {reading && <><p role="status">{zh ? '正在读取科学文件…' : 'Reading scientific source…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消读取' : 'Cancel read'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="ellipsoid-ray-contact-result">
      <EphemerisWindow referenceEpochTdb={result.ephemeris.referenceEpochTdb} elapsedRangeSeconds={result.ephemeris.elapsedRangeSeconds}
        requested={{ kind: 'search', start: result.inputFile.payload.startSeconds, end: result.inputFile.payload.endSeconds }} zh={zh} />
      <p>{result.ephemeris.aberration} · {result.contacts.length} {zh ? '个已定位接触' : 'localized contacts'} · {result.numericallyScreenedCrossings.length} {zh ? '个数值筛选候选穿越' : 'numerically screened candidates'} · {result.indeterminateSamples.length} {zh ? '个不确定样本' : 'indeterminate samples'} · {result.evaluations} {zh ? '次几何求值' : 'geometry evaluations'} · {zh ? '间隙单位' : 'gap units'}: {result.gapUnits}</p>
      {result.numericallyScreenedCrossings.length > 0 && <p role="status">{zh ? '有符号变化进入数值筛选带，未作为已定位接触或截获窗口处理。完整时间、间隙与筛选裕量保留在导出回执中。' : 'Some sampled sign changes entered the numerical screening band and were not reported as localized contacts or intercept windows. Their times, gaps and margins remain in the exported receipt.'}</p>}
      <details><summary>{zh ? '扫描与来源边界' : 'Scan and source boundaries'}</summary>
        <p>{zh ? '区间数 / 实际最大间距 / 请求最大步长 / 根定位容差：' : 'Intervals / realized maximum spacing / requested maximum step / root-localization tolerance: '}{result.scanIntervals} / {result.maximumScanIntervalSeconds.toPrecision(6)} / {result.requestedMaxStepSeconds.toPrecision(6)} / {result.toleranceSeconds.toPrecision(6)} s</p>
        <p>{zh ? 'PCK 形状表示：' : 'PCK shape representation: '}{result.shape.representation} · NAIF PCK ID {result.shape.naifPckId} · {zh ? '方向模型：' : 'orientation model: '}{result.orientationModel}</p>
        <p>{zh ? '椭球缩放观察距离范围 / 最大数值筛选余量：' : 'Scaled observer-distance range / maximum numerical screening margin: '}{result.observerScaledDistanceRange.map(value => value.toPrecision(7)).join('–')} / {result.numericalScreening.maximumMarginScaled.toExponential(3)}</p>
        {result.reception && <p>{zh ? 'CN 最大迭代 / 12、最大方程残差 / 1e-9 秒、最大光行时 / 来源余量：' : 'CN max iterations / 12, max equation residual / 1e-9 s, max light time / source margin: '}{result.reception.observedMaximumIterations} / 12, {result.reception.observedMaximumResidualSeconds.toExponential(3)} s, {result.reception.observedMaximumLightTimeSeconds.toPrecision(6)} / {result.reception.sourceMarginSeconds.toPrecision(6)} s</p>}
        {result.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}
      </details>
      {result.sampledInterceptWindows.map((window, index) => <div key={index} className="contract-list"><strong>{zh ? '采样到的射线截获窗口' : 'Sampled ray-intercept window'}</strong><p>{window.start.elapsedTdbSeconds.toFixed(4)} → {window.end.elapsedTdbSeconds.toFixed(4)} s</p><p>{zh ? '持续时间数值范围' : 'Numerical duration bounds'}: [{window.numericalDurationBoundsSeconds.map(value => value.toFixed(4)).join(', ')}] s</p></div>)}
      {!result.sampledInterceptWindows.length && <p>{zh ? '没有推断出正时长截获窗口；这不能证明没有事件。' : 'No positive-duration intercept window was inferred; this does not prove no event occurred.'}</p>}
      <details><summary>{zh ? '查看接触时刻括区' : 'Inspect contact epoch brackets'}</summary>{result.contacts.map((contact, index) => <p key={index}>{contact.direction} · {contact.elapsedTdbSeconds.toFixed(4)} s · {zh ? '扫描括区' : 'scan'} [{contact.scanBracketSeconds.map(value => value.toFixed(4)).join(', ')}] s · {zh ? '根定位' : 'root'} [{contact.bracketSeconds.map(value => value.toFixed(4)).join(', ')}] s</p>)}</details>
      <button type="button" className="secondary-button" onClick={() => { const current = generation.current; void saveTextExport(JSON.stringify({ ...result, build: BUILD_INFO }, null, 2), 'solar-ellipsoid-ray-contacts.json', 'application/json').catch(reason => { if (current === generation.current) setError(String(reason)) }) }}>{zh ? '导出接触、窗口与来源 JSON' : 'Export contacts, windows and sources JSON'}</button>
    </div>}
  </section>
}
