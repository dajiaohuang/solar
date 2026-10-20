import { CoverageGapList } from './CoverageGapList'
import { useEffect, useRef, useState } from 'react'
import { loadCoverageTarget } from '../../lib/coverageTarget'
import type { CoverageReport } from '../../lib/coverageReport'
import { PRODUCT_PROFILE } from '../../lib/productAvailability'
import { saveTextExport } from '../../lib/platform'

type Result = Awaited<ReturnType<typeof loadCoverageTarget>>
export function CoverageTargetInspector({ base, report, zh }: { base: string; report: CoverageReport; zh: boolean }) {
  const [id, setId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const generation = useRef(0)
  const active = useRef<AbortController | null>(null)
  const clear = () => { generation.current++; active.current?.abort(); active.current = null; setBusy(false); setResult(null); setShowRaw(false); setError('') }
  useEffect(() => () => { generation.current++; active.current?.abort(); active.current = null }, [])
  const load = async () => {
    clear()
    const controller = new AbortController(); active.current = controller; setBusy(true)
    const deadline = performance.now() + 30_000
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const next = await loadCoverageTarget(base, PRODUCT_PROFILE, report, id.trim(), controller.signal)
      if (performance.now() >= deadline) controller.abort()
      controller.signal.throwIfAborted()
      if (active.current === controller) setResult(next)
    } catch (reason) { if (active.current === controller) setError(String(reason)) }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setBusy(false) } }
  }
  return <section>
    <h3>{zh ? '查询具体天体的覆盖缺口' : 'Inspect one target’s coverage gaps'}</h3>
    <p>{zh ? '输入目录身份或规范 NAIF 身份（例如 naif:301），不按名称猜测。结果属于上方固定报告，不是当前实时状态。' : 'Enter a catalog identity or canonical NAIF identity (for example naif:301); names are not guessed. Results belong to the fixed audit above, not live current states.'}</p>
    <label className="field"><span>{zh ? '目标身份' : 'Target identity'}</span><input value={id} maxLength={512} onChange={event => { clear(); setId(event.target.value) }} /></label>
    <button type="button" className="secondary-button" disabled={busy || !id.trim()} onClick={() => void load()}>{zh ? '查询覆盖' : 'Inspect coverage'}</button>
    {busy && <><p role="status">{zh ? '正在读取固定审计…' : 'Loading the pinned audit…'}</p><button type="button" onClick={clear}>{zh ? '取消' : 'Cancel'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <div>
      <p>{result.id}{result.canonicalId && ` → ${result.canonicalId}`}</p>
      {result.status === 'not_audited' ? <p role="status">{zh ? '此身份未包含在该审计中；不能据此断言没有轨道或星历。' : 'This identity is not included in this audit; that does not establish absence of orbit or ephemeris data.'}</p> : <>
        <p>{zh ? '审计历元状态：' : 'State at audit epoch: '}{result.availableAtAudit ? (zh ? '可用' : 'Available') : (zh ? '无状态' : 'No state')}</p>
        <p>{zh ? '后端报告的依赖缺口数：' : 'Dependency gaps reported by the backend: '}{result.reportedGaps}</p>
        {result.gaps.length > 0 && <CoverageGapList key={result.id} gaps={result.gaps} zh={zh} />}
      </>}
      <p>{zh ? '浏览器核对报告、目录、时间窗与目标身份；未独立重算依赖链。零缺口不等于整窗数值精度认证。' : 'The browser checks report, catalog, window and target identity; it does not independently recompute dependency chains. Zero gaps is not whole-window numerical certification.'}</p>
      <details onToggle={event => setShowRaw(event.currentTarget.open)}><summary>{zh ? '查看后端原始依赖报告' : 'Inspect the backend dependency report'}</summary>{showRaw && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(result.raw, null, 2)}</pre>}</details>
      <button type="button" className="secondary-button" onClick={() => {
        const exportGeneration = generation.current
        const current = result
        void saveTextExport(JSON.stringify(current.raw, null, 2), 'solar-target-coverage.json', 'application/json')
          .catch(reason => { if (exportGeneration === generation.current) setError(String(reason)) })
      }}>{zh ? '导出目标覆盖 JSON' : 'Export target coverage JSON'}</button>
    </div>}
  </section>
}
