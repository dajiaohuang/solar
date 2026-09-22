import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { loadGroundVisibility, type GroundVisibility, type GroundVisibilityRequest } from '../../lib/groundVisibility'
import type { GroundStation } from '../../lib/groundObservation'
import { saveTextExport } from '../../lib/platform'
import { PRODUCT_PROFILE } from '../../lib/productAvailability'

export function GroundVisibilityReadout({ startUtc, station, bodyId, base }: { startUtc: string; station: GroundStation; bodyId: string; base: string }) {
  const { language } = useI18n(), zh = language === 'zh'
  const [endUtc, setEndUtc] = useState(() => { const start = Date.parse(startUtc); return Number.isFinite(start) ? new Date(start + 86400_000).toISOString() : '' })
  const [altitude, setAltitude] = useState('0'), [sunLimit, setSunLimit] = useState('none')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<GroundVisibility | null>(null)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort() }, [])
  const clear = () => { active.current?.abort(); active.current = null; setBusy(false); setResult(null); setError('') }
  const run = async () => {
    clear()
    const controller = new AbortController(); active.current = controller; setBusy(true)
    const request: GroundVisibilityRequest = { startUtc, endUtc, station, bodyId, minAltitudeDeg: Number(altitude), ...(sunLimit === 'none' ? {} : { maxSunAltitudeDeg: Number(sunLimit) }) }
    try {
      const response = await loadGroundVisibility(base, PRODUCT_PROFILE, request, controller.signal)
      if (active.current === controller) setResult(response)
    } catch (reason) { if (active.current === controller) setError(`${zh ? '窗口搜索失败' : 'Window search failed'}: ${reason instanceof Error ? reason.message : String(reason)}`) }
    finally { if (active.current === controller) { active.current = null; setBusy(false) } }
  }
  const labels = { rise: zh ? '升过目标高度' : 'Rises above target altitude', set: zh ? '落到目标高度以下' : 'Sets below target altitude', 'darkness-begins': zh ? '太阳降至限制以下' : 'Sun falls below limit', 'darkness-ends': zh ? '太阳升过限制' : 'Sun rises above limit' }
  return <details className="ground-visibility">
    <summary>{zh ? '升落与可见窗口' : 'Rise, set and visibility windows'}</summary>
    <p>{zh ? '使用上方站点和 UTC 起点，搜索不超过 24 小时的时段。按无折射的天体中心高度判断；0° 穿越不等于通常含折射与日面边缘的日出日落。' : 'Uses the station and UTC start above, for up to 24 hours. Thresholds apply to the airless target center; a 0° crossing differs from conventional sunrise/sunset with refraction and the solar limb.'}</p>
    <form onSubmit={event => { event.preventDefault(); void run() }}>
      <label>{zh ? '结束 UTC' : 'End UTC'}<input required value={endUtc} placeholder="2026-09-24T00:00:00Z" onChange={event => { clear(); setEndUtc(event.target.value) }} /></label>
      <label>{zh ? '目标最低高度 °' : 'Minimum target altitude °'}<input type="number" required min={-90} max={90} step="any" value={altitude} onChange={event => { clear(); setAltitude(event.target.value) }} /></label>
      <label>{zh ? '太阳高度限制' : 'Sun altitude limit'}<select aria-label={zh ? '太阳高度限制' : 'Sun altitude limit'} value={sunLimit} onChange={event => { clear(); setSunLimit(event.target.value) }}>
        <option value="none">{zh ? '不限' : 'No limit'}</option><option value="0">≤ 0°</option><option value="-6">≤ −6°</option><option value="-12">≤ −12°</option><option value="-18">≤ −18°</option>
      </select></label>
      <button className="primary-button" disabled={busy}>{busy ? (zh ? '搜索中…' : 'Searching…') : (zh ? '搜索可见窗口' : 'Search visibility windows')}</button>
      {busy && <button type="button" onClick={clear}>{zh ? '取消窗口搜索' : 'Cancel window search'}</button>}
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <section aria-label={zh ? '可见窗口结果' : 'Visibility window result'}>
      <p role="status">{result.result.coverage === 'unavailable' ? (zh ? '整个区间缺少可用数据或无法解析，不能判断可见性。' : 'The interval lacks usable data or cannot be resolved; visibility is unknown.') : result.result.coverage === 'partial' ? (zh ? '部分区间缺测或无法解析；仅显示可判断的窗口。' : 'Some intervals lack data or are unresolved; only resolved windows are shown.') : (zh ? '所有采样点均可计算；短事件仍可能漏检。' : 'All sampled points are available; short events may still be missed.')}</p>
      {result.result.windows.length === 0 && result.result.coverage !== 'unavailable' && <p>{zh ? '已检查区间内未找到满足条件的窗口。' : 'No qualifying window was found in the examined intervals.'}</p>}
      {result.result.windows.map((v, i) => <p key={i} className="ground-window"><strong>{zh ? '窗口' : 'Window'} {i + 1}</strong><br /><time>{v.startUtc}</time><br />→ <time>{v.endUtc}</time><br />{(v.durationSeconds / 60).toFixed(2)} min{(v.startBoundary === 'coverage-gap' || v.endBoundary === 'coverage-gap') && (zh ? ' · 被数据缺口截断' : ' · clipped by a coverage gap')}</p>)}
      {result.result.crossings.length > 0 && <table><thead><tr><th>{zh ? '穿越' : 'Crossing'}</th><th>UTC</th></tr></thead><tbody>{result.result.crossings.map((v, i) => <tr key={i}><th>{labels[v.kind]}</th><td>{v.utc}</td></tr>)}</tbody></table>}
      {result.result.missing.map((v, i) => <p className="ground-window" key={i}>{zh ? '无法判断' : 'Unresolved'}: {v.startUtc} → {v.endUtc}<br />{v.reason}</p>)}
      <p>{result.result.warnings.includes('iers-predicted-earth-orientation') ? (zh ? 'IERS 含预测值' : 'IERS includes predictions') : 'IERS'} · {result.earthOrientation.retrievedAt}</p>
      {result.result.warnings.includes('celestial-pole-correction-unavailable-model-only') && <p>{zh ? '部分时刻缺少天极修正，采用岁差章动模型。' : 'Celestial pole corrections are missing at some instants; those use the precession-nutation model alone.'}</p>}
      {result.result.warnings.includes('solar-deflection-limited-near-solar-limb') && <p>{zh ? '部分方向接近日面，光偏折模型已限幅。' : 'Some directions approach the solar limb, where light deflection is limited.'}</p>}
      {result.result.warnings.includes('no-leap-seconds-after-2017-assumed') && <p>{zh ? '时间换算假定 2017 年后无新增闰秒。' : 'Time conversion assumes no additional leap seconds after 2017.'}</p>}
      <p>{zh ? '搜索步长 30 秒，已括定边界的数值容差 0.25 秒。短于步长的事件及相切可能漏检；容差不代表物理精度。未传播物理不确定性；不含折射、地形、天体边缘或大气消光。' : 'Search step: 30 s; bracketed boundary tolerance: 0.25 s. Sub-step events and tangencies may be missed; tolerance is not physical accuracy. Physical uncertainty is not propagated; refraction, terrain, target limbs and extinction are excluded.'}</p>
      <button type="button" onClick={() => { void saveTextExport(JSON.stringify(result, null, 2), `solar-visibility-${bodyId.replace(/[^\w-]/g, '_')}.json`, 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出窗口与来源 JSON' : 'Export windows and sources JSON'}</button>
    </section>}
  </details>
}
