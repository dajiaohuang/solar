import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/context'
import type { GaiaManifest, GaiaSource } from '../../lib/gaiaChunks'
import { saveJsonArrayExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { GaiaPlot, type GaiaDisplayBatch } from './GaiaPlot'
import capacity from '../../data/gaiaCapacity.json'
import { planGaiaCollection, type GaiaCollectionPlan } from '../../lib/gaiaCollection'
import { GaiaSourceStore, gaiaNumericFieldCount, isGaiaPackedSourceBatch } from '../../lib/gaiaPackedSources'
import { gaiaAstrometricCovariance } from '../../lib/gaiaAstrometricCovariance'
import { gaiaPositionUncertainty } from '../../lib/gaiaUncertainty'
import { GAIA_UPLOAD_MAX_ROWS, GAIA_UPLOAD_SLOTS, validateGaiaLoadRequest, type GaiaLoadRequest, type GaiaWorkerResponse } from '../../workers/gaia.protocol'

type Summary = Extract<GaiaWorkerResponse, { type: 'done' }>['summary']
type RegionRecord = Extract<GaiaWorkerResponse, { type: 'manifest' }>['regions'][number]
export function GaiaSky() {
  const { language, t } = useI18n(), zh = language === 'zh'
  const fmt = (value: number) => value.toLocaleString(zh ? 'zh-CN' : 'en-US')
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [manifests, setManifests] = useState<GaiaManifest[] | null>(null), [manifestHashes, setManifestHashes] = useState<string[]>([])
  const [originalManifests, setOriginalManifests] = useState<{ encoding: 'utf-8'; byteLength: number; text: string }[]>([])
  const [regionSources, setRegionSources] = useState<RegionRecord['source'][]>([])
  const [projection, setProjection] = useState<{ centerRaDeg: number; centerDecDeg: number; radiusDeg: number } | null>(null)
  // Worker uploads use bounded slots and an aggregate input-row window. Each
  // append is published without cloning the accumulated display-batch list.
  const batches = useRef<GaiaDisplayBatch[]>([])
  const [batchVersion, setBatchVersion] = useState(0)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [zoom, setZoom] = useState(1), [selected, setSelected] = useState(0), [count, setCount] = useState(0), [drawnCount, setDrawnCount] = useState(0)
  const [source, setSource] = useState<GaiaSource | null>(null)
  const [chartGeneration, setChartGeneration] = useState(0)
  const sixParameterCovariance = useMemo(() => source ? gaiaAstrometricCovariance(source,6) : null, [source])
  const astrometricCovariance = useMemo(() => source ? gaiaAstrometricCovariance(source) : null, [source])
  const uncertainty = useMemo(() => source ? gaiaPositionUncertainty(source) : null, [source])
  const worker = useRef<Worker | null>(null), generation = useRef(0), sourceStore = useRef<GaiaSourceStore | null>(null)
  const idleWorker = useRef<Worker | null>(null)
  const uploadState = useRef<{ pending: Map<number, number>; pendingRows: number; acknowledged: number; acknowledgedOutOfOrder: Set<number> }>(
    { pending: new Map(), pendingRows: 0, acknowledged: 0, acknowledgedOutOfOrder: new Set() },
  )
  const clear = useCallback(() => {
    generation.current++
    setChartGeneration(generation.current)
    worker.current?.terminate(); worker.current = null; sourceStore.current = null
    uploadState.current = { pending: new Map(), pendingRows: 0, acknowledged: 0, acknowledgedOutOfOrder: new Set() }
    setOriginalManifests([]); setRegionSources([]); setProjection(null)
    batches.current = []
    setBatchVersion(0)
    setBusy(false); setError(''); setManifests(null); setManifestHashes([]); setSummary(null); setZoom(1); setSelected(0); setCount(0); setDrawnCount(0); setSource(null)
  }, [])
  const fail = useCallback((message: string) => { clear(); setError(message) }, [clear])
  const acknowledgeUpload = useCallback((sequence: number, active: Worker) => {
    if (worker.current !== active) return
    const state = uploadState.current
    // A replayed or already-released sequence cannot consume another credit.
    if (!Number.isSafeInteger(sequence) || sequence < 1) { fail('Invalid Gaia upload acknowledgement sequence'); return }
    if (sequence <= state.acknowledged || state.acknowledgedOutOfOrder.has(sequence)) return
    const rows = state.pending.get(sequence)
    if (rows === undefined || rows < 1 || rows > state.pendingRows) { fail('Gaia upload acknowledgement differs from pending chunks'); return }
    try {
      active.postMessage({ type:'ack', sequence })
      state.pending.delete(sequence)
      state.pendingRows -= rows
      state.acknowledgedOutOfOrder.add(sequence)
      while (state.acknowledgedOutOfOrder.delete(state.acknowledged + 1)) state.acknowledged++
    } catch (error) { fail(String(error)) }
  }, [fail])
  const uploaded = useCallback((sequence: number) => {
    if (generation.current !== chartGeneration || !worker.current) return
    acknowledgeUpload(sequence, worker.current)
  }, [acknowledgeUpload, chartGeneration])
  const presented = useCallback((rows: number) => {
    if (generation.current === chartGeneration) setDrawnCount(rows)
  }, [chartGeneration])
  const chartError = useCallback((message: string) => {
    if (generation.current === chartGeneration) fail(message)
  }, [chartGeneration, fail])
  const select = (index: number) => {
    const store = sourceStore.current
    if (generation.current !== chartGeneration || !Number.isSafeInteger(index) || !store || index < 0 || index >= store.length) return
    setSelected(index); setSource(store.get(index))
  }
  useEffect(() => () => { generation.current++; worker.current?.terminate(); idleWorker.current?.terminate() }, [])
  const run = (input: GaiaLoadRequest) => {
    clear()
    try {
      const request = validateGaiaLoadRequest(input)
      const active = idleWorker.current ?? new Worker(new URL('../../workers/gaia.worker.ts', import.meta.url), { type:'module' })
      idleWorker.current = null
      worker.current = active; setBusy(true)
      let receivedRegions: RegionRecord[] | null = null, aggregatePlan: GaiaCollectionPlan | undefined
      let lastSequence = 0, expectedBytes = 0, receivedDuplicateRows = 0
      const expectedChunks = new Map<string, number>(), receivedChunks = new Set<string>()
      const onMessage = (event: MessageEvent) => {
        if (worker.current !== active) return
        const message = event.data as GaiaWorkerResponse
        if (!message || typeof message !== 'object' || !['manifest','chunk','done','error'].includes(message.type)) {
          fail('Invalid Gaia worker response'); return
        }
        if (message.type === 'manifest') {
          if (receivedRegions || !Array.isArray(message.regions) || message.regions.length < 1 || message.regions.length > capacity.maxCatalogsPerChart ||
              !Number.isSafeInteger(message.totalManifestBytes) || message.totalManifestBytes < 1 || message.totalManifestBytes > capacity.maxCollectionManifestBytes ||
              !Number.isSafeInteger(message.declaredRows) || message.declaredRows < 0 || message.declaredRows > capacity.maxChartRows ||
              !Number.isSafeInteger(message.selectedBytes) || message.selectedBytes < 0 || message.selectedBytes > capacity.maxSelectedBytes ||
              !Number.isSafeInteger(message.chunkCount) || message.chunkCount < 0 || message.chunkCount > capacity.maxChunks ||
              !message.regions.every(region => region && typeof region === 'object' &&
                typeof region.originalManifestJson === 'string' && region.originalManifestJson.length <= capacity.maxManifestBytes &&
                Number.isSafeInteger(region.manifestBytes) && region.manifestBytes > 0 && region.manifestBytes <= capacity.maxManifestBytes &&
                new TextEncoder().encode(region.originalManifestJson).byteLength === region.manifestBytes &&
                typeof region.manifestSha256 === 'string' && /^[a-f0-9]{64}$/.test(region.manifestSha256) &&
                ((region.source?.kind === 'remote-url' && typeof region.source.url === 'string' && (region.source.url.startsWith('https://') || region.source.url.startsWith('http://')) && region.source.url.length <= 2048) ||
                  (region.source?.kind === 'local-files' && Array.isArray(region.source.files) && region.source.files.length > 0 && region.source.files.length <= capacity.maxChunks+1 &&
                    region.source.files.every(name => typeof name === 'string' && name.length > 0 && name.length <= 255) && new Set(region.source.files).size === region.source.files.length)))) {
            fail('Invalid Gaia manifest response'); return
          }
          let plan: GaiaCollectionPlan
          try { plan = planGaiaCollection(message.regions.map(region => region.manifest)) }
          catch (error) { fail(String(error)); return }
          const totalManifestBytes = message.regions.reduce((sum, region) => sum + region.manifestBytes, 0)
          if (plan.declaredRows !== message.declaredRows || plan.selectedBytes !== message.selectedBytes || plan.chunkCount !== message.chunkCount ||
              totalManifestBytes !== message.totalManifestBytes || message.projection?.centerRaDeg !== plan.projection.centerRaDeg ||
              message.projection.centerDecDeg !== plan.projection.centerDecDeg || message.projection.radiusDeg !== plan.projection.radiusDeg) {
            fail('Gaia aggregate manifest metadata differs from its validated budget'); return
          }
          for (let catalogIndex = 0; catalogIndex < plan.manifests.length; catalogIndex++) {
            for (const chunk of plan.manifests[catalogIndex].chunks) {
              const key = `${catalogIndex}:${chunk.path}`
              if (expectedChunks.has(key)) { fail('Duplicate Gaia chunk path within a region'); return }
              expectedChunks.set(key, chunk.rows)
            }
          }
          expectedBytes = plan.selectedBytes
          try { sourceStore.current = new GaiaSourceStore(plan.manifests[0].schemaVersion, plan.declaredRows) }
          catch (error) { fail(String(error)); return }
          receivedRegions = message.regions; aggregatePlan = plan
          setManifests(plan.manifests); setManifestHashes(message.regions.map(region => region.manifestSha256))
          setOriginalManifests(message.regions.map(region => ({ encoding: 'utf-8', byteLength: region.manifestBytes, text: region.originalManifestJson })))
          setRegionSources(message.regions.map(region => region.source))
          setProjection(plan.projection)
        }
        else if (message.type === 'chunk') {
          const store = sourceStore.current
          const chunkKey = `${message.catalogIndex}:${message.path}`, expectedRows = expectedChunks.get(chunkKey)
          // The active worker validates each Float32 value after writing it; keep
          // the UI boundary to payload shape checks instead of rescanning them.
          if (!receivedRegions || !aggregatePlan || message.sequence !== lastSequence+1 || expectedRows === undefined || receivedChunks.has(chunkKey) ||
              !Number.isSafeInteger(message.catalogIndex) || message.catalogIndex < 0 || message.catalogIndex >= receivedRegions.length ||
              message.inputRows !== expectedRows || !Number.isSafeInteger(message.duplicateRows) || message.duplicateRows < 0 || message.duplicateRows > expectedRows ||
              uploadState.current.pending.size >= GAIA_UPLOAD_SLOTS || uploadState.current.pendingRows + message.inputRows > GAIA_UPLOAD_MAX_ROWS ||
              !store || !message.sources || !Number.isSafeInteger(message.sources.rowCount) || message.sources.rowCount < 0 || message.sources.rowCount > expectedRows ||
              message.sources.rowCount + message.duplicateRows !== expectedRows ||
              !isGaiaPackedSourceBatch(message.sources, message.sources.rowCount, gaiaNumericFieldCount(aggregatePlan.manifests[0].schemaVersion)) ||
              store.length+message.sources.rowCount > aggregatePlan.declaredRows ||
              !(message.display instanceof Float32Array) || message.display.length !== message.sources.rowCount*3) {
            fail('Gaia chunk response exceeds or differs from its manifest'); return
          }
          lastSequence = message.sequence; receivedChunks.add(chunkKey); receivedDuplicateRows += message.duplicateRows
          uploadState.current.pending.set(message.sequence, message.inputRows)
          uploadState.current.pendingRows += message.inputRows
          if (message.sources.rowCount === 0) {
            acknowledgeUpload(message.sequence, active)
            return
          }
          const wasEmpty = store.length === 0
          try { store.append(message.sources) }
          catch (error) { fail(String(error)); return }
          if (wasEmpty && store.length) setSource(store.get(0))
          setCount(store.length)
          batches.current.push({ sequence:message.sequence, display:message.display })
          setBatchVersion(previous => previous + 1)
        } else if (message.type === 'done') {
          const complete = message.summary as Summary | undefined
          const storedRows = sourceStore.current?.length ?? -1
          if (!receivedRegions || !aggregatePlan || !complete || uploadState.current.pending.size !== 0 || uploadState.current.pendingRows !== 0 || uploadState.current.acknowledgedOutOfOrder.size !== 0 || uploadState.current.acknowledged !== lastSequence ||
              receivedChunks.size !== expectedChunks.size || storedRows !== complete.uniqueRows || complete.verifiedRows !== aggregatePlan.declaredRows ||
              complete.uniqueRows + complete.duplicateRows !== complete.verifiedRows || complete.duplicateRows !== receivedDuplicateRows ||
              complete.manifestCount !== receivedRegions.length || complete.deduplication !== 'first-manifest-order-by-gaia-source-id' ||
              !complete.loadingBudget || complete.loadingBudget.concurrency !== capacity.maxParallelChunks ||
              complete.loadingBudget.maxInFlightBytes !== capacity.defaultInFlightBytes || complete.loadingBudget.maxInFlightRows !== capacity.defaultInFlightRows ||
              complete.loadingBudget.maxTotalBytes !== capacity.maxSelectedBytes ||
              ![complete.peakActiveChunks,complete.peakReservedBytes,complete.peakReservedRows].every(value => Number.isSafeInteger(value) && value >= 0) ||
              complete.peakActiveChunks > capacity.maxParallelChunks || complete.peakReservedBytes > capacity.defaultInFlightBytes ||
              complete.peakReservedRows > capacity.defaultInFlightRows ||
              (complete.peakActiveChunks === 0) !== (complete.peakReservedRows === 0) ||
              !complete.uploadWindow || complete.uploadWindow.maxPendingChunks !== GAIA_UPLOAD_SLOTS || complete.uploadWindow.maxInputRows !== GAIA_UPLOAD_MAX_ROWS ||
              ![complete.uploadWindow.peakPendingChunks,complete.uploadWindow.peakPendingInputRows].every(value => Number.isSafeInteger(value) && value >= 0) ||
              complete.uploadWindow.peakPendingChunks > GAIA_UPLOAD_SLOTS || complete.uploadWindow.peakPendingInputRows > GAIA_UPLOAD_MAX_ROWS ||
              (complete.uploadWindow.peakPendingChunks === 0) !== (complete.uploadWindow.peakPendingInputRows === 0) ||
              complete.verifiedChunks !== receivedChunks.size ||
              complete.totalBytes !== expectedBytes ||
              ![complete.cacheHits, complete.cacheHitBytes, complete.sourceReadChunks, complete.sourceReadBytes].every(value => Number.isSafeInteger(value) && value >= 0) ||
              complete.cacheHits+complete.sourceReadChunks !== receivedChunks.size || complete.cacheHitBytes+complete.sourceReadBytes !== expectedBytes ||
              complete.sourceReadSemantics !== 'verified-chunk-source-bytes-excluding-manifest-and-transport-overhead' ||
              complete.selectedChunks !== expectedChunks.size || complete.catalogCompletenessCertified !== false || complete.epochJulianYear !== 2016 ||
              !complete.sourceReadWindow || complete.sourceReadWindow.maxConcurrentManifests < 1 ||
              complete.sourceReadWindow.maxConcurrentManifests > Math.min(capacity.maxCatalogsPerChart, receivedRegions.length) ||
              !Number.isSafeInteger(complete.sourceReadWindow.peakConcurrentManifests) || complete.sourceReadWindow.peakConcurrentManifests < 0 ||
              complete.sourceReadWindow.peakConcurrentManifests > complete.sourceReadWindow.maxConcurrentManifests ||
              (complete.sourceReadChunks === 0) !== (complete.sourceReadWindow.peakConcurrentManifests === 0) ||
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
  const example = async (extended = false) => {
    clear(); const token = generation.current
    try {
      const [m,c] = await Promise.all(extended
        ? [import('../../../tests/fixtures/gaia-six-20260923/manifest.json?raw'), import('../../../tests/fixtures/gaia-six-20260923/r11-d22.json?raw')]
        : [import('../../../tests/fixtures/gaia-pleiades-20260923/manifest.json?raw'), import('../../../tests/fixtures/gaia-pleiades-20260923/r11-d22.json?raw')])
      if (generation.current === token) run({ files:[new File([m.default],'manifest.json'),new File([c.default],'r11-d22.json')] })
    } catch (error) { if (generation.current === token) fail(String(error)) }
  }
  const loadPackagedRegion = (directory: string) => {
    const manifestUrl = new URL(`${import.meta.env.BASE_URL}data/gaia/${directory}/manifest.json`, window.location.href).href
    run({ manifestUrl })
  }
  const loadPackagedRegions = (directories: string[]) => {
    const manifestUrls = directories.map(directory => new URL(`${import.meta.env.BASE_URL}data/gaia/${directory}/manifest.json`, window.location.href).href)
    run({ manifestUrls })
  }
  const submitManifestUrls = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const manifestUrls = url.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    if (manifestUrls.length === 1) run({ manifestUrl: manifestUrls[0] })
    else run({ manifestUrls })
  }
  return <section className="evidence-module glass-panel gaia-sky" aria-label={zh ? 'Gaia 星图' : 'Gaia sky chart'}>
    <div className="module-heading"><span>{zh ? 'Gaia 星图' : 'Gaia sky chart'}</span><em>J2016.0 TCB · ICRS</em></div>
    <p>{zh ? '检查 Gaia DR3 天区导入的恒星位置。图像固定于目录历元，不是当前地面天空，也不表示恒星距离。' : 'Inspect stellar positions from a Gaia DR3 cone import. The chart is fixed at the catalog epoch; it is not the current ground sky and does not represent stellar distances.'}</p>
    <button className="secondary-button" onClick={() => void example()}>{zh ? '打开昴星团附近示例' : 'Open Pleiades-area example'}</button>
    <button className="secondary-button" onClick={() => void example(true)}>{zh ? '打开昴星团附近 94 星示例' : 'Open 94-star Pleiades-area example'}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('pleiades-ra55-dec25-r1-g17-20260923')}>{zh ? '加载 4,460 星真实天区' : 'Load real 4,460-star region'}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('pleiades-ra55-dec25-r1p5-g18-20260927')}>{zh ? '加载 16,966 星 · G≤18 · 1.5° 昴星团天区' : 'Load 16,966 stars · G≤18 · 1.5° Pleiades region'}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegions(['pleiades-ra55-dec25-r1-g17-20260923','pleiades-ra55-dec25-r1p5-g18-20260927'])}>{zh ? '合并两个昴星团清单 · 按 source_id 去重' : 'Combine both Pleiades manifests · deduplicate by source_id'}</button>
    <label className="field"><span>{zh ? 'Gaia 清单及分块 JSON 文件' : 'Gaia manifest and chunk JSON files'}</span><input type="file" multiple accept=".json,application/json" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) run({ files }) }} /></label>
    <button className="secondary-button" onClick={() => loadPackagedRegion('praesepe-ra130p1-dec19p67-r1-g18-20260927')}>{t('gaiaPraesepeRegion')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegions(['pleiades-ra55-dec25-r1-g17-20260923','pleiades-ra55-dec25-r1p5-g18-20260927','praesepe-ra130p1-dec19p67-r1-g18-20260927'])}>{t('gaiaPleiadesPraesepeCollection')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('orion-ra83p822-dec-5p391-r1-g18-recovered-20260927')}>{t('gaiaOrionRegion')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('galactic-center-ra266p4-dec-29-r0p35-g18-20260928')}>{t('gaiaGalacticCenterRegion')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('galactic-center-ra267p15-dec-29-r0p25-g18-20260928')}>{t('gaiaGalacticCenterEastRegion')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('galactic-center-ra267p7-dec-29-r0p2-g18-20260928')}>{t('gaiaGalacticCenterEastOuterRegion')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('gaia-inner-bulge-r0p15-g17-20260928')}>{t('gaiaInnerBulgeRegion')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegions(['galactic-center-ra266p4-dec-29-r0p35-g18-20260928','galactic-center-ra267p15-dec-29-r0p25-g18-20260928','galactic-center-ra267p7-dec-29-r0p2-g18-20260928','gaia-inner-bulge-r0p15-g17-20260928'])}>{t('gaiaGalacticCenterCollection')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('galactic-anticenter-ra86p4-dec29-r0p2-g18-20260928')}>{t('gaiaAntipodalComparisonRegion')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('galactic-anticenter-ra86p4-dec29-r0p4-g18-20260928')}>{t('gaiaAntipodalExpandedRegion')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegion('galactic-anticenter-ra86p4-dec29-r0p6-g18-20260928')}>{t('gaiaAntipodalWideRegion')}</button>
    <button className="secondary-button" onClick={() => loadPackagedRegions(['pleiades-ra55-dec25-r1-g17-20260923','pleiades-ra55-dec25-r1p5-g18-20260927','praesepe-ra130p1-dec19p67-r1-g18-20260927','orion-ra83p822-dec-5p391-r1-g18-recovered-20260927'])}>{t('gaiaPleiadesPraesepeOrionCollection')}</button>
    <form onSubmit={submitManifestUrls}>
      <label className="field"><span>{zh ? 'Gaia 清单地址（每行一个，最多 8 个）' : 'Gaia manifest URLs (one per line, up to 8)'}</span><textarea required rows={3} value={url} placeholder="https://…/manifest.json" onChange={event => { clear(); setUrl(event.target.value) }} /></label>
      <button className="secondary-button" disabled={busy}>{zh ? '加载天区集合' : 'Load sky-region collection'}</button>
    </form>
    {busy && <><p role="status">{zh ? '正在校验和绘制，尚未完整加载' : 'Verifying and drawing; load is not complete'} · {fmt(drawnCount)} / {fmt(count)} {zh ? '颗已绘制 / 已载入' : 'stars drawn / loaded'}</p><button onClick={clear}>{zh ? '取消 Gaia 加载' : 'Cancel Gaia loading'}</button></>}
    {error && <p role="alert">{error}</p>}
    {manifests && projection && <>
      <figure style={{ margin:'1rem 0' }}>
        <div style={{ position:'relative', border:'1px solid #28485b', overflow:'hidden' }}>
          <GaiaPlot key={chartGeneration} capacity={manifests.reduce((sum, item) => sum+item.rows, 0)} batchQueue={batches} batchVersion={batchVersion} zoom={zoom} onUploaded={uploaded} onPresented={presented} onError={chartError} onSelect={select} />
          <div aria-hidden="true" style={{ position:'absolute', inset:0, pointerEvents:'none', background:'linear-gradient(transparent calc(50% - .5px),#28485b88 50%,transparent calc(50% + .5px)),linear-gradient(90deg,transparent calc(50% - .5px),#28485b88 50%,transparent calc(50% + .5px))' }} />
          <span style={{ position:'absolute', top:8, left:'50%', color:'#96b4c5', pointerEvents:'none' }}>{zh ? '北' : 'N'}</span>
          <span style={{ position:'absolute', left:8, top:'50%', color:'#96b4c5', pointerEvents:'none' }}>{zh ? '东' : 'E'}</span>
        </div>
        <figcaption>{fmt(manifests.length)} {zh ? '个 Gaia 天区' : 'Gaia regions'} · {zh ? '共同 ICRS 切平面图心' : 'shared ICRS tangent-plane center'}: {projection.centerRaDeg.toFixed(4)}°, {projection.centerDecDeg.toFixed(4)}° · {zh ? '显示场半径' : 'display-field radius'} {projection.radiusDeg.toFixed(3)}°</figcaption>
      </figure>
      <label className="field"><span>{zh ? '星图缩放' : 'Chart zoom'} · {zoom.toFixed(1)}×</span><input type="range" min="1" max="8" step="0.1" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
      <p>{zh ? '点击恒星查看原始数值，或用序号选择。点大小仅用于区分星等，不是测量的角直径。' : 'Select a star on the chart or by row number. Point sizes distinguish magnitudes visually; they are not measured angular diameters.'}</p>
      {source && <div>
        <label className="field"><span>{zh ? '恒星序号' : 'Star row'}</span><input type="number" min="1" max={count} value={selected+1} onChange={event => { const i = Number(event.target.value)-1; if (Number.isInteger(i) && i >= 0 && i < count) select(i) }} /></label>
        <p className="checksum">Gaia DR3 {source.source_id}</p>
        <dl className="contract-list"><div><dt>RA / Dec</dt><dd>{source.ra.toFixed(9)}° / {source.dec.toFixed(9)}°</dd></div><div><dt>{zh ? 'G（Vega 星等）' : 'G (Vega mag)'}</dt><dd>{source.phot_g_mean_mag}</dd></div><div><dt>{zh ? '视差（mas）' : 'Parallax (mas)'}</dt><dd>{source.parallax ?? '—'}</dd></div></dl>
        <div data-testid="gaia-astrometric-covariance"><p>{zh ? '五参数形式协方差 · J2016.0' : 'Five-parameter formal covariance · J2016.0'}</p><p>{astrometricCovariance?.available ? (zh ? '5 × 5 边缘矩阵已验证，可随来源导出；未传播历元，未含系统误差或伪颜色。' : 'Validated 5 × 5 marginal available in export; no epoch propagation, systematics or pseudocolour.') : (zh ? '完整有效的五参数协方差不可用：' : 'Valid joint five-parameter covariance unavailable: ') + (astrometricCovariance?.reason ?? 'no-source')}</p></div>
        <div data-testid="gaia-six-parameter-covariance"><p>{zh ? '六参数形式协方差（含伪颜色）' : 'Six-parameter formal covariance (including pseudocolour)'}</p><p>{sixParameterCovariance?.available ? (zh ? '6 × 6 矩阵已验证，可随来源导出；第六维是伪颜色，不是径向速度。' : 'Validated 6 × 6 matrix available in export; the sixth coordinate is pseudocolour, not radial velocity.') : (zh ? '六参数协方差不可用：' : 'Six-parameter covariance unavailable: ') + (sixParameterCovariance?.reason ?? 'no-source')}</p></div>
        <p>{zh ? 'Gaia 的来源内参数相关系数是近似值：根据单个来源法方程估计时忽略了来源之间的相关性。本结果不含不同恒星之间的协方差。' : 'Gaia per-source correlations are approximate estimates from individual-source normal matrices that neglect between-source correlations; no cross-star covariance is included.'}</p>
        <div data-testid="gaia-position-uncertainty">
          <p>{zh ? '目录位置形式误差 · J2016.0' : 'Catalog formal position uncertainty · J2016.0'}</p>
          {uncertainty?.available ? <>
            <p>{zh ? '长 / 短半轴' : 'Major / minor semiaxes'}: {uncertainty.majorMas.toPrecision(6)} / {uncertainty.minorMas.toPrecision(6)} mas</p>
            <p>{zh ? '长轴方向（从东向北）' : 'Major-axis angle (east toward north)'}: {uncertainty.majorAxisDegreesFromEastTowardNorth === null ? '—' : uncertainty.majorAxisDegreesFromEastTowardNorth.toFixed(3)+'°'}</p>
          </> : <p>{zh ? '缺少有效位置误差数据，未计算椭圆。' : 'No ellipse computed: valid positional uncertainty is unavailable.'}</p>}
          <p>{zh ? '使用 Δα cosδ 与 Δδ 的相关误差；单位马氏距离轮廓不是 68% 联合置信区域。不含系统误差或历元传播，不代表掩星时间精度。' : 'Uses correlated Δα cosδ and Δδ errors. The unit-Mahalanobis contour is not a 68% joint confidence region. No systematics or epoch propagation; it does not certify occultation timing.'}</p>
        </div>
      </div>}
      {summary && <div data-testid="gaia-complete"
          data-load-window-max-chunks={summary.loadingBudget.concurrency}
          data-load-window-max-bytes={summary.loadingBudget.maxInFlightBytes}
          data-load-window-max-rows={summary.loadingBudget.maxInFlightRows}
          data-load-window-max-total-bytes={summary.loadingBudget.maxTotalBytes}
          data-load-window-peak-chunks={summary.peakActiveChunks}
          data-load-window-peak-bytes={summary.peakReservedBytes}
          data-load-window-peak-rows={summary.peakReservedRows}
          data-load-window-max-manifests={summary.sourceReadWindow.maxConcurrentManifests}
          data-load-window-peak-manifests={summary.sourceReadWindow.peakConcurrentManifests}
          data-load-window-source-read-chunks={summary.sourceReadChunks}
          data-upload-window-max-chunks={summary.uploadWindow.maxPendingChunks}
          data-upload-window-max-rows={summary.uploadWindow.maxInputRows}
          data-upload-window-peak-chunks={summary.uploadWindow.peakPendingChunks}
          data-upload-window-peak-rows={summary.uploadWindow.peakPendingInputRows}>
          <p>{fmt(drawnCount)} {zh ? '颗唯一恒星已绘制' : 'unique stars drawn'} · {fmt(summary.uniqueRows)} {zh ? '条唯一来源记录已载入' : 'unique source rows loaded'} · {fmt(summary.verifiedRows)} {zh ? '条来源记录校验' : 'source rows verified'} · {fmt(summary.duplicateRows)} {zh ? '条重叠记录已去重' : 'overlapping rows deduplicated'} · {fmt(summary.verifiedChunks)} {zh ? '个分块' : 'chunks'}</p>
          <p>{zh ? '上传 ACK 窗口峰值' : 'Peak unacknowledged uploads'}: {fmt(summary.uploadWindow.peakPendingChunks)}/{fmt(summary.uploadWindow.maxPendingChunks)} {zh ? '个分块' : 'chunks'} · {zh ? '输入行峰值' : 'input rows'} {fmt(summary.uploadWindow.peakPendingInputRows)}/{fmt(summary.uploadWindow.maxInputRows)}</p>
        <p>{summary.selection.allManifestChunksVerified
          ? (zh ? '已校验全部输入清单及其全部分块；不代表覆盖全天或完整星表。' : 'All input manifests and their chunks were verified; this does not establish whole-sky or catalog completeness.')
          : (zh ? '仅校验与筛选天区相交的分块；未检查其余分块。' : 'Only intersecting chunks were verified; omitted chunks were not inspected.')}</p>
        <button className="secondary-button" onClick={() => { const exportGeneration = generation.current; const catalogSources = manifests.map((manifest,index) => ({ manifest, manifestSha256:manifestHashes[index], originalManifest:originalManifests[index], source:regionSources[index] })); const metadata = { manifests:catalogSources, summary, build:BUILD_INFO, projection:{ method:'gnomonic-display-only', ...projection }, selectedSixParameterCovariance:source ? {sourceId:source.source_id,...sixParameterCovariance} : null, selectedAstrometricCovariance:source ? {sourceId:source.source_id,...astrometricCovariance} : null, selectedPositionUncertainty:source ? {sourceId:source.source_id,...uncertainty} : null }; void saveJsonArrayExport(metadata, 'sources', sourceStore.current?.records() ?? [], 'solar-gaia-sky.json').catch(error => { if (exportGeneration === generation.current) setError(String(error)) }) }}>{zh ? '导出 Gaia 记录与来源' : 'Export Gaia records and sources'}</button>
      </div>}
      <p>{zh ? '未应用自行传播、观测者视差、光行差、偏折或视差零点改正。星等筛选不是完整性保证；GPU 显示精度不是科学测量精度。' : 'No proper-motion propagation, observer parallax, aberration, deflection or parallax zero-point correction is applied. Magnitude selection is not a completeness guarantee; GPU display precision is not scientific measurement accuracy.'}</p>
      {manifestHashes.map((hash,index) => <p className="checksum" key={hash}>{zh ? '清单' : 'Manifest'} {index+1} · SHA-256 {hash}</p>)}
    </>}
  </section>
}
