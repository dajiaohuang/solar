import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import type { GaiaManifest, GaiaSource, streamGaiaChunks } from '../../lib/gaiaChunks'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { GaiaPlot, type GaiaDisplayBatch } from './GaiaPlot'
import { gaiaPositionUncertainty } from '../../lib/gaiaUncertainty'

type Summary = Awaited<ReturnType<typeof streamGaiaChunks>>
export function GaiaSky() {
  const { language } = useI18n(), zh = language === 'zh'
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [manifest, setManifest] = useState<GaiaManifest | null>(null), [manifestHash, setManifestHash] = useState('')
  const [batches, setBatches] = useState<GaiaDisplayBatch[]>([]), [summary, setSummary] = useState<Summary | null>(null)
  const [zoom, setZoom] = useState(1), [selected, setSelected] = useState(0), [count, setCount] = useState(0)
  const [source, setSource] = useState<GaiaSource | null>(null)
  const uncertainty = source ? gaiaPositionUncertainty(source) : null
  const worker = useRef<Worker | null>(null), generation = useRef(0), sources = useRef<GaiaSource[]>([])
  const idleWorker = useRef<Worker | null>(null)
  const clear = useCallback(() => {
    generation.current++; worker.current?.terminate(); worker.current = null; sources.current = []
    setBusy(false); setError(''); setManifest(null); setManifestHash(''); setBatches([]); setSummary(null); setZoom(1); setSelected(0); setCount(0); setSource(null)
  }, [])
  const fail = useCallback((message: string) => { clear(); setError(message) }, [clear])
  const uploaded = useCallback((sequence: number) => { worker.current?.postMessage({ type:'ack', sequence }) }, [])
  const select = (index: number) => { setSelected(index); setSource(sources.current[index]) }
  useEffect(() => () => { generation.current++; worker.current?.terminate(); idleWorker.current?.terminate() }, [])
  const run = (input: { files: File[] } | { manifestUrl: string }) => {
    clear()
    try {
      const active = idleWorker.current ?? new Worker(new URL('../../workers/gaia.worker.ts', import.meta.url), { type:'module' })
      idleWorker.current = null
      worker.current = active; setBusy(true)
      const onMessage = (event: MessageEvent) => {
        if (worker.current !== active) return
        const message = event.data
        if (message.type === 'manifest') { setManifest(message.manifest); setManifestHash(message.manifestSha256) }
        else if (message.type === 'chunk') {
          if (!sources.current.length) setSource(message.sources[0] ?? null)
          sources.current.push(...message.sources); setCount(sources.current.length)
          setBatches(previous => [...previous, { sequence:message.sequence, display:message.display }])
        } else if (message.type === 'done') {
          active.removeEventListener('message',onMessage); active.removeEventListener('error',onError)
          idleWorker.current = active; worker.current = null; setBusy(false); setSummary(message.summary)
        }
        else if (message.type === 'error') fail(message.error)
      }
      const onError = (event: ErrorEvent) => { if (worker.current === active) fail(event.message || 'Gaia worker failed') }
      active.addEventListener('message',onMessage); active.addEventListener('error',onError)
      active.postMessage(input)
    } catch (error) { fail(String(error)) }
  }
  const example = async () => {
    clear(); const token = generation.current
    try {
      const [m,c] = await Promise.all([import('../../../tests/fixtures/gaia-pleiades-20260923/manifest.json?raw'), import('../../../tests/fixtures/gaia-pleiades-20260923/r11-d22.json?raw')])
      if (generation.current === token) run({ files:[new File([m.default],'manifest.json'),new File([c.default],'r11-d22.json')] })
    } catch (error) { if (generation.current === token) fail(String(error)) }
  }
  return <section className="evidence-module glass-panel gaia-sky" aria-label={zh ? 'Gaia 星图' : 'Gaia sky chart'}>
    <div className="module-heading"><span>{zh ? 'Gaia 星图' : 'Gaia sky chart'}</span><em>J2016.0 · ICRS</em></div>
    <p>{zh ? '检查 Gaia DR3 天区导入的恒星位置。图像固定于目录历元，不是当前地面天空，也不表示恒星距离。' : 'Inspect stellar positions from a Gaia DR3 cone import. The chart is fixed at the catalog epoch; it is not the current ground sky and does not represent stellar distances.'}</p>
    <button className="secondary-button" onClick={() => void example()}>{zh ? '打开昴星团附近示例' : 'Open Pleiades-area example'}</button>
    <label className="field"><span>{zh ? 'Gaia 清单及分块 JSON 文件' : 'Gaia manifest and chunk JSON files'}</span><input type="file" multiple accept=".json,application/json" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) run({ files }) }} /></label>
    <form onSubmit={event => { event.preventDefault(); run({ manifestUrl:url }) }}>
      <label className="field"><span>{zh ? 'Gaia 清单地址' : 'Gaia manifest URL'}</span><input type="url" required value={url} placeholder="https://…/manifest.json" onChange={event => { clear(); setUrl(event.target.value) }} /></label>
      <button className="secondary-button" disabled={busy}>{zh ? '加载天区' : 'Load sky region'}</button>
    </form>
    {busy && <><p role="status">{zh ? '正在校验和绘制，尚未完整加载' : 'Verifying and drawing; load is not complete'} · {count}</p><button onClick={clear}>{zh ? '取消 Gaia 加载' : 'Cancel Gaia loading'}</button></>}
    {error && <p role="alert">{error}</p>}
    {manifest && <>
      <figure style={{ margin:'1rem 0' }}>
        <div style={{ position:'relative', border:'1px solid #28485b', overflow:'hidden' }}>
          <GaiaPlot capacity={manifest.rows} batches={batches} zoom={zoom} onUploaded={uploaded} onError={fail} onSelect={select} />
          <div aria-hidden="true" style={{ position:'absolute', inset:0, pointerEvents:'none', background:'linear-gradient(transparent calc(50% - .5px),#28485b88 50%,transparent calc(50% + .5px)),linear-gradient(90deg,transparent calc(50% - .5px),#28485b88 50%,transparent calc(50% + .5px))' }} />
          <span style={{ position:'absolute', top:8, left:'50%', color:'#96b4c5', pointerEvents:'none' }}>{zh ? '北' : 'N'}</span>
          <span style={{ position:'absolute', left:8, top:'50%', color:'#96b4c5', pointerEvents:'none' }}>{zh ? '东' : 'E'}</span>
        </div>
        <figcaption>{zh ? '图心' : 'Center'}: {manifest.settings.raDeg}°, {manifest.settings.decDeg}° · {zh ? '目录锥半径' : 'Catalog cone radius'} {manifest.settings.radiusDeg}°</figcaption>
      </figure>
      <label className="field"><span>{zh ? '星图缩放' : 'Chart zoom'} · {zoom.toFixed(1)}×</span><input type="range" min="1" max="8" step="0.1" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
      <p>{zh ? '点击恒星查看原始数值，或用序号选择。点大小仅用于区分星等，不是测量的角直径。' : 'Select a star on the chart or by row number. Point sizes distinguish magnitudes visually; they are not measured angular diameters.'}</p>
      {source && <div>
        <label className="field"><span>{zh ? '恒星序号' : 'Star row'}</span><input type="number" min="1" max={count} value={selected+1} onChange={event => { const i = Number(event.target.value)-1; if (Number.isInteger(i) && i >= 0 && i < count) select(i) }} /></label>
        <p className="checksum">Gaia DR3 {source.source_id}</p>
        <dl className="contract-list"><div><dt>RA / Dec</dt><dd>{source.ra.toFixed(9)}° / {source.dec.toFixed(9)}°</dd></div><div><dt>G</dt><dd>{source.phot_g_mean_mag}</dd></div><div><dt>{zh ? '视差（mas）' : 'Parallax (mas)'}</dt><dd>{source.parallax ?? '—'}</dd></div></dl>
        <div data-testid="gaia-position-uncertainty">
          <p>{zh ? '目录位置形式误差 · J2016.0' : 'Catalog formal position uncertainty · J2016.0'}</p>
          {uncertainty?.available ? <>
            <p>{zh ? '长 / 短半轴' : 'Major / minor semiaxes'}: {uncertainty.majorMas.toPrecision(6)} / {uncertainty.minorMas.toPrecision(6)} mas</p>
            <p>{zh ? '长轴方向（从东向北）' : 'Major-axis angle (east toward north)'}: {uncertainty.majorAxisDegreesFromEastTowardNorth === null ? '—' : uncertainty.majorAxisDegreesFromEastTowardNorth.toFixed(3)+'°'}</p>
          </> : <p>{zh ? '缺少有效位置误差数据，未计算椭圆。' : 'No ellipse computed: valid positional uncertainty is unavailable.'}</p>}
          <p>{zh ? '使用 Δα cosδ 与 Δδ 的相关误差；单位马氏距离轮廓不是 68% 联合置信区域。不含系统误差或历元传播，不代表掩星时间精度。' : 'Uses correlated Δα cosδ and Δδ errors. The unit-Mahalanobis contour is not a 68% joint confidence region. No systematics or epoch propagation; it does not certify occultation timing.'}</p>
        </div>
      </div>}
      {summary && <div data-testid="gaia-complete"><p>{summary.verifiedRows} {zh ? '条来源记录已加载' : 'source records loaded'} · {summary.verifiedChunks} {zh ? '个分块' : 'chunks'}</p>
        <button className="secondary-button" onClick={() => { void saveTextExport(JSON.stringify({ manifest, manifestSha256:manifestHash, summary, build:BUILD_INFO, projection:'gnomonic-display-only', selectedPositionUncertainty:source ? {sourceId:source.source_id,...uncertainty} : null, sources:sources.current },null,2),'solar-gaia-sky.json','application/json').catch(error => setError(String(error))) }}>{zh ? '导出 Gaia 记录与来源' : 'Export Gaia records and sources'}</button>
      </div>}
      <p>{zh ? '未应用自行传播、观测者视差、光行差、偏折或视差零点改正。星等筛选不是完整性保证；GPU 显示精度不是科学测量精度。' : 'No proper-motion propagation, observer parallax, aberration, deflection or parallax zero-point correction is applied. Magnitude selection is not a completeness guarantee; GPU display precision is not scientific measurement accuracy.'}</p>
      <p className="checksum">SHA-256 {manifestHash}</p>
    </>}
  </section>
}
