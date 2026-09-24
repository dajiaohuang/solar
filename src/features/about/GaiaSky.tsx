import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import type { GaiaManifest, GaiaSource, streamGaiaChunks } from '../../lib/gaiaChunks'
import { saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { GaiaPlot, type GaiaDisplayBatch } from './GaiaPlot'
import capacity from '../../data/gaiaCapacity.json'
import { gaiaAstrometricCovariance } from '../../lib/gaiaAstrometricCovariance'
import { gaiaPositionUncertainty } from '../../lib/gaiaUncertainty'
import { validateGaiaLoadRequest, type GaiaLoadRequest, type GaiaWorkerResponse } from '../../workers/gaia.protocol'

type Summary = Awaited<ReturnType<typeof streamGaiaChunks>>
export function GaiaSky() {
  const { language } = useI18n(), zh = language === 'zh'
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [manifest, setManifest] = useState<GaiaManifest | null>(null), [manifestHash, setManifestHash] = useState('')
  const [originalManifest, setOriginalManifest] = useState<{ encoding: 'utf-8'; byteLength: number; text: string } | null>(null)
  const [batches, setBatches] = useState<GaiaDisplayBatch[]>([]), [summary, setSummary] = useState<Summary | null>(null)
  const [zoom, setZoom] = useState(1), [selected, setSelected] = useState(0), [count, setCount] = useState(0)
  const [source, setSource] = useState<GaiaSource | null>(null)
  const sixParameterCovariance = useMemo(() => source ? gaiaAstrometricCovariance(source,6) : null, [source])
  const astrometricCovariance = useMemo(() => source ? gaiaAstrometricCovariance(source) : null, [source])
  const uncertainty = useMemo(() => source ? gaiaPositionUncertainty(source) : null, [source])
  const worker = useRef<Worker | null>(null), generation = useRef(0), sources = useRef<GaiaSource[]>([])
  const idleWorker = useRef<Worker | null>(null)
  const uploadState = useRef<{ pending: number | null; acknowledged: number }>({ pending: null, acknowledged: 0 })
  const clear = useCallback(() => {
    generation.current++; worker.current?.terminate(); worker.current = null; sources.current = []
    uploadState.current = { pending: null, acknowledged: 0 }
    setOriginalManifest(null)
    setBusy(false); setError(''); setManifest(null); setManifestHash(''); setBatches([]); setSummary(null); setZoom(1); setSelected(0); setCount(0); setSource(null)
  }, [])
  const fail = useCallback((message: string) => { clear(); setError(message) }, [clear])
  const chartGeneration = generation.current
  const uploaded = useCallback((sequence: number) => {
    if (generation.current !== chartGeneration || !worker.current) return
    const state = uploadState.current
    // Effect replay can upload retained batches again. It must not release a
    // different chunk's backpressure reservation.
    if (Number.isSafeInteger(sequence) && sequence > 0 && sequence <= state.acknowledged) return
    if (sequence !== state.pending) { fail('Gaia upload acknowledgement differs from pending chunk'); return }
    try {
      worker.current.postMessage({ type:'ack', sequence })
      state.acknowledged = sequence; state.pending = null
    } catch (error) { fail(String(error)) }
  }, [chartGeneration, fail])
  const chartError = useCallback((message: string) => {
    if (generation.current === chartGeneration) fail(message)
  }, [chartGeneration, fail])
  const select = (index: number) => {
    if (generation.current !== chartGeneration || !Number.isSafeInteger(index) || index < 0 || index >= sources.current.length) return
    setSelected(index); setSource(sources.current[index])
  }
  useEffect(() => () => { generation.current++; worker.current?.terminate(); idleWorker.current?.terminate() }, [])
  const run = (input: GaiaLoadRequest) => {
    clear()
    try {
      const request = validateGaiaLoadRequest(input)
      const active = idleWorker.current ?? new Worker(new URL('../../workers/gaia.worker.ts', import.meta.url), { type:'module' })
      idleWorker.current = null
      worker.current = active; setBusy(true)
      let receivedManifest: GaiaManifest | null = null, lastSequence = 0, expectedBytes = 0
      const expectedChunks = new Map<string, number>(), receivedChunks = new Set<string>()
      const onMessage = (event: MessageEvent) => {
        if (worker.current !== active) return
        const message = event.data as GaiaWorkerResponse
        if (!message || typeof message !== 'object' || !['manifest','chunk','done','error'].includes(message.type)) {
          fail('Invalid Gaia worker response'); return
        }
        if (message.type === 'manifest') {
          const next = message.manifest as GaiaManifest | undefined
          if (receivedManifest || !next || !Number.isSafeInteger(next.rows) || next.rows < 0 || next.rows > capacity.maxCatalogRows ||
              !Array.isArray(next.chunks) || next.chunks.length > capacity.maxChunks ||
              typeof message.originalManifestJson !== 'string' || message.originalManifestJson.length > 1024*1024 ||
              !Number.isSafeInteger(message.manifestBytes) || message.manifestBytes < 1 || message.manifestBytes > 1024*1024 ||
              new TextEncoder().encode(message.originalManifestJson).byteLength !== message.manifestBytes ||
              typeof message.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(message.manifestSha256)) {
            fail('Invalid Gaia manifest response'); return
          }
          let rows = 0
          for (const chunk of next.chunks) {
            if (!chunk || typeof chunk.path !== 'string' || expectedChunks.has(chunk.path) ||
                !Number.isSafeInteger(chunk.rows) || chunk.rows < 1 || chunk.rows > capacity.maxChunkRows ||
                !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > capacity.maxChunkBytes) {
              fail('Invalid Gaia manifest chunk counts'); return
            }
            expectedChunks.set(chunk.path, chunk.rows); rows += chunk.rows; expectedBytes += chunk.bytes
          }
          if (rows !== next.rows) { fail('Gaia manifest response row count mismatch'); return }
          receivedManifest = next; setManifest(next); setManifestHash(message.manifestSha256)
          setOriginalManifest({ encoding: 'utf-8', byteLength: message.manifestBytes, text: message.originalManifestJson })
        }
        else if (message.type === 'chunk') {
          if (!receivedManifest || uploadState.current.pending !== null || message.sequence !== lastSequence+1 || !expectedChunks.has(message.path) || receivedChunks.has(message.path) ||
              !Array.isArray(message.sources) || message.sources.length !== expectedChunks.get(message.path) ||
              sources.current.length+message.sources.length > receivedManifest.rows ||
              !(message.display instanceof Float32Array) || message.display.length !== message.sources.length*3 || !message.display.every(Number.isFinite)) {
            fail('Gaia chunk response exceeds or differs from its manifest'); return
          }
          lastSequence = message.sequence; receivedChunks.add(message.path)
          uploadState.current.pending = message.sequence
          if (!sources.current.length) setSource(message.sources[0] ?? null)
          sources.current.push(...message.sources); setCount(sources.current.length)
          setBatches(previous => [...previous, { sequence:message.sequence, display:message.display }])
        } else if (message.type === 'done') {
          const complete = message.summary as Summary | undefined
          if (!receivedManifest || uploadState.current.pending !== null || uploadState.current.acknowledged !== lastSequence ||
              receivedChunks.size !== expectedChunks.size || sources.current.length !== receivedManifest.rows ||
              !complete || complete.verifiedRows !== sources.current.length || complete.verifiedChunks !== receivedChunks.size ||
              complete.totalBytes !== expectedBytes ||
              ![complete.cacheHits, complete.cacheHitBytes, complete.sourceReadChunks, complete.sourceReadBytes].every(value => Number.isSafeInteger(value) && value >= 0) ||
              complete.cacheHits+complete.sourceReadChunks !== receivedChunks.size || complete.cacheHitBytes+complete.sourceReadBytes !== expectedBytes ||
              complete.sourceReadSemantics !== 'verified-chunk-source-bytes-excluding-manifest-and-transport-overhead' ||
              complete.selectedChunks !== expectedChunks.size || complete.catalogCompletenessCertified !== false || complete.epochJulianYear !== 2016 ||
              !complete.selection || complete.selection.allManifestChunksVerified !== true || complete.selection.omittedManifestChunks !== 0 ||
              !Array.isArray(complete.selection.selectedPaths) || complete.selection.selectedPaths.length !== expectedChunks.size ||
              new Set(complete.selection.selectedPaths).size !== expectedChunks.size || complete.selection.selectedPaths.some(path => !receivedChunks.has(path))) {
            fail('Gaia completion response differs from received chunks'); return
          }
          active.removeEventListener('message',onMessage); active.removeEventListener('error',onError)
          active.removeEventListener('messageerror',onMessageError)
          idleWorker.current = active; worker.current = null; setBusy(false); setSummary(message.summary)
        }
        else if (message.type === 'error') fail(message.error)
      }
      const onError = (event: ErrorEvent) => { if (worker.current === active) fail(event.message || 'Gaia worker failed') }
      const onMessageError = () => { if (worker.current === active) fail('Gaia worker response could not be decoded') }
      active.addEventListener('message',onMessage); active.addEventListener('error',onError)
      active.addEventListener('messageerror',onMessageError)
      active.postMessage(request)
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
          <GaiaPlot key={chartGeneration} capacity={manifest.rows} batches={batches} zoom={zoom} onUploaded={uploaded} onError={chartError} onSelect={select} />
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
        <div data-testid="gaia-astrometric-covariance"><p>{zh ? '五参数形式协方差 · J2016.0' : 'Five-parameter formal covariance · J2016.0'}</p><p>{astrometricCovariance?.available ? (zh ? '5 × 5 边缘矩阵已验证，可随来源导出；未传播历元，未含系统误差或伪颜色。' : 'Validated 5 × 5 marginal available in export; no epoch propagation, systematics or pseudocolour.') : (zh ? '完整有效的五参数协方差不可用：' : 'Valid joint five-parameter covariance unavailable: ') + (astrometricCovariance?.reason ?? 'no-source')}</p></div>
        <div data-testid="gaia-six-parameter-covariance"><p>{zh ? '六参数形式协方差（含伪颜色）' : 'Six-parameter formal covariance (including pseudocolour)'}</p><p>{sixParameterCovariance?.available ? (zh ? '6 × 6 矩阵已验证，可随来源导出；第六维是伪颜色，不是径向速度。' : 'Validated 6 × 6 matrix available in export; the sixth coordinate is pseudocolour, not radial velocity.') : (zh ? '六参数协方差不可用：' : 'Six-parameter covariance unavailable: ') + (sixParameterCovariance?.reason ?? 'no-source')}</p></div>
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
        <p>{summary.selection.allManifestChunksVerified
          ? (zh ? '已校验此清单的全部分块；不代表覆盖全天或完整星表。' : 'All chunks in this manifest were verified; this does not establish whole-sky or catalog completeness.')
          : (zh ? '仅校验与筛选天区相交的分块；未检查其余分块。' : 'Only intersecting chunks were verified; omitted chunks were not inspected.')}</p>
        <button className="secondary-button" onClick={() => { const exportGeneration = generation.current; void saveTextExport(JSON.stringify({ manifest, manifestSha256:manifestHash, originalManifest, summary, build:BUILD_INFO, projection:'gnomonic-display-only', selectedSixParameterCovariance:source ? {sourceId:source.source_id,...sixParameterCovariance} : null, selectedAstrometricCovariance:source ? {sourceId:source.source_id,...astrometricCovariance} : null, selectedPositionUncertainty:source ? {sourceId:source.source_id,...uncertainty} : null, sources:sources.current },null,2),'solar-gaia-sky.json','application/json').catch(error => { if (exportGeneration === generation.current) setError(String(error)) }) }}>{zh ? '导出 Gaia 记录与来源' : 'Export Gaia records and sources'}</button>
      </div>}
      <p>{zh ? '未应用自行传播、观测者视差、光行差、偏折或视差零点改正。星等筛选不是完整性保证；GPU 显示精度不是科学测量精度。' : 'No proper-motion propagation, observer parallax, aberration, deflection or parallax zero-point correction is applied. Magnitude selection is not a completeness guarantee; GPU display precision is not scientific measurement accuracy.'}</p>
      <p className="checksum">SHA-256 {manifestHash}</p>
    </>}
  </section>
}
