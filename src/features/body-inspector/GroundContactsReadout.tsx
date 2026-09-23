import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { loadGroundContacts, type GroundContacts, type GroundContactRequest } from '../../lib/groundContacts'
import type { GroundStation } from '../../lib/groundObservation'
import { saveTextExport } from '../../lib/platform'
import { PRODUCT_PROFILE } from '../../lib/productAvailability'

export function GroundContactsReadout({ startUtc, station, base }: { startUtc: string; station: GroundStation; base: string }) {
  const { language } = useI18n(), zh = language === 'zh'
  const [endUtc, setEndUtc] = useState(() => { const t = Date.parse(startUtc); return Number.isFinite(t) ? new Date(t+4*3600_000).toISOString() : '' })
  const [foreground, setForeground] = useState('301'), [background, setBackground] = useState('10')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<GroundContacts | null>(null)
  const active = useRef<AbortController | null>(null)
  const clear = () => { active.current?.abort(); active.current = null; setBusy(false); setResult(null); setError('') }
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  const run = async () => {
    clear()
    const controller = new AbortController(); active.current = controller; setBusy(true)
    const request: GroundContactRequest = { startUtc, endUtc, station, foregroundId: Number(foreground), backgroundId: Number(background), aberration: 'CN' }
    try {
      const response = await loadGroundContacts(base, PRODUCT_PROFILE, request, controller.signal)
      if (active.current === controller) setResult(response)
    } catch (reason) { if (active.current === controller) setError(`${zh ? '接触搜索失败' : 'Contact search failed'}: ${reason instanceof Error ? reason.message : String(reason)}`) }
    finally { if (active.current === controller) { active.current = null; setBusy(false) } }
  }
  const label = (boundary: 'external' | 'internal') => boundary === 'external' ? (zh ? '外接触' : 'External contact') : (zh ? '内接触' : 'Internal contact')
  const direction = { enter: zh ? '进入' : 'Enter', exit: zh ? '离开' : 'Exit', 'sampled-zero': zh ? '采样零值' : 'Sampled zero' }
  return <details className="ground-contacts">
    <summary>{zh ? '地面掩星与凌日接触' : 'Ground occultation and transit contacts'}</summary>
    <p>{zh ? '使用上方站点与 UTC 起点。默认搜索月球与太阳的接触，也可输入其他 NAIF 目标编号；仅支持 PCK 中有来源的等轴球体。' : 'Uses the station and UTC start above. The default pair is Moon and Sun; other NAIF target IDs can be entered. Only sourced equal-axis PCK spheres are supported.'}</p>
    <form onSubmit={event => { event.preventDefault(); void run() }}>
      <label>{zh ? '接触搜索结束 UTC' : 'Contact search end UTC'}<input required value={endUtc} onChange={event => { clear(); setEndUtc(event.target.value) }} /></label>
      <label>{zh ? '前景 NAIF 编号（月球 301，金星 299）' : 'Foreground NAIF ID (Moon 301, Venus 299)'}<input required type="number" min="1" step="1" value={foreground} onChange={event => { clear(); setForeground(event.target.value) }} /></label>
      <label>{zh ? '背景 NAIF 编号（太阳 10）' : 'Background NAIF ID (Sun 10)'}<input required type="number" min="1" step="1" value={background} onChange={event => { clear(); setBackground(event.target.value) }} /></label>
      <p>{zh ? '采用 CN 接收光行时与球形边缘，不含边缘光行差、引力偏折、地形或折射。接触可发生在地平线下，不能据此确认可见。' : 'Uses CN reception light time and spherical limbs, without limb aberration, gravitational deflection, terrain or refraction. Contacts can occur below the horizon; visibility is not certified.'}</p>
      <button className="primary-button" disabled={busy}>{busy ? (zh ? '搜索中…' : 'Searching…') : (zh ? '搜索地面接触' : 'Search ground contacts')}</button>
      {busy && <button type="button" onClick={clear}>{zh ? '取消地面接触搜索' : 'Cancel ground contact search'}</button>}
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <section aria-label={zh ? '地面接触结果' : 'Ground contact result'}>
      <p role="status">{zh ? '按采样符号搜索；短事件和擦边接触仍可能漏检。' : 'Sampled sign-change search; short events and grazing contacts may be missed.'}</p>
      {result.result.contacts.map((contact, i) => <p className="ground-window" key={i}><strong>{label(contact.boundary)} · {direction[contact.direction]}</strong><br /><time>{contact.utc}</time><br />{zh ? '数值区间' : 'Numerical bracket'}:<br /><time>{contact.bracketUtc[0]}</time><br />→ <time>{contact.bracketUtc[1]}</time></p>)}
      {!result.result.contacts.length && <p>{zh ? '未找到接触不代表没有重叠；窗口可能位于事件内部。' : 'No contacts does not prove no overlap; the search may lie inside an event.'}</p>}
      {result.result.sampledOverlapWindows && <>
        <h4>{zh ? '采样推断的重叠区间' : 'Sample-inferred overlap windows'}</h4>
        <p>{zh ? '外边界表示圆盘重叠，内边界表示一个圆盘完全包含于另一个。搜索边界处截断；未采样间隙仍可能将区间分开。' : 'External spans indicate disk overlap; internal spans indicate one disk contained inside the other. Search-boundary edges are clipped; unsampled gaps may split these spans.'}</p>
        {result.result.sampledOverlapWindows.map((span, i) => <p className="ground-window" key={i}>
          <strong>{span.boundary === 'external' ? (zh ? '圆盘重叠' : 'Disk overlap') : (zh ? '圆盘包含' : 'Disk containment')}</strong><br />
          <time>{span.start.utc}</time><br />→ <time>{span.end.utc}</time><br />
          {span.durationSeconds.toFixed(3)} s · {zh ? '数值持续时间范围' : 'Numerical duration bounds'}: {span.numericalDurationBoundsSeconds.map(n => n.toFixed(3)).join(' – ')} s<br />
          {zh ? '边缘类型' : 'Edge kinds'}: {span.start.kind} / {span.end.kind}
        </p>)}
        {!result.result.sampledOverlapWindows.length && <p>{zh ? '没有推断出正时长的重叠区间。' : 'No positive-duration overlap inferred.'}</p>}
      </>}
      <p>{zh ? '起点 / 终点几何类型' : 'Start / end geometry'}: {result.result.startGeometry.classification} / {result.result.endGeometry.classification}</p>
      <p>{result.result.evaluations} {zh ? '次几何求值' : 'geometry evaluations'} · IERS {result.result.earthOrientation.retrievedAt}</p>
      <p>{zh ? '最大窗口 86401 秒，扫描步长 30 秒，根区间容差 0.05 秒。物理时间不确定性未知；容差不是物理精度。' : 'Maximum window 86401 s; scan step 30 s; root tolerance 0.05 s. Physical timing uncertainty is unknown; tolerance is not physical accuracy.'}</p>
      {result.result.warnings.includes('iers-predicted-earth-orientation') && <p>{zh ? 'IERS 含预测值。' : 'IERS includes predictions.'}</p>}
      <button type="button" onClick={() => { void saveTextExport(JSON.stringify(result, null, 2), 'solar-ground-contacts.json', 'application/json').catch(reason => setError(String(reason))) }}>{zh ? '导出地面接触与来源 JSON' : 'Export ground contacts and sources JSON'}</button>
    </section>}
  </details>
}
