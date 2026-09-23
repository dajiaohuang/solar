import { useEffect, useRef, useState } from 'react'
import example from '../../data/venus-transit-reception-example.json'
import { parseOccultationInput, type OccultationInput, type runOccultationExperiment } from '../../engine/events/occultationExperiment'
import { useI18n } from '../../i18n/context'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'

type Receipt = Awaited<ReturnType<typeof runOccultationExperiment>>
export function OccultationLaboratory() {
  const { language } = useI18n(), zh = language === 'zh'
  const [input, setInput] = useState<OccultationInput | null>(null)
  const [model, setModel] = useState<'NONE' | 'CN'>('CN'), [step, setStep] = useState('300'), [tolerance, setTolerance] = useState('0.01')
  const [result, setResult] = useState<Receipt | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const worker = useRef<Worker | null>(null), generation = useRef(0)
  const clear = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { generation.current++; worker.current?.terminate(); worker.current = null }, [])
  const install = (bytes: ArrayBuffer) => {
    const parsed = parseOccultationInput(bytes)
    setInput(parsed); setModel(parsed.aberration); setStep(String(parsed.maxStepSeconds)); setTolerance(String(parsed.toleranceSeconds))
  }
  const read = async (file: File) => {
    clear(); setInput(null)
    const current = generation.current
    try {
      if (file.size > 65536) throw new Error(zh ? '文件超过 64 KiB 上限。' : 'The file exceeds the 64 KiB limit.')
      const bytes = await file.arrayBuffer()
      if (current === generation.current) install(bytes)
    } catch (reason) { if (current === generation.current) setError(String(reason)) }
  }
  const run = () => {
    clear()
    if (!input) return
    try {
      if (!step.trim() || !tolerance.trim()) throw new Error(zh ? '请填写步长和容差。' : 'Enter the scan step and tolerance.')
      const inputBytes = new TextEncoder().encode(JSON.stringify({ ...input, aberration: model, maxStepSeconds: Number(step), toleranceSeconds: Number(tolerance) })).buffer
      parseOccultationInput(inputBytes)
      const active = new Worker(new URL('../../workers/occultation.worker.ts', import.meta.url), { type: 'module' })
      worker.current = active; setBusy(true)
      active.onmessage = (event: MessageEvent<{ type: 'done'; receipt: Receipt } | { type: 'error'; error: string }>) => {
        if (worker.current !== active) return
        active.terminate(); worker.current = null; setBusy(false)
        if (event.data.type === 'done') setResult(event.data.receipt)
        else setError(event.data.error)
      }
      active.onerror = event => { if (worker.current === active) { clear(); setError(event.message || 'Worker failed') } }
      active.postMessage({ inputBytes }, [inputBytes])
    } catch (reason) { clear(); setError(String(reason)) }
  }
  const boundary = (value: 'external' | 'internal') => value === 'external' ? (zh ? '圆盘重叠' : 'Disc overlap') : (zh ? '圆盘完全包含' : 'Disc containment')
  const edge = (kind: string) => kind === 'search-boundary' ? (zh ? '搜索边界截断' : 'Clipped to search') : kind === 'sampled-zero' ? (zh ? '采样零值' : 'Sampled zero') : (zh ? '接触根区间' : 'Contact bracket')
  return <section className="evidence-module glass-panel" aria-label={zh ? '掩星与凌日实验室' : 'Occultation laboratory'}>
    <div className="module-heading"><span>{zh ? '掩星与凌日实验室' : 'Occultation laboratory'}</span><em>SPK + PCK</em></div>
    <p>{zh ? '从原始 DE440 星历与有来源的球形半径搜索圆盘接触。示例为地心观测的 2012 年金星凌日，不是地面可见性预报。' : 'Search disc contacts using original DE440 states and sourced spherical radii. The example is the 2012 Venus transit seen from Earth’s center, not a ground visibility forecast.'}</p>
    <button type="button" className="secondary-button" onClick={() => { clear(); install(new TextEncoder().encode(JSON.stringify(example)).buffer) }}>{zh ? '载入金星凌日示例' : 'Load Venus transit example'}</button>
    <label className="field"><span>{zh ? '接触实验 JSON 文件' : 'Contact experiment JSON file'}</span><input type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file) }} /></label>
    {input && <>
      <dl className="contract-list"><div><dt>{zh ? '前景 / 背景 / 观测中心 NAIF ID' : 'Foreground / background / observer NAIF IDs'}</dt><dd>{input.foregroundId} / {input.backgroundId} / {input.observerId}</dd></div><div><dt>{zh ? '参考历元' : 'Reference epoch'}</dt><dd>JD {input.referenceEpochTdb} TDB</dd></div><div><dt>{zh ? '相对搜索区间（TDB 秒）' : 'Relative search interval (TDB seconds)'}</dt><dd>{input.startSeconds} → {input.endSeconds}</dd></div></dl>
      <details><summary>{zh ? '查看导入的实验设置' : 'Inspect imported experiment settings'}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(input, null, 2)}</pre></details>
    </>}
    <label className="field"><span>{zh ? '光行时模型' : 'Light-time model'}</span><select aria-label={zh ? '光行时模型' : 'Light-time model'} value={model} onChange={event => { clear(); setModel(event.target.value as 'NONE' | 'CN') }}><option value="CN">{zh ? 'CN · 迭代接收光行时' : 'CN · converged reception light time'}</option><option value="NONE">{zh ? 'NONE · 同时几何位置' : 'NONE · simultaneous geometric positions'}</option></select></label>
    <label className="field"><span>{zh ? '最大扫描步长（秒）' : 'Maximum scan step (seconds)'}</span><input type="number" step="any" value={step} onChange={event => { clear(); setStep(event.target.value) }} /></label>
    <label className="field"><span>{zh ? '接触数值容差（秒）' : 'Contact numerical tolerance (seconds)'}</span><input type="number" step="any" value={tolerance} onChange={event => { clear(); setTolerance(event.target.value) }} /></label>
    <p>{zh ? '可能漏掉步长内的短事件和擦边事件。未包含恒星光行差、引力偏折、非球形边缘或地面站；数值容差不是物理误差。' : 'Short events and grazing contacts may be missed. Stellar aberration, gravitational deflection, non-spherical limbs and ground stations are absent; numerical tolerance is not physical error.'}</p>
    <button type="button" className="primary-button" disabled={!input || busy} onClick={run}>{zh ? '搜索球形接触' : 'Search spherical contacts'}</button>
    {busy && <><p role="status">{zh ? '正在校验来源并搜索…' : 'Verifying sources and searching…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消接触搜索' : 'Cancel contact search'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="occultation-result">
      <p>{result.ephemeris.aberration} · {result.contacts.length} {zh ? '个接触' : 'contacts'} · {result.evaluations} {zh ? '次几何求值' : 'geometry evaluations'}</p>
      <p>{zh ? '下列时刻为相对参考历元的 TDB 秒，不是 UTC。' : 'Times below are TDB seconds relative to the reference epoch, not UTC.'}</p>
      {result.sampledOverlapWindows.map((window, i) => <div key={i} className="contract-list"><strong>{boundary(window.boundary)}</strong><p>{window.start.elapsedTdbSeconds.toFixed(4)} → {window.end.elapsedTdbSeconds.toFixed(4)} s</p><p>{edge(window.start.kind)} → {edge(window.end.kind)}</p><p>{zh ? '持续时间' : 'Duration'}: {window.durationSeconds.toFixed(4)} s · {zh ? '数值范围' : 'Numerical range'} [{window.numericalDurationBoundsSeconds.map(v => v.toFixed(4)).join(', ')}] s</p></div>)}
      {!result.sampledOverlapWindows.length && <p>{zh ? '未推断出正时长重叠窗口；这不能证明没有事件。' : 'No positive-duration overlap window was inferred; this does not prove no event occurred.'}</p>}
      <details><summary>{zh ? '查看接触时刻与数值区间' : 'Inspect contact times and numerical brackets'}</summary>{result.contacts.map((contact, i) => <p key={i}>{boundary(contact.boundary)} · {contact.direction} · {contact.elapsedTdbSeconds.toFixed(4)} s · [{contact.bracketSeconds.map(v => v.toFixed(4)).join(', ')}] s</p>)}</details>
      <p>{zh ? '完全包含不一定是全食。窗口由采样符号推断，仍可能含未检出的间断。物理时间不确定性未知。' : 'Containment does not necessarily mean a total eclipse. Windows inferred from sampled signs may hide interruptions. Physical timing uncertainty is unknown.'}</p>
      <button type="button" className="secondary-button" onClick={() => { void saveTextExport(JSON.stringify({ ...result, build: BUILD_INFO }, null, 2), 'solar-occultation-experiment.json', 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出接触、窗口与来源 JSON' : 'Export contacts, windows and sources JSON'}</button>
    </div>}
  </section>
}
