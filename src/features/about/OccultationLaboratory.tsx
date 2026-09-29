import { readScientificSourceFile } from '../../lib/scientificSourceFile'
import { EphemerisWindow } from './EphemerisWindow'
import { useEffect, useRef, useState } from 'react'
import { startOccultationJob, type OccultationJob } from '../../lib/occultationJob'
import example from '../../data/venus-transit-reception-example.json'
import { parseOccultationInput, type OccultationInput, type runOccultationExperiment } from '../../engine/events/occultationExperiment'
import { useI18n } from '../../i18n/context'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { dynamicsSourceBase64 } from '../../lib/dynamicsSourceBytes'
import { EllipsoidRayContactsPanel } from './EllipsoidRayContactsPanel'

type ImportedSource = { kind: 'imported-file' | 'bundled-example'; name: string; bytes: number; originalBase64: string }
type EditableSettings = Pick<OccultationInput, 'aberration' | 'maxStepSeconds' | 'toleranceSeconds'>
type Receipt = Awaited<ReturnType<typeof runOccultationExperiment>> & {
  preparation: { source: ImportedSource; originalSettings: EditableSettings; submittedSettings: EditableSettings; changedFields: (keyof EditableSettings)[] }
}
export function OccultationLaboratory() {
  const { language } = useI18n(), zh = language === 'zh'
  const [input, setInput] = useState<OccultationInput | null>(null)
  const [source, setSource] = useState<ImportedSource | null>(null)
  const [model, setModel] = useState<'NONE' | 'CN'>('CN'), [step, setStep] = useState('300'), [tolerance, setTolerance] = useState('0.01')
  const [result, setResult] = useState<Receipt | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const worker = useRef<OccultationJob | null>(null), generation = useRef(0)
  const sourceRead = useRef<AbortController | null>(null)
  const [reading,setReading] = useState(false)
  const clear = () => { generation.current++; sourceRead.current?.abort(); sourceRead.current = null; setReading(false); worker.current?.terminate(); worker.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { generation.current++; sourceRead.current?.abort(); sourceRead.current = null; worker.current?.terminate(); worker.current = null }, [])
  const install = (bytes: ArrayBuffer, kind: ImportedSource['kind'], name: string, check: () => void = () => {}) => {
    check()
    const parsed = parseOccultationInput(bytes)
    const originalBase64 = dynamicsSourceBase64(bytes)
    check()
    setSource({ kind, name, bytes: bytes.byteLength, originalBase64 })
    setInput(parsed); setModel(parsed.aberration); setStep(String(parsed.maxStepSeconds)); setTolerance(String(parsed.toleranceSeconds))
  }
  const read = async (file: File) => {
    clear(); setInput(null); setSource(null)
    const current = generation.current, controller = new AbortController()
    const deadline = performance.now()+30000
    const check = () => {
      controller.signal.throwIfAborted()
      if (performance.now() >= deadline) throw new Error(zh ? '接触搜索条件导入超过 30 秒时限。' : 'Contact search input import exceeded its 30-second limit.')
    }
    sourceRead.current = controller; setReading(true)
    try {
      if (file.size > 65536) throw new Error(zh ? '文件超过 64 KiB 上限。' : 'The file exceeds the 64 KiB limit.')
      const bytes = await readScientificSourceFile(file,controller.signal,65536)
      if (current === generation.current) install(bytes, 'imported-file', file.name, check)
    } catch (reason) { if (current === generation.current) setError(String(reason)) }
    finally { if(sourceRead.current === controller) sourceRead.current = null; if(current === generation.current) setReading(false) }
  }
  const run = () => {
    clear()
    if (!input || !source) return
    try {
      if (!step.trim() || !tolerance.trim()) throw new Error(zh ? '请填写步长和容差。' : 'Enter the scan step and tolerance.')
      const originalSettings: EditableSettings = { aberration: input.aberration, maxStepSeconds: input.maxStepSeconds, toleranceSeconds: input.toleranceSeconds }
      const submittedSettings: EditableSettings = { aberration: model, maxStepSeconds: Number(step), toleranceSeconds: Number(tolerance) }
      const fields: (keyof EditableSettings)[] = ['aberration', 'maxStepSeconds', 'toleranceSeconds']
      const preparation = { source, originalSettings, submittedSettings, changedFields: fields.filter(field => originalSettings[field] !== submittedSettings[field]) }
      const inputBytes = new TextEncoder().encode(JSON.stringify({ ...input, ...submittedSettings })).buffer
      parseOccultationInput(inputBytes)
      setBusy(true)
      const active = startOccultationJob({ calculation: 'contacts', inputBytes }, [inputBytes], {
        done: response => {
          if (worker.current !== active) return
          worker.current = null; setBusy(false)
          if (response.calculation === 'contacts') setResult({ ...response.receipt, preparation })
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
  const boundary = (value: 'external' | 'internal') => value === 'external' ? (zh ? '圆盘重叠' : 'Disc overlap') : (zh ? '圆盘完全包含' : 'Disc containment')
  const edge = (kind: string) => kind === 'search-boundary' ? (zh ? '搜索边界截断' : 'Clipped to search') : kind === 'sampled-zero' ? (zh ? '采样零值' : 'Sampled zero') : kind === 'sampled-overlap' ? (zh ? '采样重叠边缘' : 'Sampled overlap edge') : (zh ? '接触根区间' : 'Contact bracket')
  return <>
  <section className="evidence-module glass-panel" aria-label={zh ? '掩星与凌日实验室' : 'Occultation laboratory'}>
    <div className="module-heading"><span>{zh ? '掩星与凌日实验室' : 'Occultation laboratory'}</span><em>SPK + PCK</em></div>
    <p>{zh ? '从原始 DE440 星历与有来源的球形半径搜索圆盘接触。示例为地心观测的 2012 年金星凌日，不是地面可见性预报。' : 'Search disc contacts using original DE440 states and sourced spherical radii. The example is the 2012 Venus transit seen from Earth’s center, not a ground visibility forecast.'}</p>
    <button type="button" className="secondary-button" onClick={() => { clear(); install(new TextEncoder().encode(JSON.stringify(example)).buffer, 'bundled-example', 'venus-transit-reception-example.json') }}>{zh ? '载入金星凌日示例' : 'Load Venus transit example'}</button>
    <label className="field"><span>{zh ? '接触实验 JSON 文件' : 'Contact experiment JSON file'}</span><input type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file) }} /></label>
    {input && <>
      <p>{zh ? '导出同时保留导入文件的原始字节和实际提交设置；文件名与来源声明不构成真实性认证。内置示例保存的是序列化后的示例字节。' : 'Exports retain imported file bytes and submitted settings separately. Names and source declarations do not authenticate a file. Bundled examples retain serialized example bytes.'}</p>
      <dl className="contract-list"><div><dt>{zh ? '前景 / 背景 / 观测中心 NAIF ID' : 'Foreground / background / observer NAIF IDs'}</dt><dd>{input.foregroundId} / {input.backgroundId} / {input.observerId}</dd></div><div><dt>{zh ? '参考历元' : 'Reference epoch'}</dt><dd>JD {input.referenceEpochTdb} TDB</dd></div><div><dt>{zh ? '相对搜索区间（TDB 秒）' : 'Relative search interval (TDB seconds)'}</dt><dd>{input.startSeconds} → {input.endSeconds}</dd></div></dl>
      <details><summary>{zh ? '查看导入的实验设置' : 'Inspect imported experiment settings'}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(input, null, 2)}</pre></details>
    </>}
    <label className="field"><span>{zh ? '光行时模型' : 'Light-time model'}</span><select aria-label={zh ? '光行时模型' : 'Light-time model'} value={model} onChange={event => { clear(); setModel(event.target.value as 'NONE' | 'CN') }}><option value="CN">{zh ? 'CN · 迭代接收光行时' : 'CN · converged reception light time'}</option><option value="NONE">{zh ? 'NONE · 同时几何位置' : 'NONE · simultaneous geometric positions'}</option></select></label>
    <label className="field"><span>{zh ? '最大扫描步长（秒）' : 'Maximum scan step (seconds)'}</span><input type="number" step="any" value={step} onChange={event => { clear(); setStep(event.target.value) }} /></label>
    <label className="field"><span>{zh ? '接触数值容差（秒）' : 'Contact numerical tolerance (seconds)'}</span><input type="number" step="any" value={tolerance} onChange={event => { clear(); setTolerance(event.target.value) }} /></label>
    <p>{zh ? '可能漏掉步长内的短事件和擦边事件。未包含恒星光行差、引力偏折、非球形边缘或地面站；数值容差不是物理误差。' : 'Short events and grazing contacts may be missed. Stellar aberration, gravitational deflection, non-spherical limbs and ground stations are absent; numerical tolerance is not physical error.'}</p>
    <button type="button" className="primary-button" disabled={!input || busy} onClick={run}>{zh ? '搜索球形接触' : 'Search spherical contacts'}</button>
    <p>{zh ? '30 秒内未完成会终止任务；可调整参数后重新运行。' : 'Jobs that do not finish within 30 seconds are terminated; adjust parameters before retrying.'}</p>
    {busy && <><p role="status">{zh ? '正在校验来源并搜索…' : 'Verifying sources and searching…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消接触搜索' : 'Cancel contact search'}</button></>}
    {reading && <><p role="status">{zh ? '正在读取科学文件…' : 'Reading scientific source…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消读取' : 'Cancel read'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="occultation-result">
      <EphemerisWindow referenceEpochTdb={result.ephemeris.referenceEpochTdb} elapsedRangeSeconds={result.ephemeris.elapsedRangeSeconds} requested={{ kind: 'search', start: result.inputFile.payload.startSeconds, end: result.inputFile.payload.endSeconds }} zh={zh} />
      <p>{result.ephemeris.aberration} · {result.contacts.length} {zh ? '个接触' : 'contacts'} · {result.evaluations} {zh ? '次几何求值' : 'geometry evaluations'}</p>
      <p>{zh ? '下列时刻为相对参考历元的 TDB 秒，不是 UTC。' : 'Times below are TDB seconds relative to the reference epoch, not UTC.'}</p>
      <details><summary>{zh ? '搜索分辨率与误差边界' : 'Search resolution and error boundary'}</summary>
        <p>{zh ? '扫描区间 / 实际最大扫描间隔 / 请求最大步长 / 根定位容差：' : 'Scan intervals / realized maximum spacing / requested maximum step / root localization tolerance: '}
          {result.scanIntervals} / {result.maximumScanIntervalSeconds.toPrecision(6)} / {result.requestedMaxStepSeconds.toPrecision(6)} / {result.toleranceSeconds.toPrecision(6)} s
        </p>
        <p>{zh ? '定位括区只反映数值根细化。采样可能漏掉短事件或切触；物理时间不确定性未知。' : 'Localization brackets describe numerical root refinement only. Sampling can miss short events or tangencies; physical timing uncertainty is unknown.'}</p>
        {result.reception && <>
          <p>{zh ? 'CN 接收光行时：最大迭代次数 / 上限、最大方程残差 / 容差、最大光行时 / 来源余量：' : 'CN reception light time: maximum iterations / limit, maximum equation residual / tolerance, maximum light time / source margin: '}
            {result.reception.observedMaximumIterations} / {result.reception.maxIterations}, {result.reception.observedMaximumResidualSeconds.toExponential(3)} / {result.reception.iterationToleranceSeconds.toExponential(3)}, {result.reception.observedMaximumLightTimeSeconds.toPrecision(6)} / {result.reception.sourceMarginSeconds.toPrecision(6)} s
          </p>
          <p>{zh ? '残差仅是光行时方程的数值收敛证据，不代表物理时刻精度；未建模恒星光行差、引力偏折或扩展边缘的差分光行时。' : 'Residual is numerical convergence evidence for the light-time equation, not physical timing accuracy; stellar aberration, gravitational deflection and differential light time across extended limbs are omitted.'}</p>
        </>}
      </details>
      {result.sampledOverlapWindows.map((window, i) => <div key={i} className="contract-list"><strong>{boundary(window.boundary)}</strong><p>{window.start.elapsedTdbSeconds.toFixed(4)} → {window.end.elapsedTdbSeconds.toFixed(4)} s</p><p>{edge(window.start.kind)} → {edge(window.end.kind)}</p><p>{zh ? '持续时间' : 'Duration'}: {window.durationSeconds.toFixed(4)} s · {zh ? '数值范围' : 'Numerical range'} [{window.numericalDurationBoundsSeconds.map(v => v.toFixed(4)).join(', ')}] s</p></div>)}
      {!result.sampledOverlapWindows.length && <p>{zh ? '未推断出正时长重叠窗口；这不能证明没有事件。' : 'No positive-duration overlap window was inferred; this does not prove no event occurred.'}</p>}
      <details><summary>{zh ? '查看接触时刻与数值区间' : 'Inspect contact times and numerical brackets'}</summary>{result.contacts.map((contact, i) => <p key={i}>{boundary(contact.boundary)} · {contact.direction} · {contact.elapsedTdbSeconds.toFixed(4)} s · {zh ? '扫描括区' : 'scan bracket'} [{contact.scanBracketSeconds.map(v => v.toFixed(4)).join(', ')}] s · {zh ? '根定位括区' : 'root bracket'} [{contact.bracketSeconds.map(v => v.toFixed(4)).join(', ')}] s</p>)}</details>
      <p>{zh ? '完全包含不一定是全食。窗口由采样符号推断，仍可能含未检出的间断。物理时间不确定性未知。' : 'Containment does not necessarily mean a total eclipse. Windows inferred from sampled signs may hide interruptions. Physical timing uncertainty is unknown.'}</p>
      <button type="button" className="secondary-button" onClick={() => { const current = generation.current; void saveTextExport(JSON.stringify({ ...result, build: BUILD_INFO }, null, 2), 'solar-occultation-experiment.json', 'application/json').catch(reason => { if (current === generation.current) setError(String(reason)) }) }}>{zh ? '导出接触、窗口与来源 JSON' : 'Export contacts, windows and sources JSON'}</button>
    </div>}
  </section>
  <EllipsoidRayContactsPanel />
  </>
}
