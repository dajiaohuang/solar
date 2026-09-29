import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/context'
import { GAIA_ZERO_RADIAL_MOTION_POLICY, loadStellarMotion, stellarSourceBase64, type StellarMotionExperiment } from '../../lib/stellarMotion'
import { expandStellarMotionRow, expandStellarMotionTileReceipt, STELLAR_MOTION_ROW_STATUS_CODE, type CompactStellarMotionRows, type CompactStellarMotionTileReceipt } from '../../lib/stellarMotionResultStore'
import { saveJsonArrayExport, saveTextExport } from '../../lib/platform'
import { BUILD_INFO } from '../../lib/buildInfo'
import { loadStellarObserverReceipt, type StellarObserverReport, type StellarObserverRequest } from '../../lib/stellarObserver'
import { StellarLimbPanel } from './StellarLimbPanel'
import { GaiaPlot, type GaiaDisplayBatch } from './GaiaPlot'
import type { StellarMotionBatchPlan, StellarMotionBatchResponse } from '../../workers/stellarMotionBatch.protocol'
import gaiaCapacity from '../../data/gaiaCapacity.json'

export function GaiaMotion() {
  const { language } = useI18n(), zh = language === 'zh'
  const base = import.meta.env.VITE_SOLAR_API_BASE_URL?.trim() || ''
  const [files, setFiles] = useState<File[]>([]), [id, setId] = useState('65212004581252736'), [epoch, setEpoch] = useState('2026')
  const [batchUrls, setBatchUrls] = useState('')
  const [covariance, setCovariance] = useState(false)
  const [zeroRadialMotionWhenMissing, setZeroRadialMotionWhenMissing] = useState(false)
  const [mode, setMode] = useState<'catalog' | 'batch' | 'station'>('catalog')
  const [utc, setUtc] = useState(''), [longitude, setLongitude] = useState(''), [latitude, setLatitude] = useState(''), [height, setHeight] = useState('')
  const [observerResult, setObserverResult] = useState<StellarObserverReport | null>(null)
  const [observerInput, setObserverInput] = useState<{ request: StellarObserverRequest; originalResponseJson: string; generation: number } | null>(null)
  const [refraction, setRefraction] = useState(false), [weather, setWeather] = useState(['', '', '', ''])
  const [adopt, setAdopt] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [result, setResult] = useState<StellarMotionExperiment | null>(null)
  const [batchPlan, setBatchPlan] = useState<StellarMotionBatchPlan | null>(null), [batchComplete, setBatchComplete] = useState(false)
  const batchResult = useRef<Array<{ manifestIndex: number; duplicateSourceRows: number; outcomes: { propagated: number; missing: number; rejected: number; zeroRadialMotion: number }; receipt: CompactStellarMotionTileReceipt; rows: CompactStellarMotionRows; plotStart: number; plotRowOrdinals: Uint32Array }>>([])
  const batchSummary = useRef({ propagated: 0, missing: 0, rejected: 0, zeroRadialMotionRows: 0, verifiedRows: 0, duplicateRows: 0, limitations: new Set<string>(), provenance: new Set<string>() })
  const [batchView, setBatchView] = useState<{ totals: typeof batchSummary.current; results: typeof batchResult.current; plotCount: number }>({
    totals: { propagated: 0, missing: 0, rejected: 0, zeroRadialMotionRows: 0, verifiedRows: 0, duplicateRows: 0, limitations: new Set(), provenance: new Set() }, results: [], plotCount: 0,
  })
  const [batchCapacity, setBatchCapacity] = useState(0)
  const batchPlotCount = useRef(0)
  const [batchDrawn, setBatchDrawn] = useState(0), [batchSelected, setBatchSelected] = useState(0), [batchVersion, setBatchVersion] = useState(0)
  const batchQueue = useRef<GaiaDisplayBatch[]>([])
  const batchWorker = useRef<Worker | null>(null)
  const generation = useRef(0), active = useRef<AbortController | null>(null)
  const clear = () => { generation.current++; active.current?.abort(); active.current = null; batchWorker.current?.terminate(); batchWorker.current = null; batchQueue.current = []; batchResult.current = []; batchSummary.current = { propagated: 0, missing: 0, rejected: 0, zeroRadialMotionRows: 0, verifiedRows: 0, duplicateRows: 0, limitations: new Set<string>(), provenance: new Set<string>() }; batchPlotCount.current = 0; setBatchView({ totals: { ...batchSummary.current }, results: [], plotCount: 0 }); setBusy(false); setResult(null); setBatchPlan(null); setBatchComplete(false); setBatchCapacity(0); setBatchDrawn(0); setBatchSelected(0); setBatchVersion(0); setObserverResult(null); setObserverInput(null); setError('') }
  const cancelBatch = () => { generation.current++; active.current?.abort(); active.current = null; batchWorker.current?.terminate(); batchWorker.current = null; setBusy(false); setError(zh ? '计算已取消；已核验分块仍保留，可导出部分回执。' : 'Computation cancelled; verified chunks remain available for partial export.') }
  useEffect(() => () => { generation.current++; active.current?.abort(); batchWorker.current?.terminate() }, [])
  const run = async () => {
    clear(); const token = generation.current, controller = new AbortController(); active.current = controller; setBusy(true)
    try {
      const manifest = files.find(f => f.name === 'manifest.json')
      if (mode !== 'batch' && (!manifest || manifest.size < 1 || manifest.size > 1 << 20)) throw new Error(zh ? '请选择原始 manifest.json（≤1 MiB）。' : 'Select the original manifest.json (≤1 MiB).')
      if (!adopt || (mode === 'station' ? [utc, longitude, latitude, height].some(value => !value.trim()) : !epoch.trim())) throw new Error(zh ? '请填写目标历元或全部站点字段，并选择径向速度假设。' : 'Complete the target epoch or all station fields and adopt the radial-velocity assumption.')
      if (mode === 'station' && refraction && weather.some(value => !value.trim())) throw new Error(zh ? '折射需要填写全部四项气象与波长数值。' : 'Refraction requires all four weather and wavelength values.')
      if (mode === 'batch') {
        const manifestUrls = batchUrls.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
        if (manifestUrls.length > gaiaCapacity.maxCatalogsPerChart) throw new Error(zh ? '最多可输入 8 个 Gaia 清单地址。' : 'Enter no more than eight Gaia manifest URLs.')
        if (manifestUrls.length > 0 && files.length > 0 || manifestUrls.length === 0 && files.length === 0) {
          throw new Error(zh ? '请选择本地单清单文件，或输入远程清单地址；两种来源不可混用。' : 'Choose local files or remote manifest URLs; do not mix the two source types.')
        }
        const activeWorker = new Worker(new URL('../../workers/stellarMotionBatch.worker.ts', import.meta.url), { type: 'module' })
        batchWorker.current = activeWorker
        const runState: { plan: StellarMotionBatchPlan | null; nextSequence: number; verifiedRows: number; duplicateSourceRows: number; seenPaths: Set<string>; chunksByKey: Map<string, StellarMotionBatchPlan['chunks'][number]> } = { plan: null, nextSequence: 1, verifiedRows: 0, duplicateSourceRows: 0, seenPaths: new Set(), chunksByKey: new Map() }
        const finish = () => { activeWorker.terminate(); if (batchWorker.current === activeWorker) batchWorker.current = null; if (active.current === controller) active.current = null; setBusy(false) }
        activeWorker.onmessage = event => {
          if (batchWorker.current !== activeWorker || token !== generation.current) return
          const message = event.data as StellarMotionBatchResponse
          if (!message || typeof message !== 'object' || !['start', 'chunk', 'done', 'error'].includes(message.type)) {
            finish(); setError('Invalid Gaia motion batch worker response'); return
          }
          if (message.type === 'error') { finish(); setError(message.error); return }
          if (message.type === 'start') {
            const plan = message.plan
            const manifestsValid = plan && Array.isArray(plan.manifests) && plan.manifests.length === plan.manifestCount
              && plan.manifests.length >= 1 && plan.manifests.length <= gaiaCapacity.maxCatalogsPerChart
              && plan.manifests.every(item => item && /^[a-f0-9]{64}$/.test(item.manifestSha256)
                && typeof item.originalManifestJson === 'string' && item.originalManifestJson.length <= gaiaCapacity.maxManifestBytes
                && ((item.source?.kind === 'local-files') || (item.source?.kind === 'remote-url' && typeof item.source.url === 'string'
                  && item.source.url.length <= 2048 && (item.source.url.startsWith('https://') || item.source.url.startsWith('http://'))))
                && Number.isSafeInteger(item.rows) && item.rows >= 0 && item.rows <= gaiaCapacity.maxCatalogRows
                && Number.isSafeInteger(item.chunkCount) && item.chunkCount >= 0 && item.chunkCount <= gaiaCapacity.maxChunks)
            const validChunks = plan && Array.isArray(plan.chunks) && Array.isArray(plan.manifests) && plan.chunks.length <= gaiaCapacity.maxChunks
              && plan.chunks.every(chunk => chunk && Number.isSafeInteger(chunk.manifestIndex) && chunk.manifestIndex >= 0
                && chunk.manifestIndex < plan.manifestCount && chunk.manifestSha256 === plan.manifests[chunk.manifestIndex]?.manifestSha256
                && /^r\d+-d\d+\.json$/.test(chunk.path) && /^[a-f0-9]{64}$/.test(chunk.sha256)
                && Number.isSafeInteger(chunk.bytes) && chunk.bytes > 0 && chunk.bytes <= gaiaCapacity.maxChunkBytes
                && Number.isSafeInteger(chunk.rows) && chunk.rows > 0 && chunk.rows <= gaiaCapacity.maxChunkRows)
            const totalRows = validChunks ? plan!.chunks.reduce((sum, chunk) => sum + chunk.rows, 0) : -1
            const totalBytes = validChunks ? plan!.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) : -1
            const manifestRows = manifestsValid ? plan!.manifests.reduce((sum, item) => sum + item.rows, 0) : -1
            const manifestBytes = manifestsValid ? plan!.manifests.reduce((sum, item) => sum + new TextEncoder().encode(item.originalManifestJson).byteLength, 0) : -1
            const perManifestRows = validChunks ? plan!.manifests.map((_, manifestIndex) => plan!.chunks.filter(chunk => chunk.manifestIndex === manifestIndex).reduce((sum, chunk) => sum + chunk.rows, 0)) : []
            const perManifestChunks = validChunks ? plan!.manifests.map((_, manifestIndex) => plan!.chunks.filter(chunk => chunk.manifestIndex === manifestIndex).length) : []
            const projection = plan?.projection
            if (runState.plan || !plan || !/^[a-f0-9]{64}$/.test(plan.collectionSha256)
              || !Number.isFinite(plan.targetEpochJulianYearTCB) || plan.targetEpochJulianYearTCB !== Number(epoch)
              || !Number.isSafeInteger(plan.inputRows) || plan.inputRows < 0 || plan.inputRows > gaiaCapacity.maxChartRows
              || !Number.isSafeInteger(plan.selectedBytes) || plan.selectedBytes < 0 || plan.selectedBytes > gaiaCapacity.maxSelectedBytes
              || !Number.isSafeInteger(plan.totalManifestBytes) || plan.totalManifestBytes < 1 || plan.totalManifestBytes > gaiaCapacity.maxCollectionManifestBytes
              || manifestBytes !== plan.totalManifestBytes
              || !manifestsValid || manifestRows !== plan.inputRows || !validChunks || totalRows !== plan.inputRows || totalBytes !== plan.selectedBytes
              || perManifestRows.some((rows, index) => rows !== plan.manifests[index].rows)
              || perManifestChunks.some((count, index) => count !== plan.manifests[index].chunkCount)
              || !projection || !Number.isFinite(projection.centerRaDeg) || projection.centerRaDeg < 0 || projection.centerRaDeg >= 360
              || !Number.isFinite(projection.centerDecDeg) || Math.abs(projection.centerDecDeg) > 90
              || !Number.isFinite(projection.radiusDeg) || projection.radiusDeg <= 0 || projection.radiusDeg > gaiaCapacity.maxProjectionRadiusDegrees
              || new Set(plan.chunks.map(chunk => `${chunk.manifestIndex}:${chunk.path}`)).size !== plan.chunks.length) {
              finish(); setError('Gaia motion batch plan exceeds or differs from the verified source budget'); return
            }
            runState.plan = plan
            runState.chunksByKey = new Map(plan.chunks.map(chunk => [`${chunk.manifestIndex}:${chunk.path}`, chunk] as const))
            setBatchPlan(plan); setBatchCapacity(plan.inputRows)
            return
          }
          const plan = runState.plan
          if (!plan) { finish(); setError('Gaia motion batch sent results before its source plan'); return }
          if (message.type === 'chunk') {
            const receipt = message.receipt
            if (!receipt || typeof receipt !== 'object' || !receipt.motion || typeof receipt.motion !== 'object') {
              finish(); setError('Gaia motion batch returned a malformed chunk receipt'); return
            }
            const chunkKey = `${message.manifestIndex}:${receipt.chunkPath}`
            const expected = runState.chunksByKey.get(chunkKey)
            const outcomes = message.outcomes
            if (!expected || runState.seenPaths.has(chunkKey) || message.sequence !== runState.nextSequence || message.collectionSha256 !== plan.collectionSha256
              || !outcomes || !Number.isSafeInteger(outcomes.propagated) || !Number.isSafeInteger(outcomes.missing) || !Number.isSafeInteger(outcomes.rejected) || !Number.isSafeInteger(outcomes.zeroRadialMotion)
              || outcomes.propagated < 0 || outcomes.missing < 0 || outcomes.rejected < 0 || outcomes.zeroRadialMotion < 0 || outcomes.zeroRadialMotion > outcomes.propagated
              || !Number.isSafeInteger(message.duplicateSourceRows) || message.duplicateSourceRows < 0 || message.duplicateSourceRows > expected.rows
              || receipt.manifestSha256 !== expected.manifestSha256
              || receipt.chunkPath !== expected.path || receipt.chunkSha256 !== expected.sha256
              || receipt.motion.inputRows !== expected.rows
              || !Number.isSafeInteger(receipt.motion.propagatedRows) || !Number.isSafeInteger(receipt.motion.missingRows)
              || !Number.isSafeInteger(receipt.motion.rejectedRows)
              || receipt.motion.propagatedRows + receipt.motion.missingRows + receipt.motion.rejectedRows !== expected.rows
              || outcomes.propagated > receipt.motion.propagatedRows || outcomes.missing > receipt.motion.missingRows || outcomes.rejected > receipt.motion.rejectedRows
              || outcomes.zeroRadialMotion > (receipt.motion.zeroRadialMotionRows ?? 0)
              || outcomes.propagated + outcomes.missing + outcomes.rejected + message.duplicateSourceRows !== expected.rows
              || !message.rows || !(message.rows.sourceIds instanceof BigInt64Array) || message.rows.sourceIds.length !== expected.rows
              || !(message.rows.statuses instanceof Uint8Array) || message.rows.statuses.length !== expected.rows
              || !(message.rows.zeroRadialMotionAssumptions instanceof Uint8Array) || message.rows.zeroRadialMotionAssumptions.length !== expected.rows
              || !(message.rows.reasonCodes instanceof Uint16Array) || message.rows.reasonCodes.length !== expected.rows
              || !(message.rows.stateIndexes instanceof Uint16Array) || message.rows.stateIndexes.length !== expected.rows
              || !Array.isArray(message.rows.reasons) || message.rows.reasons.length < 1 || message.rows.reasons.length > expected.rows + 1
              || !(message.rows.states instanceof Float64Array) || message.rows.states.length !== receipt.motion.propagatedRows * 6
              || !(message.display instanceof Float32Array) || !(message.plotRowOrdinals instanceof Uint32Array)
              || message.display.length % 3 !== 0 || message.display.length / 3 !== message.plotRowOrdinals.length
              || message.plotRowOrdinals.length > outcomes.propagated) {
              finish(); setError('Gaia motion batch output differs from its verified source chunk'); return
            }
            let previousPlotOrdinal = -1
            for (const ordinal of message.plotRowOrdinals) {
              if (ordinal <= previousPlotOrdinal || message.rows.statuses[ordinal] !== STELLAR_MOTION_ROW_STATUS_CODE.propagated
                || message.rows.stateIndexes[ordinal] === 0 || message.rows.sourceIds[ordinal] <= 0n) {
                finish(); setError('Gaia motion plot row mapping differs from its verified receipt'); return
              }
              previousPlotOrdinal = ordinal
            }
            runState.nextSequence++; runState.verifiedRows += expected.rows; runState.duplicateSourceRows += message.duplicateSourceRows; runState.seenPaths.add(chunkKey)
            if (message.display.length > 0) batchQueue.current.push({ sequence: message.sequence, display: message.display })
            const plotStart = batchPlotCount.current
            batchPlotCount.current += message.plotRowOrdinals.length
            batchResult.current.push({ manifestIndex: message.manifestIndex, duplicateSourceRows: message.duplicateSourceRows, outcomes, receipt, rows: message.rows, plotStart, plotRowOrdinals: message.plotRowOrdinals })
            batchSummary.current.propagated += outcomes.propagated
            batchSummary.current.missing += outcomes.missing
            batchSummary.current.rejected += outcomes.rejected
            batchSummary.current.zeroRadialMotionRows += outcomes.zeroRadialMotion
            batchSummary.current.verifiedRows += receipt.motion.inputRows
            batchSummary.current.duplicateRows += message.duplicateSourceRows
            for (const limitation of receipt.motion.limitations) batchSummary.current.limitations.add(limitation)
            batchSummary.current.provenance.add(receipt.provenanceBoundary)
            setBatchView({ totals: { ...batchSummary.current, limitations: new Set(batchSummary.current.limitations), provenance: new Set(batchSummary.current.provenance) }, results: batchResult.current.slice(), plotCount: batchPlotCount.current })
            setBatchVersion(value => value + 1)
            if (message.display.length === 0) activeWorker.postMessage({ type: 'ack', sequence: message.sequence })
            return
          }
          if (message.collectionSha256 !== plan.collectionSha256 || message.verifiedChunks !== plan.chunks.length
            || message.verifiedRows !== plan.inputRows || runState.nextSequence - 1 !== plan.chunks.length
            || runState.verifiedRows !== plan.inputRows || runState.seenPaths.size !== plan.chunks.length
            || !Number.isSafeInteger(message.uniqueSourceRows) || message.uniqueSourceRows < 0 || message.uniqueSourceRows > plan.inputRows
            || !Number.isSafeInteger(message.duplicateSourceRows) || message.duplicateSourceRows < 0 || message.duplicateSourceRows > plan.inputRows
            || message.uniqueSourceRows + message.duplicateSourceRows !== message.verifiedRows
            || message.duplicateSourceRows !== runState.duplicateSourceRows || message.uniqueSourceRows + runState.duplicateSourceRows !== plan.inputRows) {
            finish(); setError('Gaia motion batch completion did not reconcile with every manifest chunk and row'); return
          }
          setBatchComplete(true); finish()
        }
        activeWorker.onerror = event => { if (batchWorker.current === activeWorker && token === generation.current) { finish(); setError(event.message || 'Gaia motion batch worker failed') } }
        activeWorker.onmessageerror = () => { if (batchWorker.current === activeWorker && token === generation.current) { finish(); setError('Gaia motion batch worker response could not be decoded') } }
        try {
          activeWorker.postMessage({ type: 'run', ...(manifestUrls.length > 0 ? { manifestUrls } : { files }), backendBaseUrl: base, targetEpochJulianYearTCB: Number(epoch), radialVelocityPolicy: zeroRadialMotionWhenMissing ? GAIA_ZERO_RADIAL_MOTION_POLICY : 'spectroscopic-as-astrometric' })
        }
        catch (error) { finish(); throw error }
        return
      }
      const rows = files.find(f => f.name === 'rows.csv')
      if (!manifest) throw new Error(zh ? '请选择原始 manifest.json。' : 'Select the original manifest.json.')
      if (files.length !== 2 || !rows || rows.size > 16 << 20) throw new Error(zh ? '单星与站点模式需要 rows.csv（≤16 MiB）。' : 'Single-source and station modes need rows.csv (≤16 MiB).')
      const [m, r] = await Promise.all([manifest.arrayBuffer(), rows.arrayBuffer()])
      controller.signal.throwIfAborted()
      const source = { originalManifestBase64: stellarSourceBase64(new Uint8Array(m), 1 << 20), originalRowsCsvBase64: stellarSourceBase64(new Uint8Array(r), 16 << 20), sourceId: id, radialVelocityPolicy: 'spectroscopic-as-astrometric' as const }
      if (mode === 'station') {
        const request: StellarObserverRequest = { ...source, utc, station: { longitudeDeg: Number(longitude), latitudeDeg: Number(latitude), heightMeters: Number(height) },
          ...(refraction ? { atmosphere: { pressureHPa: Number(weather[0]), temperatureC: Number(weather[1]), relativeHumidity: Number(weather[2]), wavelengthMicrometers: Number(weather[3]) } } : {}) }
        const next = await loadStellarObserverReceipt(base, request, controller.signal)
        if (token === generation.current) { setObserverResult(next.report); setObserverInput({ request, originalResponseJson: next.originalResponseJson, generation: token }); setResult(next.report.experiment.stellar); setBusy(false); active.current = null }
        return
      }
      const next = await loadStellarMotion(base, { ...source, targetEpochJulianYearTCB: Number(epoch), ...(covariance ? { covariancePolicy: 'independent-spectroscopic-rv' as const } : {}) }, controller.signal)
      if (token === generation.current) { setResult(next); setBusy(false); active.current = null }
    } catch (error) { if (token === generation.current) { setError(String(error)); setBusy(false); active.current = null } }
  }
  const acknowledgeBatchUpload = useCallback((sequence: number) => { batchWorker.current?.postMessage({ type: 'ack', sequence }) }, [])
  const reportBatchPresented = useCallback((rows: number) => setBatchDrawn(rows), [])
  const reportBatchPlotError = useCallback((message: string) => {
    batchWorker.current?.terminate(); batchWorker.current = null
    active.current?.abort(); active.current = null; setBusy(false); setError(message)
  }, [])
  const selectBatchStar = useCallback((index: number) => setBatchSelected(index), [])
  const batchTotals = batchView.totals
  const batchVerifiedRows = batchView.totals.verifiedRows
  const batchDuplicateRows = batchView.totals.duplicateRows
  const batchUniqueRows = batchVerifiedRows - batchDuplicateRows
  const batchLimitations = [...batchView.totals.limitations]
  const batchProvenance = [...batchView.totals.provenance]
  const batchPlotRowAt = (index: number) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= batchView.plotCount) return null
    let low = 0, high = batchView.results.length
    while (low < high) {
      const middle = low + ((high - low) >> 1), item = batchView.results[middle]
      if (item.plotStart + item.plotRowOrdinals.length <= index) low = middle + 1
      else high = middle
    }
    const item = batchView.results[low]
    if (!item || index < item.plotStart) return null
    const ordinal = item.plotRowOrdinals[index - item.plotStart]
    return ordinal === undefined ? null : expandStellarMotionRow(item.rows, ordinal)
  }
  const selectedBatchPlotRow = batchPlotRowAt(batchSelected)
  const firstBatchPlotRows = Array.from({ length: Math.min(20, batchView.plotCount) }, (_, index) => ({ index, row: batchPlotRowAt(index) }))
  const exportBatchReceipts = () => {
    const exportGeneration = generation.current, exportChunks = batchResult.current.slice()
    const records = function* () {
      for (const item of exportChunks) yield {
        manifestIndex: item.manifestIndex,
        duplicateSourceRows: item.duplicateSourceRows,
        outcomes: item.outcomes,
        receipt: expandStellarMotionTileReceipt(item.receipt, item.rows),
      }
    }
    void saveJsonArrayExport({ build: BUILD_INFO, complete: batchComplete, plan: batchPlan }, 'verifiedChunks', records(), 'solar-gaia-motion-batch.json', 1)
      .catch(error => { if (exportGeneration === generation.current) setError(String(error)) })
  }
  return <section className="evidence-module glass-panel" aria-label={zh ? '恒星历元传播' : 'Stellar epoch propagation'}>
    <div className="module-heading"><span>{zh ? '恒星历元传播' : 'Stellar epoch propagation'}</span><em>ICRS · TCB</em></div>
    <p>{mode === 'batch' ? (zh ? '本地模式选择一个原始 manifest.json 与全部分块；远程模式可输入最多 8 个清单地址。校验后使用共同 ICRS 切平面，以 source_id 首次出现规则去重，并把具备可用位置、正视差和自行且符合所选径向运动策略的目标历元位置逐批加入 WebGL 图。集合上限为 200,000 行、128 MiB 分块与 8 MiB 清单；点大小仍使用 J2016 Gaia G 星等。' : 'Choose one local manifest and all its chunks, or enter up to eight remote manifest URLs. The collection uses one validated ICRS tangent plane, deduplicates by first source_id occurrence, and appends successfully propagated in-field positions as chunks finish. Rows need a usable position, positive parallax and proper motion; missing radial velocities follow the selected policy. Limits are 200,000 input rows, 128 MiB of chunks and 8 MiB of manifests; point size retains J2016 Gaia G magnitude.') : (zh ? '使用原始 Gaia CSV 的完整单星参数传播星表状态，或计算显式地面站点的方向。需要正视差、自行及径向速度；单星模式可选择传播形式协方差。' : 'Propagate a complete single-star model from original Gaia CSV, or calculate directions for an explicit ground station. Positive parallax, proper motion and radial velocity are required. Single-star mode can propagate formal covariance.')}</p>
    {!base && <p role="status">{mode === 'station' ? (zh ? '站点方向需要配置含 SPK/IERS 数据的计算后端。' : 'Station directions require a configured backend with SPK/IERS data.') : mode === 'batch' ? (zh ? '批量传播需要配置恒星计算后端。' : 'Batch propagation requires a configured stellar computation backend.') : (zh ? '尚未配置计算后端；可使用离线 gaia-motion 命令。' : 'No computation backend is configured. The offline gaia-motion command remains available.')}</p>}
    <form onSubmit={event => { event.preventDefault(); void run() }}>
      <label className="field"><span>{zh ? '恒星计算模式' : 'Stellar calculation mode'}</span><select value={mode} onChange={event => { clear(); setMode(event.target.value as 'catalog' | 'batch' | 'station') }}><option value="catalog">{zh ? '单星历元传播' : 'Single-star epoch propagation'}</option><option value="batch">{zh ? 'Gaia 分块批量传播' : 'Gaia chunk batch propagation'}</option><option value="station">{zh ? '地面站坐标方向' : 'Station coordinate direction'}</option></select></label>
      {mode === 'batch' && <label className="field"><span>{zh ? '远程 Gaia 清单地址（每行一个，最多 8 个）' : 'Remote Gaia manifest URLs (one per line, up to 8)'}</span><textarea rows={3} value={batchUrls} placeholder="https://…/manifest.json" onChange={event => { const value = event.target.value; clear(); setBatchUrls(value); if (value.trim()) setFiles([]) }} /></label>}
      <label className="field"><span>{mode === 'batch' ? (zh ? '本地原始 manifest.json 与全部 Gaia 分块' : 'Local original manifest.json and every Gaia chunk') : (zh ? '恒星传播原始清单与 CSV' : 'Stellar original manifest and CSV')}</span><input type="file" multiple accept=".json,.csv" onChange={event => { const selectedFiles = Array.from(event.target.files ?? []); clear(); setFiles(selectedFiles); if (selectedFiles.length) setBatchUrls(''); event.target.value = '' }} /></label>
      {files.length > 0 && <p>{mode === 'batch'
        ? files.some(file => file.name === 'manifest.json')
          ? (zh ? `已选 ${files.length - 1} 个分块文件与清单；运行前会核对是否齐全。` : `${files.length - 1} chunk files selected with the manifest; completeness is checked before processing.`)
          : (zh ? '尚未选择名为 manifest.json 的原始清单。' : 'The original file named manifest.json is missing.')
        : files.map(f => f.name).join(' · ')}</p>}
      {mode === 'batch' && batchUrls.trim() && <p>{batchUrls.split(/\r?\n/).map(value => value.trim()).filter(Boolean).length.toLocaleString()} {zh ? '个远程清单地址；运行前将核对合集行数、字节与共同投影预算。' : 'remote manifest URLs; aggregate rows, bytes and projection are validated before loading.'}</p>}
      {mode !== 'batch' && <label className="field"><span>{zh ? 'Gaia 传播源 ID' : 'Gaia propagation source ID'}</span><input required type="text" inputMode="numeric" value={id} onChange={event => { clear(); setId(event.target.value) }} /></label>}
      {mode !== 'station' ? <label className="field"><span>{zh ? '目标 TCB 儒略年' : 'Target TCB Julian year'}</span><input required type="number" min="1916" max="2116" step="any" value={epoch} onChange={event => { clear(); setEpoch(event.target.value) }} /></label> : <>
        <label className="field"><span>UTC (YYYY-MM-DDTHH:mm:ssZ)</span><input required type="text" value={utc} placeholder="YYYY-MM-DDTHH:mm:ssZ" onChange={event => { clear(); setUtc(event.target.value) }} /></label>
        {[{ label: zh ? '东经（度）' : 'East longitude (degrees)', value: longitude, set: setLongitude }, { label: zh ? '纬度（度）' : 'Latitude (degrees)', value: latitude, set: setLatitude }, { label: zh ? 'WGS84 椭球高（米）' : 'WGS84 ellipsoidal height (meters)', value: height, set: setHeight }].map(field => <label className="field" key={field.label}><span>{field.label}</span><input required type="number" step="any" value={field.value} onChange={event => { clear(); field.set(event.target.value) }} /></label>)}
        <p>{zh ? '历元由站点 UTC 推导，需要后端 SPK 和 IERS 覆盖。分别输出视差修正后的坐标方向，以及加入太阳偏折和光行差的无大气地平视方向；暂不传播站点方向协方差。' : 'The epoch is derived from station UTC and requires backend SPK/IERS coverage. Separate outputs show the parallax-corrected coordinate direction and the airless horizontal direction with solar deflection and aberration. Station-direction covariance is not propagated.'}</p>
        <label className="dynamics-check"><input type="checkbox" checked={refraction} onChange={event => { clear(); setRefraction(event.target.checked) }} />{zh ? '使用显式气象参数估算折射' : 'Estimate refraction with explicit weather inputs'}</label>
        {refraction && <>
          {(zh ? ['气压（hPa）', '气温（°C）', '相对湿度（0–1）', '波长（微米）'] : ['Pressure (hPa)', 'Temperature (°C)', 'Relative humidity (0–1)', 'Wavelength (micrometers)']).map((label, index) => <label className="field" key={index}><span>{label}</span><input required type="number" step="any" value={weather[index]} onChange={event => { clear(); setWeather(previous => previous.map((value, axis) => axis === index ? event.target.value : value)) }} /></label>)}
          <p>{zh ? '只在无大气高度角 ≥5° 时提供折射结果；这不保证当地大气的实际精度。' : 'Refraction is returned only for airless altitude ≥5°. This does not certify accuracy for the local atmosphere.'}</p>
        </>}
      </>}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '12px 0' }}><input style={{ flexShrink: 0, marginTop: 4 }} type="checkbox" checked={adopt} onChange={event => { clear(); setAdopt(event.target.checked) }} />{zh ? '采用光谱径向速度近似天体测量径向速度（未校正天体物理位移）' : 'Adopt spectroscopic RV as astrometric RV (astrophysical shifts uncorrected)'}</label>
      {mode === 'batch' && <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '12px 0' }}><input style={{ flexShrink: 0, marginTop: 4 }} type="checkbox" checked={zeroRadialMotionWhenMissing} onChange={event => { clear(); setZeroRadialMotionWhenMissing(event.target.checked) }} />{zh ? '批量模式：缺少光谱径向速度时按 Gaia 历元传播约定采用 μr=0；仍需正视差。此值是假设，不是测量值，每行会标记。' : 'Batch mode: when spectroscopic RV is missing, adopt Gaia’s epoch-propagation convention μr=0; positive parallax is still required. This is an assumption, not a measurement, and is marked per row.'}</label>}
      {mode === 'catalog' && <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '12px 0' }}><input style={{ flexShrink: 0, marginTop: 4 }} type="checkbox" checked={covariance} onChange={event => { clear(); setCovariance(event.target.checked) }} />{zh ? '传播形式协方差，假设径向速度误差独立于天体测量误差' : 'Propagate formal covariance assuming RV errors are independent of astrometry'}</label>}
      <button className="secondary-button" disabled={!base || (mode === 'batch' ? files.length < 1 && !batchUrls.trim() : files.length !== 2) || !adopt || busy}>{mode === 'batch' ? (zh ? '传播并显示 Gaia 天区合集' : 'Propagate and display Gaia collection') : (zh ? '计算恒星状态' : 'Compute stellar state')}</button>
    </form>
    {busy && <><p role="status">{zh ? '正在核验来源并计算' : 'Verifying sources and computing'}</p><button onClick={mode === 'batch' ? cancelBatch : clear}>{zh ? '取消恒星计算' : 'Cancel stellar calculation'}</button></>}
    {error && <p role="alert">{error}</p>}
    {batchPlan && <div data-testid="stellar-motion-batch-result">
      <p role="status">{batchComplete
        ? (zh ? `已核验并处理 ${batchPlan.manifestCount.toLocaleString()} 个清单的全部 ${batchPlan.chunks.length.toLocaleString()} 个分块 · J${batchPlan.targetEpochJulianYearTCB} TCB` : `Verified all ${batchPlan.chunks.length.toLocaleString()} chunks across ${batchPlan.manifestCount.toLocaleString()} manifests · J${batchPlan.targetEpochJulianYearTCB} TCB`)
        : busy
          ? (zh ? `正在处理 ${batchView.results.length.toLocaleString()} / ${batchPlan.chunks.length.toLocaleString()} 个分块（${batchPlan.manifestCount.toLocaleString()} 个清单）· J${batchPlan.targetEpochJulianYearTCB} TCB` : `Processing ${batchView.results.length.toLocaleString()} / ${batchPlan.chunks.length.toLocaleString()} chunks across ${batchPlan.manifestCount.toLocaleString()} manifests · J${batchPlan.targetEpochJulianYearTCB} TCB`)
          : (zh ? `批量传播未完成；已核验 ${batchView.results.length.toLocaleString()} / ${batchPlan.chunks.length.toLocaleString()} 个分块` : `Batch propagation incomplete; verified ${batchView.results.length.toLocaleString()} / ${batchPlan.chunks.length.toLocaleString()} chunks`)}</p>
      <dl className="contract-list">
        <div><dt>{zh ? '传播成功 / 缺少输入 / 拒绝' : 'Propagated / missing / rejected'}</dt><dd>{batchTotals.propagated.toLocaleString()} / {batchTotals.missing.toLocaleString()} / {batchTotals.rejected.toLocaleString()}</dd></div>
        <div><dt>{zh ? '唯一源采用 μr=0 假设' : 'Unique sources using the μr=0 assumption'}</dt><dd>{batchTotals.zeroRadialMotionRows.toLocaleString()}</dd></div>
        <div><dt>{zh ? '显示在所选天区内' : 'Visible within selected field'}</dt><dd>{batchView.plotCount.toLocaleString()}</dd></div>
        <div><dt>{zh ? '传播成功但位于视场外' : 'Propagated outside selected field'}</dt><dd>{Math.max(0, batchTotals.propagated - batchView.plotCount).toLocaleString()}</dd></div>
        <div><dt>{zh ? '唯一传播源 / 重叠源' : 'Unique sources / overlaps'}</dt><dd>{batchUniqueRows.toLocaleString()} / {batchDuplicateRows.toLocaleString()}</dd></div>
        <div><dt>{zh ? '已核验行 / 集合总行 / 所选字节' : 'Verified rows / collection rows / selected bytes'}</dt><dd>{batchVerifiedRows.toLocaleString()} / {batchPlan.inputRows.toLocaleString()} / {batchPlan.selectedBytes.toLocaleString()}</dd></div>
        <div><dt>{zh ? '共同投影心与半径' : 'Shared projection center / radius'}</dt><dd>{batchPlan.projection.centerRaDeg.toFixed(4)}°, {batchPlan.projection.centerDecDeg.toFixed(4)}° · {batchPlan.projection.radiusDeg.toFixed(3)}°</dd></div>
        <div><dt>{zh ? '清单合集 SHA-256' : 'Manifest collection SHA-256'}</dt><dd>{batchPlan.collectionSha256}</dd></div>
      </dl>
      {batchCapacity > 0 && <>
        <GaiaPlot capacity={batchCapacity} batchQueue={batchQueue} batchVersion={batchVersion} zoom={1}
          ariaLabel={`Gaia ICRS tangent-plane propagated stars at J${batchPlan.targetEpochJulianYearTCB} TCB`}
          onUploaded={acknowledgeBatchUpload} onPresented={reportBatchPresented} onError={reportBatchPlotError} onSelect={selectBatchStar} />
        <p>{zh ? `WebGL 已呈现 ${batchDrawn.toLocaleString()} 颗。点击星点查看传播结果；图表不含观测者视差、光行差、偏折或自行系统误差。` : `WebGL has presented ${batchDrawn.toLocaleString()} stars. Click a point to inspect its propagated result; the chart omits observer parallax, aberration, deflection and proper-motion systematics.`}</p>
        {selectedBatchPlotRow?.state && <p>{zh ? '所选 Gaia 源' : 'Selected Gaia source'} {selectedBatchPlotRow.sourceId} · RA {selectedBatchPlotRow.state.raDeg.toPrecision(10)}° · Dec {selectedBatchPlotRow.state.decDeg.toPrecision(10)}°{selectedBatchPlotRow.zeroRadialMotionAssumed ? (zh ? ' · 缺失径向速度，采用 μr=0 假设' : ' · RV unavailable; μr=0 assumed') : ''}</p>}
      </>}
      {batchComplete && batchView.plotCount === 0 && <p role="status">{zh ? '没有已传播恒星留在该圆锥视场内；缺少输入的恒星未投到目标历元图。' : 'No successfully propagated stars remain in this cone view. Stars with missing inputs are not projected into the target-epoch chart.'}</p>}
      {batchProvenance.map(text => <p key={text}>{text}</p>)}
      <details><summary>{zh ? '图中前 20 颗已传播恒星' : 'First 20 propagated stars in the chart'}</summary>
        <table><thead><tr><th>Gaia source_id</th><th>RA (°)</th><th>Dec (°)</th><th>Parallax (mas)</th></tr></thead><tbody>
          {firstBatchPlotRows.map(({ index, row }) => row?.state && <tr key={index}><td>{row.sourceId}</td><td>{row.state.raDeg.toPrecision(10)}</td><td>{row.state.decDeg.toPrecision(10)}</td><td>{row.state.parallaxMas.toPrecision(8)}</td></tr>)}
        </tbody></table>
      </details>
      <details><summary>{zh ? `已处理分块及来源哈希（${batchView.results.length.toLocaleString()}）` : `Processed chunks and source hashes (${batchView.results.length.toLocaleString()})`}</summary>
        {batchView.results.slice(0, 20).map(item => <p key={`${item.manifestIndex}:${item.receipt.chunkPath}`}>{zh ? `清单 ${item.manifestIndex + 1} · ` : `Manifest ${item.manifestIndex + 1} · `}{item.receipt.chunkPath} · {item.receipt.chunkSha256}</p>)}
        {batchView.results.length > 20 && <p>{zh ? '其余分块哈希包含在完整导出回执中。' : 'Remaining chunk hashes are included in the complete receipt export.'}</p>}
      </details>
      <details><summary>{zh ? '模型限制' : 'Model limits'}</summary>{batchLimitations.map(text => <p key={text}>{text}</p>)}</details>
      <button className="secondary-button" disabled={!batchComplete && batchView.results.length === 0} onClick={exportBatchReceipts}>{zh ? '导出已核验分块回执' : 'Export verified chunk receipts'}</button>
    </div>}
    {result && <div data-testid="stellar-motion-result">
      {observerResult && <div>
        <p>{zh ? '站点无大气视方向' : 'Station airless apparent direction'}</p>
        <dl className="contract-list">
          <div><dt>{zh ? '方位角 / 高度角（度）' : 'Azimuth / altitude (degrees)'}</dt><dd>{observerResult.experiment.observed.apparentAirless.azimuthDeg.toPrecision(12)} / {observerResult.experiment.observed.apparentAirless.altitudeDeg.toPrecision(12)}</dd></div>
          <div><dt>CIRS RA / Dec (°)</dt><dd>{observerResult.experiment.observed.cirsRaDeg.toPrecision(12)} / {observerResult.experiment.observed.cirsDecDeg.toPrecision(12)}</dd></div>
          <div><dt>{zh ? '坐标太阳距角（度）' : 'Coordinate solar elongation (degrees)'}</dt><dd>{observerResult.experiment.observed.solarElongationDeg.toPrecision(10)}</dd></div>
          {observerResult.experiment.observed.refracted && <div><dt>{zh ? '折射后方位角 / 高度角（度）' : 'Refracted azimuth / altitude (degrees)'}</dt><dd>{observerResult.experiment.observed.refracted.azimuthDeg.toPrecision(12)} / {observerResult.experiment.observed.refracted.altitudeDeg.toPrecision(12)}</dd></div>}
        </dl>
        {observerResult.experiment.observed.refractionStatus === 'outside-altitude-domain' && <p role="status">{zh ? '无大气高度角低于 5°，未提供折射结果；无大气结果仍有效。' : 'Airless altitude is below 5°; no refracted result is supplied. The airless result remains available.'}</p>}
        <p>{zh ? '方位角以北为零、向东递增。高度角和太阳距角不是可见性判断；未检查地形、日光背景或天体圆盘遮挡，显示位数不代表物理精度。' : 'Azimuth is north-zero and east-positive. Altitude and solar elongation are not visibility judgments: terrain, daylight and body-disk occultation are unchecked. Displayed digits do not establish physical accuracy.'}</p>
        {observerResult.experiment.observed.solarDeflectionLimited && <p role="status">{zh ? '接近太阳中心，太阳偏折模型已触发限制。' : 'The solar-deflection limiter is active near the Sun’s center.'}</p>}
        <p>{zh ? '站点坐标方向（BCRS，未加光行差）' : 'Station coordinate direction (BCRS, without aberration)'}</p>
        <dl className="contract-list">
          <div><dt>RA / Dec (°)</dt><dd>{observerResult.experiment.raDeg.toPrecision(12)} / {observerResult.experiment.decDeg.toPrecision(12)}</dd></div>
          <div><dt>{zh ? '方向单位向量' : 'Unit direction'}</dt><dd>{observerResult.experiment.coordinateDirectionBcrs.map(value => value.toPrecision(12)).join(', ')}</dd></div>
          <div><dt>{zh ? 'TDB 两部分儒略日' : 'Two-part TDB Julian date'}</dt><dd>{observerResult.experiment.epochJdTdbParts.join(' + ')}</dd></div>
        </dl>
        <details><summary>{zh ? '站点来源、警告与限制' : 'Station sources, warnings and limits'}</summary>
          <p>IERS SHA-256: {observerResult.earthOrientation.sha256}</p>
          {observerResult.experiment.observation.sources.map((source, index) => <p key={index}>{source.bodyId}: {source.source} · {source.kernelSha256}</p>)}
          {[...observerResult.experiment.observation.warnings, ...observerResult.experiment.limitations, ...observerResult.experiment.observed.warnings, ...observerResult.experiment.observed.limitations].map((text, index) => <p key={index}>{text}</p>)}
        </details>
        {observerInput && <StellarLimbPanel key={observerInput.generation} request={observerInput.request} originalResponseJson={observerInput.originalResponseJson} zh={zh} />}
        <p>{zh ? '以下为传播后的质心星表状态，尚未加入站点修正：' : 'The following is the propagated barycentric catalog state before station corrections:'}</p>
      </div>}
      <p>Gaia DR3 {result.result.sourceId} · J{result.result.targetEpochJulianYearTCB} TCB</p>
      <dl className="contract-list">
        <div><dt>RA / Dec (°)</dt><dd>{result.result.stateTCBCompatible.raDeg.toPrecision(12)} / {result.result.stateTCBCompatible.decDeg.toPrecision(12)}</dd></div>
        <div><dt>{zh ? '视差（mas）' : 'Parallax (mas)'}</dt><dd>{result.result.stateTCBCompatible.parallaxMas.toPrecision(10)}</dd></div>
        <div><dt>μα* / μδ (mas/yr)</dt><dd>{result.result.stateTCBCompatible.pmraMasPerJulianYear.toPrecision(10)} / {result.result.stateTCBCompatible.pmdecMasPerJulianYear.toPrecision(10)}</dd></div>
        <div><dt>RV (km/s)</dt><dd>{result.result.stateTCBCompatible.radialVelocityKmPerSecond.toPrecision(10)}</dd></div>
      </dl>
      <p>{zh ? '匀速单星模型，不含双星加速度、系统误差或观测者改正；显示位数不是精度保证。' : 'Uniform single-star model without binary acceleration, systematics or observer corrections; displayed digits are not an accuracy guarantee.'}</p>
      {result.formalCovariance && <div data-testid="stellar-covariance-result">
        <p>{zh ? '传播后边缘标准差（形式误差）' : 'Propagated marginal standard deviations (formal errors)'}</p>
        <dl className="contract-list">{result.formalCovariance.coordinateLabels.map((label, i) => <div key={label}><dt>{label}</dt><dd>{Math.sqrt(result.formalCovariance!.outputMatrix[i][i]).toPrecision(6)} {result.formalCovariance!.coordinateUnits[i]}</dd></div>)}</dl>
        <p>{zh ? '一阶局部线性近似；标准差不是联合置信区域。不含系统误差，也不保证掩星时间精度。完整相关矩阵与假设随来源导出。' : 'First-order local approximation; standard deviations are not a joint confidence region. No systematics or occultation timing guarantee. Export includes full correlations and assumptions.'}</p>
        <details><summary>{zh ? '协方差假设' : 'Covariance assumptions'}</summary>{result.formalCovariance.assumptions.map(text => <p key={text}>{text}</p>)}</details>
      </div>}
      <details><summary>{zh ? '模型及来源限制' : 'Model and provenance limitations'}</summary>{result.result.limitations.map(text => <p key={text}>{text}</p>)}<p>{result.provenanceBoundary}</p></details>
      <button className="secondary-button" onClick={() => { const exportGeneration = generation.current; void saveTextExport(observerInput?.originalResponseJson ?? JSON.stringify({ build: BUILD_INFO, experiment: result }, null, 2), observerInput ? 'solar-gaia-observer.json' : 'solar-gaia-motion.json', 'application/json').catch(error => { if (exportGeneration === generation.current) setError(String(error)) }) }}>{zh ? '导出恒星计算与原始来源' : 'Export stellar calculation and originals'}</button>
      {observerInput && <button className="secondary-button" onClick={() => { const exportGeneration = generation.current; void saveTextExport(JSON.stringify(observerInput.request, null, 2), 'solar-gaia-observer-request.json', 'application/json').catch(error => { if (exportGeneration === generation.current) setError(String(error)) }) }}>{zh ? '导出站点请求供离线复算' : 'Export station request for offline reproduction'}</button>}
    </div>}
  </section>
}
