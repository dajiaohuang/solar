import { useEffect, useRef, useState } from 'react'
import example from '../../data/dynamics-eros-example.json'
import { parseDynamicsInitial, type integrateDynamicsExperiment } from '../../engine/dynamics/experiment'
import { useI18n } from '../../i18n/context'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'

type Receipt = Awaited<ReturnType<typeof integrateDynamicsExperiment>> & { initialFile: { sha256: string; bytes: number; payload: Record<string, unknown> }; schemaVersion: number; calculation: string }
type Input = { bytes: ArrayBuffer; parsed: ReturnType<typeof parseDynamicsInitial>; name: string }

export function DynamicsLaboratory() {
  const { language } = useI18n(), zh = language === 'zh'
  const [input, setInput] = useState<Input | null>(null), [result, setResult] = useState<Receipt | null>(null)
  const [days, setDays] = useState('30'), [exclusion, setExclusion] = useState('1')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const worker = useRef<Worker | null>(null), generation = useRef(0)
  const clear = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { generation.current++; worker.current?.terminate() }, [])
  const install = (bytes: ArrayBuffer, name: string) => {
    const parsed = parseDynamicsInitial(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    setInput({ bytes, parsed, name })
  }
  const read = async (file: File) => {
    clear(); setInput(null)
    const current = generation.current
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(zh ? '文件超过 2 MiB 上限。' : 'The file exceeds the 2 MiB limit.')
      const bytes = await file.arrayBuffer()
      if (current === generation.current) install(bytes, file.name)
    } catch (reason) { if (current === generation.current) setError(String(reason)) }
  }
  const run = () => {
    clear()
    if (!input) return
    const durationSeconds = Number(days) * 86400, exclusionKm = Number(exclusion)
    if (!days.trim() || !exclusion.trim() || !Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365 * 86400 || !Number.isFinite(exclusionKm) || exclusionKm < 0) {
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
      active.onerror = event => { if (worker.current === active) { active.terminate(); worker.current = null; setBusy(false); setError(event.message || 'Worker failed') } }
      const initialBytes = input.bytes.slice(0)
      active.postMessage({ initialBytes, durationSeconds, exclusionKm }, [initialBytes])
    } catch (reason) { worker.current?.terminate(); worker.current = null; setBusy(false); setError(String(reason)) }
  }
  return <section className="evidence-module glass-panel dynamics-laboratory" aria-label={zh ? '动力学实验室' : 'Dynamics laboratory'}>
    <div className="module-heading"><span>{zh ? '动力学实验室' : 'Dynamics laboratory'}</span><em>DE440</em></div>
    <p>{zh ? '在真实 DE440 扰动源下积分试验粒子。当前模型只含牛顿点质量引力，尚未包含相对论、非球形引力或非引力项。' : 'Integrate a test particle under real DE440 perturbing sources. This model includes Newtonian point-mass gravity only; relativity, harmonics and non-gravitational terms are absent.'}</p>
    <button type="button" className="secondary-button" onClick={() => { clear(); install(new TextEncoder().encode(JSON.stringify(example)).buffer, 'Eros 433 · CSPICE') }}>{zh ? '载入有据可查的 Eros 示例' : 'Load source-backed Eros example'}</button>
    <label className="field"><span>{zh ? '初始条件 JSON 文件' : 'Initial condition JSON file'}</span><input type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file) }} /></label>
    <p>{zh ? '初始状态必须为 J2000 / 太阳系质心 / TDB，位置 km、速度 km/s。来源声明不会自动认证自备文件。' : 'Initial states must use J2000 / SSB / TDB, position km and velocity km/s. A source declaration does not authenticate an imported file.'}</p>
    {input && <dl className="contract-list"><div><dt>{zh ? '输入' : 'Input'}</dt><dd>{input.name}</dd></div><div><dt>{zh ? '初始历元' : 'Initial epoch'}</dt><dd>JD {input.parsed.referenceEpochTdb} TDB</dd></div><div><dt>{zh ? '来源' : 'Source'}</dt><dd>{input.parsed.initialSource}</dd></div></dl>}
    {input && <><details><summary>{zh ? '查看初始坐标与速度' : 'Inspect initial coordinates and velocity'}</summary><div className="uncertainty-table"><table><caption>J2000 / SSB</caption><tbody>{['x', 'y', 'z', 'vx', 'vy', 'vz'].map((label, i) => <tr key={label}><th>{label}</th><td>{input.parsed.initial[i].toPrecision(15)}</td><td>{i < 3 ? 'km' : 'km/s'}</td></tr>)}</tbody></table></div></details>
      <button type="button" className="secondary-button" onClick={() => { void saveTextExport(new TextDecoder().decode(input.bytes), 'solar-dynamics-initial.json', 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出初始条件 JSON' : 'Export initial conditions JSON'}</button></>}
    <label className="field"><span>{zh ? '积分时长（TDB 天）' : 'Duration (TDB days)'}</span><input type="number" min="-365" max="365" step="any" value={days} onChange={event => { clear(); setDays(event.target.value) }} /></label>
    <label className="field"><span>{zh ? '点质量排除距离（km）' : 'Point-mass exclusion distance (km)'}</span><input type="number" min="0" step="any" value={exclusion} onChange={event => { clear(); setExclusion(event.target.value) }} /></label>
    <p>{zh ? '排除距离在力计算时检查，不是连续碰撞检测。实验不计算完整拟合协方差或事件概率。' : 'Exclusion is checked at force evaluations, not by continuous collision detection. No complete fit covariance or event probability is calculated.'}</p>
    <button type="button" className="primary-button" disabled={!input || busy} onClick={run}>{zh ? '采用 DE440 点质量模型并运行' : 'Adopt DE440 point masses and run'}</button>
    {busy && <><p role="status">{zh ? '正在校验星历并积分…' : 'Verifying ephemeris and integrating…'}</p><button type="button" className="secondary-button" onClick={clear}>{zh ? '取消实验' : 'Cancel experiment'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="dynamics-result">
      <p>{zh ? '实验终点' : 'Experiment endpoint'}: JD {result.finalEpoch.referenceEpochTdb} TDB + {result.finalEpoch.elapsedTdbSeconds} s</p>
      <div className="uncertainty-table"><table><caption>{zh ? '模型积分状态 · J2000 / SSB' : 'Model-integrated state · J2000 / SSB'}</caption><thead><tr><th>{zh ? '分量' : 'Axis'}</th><th>{zh ? '值' : 'Value'}</th><th>{zh ? '单位' : 'Unit'}</th></tr></thead><tbody>{['x', 'y', 'z', 'vx', 'vy', 'vz'].map((label, i) => <tr key={label}><th>{label}</th><td>{result.finalStateKmKmPerSecond[i].toPrecision(12)}</td><td>{i < 3 ? 'km' : 'km/s'}</td></tr>)}</tbody></table></div>
      <p>{result.numerics.accepted} {zh ? '接受步数' : 'accepted steps'} · {result.numerics.evaluations} {zh ? '力计算次数' : 'force evaluations'}</p>
      <p>{zh ? '太阳、分离的地球和月球、其他行星系统质心，共 11 个点质量；误差容差只控制数值计算。Eros 的已验证 30 天案例与原始 SPK 约相差 191 米，不能视为物理精度保证。' : 'Eleven point masses: Sun, separate Earth/Moon and other planetary system barycenters. Tolerances control numerical computation only. The verified 30-day Eros case differs from its original SPK by about 191 m; this is not a physical accuracy guarantee.'}</p>
      <button type="button" className="secondary-button" onClick={() => { void saveTextExport(JSON.stringify({ ...result, build: BUILD_INFO }, null, 2), 'solar-dynamics-experiment.json', 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出实验与来源 JSON' : 'Export experiment and sources JSON'}</button>
    </div>}
  </section>
}
