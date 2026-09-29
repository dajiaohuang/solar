import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { createCatalogPointStyleTable } from '../lib/catalogPointAppearance'
import { createCatalogPointRenderer, type CatalogPointAppend } from '../lib/catalogPointRenderer'
import { planCatalogStream, type CatalogStreamPriority, type CatalogSourceSelection, type CatalogStreamResult } from '../lib/catalogStreaming'
import { julianDayToDate } from '../lib/julianDate'
import type { AsteroidManifest, CatalogFilters, CatalogLocator } from '../types'
import type { CatalogStreamRequest, CatalogStreamResponse } from '../workers/catalog-stream.protocol'
import { CATALOG_TRANSFER_WINDOW } from '../lib/catalogTransferWindow'
import type { CatalogRotation } from '../lib/catalogProjection'
import { catalogTemporalDisplacementAU } from '../engine/ephemeris/catalogTemporalBudget'
import type { CatalogEpochResult } from '../lib/catalogEpochStore'
import { CATALOG_EPOCH_TILE_ROWS, CATALOG_EPOCH_UPLOAD_SLOTS } from '../lib/catalogEpochCapacity'
import { saveTextExport } from '../lib/platform'
import { BUILD_INFO } from '../lib/buildInfo'
import { encodeCatalogEpochs, encodeCatalogMask } from '../lib/catalogEvidenceEncoding'
import { createCatalogSourceRowLookup } from '../lib/catalogSourceRow'
import { createCatalogSourceAppendLookup } from '../lib/catalogSourceAppendLookup'
import { checkCatalogAppendReceipt } from '../lib/catalogAppendReceipt'
import { CATALOG_APPEND_TIMEOUT_MS } from '../lib/catalogAppendLimits'
import { checkCatalogReadEvidence } from '../lib/catalogReadEvidence'
import { CATALOG_CLIP_RELATIVE_MARGIN } from '../lib/catalogProjection'
import { CATALOG_SCREEN_COUNT_MAX_CELLS } from '../lib/catalogSpatialSelection'
import { hasOnlyFiniteValues } from '../lib/finiteFloatArray'

type Props = {
  manifest: AsteroidManifest
  filters: CatalogFilters
  julianDay: number
  requestedRows: number
  budgetBytes: number
  viewRadiusAU: number
  displayMode: 'spatial' | 'all'
  displayLimit: number
  mode?: '2d' | '3d'
  priority?: CatalogStreamPriority
  rotation?: CatalogRotation
  retainEpochs?: boolean
  appendRows?: number
  targetJulianDay?: number
  maximumTemporalDriftAU?: number
  focusedSource?: { id: string; locator: CatalogLocator }
  selectedSources?: readonly { id: string; locator: CatalogLocator }[]
  prioritySources?: readonly { id: string; locator: CatalogLocator }[]
  onSourceSelectionChange?: (selection: CatalogSourceSelection | null) => void
  onSourceRowsComplete?: (rows: number) => void
  activeRenderSampling?: boolean
  onActiveRenderFrameDuration?: (durationMs: number, renderedCount?: number) => void
  onStopped?: () => void
  onRestarted?: () => void
}
type Status = { drawnRows: number; sourceRows: number; phase: 'loading' | 'updating' | 'complete' | 'limited' | 'cancelled' | 'error'; error?: string }
type Attributes = CatalogPointAppend
type AppendReceipt = Extract<CatalogStreamResponse, { type: 'append-done' }> & { requestedLocators: readonly CatalogLocator[] }
type CountOverlaySummary = { sourceRows: number; occupiedCells: number; columns: number; rows: number; maximumCount: number }

function drawCatalogScreenCountOverlay(canvas: HTMLCanvasElement, overlay: NonNullable<Extract<CatalogStreamResponse, { type: 'selection' }>['countOverlay']>): CountOverlaySummary {
  const { counts, columns, rows, sourceRows, occupiedCells, maximumCount } = overlay
  if (!(counts instanceof Uint32Array) || !Number.isSafeInteger(columns) || columns < 1 ||
      !Number.isSafeInteger(rows) || rows < 1 || columns * rows !== counts.length || counts.length > CATALOG_SCREEN_COUNT_MAX_CELLS ||
      !Number.isSafeInteger(sourceRows) || sourceRows < 0 || !Number.isSafeInteger(occupiedCells) || occupiedCells < 0 || occupiedCells > counts.length ||
      !Number.isSafeInteger(maximumCount) || maximumCount < 0 || maximumCount > sourceRows) {
    throw new Error('Invalid catalog screen-count overlay')
  }
  if (canvas.width !== columns) canvas.width = columns
  if (canvas.height !== rows) canvas.height = rows
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Catalog screen-count overlay canvas is unavailable')
  const pixels = context.createImageData(columns, rows)
  let total = 0, occupied = 0, observedMaximum = 0
  const scale = maximumCount > 1 ? Math.log1p(maximumCount) : 1
  for (let index = 0; index < counts.length; index++) {
    const count = counts[index]
    if (count > 0) { total += count; occupied++ }
    observedMaximum = Math.max(observedMaximum, count)
    // A singleton already has an exact point beneath the overlay. Color only
    // the multiply occupied bins so the layer adds population context without
    // obscuring isolated source positions.
    if (count < 2) continue
    const intensity = Math.log1p(count) / scale
    const column = index % columns, row = rows - 1 - Math.floor(index / columns)
    const pixel = (row * columns + column) * 4
    pixels.data[pixel] = Math.round(38 + 186 * intensity)
    pixels.data[pixel + 1] = Math.round(138 + 74 * intensity)
    pixels.data[pixel + 2] = Math.round(246 - 148 * intensity)
    pixels.data[pixel + 3] = Math.round(18 + 56 * intensity)
  }
  if (total !== sourceRows || occupied !== occupiedCells || observedMaximum !== maximumCount) {
    throw new Error('Catalog screen-count overlay does not reconcile to in-viewport rows')
  }
  context.putImageData(pixels, 0, 0)
  return { sourceRows, occupiedCells: occupied, columns, rows, maximumCount }
}

const DEFAULT_ROTATION: CatalogRotation = { azimuthDegrees: 0,tiltDegrees: 0 }
const UPLOAD_SLICE_ROWS = 4096
const UPLOAD_FRAME_BUDGET_MS = 3
const EMPTY_SOURCE_ROW_MASK = new Uint8Array(0)

export function CatalogStreamCanvas({ manifest, filters, julianDay, requestedRows, budgetBytes, viewRadiusAU, displayMode, displayLimit, mode = '2d', priority = 'source', rotation = DEFAULT_ROTATION, retainEpochs = false, appendRows = 0, targetJulianDay = julianDay, maximumTemporalDriftAU = 0, focusedSource, selectedSources, prioritySources, onSourceSelectionChange, onSourceRowsComplete, activeRenderSampling = false, onActiveRenderFrameDuration, onStopped, onRestarted }: Props) {
  const { t, language } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const countOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const epochRef = useRef<((epoch: number) => void) | null>(null)
  const appendRef = useRef<((locators: readonly CatalogLocator[]) => void) | null>(null)
  const [appendReceipts, setAppendReceipts] = useState<AppendReceipt[]>([])
  const [lastAppendAttempt, setLastAppendAttempt] = useState<AppendReceipt | null>(null)
  const [appendNotice, setAppendNotice] = useState<'busy' | 'no-missing' | 'capacity' | null>(null)
  const targetEpochRef = useRef(targetJulianDay)
  const temporalBudgetRef = useRef(maximumTemporalDriftAU)
  const [computedEpoch, setComputedEpoch] = useState<number | null>(julianDay)
  const [maximumSpeed, setMaximumSpeed] = useState<number | null>(null)
  const [epochEvidence, setEpochEvidence] = useState<CatalogEpochResult | null>(null)
  const [sourceSelection, setSourceSelection] = useState<CatalogSourceSelection | null>(null)
  const [screeningEvidence, setScreeningEvidence] = useState<CatalogStreamResult['screening'] | null>(null)
  const [readEvidence, setReadEvidence] = useState<CatalogStreamResult['reads'] | null>(null)
  const sourceRows = useMemo(() => {
    if (!sourceSelection) return null
    if (!appendReceipts.length) return createCatalogSourceRowLookup(sourceSelection)
    const lookup = createCatalogSourceAppendLookup(sourceSelection,requestedRows)
    for (const receipt of appendReceipts) {
      if (receipt.addedRows) lookup.prepareAppend(receipt.result.sourceSelection!,receipt.startRow).commit(receipt.startRow,receipt.addedRows)
    }
    return lookup
  }, [sourceSelection, appendReceipts, requestedRows])
  const focusedRow = useMemo(() => sourceRows && focusedSource ? sourceRows.row(focusedSource.locator) : undefined, [sourceRows, focusedSource])
  const focusedRowRef = useRef<number | undefined>(focusedRow)
  const selectedSourceRows = useMemo(() => {
    if (!selectedSources) return []
    const rows = sourceRows?.rows(selectedSources.map(source => source.locator))
    return selectedSources.map((source, index) => ({ ...source, uploadedRow: rows?.[index] ?? null }))
  }, [sourceRows, selectedSources])
  const selectedRows = useMemo(() => selectedSourceRows
    .map(source => source.uploadedRow).filter((row): row is number => row !== null), [selectedSourceRows])
  const selectedRowsRef = useRef<readonly number[]>(selectedRows)
  const [exportError, setExportError] = useState('')
  const [spatialWorkerError, setSpatialWorkerError] = useState('')
  const [discardedOnCancel, setDiscardedOnCancel] = useState(false)
  const exportGeneration = useRef(0)
  const [sourceOwner, setSourceOwner] = useState<object | null>(null)
  const radiusRef = useRef(viewRadiusAU)
  const detailRef = useRef({ displayMode, displayLimit, rotation })
  const [display, setDisplay] = useState<{ count: number; visible: number; selectionRows?: number; pending: boolean; selectionMs?: number; edgeCandidates?: number; testedRows?: number; skippedRows?: number; countOverlay?: CountOverlaySummary }>({ count: 0, visible: 0, pending: false })
  const displayCountRef = useRef(display.count)
  displayCountRef.current = display.count
  const [status, setStatus] = useState<Status>({ drawnRows: 0, sourceRows: 0, phase: 'loading' })
  const completedSourceRows = status.phase === 'complete' || status.phase === 'limited' ? status.drawnRows : 0
  const activeRenderSamplingRef = useRef(activeRenderSampling)
  const activeRenderFrameDurationRef = useRef(onActiveRenderFrameDuration)
  activeRenderSamplingRef.current = activeRenderSampling
  activeRenderFrameDurationRef.current = onActiveRenderFrameDuration
  useEffect(() => { onSourceRowsComplete?.(completedSourceRows) }, [completedSourceRows, onSourceRowsComplete])
  const [unavailable, setUnavailable] = useState(false)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const [restoration, setRestoration] = useState<{ rows: number; total: number } | null>(null)
  const plan = planCatalogStream(manifest, requestedRows, budgetBytes, mode, retainEpochs, appendRows)
  const dimensions = mode === '3d' ? 3 : 2
  const displayUnavailable = unavailable || restoration !== null || (displayMode === 'spatial' && Boolean(spatialWorkerError))
  const displayCountLabel = displayUnavailable ? (language === 'zh' ? '不可用' : 'unavailable')
    : display.pending ? t(displayMode === 'spatial' ? 'catalogSpatialUpdating' : 'catalogSelectionUpdating')
      : display.count.toLocaleString()
  const displayKnown = !displayUnavailable && !display.pending
  // The worker's visible count includes points admitted by the clip margin;
  // edgeCandidates is the subset outside the mathematical viewport.
  const inViewport = Math.max(0, display.visible - (display.edgeCandidates ?? 0))
  const notSubmittedRows = displayKnown ? Math.max(0, status.drawnRows - display.count) : null
  const spatialLimitReached = displayKnown && displayMode === 'spatial' && inViewport > display.count
    && display.count >= Math.min(plan.capacity, displayLimit)
  const loadOwner = useMemo(() => ({ manifest, filters, julianDay, requestedRows, budgetBytes,
    capacity: plan.capacity, mode, dimensions, priority, retainEpochs, appendRows, prioritySources, retryGeneration }), [manifest, filters, julianDay, requestedRows, budgetBytes,
    plan.capacity, mode, dimensions, priority, retainEpochs, appendRows, prioritySources, retryGeneration])
  useEffect(() => {
    onSourceSelectionChange?.(sourceOwner === loadOwner ? sourceSelection : null)
    return () => onSourceSelectionChange?.(null)
  }, [onSourceSelectionChange, sourceOwner, loadOwner, sourceSelection])
  const extraDrift = epochEvidence ? catalogTemporalDisplacementAU(epochEvidence.julianDay, targetJulianDay, maximumSpeed) : null
  const temporalDrift = computedEpoch !== null ? catalogTemporalDisplacementAU(computedEpoch, targetJulianDay, maximumSpeed)
    : epochEvidence && extraDrift !== null && Number.isFinite(extraDrift+epochEvidence.maximumDisplacementAU) ? extraDrift+epochEvidence.maximumDisplacementAU : null
  useEffect(() => {
    if (!Number.isFinite(maximumTemporalDriftAU) || maximumTemporalDriftAU < 0 || maximumTemporalDriftAU > 1) throw new RangeError('Invalid catalog temporal display budget')
    targetEpochRef.current = targetJulianDay; temporalBudgetRef.current = maximumTemporalDriftAU
    epochRef.current?.(targetJulianDay)
  }, [targetJulianDay, maximumTemporalDriftAU])

  useEffect(() => {
    focusedRowRef.current = focusedRow
    selectedRowsRef.current = selectedRows
    radiusRef.current = viewRadiusAU
    detailRef.current = { displayMode, displayLimit, rotation }
    drawRef.current?.()
  }, [viewRadiusAU, displayMode, displayLimit, rotation, focusedRow, selectedRows])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const classCodes = manifest.compactIndex?.classCodes
    const pointStyles = createCatalogPointStyleTable(classCodes ?? [])
    const exportCounter = exportGeneration
    exportGeneration.current++
    let active = true, acceptingTiles = true, loading = true, stopped = false, failed = false, discardedSnapshot = false, worker: Worker | null = null, frameId = 0
    let renderObservationFrame = 0, renderObservationPrevious: number | null = null
    let renderObservationLastDrawAt = 0, renderObservationIdleFrames = 0
    let renderer: ReturnType<typeof createCatalogPointRenderer> | null = null
    let restoring = false, restorationFrame = 0, restorationGeneration = 0
    let gl: WebGLRenderingContext | null = null
    let viewKey = '', selectionViewKey = '', viewRequestId = 0
    let inFlightView: number | null = null, lastViewRequestedCount = 0
    let epochReady = false, epochBusy = false, epochStarted = false, coherent = true, epochId = 0, epochFrame = 0
    let awaitingPresentation = false, followFrame = 0
    let installedEpoch = julianDay, requestedEpoch = julianDay, updatedRows = 0, retainedTile = 0, retainedOffset = 0, snapshotComplete = false
    let sourceMaximumSpeed: number | null = null
    let completedEpochEvidence: CatalogEpochResult | null = null
    let appendLookup: ReturnType<typeof createCatalogSourceAppendLookup> | null = null
    let appendBase: CatalogSourceSelection | null = null, appendId = 0, appendRemaining = plan.appendCapacity
    let appendPending: { request: Extract<CatalogStreamRequest, { type: 'append' }>; maximumRows: number; deadline: number;
      timer?: ReturnType<typeof setTimeout>;
      reservation?: ReturnType<ReturnType<typeof createCatalogSourceAppendLookup>['prepareAppend']>;
      result?: CatalogStreamResult; addedRows?: number } | null = null
    let epochBlockCounts: number[] = []
    const recordEpochBlockCounts = (rows: number) => {
      if (!Number.isSafeInteger(rows) || rows < 0) throw new Error('Invalid catalog epoch block row count')
      for (let start = 0; start < rows; start += CATALOG_EPOCH_TILE_ROWS) {
        epochBlockCounts.push(Math.min(CATALOG_EPOCH_TILE_ROWS,rows-start))
      }
    }
    let observedBlockEpochs = new Float64Array(0), observedBlock = 0, observedBlockRows = 0
    const recordEpochRows = (rows: number, epoch: number, drift: number) => {
      while (rows > 0) {
        const blockSize = epochBlockCounts[observedBlock]
        if (blockSize === undefined) throw new Error('Catalog epoch rows exceed admitted epoch blocks')
        const offset = observedBlock * 2
        if (observedBlockRows === 0) { observedBlockEpochs[offset] = epoch; observedBlockEpochs[offset+1] = drift }
        else if (observedBlockEpochs[offset] !== epoch || observedBlockEpochs[offset+1] !== drift) {
          throw new Error('Catalog source block contains inconsistent epoch receipts')
        }
        const accepted = Math.min(rows, blockSize-observedBlockRows)
        rows -= accepted; observedBlockRows += accepted
        if (observedBlockRows === blockSize) { observedBlock++; observedBlockRows = 0 }
      }
    }
    let uniformEpoch: number | null = julianDay, installedDrift = 0, requestedBudget = 0, reusedRows = 0, maximumReuseDrift = 0
    let minimumActualEpoch = Infinity, maximumActualEpoch = -Infinity
    const epochTiles: Extract<CatalogStreamResponse, { type: 'epoch-tile' }>[] = []
    let epochTileOffset = 0
    let nextEpochTileRow = 0
    const retained: Attributes[] = []
    const pendingTiles: Extract<CatalogStreamResponse, { type: 'tile' }>[] = []
    let pendingTileOffset = 0
    const count = { drawnRows: 0, sourceRows: 0 }
    const uploadedShards: { chunk: number; selectedRows: number; sourceRows: number; drawnRows: number }[] = []
    const uploadedMasks = new Map<number, Uint8Array>()
    // A replacement source/epoch has no uploaded rows yet. Do not display the
    // previous snapshot's completion or error while its first tile is pending.
    queueMicrotask(() => {
      if (active && loading && acceptingTiles) { setStatus({ ...count, phase: 'loading' }); setComputedEpoch(julianDay); setMaximumSpeed(null); setEpochEvidence(null); setSourceSelection(null); setAppendReceipts([]); setLastAppendAttempt(null); setAppendNotice(null); setExportError(''); setSpatialWorkerError(''); setDiscardedOnCancel(false) }
    })
    const post = (request: CatalogStreamRequest) => worker?.postMessage(request)
    const cancelView = () => {
      if (inFlightView === null) return
      inFlightView = null
      lastViewRequestedCount = 0
      post({ type: 'view-cancel' })
    }
    const sampleActiveRenderFrames = (timestamp: number) => {
      renderObservationFrame = 0
      if (!active || document.hidden || !activeRenderSamplingRef.current || !coherent || epochBusy ||
          awaitingPresentation || restoring || stopped || failed || discardedSnapshot) {
        renderObservationPrevious = null
        renderObservationIdleFrames = 0
        return
      }
      const previous = renderObservationPrevious
      const renderedDuringInterval = previous !== null && renderObservationLastDrawAt > previous
      if (renderedDuringInterval) {
        activeRenderFrameDurationRef.current?.(timestamp - previous,
          Math.min(displayCountRef.current, detailRef.current.displayLimit, plan.capacity))
        renderObservationIdleFrames = 0
      } else renderObservationIdleFrames++
      renderObservationPrevious = timestamp
      // Stop promptly when the user stops changing the view. Idle page frames
      // are not evidence that this canvas can submit more catalog points.
      if (renderObservationIdleFrames >= 2) {
        renderObservationPrevious = null
        renderObservationIdleFrames = 0
        return
      }
      renderObservationFrame = requestAnimationFrame(sampleActiveRenderFrames)
    }
    const noteActiveCatalogDraw = () => {
      if (!count.drawnRows || !activeRenderSamplingRef.current || document.hidden || !coherent || epochBusy ||
          awaitingPresentation || restoring || stopped || failed || discardedSnapshot || !renderer) return
      renderObservationLastDrawAt = performance.now()
      renderObservationIdleFrames = 0
      if (!renderObservationFrame) {
        renderObservationPrevious = renderObservationLastDrawAt
        renderObservationFrame = requestAnimationFrame(sampleActiveRenderFrames)
      }
    }
    const terminateWorker = () => {
      clearTimeout(appendPending?.timer)
      appendPending?.reservation?.cancel(); appendPending = null
      const owned = worker
      worker = null
      inFlightView = null
      if (!owned) return
      owned.onmessage = null; owned.onerror = null; owned.onmessageerror = null
      owned.terminate()
    }
    const workerFailure = (error: Error) => {
      if (!active || failed || discardedSnapshot) return
      if (!stopped) { fail(error); return }
      // The accepted CPU/GPU snapshot is still useful without the spatial
      // worker. Do not discard its source evidence or leave a pending view.
      terminateWorker()
      exportGeneration.current++
      viewRequestId++; viewKey = ''; selectionViewKey = ''
      renderer?.setSpatialSelection(null)
      setSpatialWorkerError(error.message)
      const presented = draw()
      setDisplay({ count: presented ? Math.min(count.drawnRows, plan.capacity, detailRef.current.displayLimit) : 0,
        visible: count.drawnRows, selectionRows: count.drawnRows, pending: false })
    }
    const invalidatePresentation = () => {
      // Keep awaitingPresentation until the replacement view is actually ready.
      if (followFrame) { cancelAnimationFrame(followFrame); followFrame = 0 }
    }
    const stopRestoration = () => {
      restorationGeneration++
      if (restorationFrame) { cancelAnimationFrame(restorationFrame); restorationFrame = 0 }
      if (restoring) { renderer?.dispose(); renderer = null }
      restoring = false
      if (active) setRestoration(null)
    }
    const recycle = (tile: Extract<CatalogStreamResponse, { type: 'epoch-tile' }>) => {
      const message: CatalogStreamRequest = { type: 'epoch-ack', requestId: tile.requestId, startRow: tile.startRow, positions: tile.positions }
      worker?.postMessage(message, [tile.positions.buffer])
    }
    const cancel = () => {
      onStopped?.()
      exportGeneration.current++
      uploadedShards.length = 0; uploadedMasks.clear()
      if (restoring) { setUnavailable(true); setDisplay({ count: 0, visible: 0, pending: false }) }
      stopRestoration()
      stopped = true
      // Explicit abort ends admitted fetches and the pending upload ACK. The
      // worker retains only the visual coordinates for the stopped snapshot.
      // Navigation and changed filters terminate it and release that storage.
      acceptingTiles = false
      loading = false
      inFlightView = null
      lastViewRequestedCount = 0
      epochReady = false; epochBusy = false; epochStarted = false; epochId++
      awaitingPresentation = false; if (followFrame) { cancelAnimationFrame(followFrame); followFrame = 0 }
      if (epochFrame) { cancelAnimationFrame(epochFrame); epochFrame = 0 }
      epochTiles.length = 0; epochTileOffset = 0; nextEpochTileRow = 0
      if (!coherent) {
        // Epoch upload overwrites the restoration buffer incrementally. It is
        // neither the prior snapshot nor a completed new epoch after cancel.
        discardedSnapshot = true
        setDiscardedOnCancel(true)
        renderer?.dispose(); renderer = null
        retained.length = 0; epochBlockCounts = []
        observedBlockEpochs = new Float64Array(0); observedBlock = 0; observedBlockRows = 0
        count.drawnRows = 0
        setDisplay({ count: 0, visible: 0, pending: false }); setComputedEpoch(null)
        setEpochEvidence(null); setSourceSelection(null); setSourceOwner(null)
        setAppendReceipts([]); setLastAppendAttempt(null); setAppendNotice(null)
        setMaximumSpeed(null); setUnavailable(true)
      }
      pendingTiles.length = 0; pendingTileOffset = 0
      // Cancellation must settle local state even if the worker channel is
      // already unusable. The normal path keeps its visual snapshot available.
      try { post({ type: 'cancel' }) }
      catch (error) { workerFailure(error instanceof Error ? error : new Error(String(error))); terminateWorker() }
      if (discardedSnapshot) terminateWorker()
      if (frameId) { cancelAnimationFrame(frameId); frameId = 0 }
      setStatus({ ...count, phase: 'cancelled' })
      viewKey = ''
      draw()
    }
    cancelRef.current = cancel
    const fail = (error: unknown) => {
      if (!active || failed) return
      onStopped?.()
      exportGeneration.current++
      uploadedShards.length = 0; uploadedMasks.clear()
      failed = true
      stopRestoration()
      stopped = true
      acceptingTiles = false
      loading = false
      epochReady = false; epochBusy = false; epochStarted = false; epochId++
      awaitingPresentation = false; if (followFrame) { cancelAnimationFrame(followFrame); followFrame = 0 }
      if (epochFrame) { cancelAnimationFrame(epochFrame); epochFrame = 0 }
      epochTiles.length = 0; epochTileOffset = 0; nextEpochTileRow = 0
      // An upload error can leave attributes only partly replaced. Unlike a
      // user cancellation, failure does not retain a drawable snapshot or a
      // restoration copy whose GPU/CPU coherence is no longer established.
      renderer?.dispose(); renderer = null
      retained.length = 0; epochBlockCounts = []
      observedBlockEpochs = new Float64Array(0); observedBlock = 0; observedBlockRows = 0
      setComputedEpoch(null); setEpochEvidence(null); setSourceSelection(null)
      setAppendReceipts([]); setLastAppendAttempt(null); setAppendNotice(null)
      setMaximumSpeed(null); setUnavailable(true)
      viewRequestId++
      pendingTiles.length = 0; pendingTileOffset = 0
      if (frameId) { cancelAnimationFrame(frameId); frameId = 0 }
      terminateWorker()
      setDisplay({ count: 0, visible: 0, pending: false })
      if (active) setStatus({ ...count, phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
    const draw = (verifyGpu = false) => {
      if (!renderer || restoring) return false
      try {
        if (appendPending) {
          gl?.clear(gl.COLOR_BUFFER_BIT)
          if (verifyGpu) checkGl()
          else if (gl?.isContextLost()) throw new Error('Catalog WebGL context is lost')
          return true
        }
        const rect = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio, 2)
        const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio))
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
        const detail = detailRef.current
        const maximumDrawPoints = Math.min(plan.capacity, detail.displayLimit)
        if (!coherent) {
          renderer.drawRetained(radiusRef.current, 0.82, width, height, ratio, mode === '3d' ? detail.rotation : undefined,
            verifyGpu || awaitingPresentation, maximumDrawPoints)
          return true
        }
        const cameraKey = detail.displayMode === 'spatial'
          ? `${radiusRef.current}:${width}:${height}:${mode === '3d' ? `${detail.rotation.azimuthDegrees}:${detail.rotation.tiltDegrees}` : ''}` : ''
        const spatialKey = `${detail.displayMode}:${maximumDrawPoints}:${cameraKey}:${focusedRowRef.current ?? 'none'}`
        const selectionKey = `${spatialKey}:${selectedRowsRef.current.join(',')}`
        if (detail.displayMode === 'all') {
          const directKey = `${selectionKey}:${count.drawnRows}`
          if (count.drawnRows <= maximumDrawPoints && directKey !== viewKey) {
            invalidatePresentation()
            viewKey = directKey
            viewRequestId++
            cancelView()
            selectionViewKey = ''; lastViewRequestedCount = 0
            renderer.setSpatialSelection(null)
            setDisplay({ count: count.drawnRows, visible: count.drawnRows, selectionRows: count.drawnRows, pending: false })
          } else if (count.drawnRows > maximumDrawPoints && !worker &&
              (directKey !== viewKey || selectionViewKey !== '')) {
            invalidatePresentation()
            viewKey = directKey
            viewRequestId++
            cancelView()
            selectionViewKey = ''; lastViewRequestedCount = 0
            renderer.setSpatialSelection(null)
            setDisplay({ count: Math.min(count.drawnRows, maximumDrawPoints), visible: count.drawnRows, selectionRows: count.drawnRows, pending: false })
          } else if (count.drawnRows > maximumDrawPoints && worker) {
            const contextChanged = selectionKey !== selectionViewKey
            if (contextChanged) {
              invalidatePresentation()
              viewKey = selectionKey
              viewRequestId++
              selectionViewKey = selectionKey; lastViewRequestedCount = 0
              setDisplay(previous => ({ ...previous, visible: count.drawnRows, selectionRows: count.drawnRows,
                pending: count.drawnRows > 0, selectionMs: undefined, edgeCandidates: undefined,
                testedRows: undefined, skippedRows: undefined }))
            }
            // Keep an all-row representative sample visible as the scientific
            // snapshot grows; retain useful work between geometric refreshes.
            const progressRefresh = loading &&
              (lastViewRequestedCount === 0 || count.drawnRows >= lastViewRequestedCount*2)
            const terminalRefresh = !loading && lastViewRequestedCount !== count.drawnRows
            if ((contextChanged || progressRefresh || terminalRefresh) &&
                (contextChanged || inFlightView === null)) {
              if (!contextChanged) viewRequestId++
              inFlightView = viewRequestId; lastViewRequestedCount = count.drawnRows
              if (!contextChanged) setDisplay(previous => ({ ...previous, pending: true }))
              post({ type: 'view', requestId: viewRequestId, count: count.drawnRows,
                view: { mode: 'all', radius: radiusRef.current, aspect: width / height, maximumPoints: maximumDrawPoints,
                  focusedRow: focusedRowRef.current, selectedRows: selectedRowsRef.current, ...(mode === '3d' ? { rotation: detail.rotation } : {}) } })
            }
          }
        } else {
          const contextChanged = selectionKey !== selectionViewKey
          if (contextChanged) {
            invalidatePresentation()
            viewKey = selectionKey; selectionViewKey = selectionKey; lastViewRequestedCount = 0
            // Camera/focus changes do not invalidate coordinates or row IDs.
            // Keep the last coherent representatives until the new viewport
            // selection is ready; epoch updates still hide incoherent states.
            setDisplay(previous => ({ ...previous, pending: count.drawnRows > 0 && worker !== null,
              selectionMs: undefined, edgeCandidates: undefined, testedRows: undefined, skippedRows: undefined }))
          }
          // Geometric refresh milestones let the map grow during a long load
          // without cancelling a useful worker pass for every uploaded tile.
          // Once a pass is in flight, keep it and refresh after its receipt.
          const progressRefresh = loading && count.drawnRows > 0 &&
            (lastViewRequestedCount === 0 || count.drawnRows >= lastViewRequestedCount*2)
          const terminalRefresh = !loading && count.drawnRows > 0 && lastViewRequestedCount !== count.drawnRows
          if (worker && count.drawnRows && (contextChanged || progressRefresh || terminalRefresh) &&
              (contextChanged || inFlightView === null)) {
            viewRequestId++
            inFlightView = viewRequestId; lastViewRequestedCount = count.drawnRows
            if (!contextChanged) setDisplay(previous => ({ ...previous, pending: true }))
            post({ type: 'view', requestId: viewRequestId, count: count.drawnRows,
              view: { mode: 'spatial', radius: radiusRef.current, aspect: width / height, maximumPoints: maximumDrawPoints,
                focusedRow: focusedRowRef.current, selectedRows: selectedRowsRef.current, ...(mode === '3d' ? { rotation: detail.rotation } : {}) } })
          }
        }
        renderer.drawRetained(radiusRef.current, 0.82, width, height, ratio, mode === '3d' ? detail.rotation : undefined,
          verifyGpu || awaitingPresentation, maximumDrawPoints)
        noteActiveCatalogDraw()
        if (awaitingPresentation && (detail.displayMode === 'spatial' && !count.drawnRows ||
            detail.displayMode === 'all' && (count.drawnRows <= maximumDrawPoints || !worker))) finishPresentation()
        return true
      } catch (error) { fail(error); return false }
    }
    const checkGl = () => { if (gl?.getError() !== gl?.NO_ERROR) throw new Error('Catalog GPU allocation or upload failed') }
    const finishPresentation = () => {
      if (followFrame || !awaitingPresentation) return
      const presentationView = viewRequestId, presentationEpoch = epochId
      const current = () => active && renderer !== null && !restoring && coherent && !epochBusy &&
        presentationView === viewRequestId && presentationEpoch === epochId
      followFrame = requestAnimationFrame(() => {
        if (!current()) { followFrame = 0; return }
        followFrame = requestAnimationFrame(() => {
          followFrame = 0
          if (!current()) return
          awaitingPresentation = false
          requestEpoch(targetEpochRef.current)
        })
      })
    }
    const requestEpoch = (epoch: number) => {
      // While busy, targetEpochRef holds the latest request. Finish one epoch
      // before starting the next so a fast clock cannot starve publication.
      if (appendPending || !retainEpochs || !epochReady || !count.drawnRows || epochBusy || awaitingPresentation || restoring || !worker || !renderer || !Number.isFinite(epoch)) return
      if (epoch === installedEpoch && (uniformEpoch === epoch || installedDrift <= temporalBudgetRef.current)) return
      const drift = uniformEpoch === null ? null : catalogTemporalDisplacementAU(uniformEpoch, epoch, sourceMaximumSpeed)
      if (temporalBudgetRef.current > 0 && drift !== null && drift <= temporalBudgetRef.current) return
      if (epochId >= Number.MAX_SAFE_INTEGER) { fail(new Error('Catalog epoch request identifiers exhausted')); return }
      epochBusy = true; epochStarted = false; coherent = false; requestedEpoch = epoch; epochId++
      // The epoch request cancels worker selections without a view receipt.
      inFlightView = null
      requestedBudget = temporalBudgetRef.current; setEpochEvidence(null)
      viewRequestId++; viewKey = ''; selectionViewKey = ''
      renderer.invalidatePositions(); setComputedEpoch(null)
      setDisplay({ count: 0, visible: 0, pending: true }); setStatus({ ...count, phase: 'updating' })
      try { post({ type: 'epoch', requestId: epochId, julianDay: epoch, maximumDriftAU: requestedBudget }) } catch (error) { fail(error) }
    }
    epochRef.current = requestEpoch
    appendRef.current = locators => {
      if (!active || stopped || loading || restoring || !renderer || !worker || !epochReady || epochBusy || awaitingPresentation ||
          !coherent || appendPending || !appendLookup || !appendBase) { setAppendNotice('busy'); return }
      if (appendRemaining < 1) { setAppendNotice('capacity'); return }
      const unique = new Map<string,CatalogLocator>()
      for (const locator of locators) {
        if (appendLookup.row(locator) === undefined) unique.set(`${locator.chunkIndex}:${locator.rowIndex}`,locator)
        if (unique.size === 256) break
      }
      if (!unique.size) { setAppendNotice('no-missing'); return }
      if (appendId >= Number.MAX_SAFE_INTEGER) { fail(new Error('Catalog append request identifiers exhausted')); return }
      const request: Extract<CatalogStreamRequest, { type: 'append' }> = { type: 'append', requestId: ++appendId,
        startRow: count.drawnRows, julianDay: installedEpoch, locators: [...unique.values()] }
      appendPending = { request, maximumRows: appendRemaining, deadline: performance.now()+CATALOG_APPEND_TIMEOUT_MS }
      const ownedAppend = appendPending
      ownedAppend.timer = setTimeout(() => {
        if (appendPending === ownedAppend && active && !stopped) fail(new Error('Catalog append exceeded its 300-second resource limit'))
      },CATALOG_APPEND_TIMEOUT_MS)
      setAppendNotice(null); setLastAppendAttempt(null)
      coherent = false; inFlightView = null; viewRequestId++; viewKey = ''; selectionViewKey = ''
      exportGeneration.current++; setEpochEvidence(null); setComputedEpoch(null)
      setStatus({ ...count, phase: 'updating' }); setDisplay({ count: 0, visible: 0, pending: true })
      draw()
      try { post(request) } catch (error) { fail(error) }
    }
    const advanceCpuSnapshot = (rows: number, positions?: Float32Array | Float64Array, sourceOffset = 0) => {
      if (positions) {
        const destination = retained[retainedTile]
        if (!destination || rows > destination.sizes.length-retainedOffset) throw new Error('Catalog epoch slice crosses its CPU restoration tile')
      }
      let copied = 0
      let displayPositions: Float32Array | undefined
      while (copied < rows) {
        const destination = retained[retainedTile]
        if (!destination) throw new Error('Catalog epoch exceeds CPU restoration snapshot')
        const length = Math.min(rows-copied, destination.sizes.length-retainedOffset)
        if (length <= 0) throw new Error('Invalid CPU catalog range')
        if (positions) {
          const targetStart = retainedOffset*dimensions, targetEnd = (retainedOffset+length)*dimensions
          const sourceStart = (sourceOffset+copied)*dimensions
          destination.positions.set(positions.subarray(sourceStart, sourceStart+length*dimensions), targetStart)
          displayPositions = destination.positions.subarray(targetStart, targetEnd)
        }
        copied += length; retainedOffset += length
        if (retainedOffset === destination.sizes.length) { retainedTile++; retainedOffset = 0 }
      }
      return displayPositions
    }
    const flushEpochTile = () => {
      epochFrame = 0
      if (!active || !epochTiles.length) return
      try {
        const started = performance.now()
        while (epochTiles.length && performance.now()-started < UPLOAD_FRAME_BUDGET_MS) {
          const tile = epochTiles[0]
          if (!epochBusy || tile.requestId !== epochId) {
            epochTiles.shift(); epochTileOffset = 0; recycle(tile)
            continue
          }
          if (!renderer || tile.julianDay !== requestedEpoch || tile.startRow+epochTileOffset !== updatedRows || !Number.isSafeInteger(tile.count) || tile.count < 1 || tile.count > 16384 ||
              tile.positions.length !== tile.count*dimensions || tile.startRow+tile.count > count.drawnRows) throw new Error('Invalid catalog epoch tile')
          do {
            const retainedCpuTile = retained[retainedTile]
            const retainedTileRows = retainedCpuTile ? retainedCpuTile.sizes.length-retainedOffset : 0
            if (!Number.isSafeInteger(retainedTileRows) || retainedTileRows < 1) throw new Error('Catalog epoch exceeds CPU restoration snapshot')
            const end = Math.min(tile.count, epochTileOffset+UPLOAD_SLICE_ROWS, epochTileOffset+retainedTileRows), rows = end-epochTileOffset
            const displayPositions = advanceCpuSnapshot(rows, tile.positions, epochTileOffset)
            if (!displayPositions) throw new Error('Catalog epoch did not produce a CPU restoration slice')
            renderer.replacePositions(updatedRows, displayPositions)
            recordEpochRows(rows, tile.julianDay, 0)
            updatedRows += rows; epochTileOffset = end
          } while (epochTileOffset < tile.count && performance.now()-started < UPLOAD_FRAME_BUDGET_MS)
          minimumActualEpoch = Math.min(minimumActualEpoch, tile.julianDay); maximumActualEpoch = Math.max(maximumActualEpoch, tile.julianDay)
          if (epochTileOffset < tile.count) break
          // Keep each worker buffer until its complete upload has been checked.
          checkGl()
          epochTiles.shift(); epochTileOffset = 0
          recycle(tile)
        }
        if (epochTiles.length) {
          if (gl?.isContextLost()) throw new Error('Catalog WebGL context is lost')
          epochFrame = requestAnimationFrame(flushEpochTile)
        }
      } catch (error) { fail(error) }
    }
    const flushTiles = () => {
      frameId = 0
      if (!active || !acceptingTiles) return
      try {
        if (!renderer) throw new Error('Catalog GPU context is unavailable')
        const started = performance.now(), acknowledgements: Extract<CatalogStreamResponse, { type: 'tile' }>[] = []
        let changed = false, processed = false
        // A source shard stays in the credit window until every bounded slice
        // is converted and uploaded. Even the first shard can yield mid-upload.
        while (pendingTiles.length && (!processed || performance.now() - started < UPLOAD_FRAME_BUDGET_MS)) {
          const response = pendingTiles[0]
          const points = response.positions.length / dimensions
          if (!Number.isSafeInteger(response.sourceChunk) || response.sourceChunk < 0 || response.sourceChunk >= manifest.chunkCount ||
              uploadedMasks.has(response.sourceChunk) ||
              !Number.isSafeInteger(points) || points > Math.min(manifest.chunkSize, manifest.totalCount-response.sourceChunk*manifest.chunkSize) || response.appearance.length !== points * 2 ||
              response.drawnRows !== count.drawnRows + points-pendingTileOffset || response.drawnRows > plan.capacity ||
              !Number.isSafeInteger(response.sourceRows) || response.sourceRows < count.sourceRows || response.sourceRows > manifest.totalCount) throw new Error('Invalid catalog streaming tile')
          if (pendingTileOffset === 0) {
            const sourceCount = Math.min(manifest.chunkSize, manifest.totalCount-response.sourceChunk*manifest.chunkSize)
            const mask = response.sourceRowMask
            if (!(mask instanceof Uint8Array) || mask.length !== Math.ceil(sourceCount/8) ||
                sourceCount % 8 && mask[mask.length-1] >>> (sourceCount % 8)) throw new Error('Invalid upload source-row bitmap')
            let selectedCount = 0
            for (const value of mask) {
              const pairs = value-((value >>> 1)&0x55), groups = (pairs&0x33)+((pairs >>> 2)&0x33)
              selectedCount += (groups+(groups >>> 4))&0x0f
            }
            if (selectedCount !== points) throw new Error('Upload source-row bitmap differs from position count')
          }
          const end = Math.min(points, pendingTileOffset+UPLOAD_SLICE_ROWS), rows = end-pendingTileOffset
          const tile: Attributes = { positions: new Float32Array(response.positions.subarray(pendingTileOffset*dimensions, end*dimensions)), colors: new Uint8Array(rows * 3), sizes: new Uint8Array(rows) }
          if (!hasOnlyFiniteValues(tile.positions)) throw new Error('Catalog position exceeds GPU coordinates')
          for (let row = 0; row < rows; row++) {
            const sourceRow = pendingTileOffset+row
            const classIndex = response.appearance[sourceRow * 2], flags = response.appearance[sourceRow * 2 + 1]
            if (!classCodes || classIndex >= classCodes.length || flags > 7) throw new Error('Invalid catalog appearance')
            const styleOffset = (classIndex*8+flags)*4, colorOffset = row * 3
            tile.colors[colorOffset] = pointStyles[styleOffset]
            tile.colors[colorOffset + 1] = pointStyles[styleOffset + 1]
            tile.colors[colorOffset + 2] = pointStyles[styleOffset + 2]
            tile.sizes[row] = pointStyles[styleOffset + 3]
          }
          if (rows) { renderer.append(tile); retained.push(tile); changed = true }
          count.drawnRows += rows; count.sourceRows = response.sourceRows
          pendingTileOffset = end; processed = true
          if (end === points) {
            // Keep the duplicate-chunk guard without retaining a full all-zero
            // source bitmap for shards that contributed no uploaded points.
            uploadedMasks.set(response.sourceChunk, points ? response.sourceRowMask : EMPTY_SOURCE_ROW_MASK)
            uploadedShards.push({ chunk: response.sourceChunk, selectedRows: points, sourceRows: response.sourceRows, drawnRows: response.drawnRows })
            pendingTiles.shift(); pendingTileOffset = 0
            acknowledgements.push(response)
          }
        }
        // drawRetained checks the shared GL error state after upload and draw.
        // A separate pre-draw getError synchronizes with the GPU twice while
        // adding no acknowledgement protection: a failed draw never reaches ACK.
        if (changed && !draw(true)) return
        setStatus({ ...count, phase: 'loading' })
        // Acknowledge only after the batch has actually reached the renderer.
        for (const tile of acknowledgements) {
          const message: CatalogStreamRequest = { type: 'ack', tileId: tile.tileId, positions: tile.positions }
          worker?.postMessage(message, [tile.positions.buffer])
        }
        if (pendingTiles.length) frameId = requestAnimationFrame(flushTiles)
      } catch (error) { fail(error) }
    }
    const initialize = () => {
      // A failed source generation needs a fresh load. A later context-restored
      // event must not revive its discarded partial attributes.
      if (!active || failed || discardedSnapshot) return false
      stopRestoration(); invalidatePresentation(); viewRequestId++
      renderer?.dispose(); renderer = null
      try {
        gl = canvas.getContext('webgl', { antialias: false, alpha: false })
        if (!gl) throw new Error('WebGL unavailable')
        renderer = createCatalogPointRenderer(gl, plan.capacity, dimensions, true)
        const ownedRenderer = renderer, generation = restorationGeneration
        const finish = () => {
          restoring = false; setRestoration(null)
          if (!coherent) { ownedRenderer.invalidatePositions(); setDisplay({ count: 0, visible: 0, pending: false }) }
          viewKey = ''; selectionViewKey = ''
          if (!draw(true)) return false
          if (epochReady) requestEpoch(targetEpochRef.current)
          if (active) setUnavailable(false)
          return true
        }
        if (retained.length) {
          restoring = true
          setRestoration({ rows: 0, total: count.drawnRows }); setUnavailable(false)
          setDisplay({ count: 0, visible: 0, pending: true })
          let tileIndex = 0, rowOffset = 0, restoredRows = 0
          const upload = () => {
            restorationFrame = 0
            if (!active || !restoring || generation !== restorationGeneration || renderer !== ownedRenderer) return
            try {
              const start = performance.now()
              do {
                const tile = retained[tileIndex]
                const end = Math.min(tile.sizes.length, rowOffset + UPLOAD_SLICE_ROWS)
                const positions = tile.positions.subarray(rowOffset*dimensions, end*dimensions)
                if (tile.colors instanceof Uint8Array && tile.sizes instanceof Uint8Array) {
                  ownedRenderer.append({ positions, colors: tile.colors.subarray(rowOffset*3, end*3), sizes: tile.sizes.subarray(rowOffset, end) })
                } else if (tile.colors instanceof Float32Array && tile.sizes instanceof Float32Array) {
                  ownedRenderer.append({ positions, colors: tile.colors.subarray(rowOffset*3, end*3), sizes: tile.sizes.subarray(rowOffset, end) })
                } else throw new Error('Mismatched retained catalog attribute formats')
                restoredRows += end-rowOffset; rowOffset = end
                if (rowOffset === tile.sizes.length) { tileIndex++; rowOffset = 0 }
              } while (tileIndex < retained.length && performance.now()-start < UPLOAD_FRAME_BUDGET_MS)
              if (gl?.isContextLost()) throw new Error('Catalog WebGL context is lost')
              setRestoration({ rows: restoredRows, total: count.drawnRows })
              if (tileIndex < retained.length) restorationFrame = requestAnimationFrame(upload)
              else {
                if (restoredRows !== count.drawnRows) throw new Error('Catalog restoration row count mismatch')
                finish()
              }
            } catch (error) { fail(error) }
          }
          restorationFrame = requestAnimationFrame(upload)
        } else if (!finish()) return false
        return true
      } catch (error) {
        renderer?.dispose(); renderer = null
        queueMicrotask(() => { if (active) { setUnavailable(true); fail(error) } })
        return false
      }
    }
    const lost = (event: Event) => {
      event.preventDefault()
      // A selection already posted by the worker belongs to the lost context.
      // Restoration requests fresh indices after rebuilding the attributes.
      viewRequestId++
      cancelView()
      setDisplay(previous => ({ ...previous, selectionMs: undefined }))
      invalidatePresentation()
      stopRestoration()
      renderer?.dispose(); renderer = null
      setUnavailable(true)
      if (worker && (loading || epochBusy || appendPending)) cancel()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', initialize)
    const prepareCapture = () => { draw(true) }
    canvas.addEventListener('solar-atlas-prepare-canvas-capture', prepareCapture)
    drawRef.current = draw
    const resize = new ResizeObserver(() => { draw() }); resize.observe(canvas)
    const startWorker = () => {
      worker = new Worker(new URL('../workers/catalog-stream.worker.ts', import.meta.url), { type: 'module' })
      const ownedWorker = worker
      const currentWorker = () => active && worker === ownedWorker && !failed && !discardedSnapshot
      worker.onerror = event => { if (currentWorker()) workerFailure(new Error(event.message || 'Catalog streaming failed')) }
      worker.onmessageerror = () => { if (currentWorker()) workerFailure(new Error('Catalog worker response could not be decoded')) }
      worker.onmessage = (event: MessageEvent<CatalogStreamResponse>) => {
        if (!currentWorker()) return
        const response = event.data
        if (!response || typeof response !== 'object' || ![
          'tile', 'done', 'error', 'cancelled', 'selection', 'selection-error',
          'epoch-start', 'epoch-tile', 'epoch-reuse', 'epoch-done', 'epoch-error',
          'append-tile', 'append-done', 'append-error',
        ].includes(response.type)) { fail(new Error('Invalid catalog worker response type')); return }
        // A decode/worker error can occur after initial loading while retained
        // epochs or camera selections are active. Do not ignore that failure,
        // but do not replace a deliberate cancellation with a late error.
        if (response.type === 'error' && !stopped) { fail(new Error(response.error)); return }
        if (response.type === 'append-tile' || response.type === 'append-done' || response.type === 'append-error') {
          const pending = appendPending
          if (stopped || !pending || pending.request.requestId !== response.requestId) return
          try {
            const checkAppendDeadline = () => {
              if (performance.now() >= pending.deadline) throw new Error('Catalog append exceeded its 300-second resource limit')
            }
            checkAppendDeadline()
            if (response.type === 'append-error') throw new Error(response.error)
            if (!renderer || restoring || !appendLookup || !appendBase || response.startRow !== pending.request.startRow ||
                response.julianDay !== pending.request.julianDay) throw new Error('Catalog append response identity mismatch')
            const selection = checkCatalogAppendReceipt(response.result,{ manifest, locators: pending.request.locators,
              maximumRows: pending.maximumRows, contentSha256: appendBase.contentSha256, indexSha256: appendBase.indexSha256 })
            if (response.type === 'append-tile') {
              if (pending.result || response.count < 1 || response.count !== response.result.drawnRows ||
                  count.drawnRows+response.count > plan.capacity || !(response.positions instanceof Float64Array) ||
                  response.positions.length !== response.count*dimensions || !hasOnlyFiniteValues(response.positions) ||
                  !(response.appearance instanceof Uint8Array) || response.appearance.length !== response.count*2) {
                throw new Error('Invalid catalog append upload')
              }
              pending.reservation = appendLookup.prepareAppend(selection,response.startRow)
              if (pending.reservation.count !== response.count) throw new Error('Catalog append mask count differs from upload')
              const attributes: Attributes = { positions: new Float32Array(response.positions),
                colors: new Uint8Array(response.count*3), sizes: new Uint8Array(response.count) }
              if (!hasOnlyFiniteValues(attributes.positions)) throw new Error('Catalog append exceeds GPU coordinates')
              for (let row=0;row<response.count;row++) {
                const classIndex = response.appearance[row*2], flags = response.appearance[row*2+1]
                if (!classCodes || classIndex >= classCodes.length || flags > 7) throw new Error('Invalid appended catalog appearance')
                const styleOffset = (classIndex*8+flags)*4, colorOffset = row*3
                attributes.colors[colorOffset] = pointStyles[styleOffset]
                attributes.colors[colorOffset+1] = pointStyles[styleOffset+1]
                attributes.colors[colorOffset+2] = pointStyles[styleOffset+2]
                attributes.sizes[row] = pointStyles[styleOffset+3]
              }
              renderer.append(attributes); checkGl(); retained.push(attributes)
              checkAppendDeadline()
              pending.result = response.result; pending.addedRows = response.count
              post({ type: 'append-ack', requestId: response.requestId, startRow: response.startRow, count: response.count })
              return
            }
            if (response.addedRows !== response.result.drawnRows || response.count !== count.drawnRows+response.addedRows ||
                response.addedRows !== (pending.addedRows ?? 0)) throw new Error('Catalog append completed before matching upload')
            if (pending.result) {
              const old = pending.result
              if (JSON.stringify({ ...old, sourceSelection: undefined }) !== JSON.stringify({ ...response.result, sourceSelection: undefined }) ||
                  old.sourceSelection!.shards.length !== selection.shards.length || old.sourceSelection!.shards.some((shard,index) => {
                    const next = selection.shards[index]
                    return shard.chunk !== next.chunk || shard.sha256 !== next.sha256 || shard.metadataSha256 !== next.metadataSha256 ||
                      shard.selectedRows.length !== next.selectedRows.length || shard.selectedRows.some((value,byte) => value !== next.selectedRows[byte])
                  })) throw new Error('Catalog append completion changed its uploaded receipt')
              checkAppendDeadline()
              pending.reservation!.commit(response.startRow,response.addedRows)
              recordEpochBlockCounts(response.addedRows)
              const speed = response.result.maximumSpeedAUPerTtDay ?? null
              sourceMaximumSpeed = count.drawnRows === 0 ? speed : sourceMaximumSpeed === null || speed === null ? null : Math.max(sourceMaximumSpeed,speed)
              setMaximumSpeed(sourceMaximumSpeed)
              count.drawnRows = response.count; appendRemaining -= response.addedRows
              setAppendReceipts(previous => [...previous,{ ...response, requestedLocators: pending.request.locators }])
            }
            checkAppendDeadline()
            clearTimeout(pending.timer)
            setLastAppendAttempt({ ...response, requestedLocators: pending.request.locators })
            appendPending = null; coherent = true
            if (response.addedRows) {
              // New blocks require a receipt handshake covering the new layout.
              completedEpochEvidence = null
              uniformEpoch = null; installedDrift = Infinity
            } else {
              // No coordinates or epochs changed. Restore prior evidence and
              // let the normal clock budget decide whether an update is needed.
              setComputedEpoch(uniformEpoch); setEpochEvidence(completedEpochEvidence)
            }
            setStatus({ ...count, phase: snapshotComplete ? 'complete' : 'limited' })
            requestEpoch(targetEpochRef.current)
            draw(true)
          } catch (error) { fail(error) }
          return
        }
        if (response.type === 'epoch-start' || response.type === 'epoch-tile' || response.type === 'epoch-reuse' || response.type === 'epoch-done' || response.type === 'epoch-error') {
          if (!epochBusy || response.requestId !== epochId) {
            if (response.type === 'epoch-tile') recycle(response)
            else if (response.type === 'epoch-reuse') post({ type: 'epoch-reuse-ack', requestId: response.requestId, startRow: response.startRow, count: response.count })
            return
          }
          try {
            if (response.type === 'epoch-error') throw new Error(response.error)
            if (!renderer || response.julianDay !== requestedEpoch) throw new Error('Catalog epoch identity mismatch')
            if (response.type !== 'epoch-start' && !epochStarted) throw new Error('Catalog epoch data arrived before its start receipt')
            if (response.type === 'epoch-start') {
              if (epochStarted || response.count !== count.drawnRows) throw new Error('Duplicate or mismatched catalog epoch start receipt')
              epochStarted = true
              if (epochTiles.length) throw new Error('Catalog epoch started with an unreturned upload tile')
              updatedRows = 0; nextEpochTileRow = 0; retainedTile = 0; retainedOffset = 0
              observedBlockEpochs = new Float64Array(epochBlockCounts.length * 2)
              observedBlock = 0; observedBlockRows = 0
              reusedRows = 0; maximumReuseDrift = 0; minimumActualEpoch = Infinity; maximumActualEpoch = -Infinity
              renderer.beginPositionUpdate()
            } else if (response.type === 'epoch-reuse') {
              if (epochTiles.length || response.startRow !== updatedRows || response.startRow !== nextEpochTileRow || !Number.isSafeInteger(response.count) || response.count < 1 || response.count > Math.max(manifest.chunkSize,plan.appendCapacity) ||
                  updatedRows+response.count > count.drawnRows || !Number.isFinite(response.computedJulianDay) || response.computedJulianDay < 2441317.5 ||
                  !Number.isFinite(response.displacementAU) || response.displacementAU < 0 || response.displacementAU > requestedBudget ||
                  (response.computedJulianDay === requestedEpoch) !== (response.displacementAU === 0)) throw new Error('Invalid catalog reused-block receipt')
              renderer.retainPositions(response.startRow, response.count); advanceCpuSnapshot(response.count)
              recordEpochRows(response.count, response.computedJulianDay, response.displacementAU)
              updatedRows += response.count; nextEpochTileRow += response.count; reusedRows += response.count
              maximumReuseDrift = Math.max(maximumReuseDrift, response.displacementAU)
              minimumActualEpoch = Math.min(minimumActualEpoch, response.computedJulianDay); maximumActualEpoch = Math.max(maximumActualEpoch, response.computedJulianDay)
              post({ type: 'epoch-reuse-ack', requestId: response.requestId, startRow: response.startRow, count: response.count })
            } else if (response.type === 'epoch-tile') {
              if (epochTiles.length >= CATALOG_EPOCH_UPLOAD_SLOTS || !(response.positions instanceof Float64Array) ||
                  !Number.isSafeInteger(response.startRow) || response.startRow !== nextEpochTileRow ||
                  !Number.isSafeInteger(response.count) || response.count < 1 || response.count > 16384 ||
                  response.positions.length !== response.count*dimensions || response.startRow+response.count > count.drawnRows) {
                throw new Error('Invalid catalog epoch transfer window or coordinates')
              }
              epochTiles.push(response); nextEpochTileRow += response.count
              if (!epochFrame) epochFrame = requestAnimationFrame(flushEpochTile)
            } else {
              if (epochTiles.length || response.count !== updatedRows || updatedRows !== count.drawnRows || nextEpochTileRow !== count.drawnRows ||
                  observedBlock !== epochBlockCounts.length || observedBlockRows !== 0) throw new Error('Catalog epoch completed before upload')
              const timing = response.workerTimingMs
              if (!timing || ![timing.computeAndYield,timing.propagation,timing.cooperativeYield,
                timing.tileOwnershipWait,timing.reuseAckWait,timing.total]
                  .every(value => Number.isFinite(value) && value >= 0) ||
                  timing.tileRows !== CATALOG_EPOCH_TILE_ROWS ||
                  timing.maxUnacknowledgedTiles !== CATALOG_EPOCH_UPLOAD_SLOTS || !Number.isSafeInteger(timing.peakUnacknowledgedTiles) ||
                  timing.peakUnacknowledgedTiles < (response.recomputedRows === 0 ? 0 : 1) ||
                  timing.peakUnacknowledgedTiles > timing.maxUnacknowledgedTiles) {
                throw new Error('Invalid catalog epoch worker timing receipt')
              }
              if (response.reusedRows !== reusedRows || response.recomputedRows !== updatedRows-reusedRows || response.maximumDisplacementAU !== maximumReuseDrift ||
                  (updatedRows ? !response.computedEpochRange || response.computedEpochRange[0] !== minimumActualEpoch || response.computedEpochRange[1] !== maximumActualEpoch : response.computedEpochRange !== null)) throw new Error('Catalog epoch provenance summary mismatch')
              if (response.maximumDriftAU !== requestedBudget || !(response.blockEpochs instanceof Float64Array) ||
                  response.blockEpochs.length !== epochBlockCounts.length*4) throw new Error('Invalid catalog block epoch evidence')
              let blockRows = 0, blockMinimum = Infinity, blockMaximum = -Infinity, blockDrift = 0
              for (let offset = 0; offset < response.blockEpochs.length; offset += 4) {
                const [start, rows, epoch, drift] = response.blockEpochs.subarray(offset, offset+4)
                if (start !== blockRows || rows !== epochBlockCounts[offset/4] || !Number.isSafeInteger(rows) || rows < 1 || rows > CATALOG_EPOCH_TILE_ROWS ||
                    !Number.isFinite(epoch) || epoch < 2441317.5 || !Number.isFinite(drift) || drift < 0 || drift > requestedBudget ||
                    (epoch === requestedEpoch) !== (drift === 0) || epoch !== observedBlockEpochs[offset/2] ||
                    drift !== observedBlockEpochs[offset/2+1]) throw new Error('Invalid contiguous catalog block evidence')
                blockRows += rows; blockMinimum = Math.min(blockMinimum, epoch); blockMaximum = Math.max(blockMaximum, epoch); blockDrift = Math.max(blockDrift, drift)
              }
              if (blockRows !== updatedRows || blockDrift !== maximumReuseDrift ||
                  updatedRows > 0 && (blockMinimum !== minimumActualEpoch || blockMaximum !== maximumActualEpoch)) throw new Error('Catalog block evidence differs from uploaded epoch')
              renderer.finishPositionUpdate(false); coherent = true; epochBusy = false; epochStarted = false; installedEpoch = requestedEpoch
              installedDrift = response.maximumDisplacementAU
              uniformEpoch = response.computedEpochRange && response.computedEpochRange[0] === response.computedEpochRange[1] ? response.computedEpochRange[0] : null
              completedEpochEvidence = response
              awaitingPresentation = true
              setComputedEpoch(uniformEpoch); setEpochEvidence(response); viewKey = ''; selectionViewKey = ''
              if (!draw(true)) return
              setStatus({ ...count, phase: snapshotComplete ? 'complete' : 'limited' })
              // Capped display modes wait for matching selection before presenting.
            }
          } catch (error) { fail(error) }
          return
        }
        if (response.type === 'selection' || response.type === 'selection-error') {
          if (response.requestId !== inFlightView) return
          inFlightView = null
          const detail = detailRef.current
          if (response.requestId !== viewRequestId) {
            viewKey = ''
            draw()
            return
          }
          if (restoring || !coherent) return
          if (response.type === 'selection-error') { workerFailure(new Error(response.error)); return }
          try {
            if (!Number.isSafeInteger(response.count) || response.count < 1 || response.count !== lastViewRequestedCount || response.count > count.drawnRows ||
                !renderer || !(response.indices instanceof Uint32Array) || response.indices.byteOffset !== 0 ||
                !(response.indices.buffer instanceof ArrayBuffer) || response.indices.buffer.byteLength !== response.indices.byteLength ||
                response.indices.length > Math.min(detail.displayLimit,response.count) ||
                response.indices.length > 0 && response.indices[response.indices.length-1] >= response.count ||
                !Number.isSafeInteger(response.visible) || response.visible < response.indices.length || response.visible > response.count ||
                !Number.isSafeInteger(response.edgeCandidates) || response.edgeCandidates < 0 || response.edgeCandidates > response.visible ||
                !Number.isFinite(response.selectionMs) || response.selectionMs < 0) throw new Error('Invalid catalog display selection')
            const hasSpatialWorkCounters = response.testedRows !== undefined || response.skippedRows !== undefined
            if ((detail.displayMode === 'spatial') !== hasSpatialWorkCounters) throw new Error('Catalog selection counters do not match display mode')
            if (hasSpatialWorkCounters) {
              if (!Number.isSafeInteger(response.testedRows) || !Number.isSafeInteger(response.skippedRows) || response.testedRows! < 0 || response.skippedRows! < 0 ||
                  response.testedRows!+response.skippedRows! !== response.count || response.visible > response.testedRows!) throw new Error('Invalid catalog spatial work counters')
            }
            if ((detail.displayMode === 'spatial') !== Boolean(response.countOverlay)) throw new Error('Catalog screen-count overlay does not match display mode')
            const countOverlaySummary = response.countOverlay
              ? drawCatalogScreenCountOverlay(countOverlayCanvasRef.current!, response.countOverlay)
              : undefined
            if (response.countOverlay && response.countOverlay.sourceRows !== response.visible-response.edgeCandidates) {
              throw new Error('Catalog screen-count overlay does not cover the exact viewport rows')
            }
            renderer.setSpatialSelectionFromWorker(response.indices)
            setDisplay({ count: response.indices.length, visible: response.visible, selectionRows: response.count,
              selectionMs: response.selectionMs, edgeCandidates: response.edgeCandidates, pending: false,
              testedRows: response.testedRows, skippedRows: response.skippedRows, countOverlay: countOverlaySummary })
            // The draw validates index upload and draw errors together before
            // publishing this selection as presented.
            if (!draw(true)) return
            // draw() may schedule a follow-up progress pass. Its pending state
            // must not be overwritten by this completed, older selection.
            if (response.requestId !== viewRequestId || !coherent) return
            if (awaitingPresentation && inFlightView === null) finishPresentation()
          } catch (error) { fail(error) }
        } else if (response.type === 'tile') {
          if (!acceptingTiles) return
          if (pendingTiles.length >= CATALOG_TRANSFER_WINDOW) { fail(new Error('Catalog transfer window exceeded')); return }
          pendingTiles.push(response)
          if (!frameId) frameId = requestAnimationFrame(flushTiles)
        } else {
          // Cancellation/failure can happen after the worker posted its last
          // message. A queued terminal response must not revive that load.
          // Selection messages remain valid for the retained stopped snapshot.
          if (!acceptingTiles) return
          loading = false
          if (response.type === 'error') fail(new Error(response.error))
          else if (response.type === 'cancelled') {
            acceptingTiles = false
            lastViewRequestedCount = 0
            setStatus({ ...count, phase: 'cancelled' })
            viewKey = ''
            draw()
          }
          else if (response.type !== 'done') fail(new Error('Unexpected catalog completion response'))
          else if (pendingTiles.length || response.drawnRows !== count.drawnRows || response.sourceRows !== count.sourceRows) fail(new Error('Catalog completed before all tiles were uploaded'))
          else {
            acceptingTiles = false
            try { checkCatalogReadEvidence(response.reads,manifest) } catch (error) { fail(error); return }
            setReadEvidence(response.reads)
            if (response.retainedEpochs !== retainEpochs) { fail(new Error('Catalog completion differs from admitted epoch retention')); return }
            const speed = response.maximumSpeedAUPerTtDay
            if (speed != null && (!Number.isFinite(speed) || speed <= 0)) { fail(new Error('Invalid catalog temporal speed bound')); return }
            const screening = response.screening
            if (typeof response.complete !== 'boolean' || !screening ||
                !Number.isSafeInteger(screening.admittedShards) || screening.admittedShards < 0 || screening.admittedShards > manifest.chunkCount ||
                !Number.isSafeInteger(screening.completedShards) || screening.completedShards < 0 || screening.completedShards > screening.admittedShards ||
                !Number.isSafeInteger(screening.metadataOnlyRows) || screening.metadataOnlyRows < 0 || screening.metadataOnlyRows > response.sourceRows ||
                screening.completionReason !== (response.complete ? 'exhausted' : 'capacity') ||
                response.complete && screening.completedShards !== screening.admittedShards ||
                !response.complete && response.drawnRows !== plan.initialCapacity) { fail(new Error('Invalid catalog completion evidence')); return }
            if (!Array.isArray(screening.shards) || screening.shards.length > screening.admittedShards || screening.shards.length !== uploadedShards.length) { fail(new Error('Invalid screened shard evidence')); return }
            const screened = new Map<number, (typeof screening.shards)[number]>()
            let examined = 0, selected = 0, metadataOnly = 0, completed = 0
            for (const shard of screening.shards) {
              if (!shard || !Number.isSafeInteger(shard.chunk) || shard.chunk < 0 || shard.chunk >= manifest.chunkCount || screened.has(shard.chunk) ||
                  !/^[a-f0-9]{64}$/.test(shard.metadataSha256)) { fail(new Error('Invalid screened shard identity')); return }
              const rows = Math.min(manifest.chunkSize, manifest.totalCount-shard.chunk*manifest.chunkSize)
              if (!Number.isSafeInteger(shard.examinedRows) || shard.examinedRows < 1 || shard.examinedRows > rows ||
                  !Number.isSafeInteger(shard.selectedRows) || shard.selectedRows < 0 || shard.selectedRows > shard.examinedRows ||
                  (shard.outcome === 'metadata-rejected' ? shard.binarySha256 !== null || shard.selectedRows !== 0 || shard.examinedRows !== rows
                    : shard.outcome !== 'source-screened' || !/^[a-f0-9]{64}$/.test(shard.binarySha256 ?? ''))) { fail(new Error('Invalid screened shard outcome')); return }
              screened.set(shard.chunk, shard)
              examined += shard.examinedRows; selected += shard.selectedRows
              const uploaded = uploadedShards[screened.size-1]
              if (uploaded.chunk !== shard.chunk || uploaded.selectedRows !== shard.selectedRows || uploaded.sourceRows !== examined || uploaded.drawnRows !== selected) {
                fail(new Error('Screening evidence differs from upload order')); return
              }
              if (shard.examinedRows === rows) completed++
              if (shard.outcome === 'metadata-rejected') metadataOnly += rows
            }
            if (examined !== response.sourceRows || selected !== response.drawnRows || completed !== screening.completedShards ||
                metadataOnly !== screening.metadataOnlyRows) { fail(new Error('Screened shard totals differ from completion')); return }
            {
              const mapping = response.sourceSelection
              if (!mapping || !/^[a-f0-9]{64}$/.test(mapping.indexSha256) ||
                  !/^[a-f0-9]{64}$/.test(mapping.contentSha256) || mapping.contentSha256 !== manifest.contentSha256 ||
                  !Array.isArray(mapping.shards) || mapping.shards.length > manifest.chunkCount) { fail(new Error('Missing or mismatched catalog source selection evidence')); return }
              const chunks = new Set<number>()
              const selectedOrder = screening.shards.filter(shard => shard.selectedRows > 0)
              if (selectedOrder.length !== mapping.shards.length) { fail(new Error('Selected shard count differs from upload order')); return }
              epochBlockCounts = []
              let mappedRows = 0
              for (const shard of mapping.shards) {
                if (!shard || !Number.isSafeInteger(shard.chunk) || shard.chunk < 0 || shard.chunk >= manifest.chunkCount || chunks.has(shard.chunk) ||
                    !/^[a-f0-9]{64}$/.test(shard.sha256) || !/^[a-f0-9]{64}$/.test(shard.metadataSha256)) { fail(new Error('Invalid catalog source shard evidence')); return }
                chunks.add(shard.chunk)
                if (selectedOrder[chunks.size-1].chunk !== shard.chunk) { fail(new Error('Selected shard order differs from uploaded rows')); return }
                const rows = Math.min(manifest.chunkSize, manifest.totalCount-shard.chunk*manifest.chunkSize)
                if (!(shard.selectedRows instanceof Uint8Array) || shard.selectedRows.length !== Math.ceil(rows/8)) { fail(new Error('Invalid catalog source-row bitmap')); return }
                let selectedCount = 0
                for (const value of shard.selectedRows) {
                  const pairs = value-((value >>> 1)&0x55), groups = (pairs&0x33)+((pairs >>> 2)&0x33)
                  selectedCount += (groups+(groups >>> 4))&0x0f
                }
                if (!selectedCount || rows % 8 && shard.selectedRows[shard.selectedRows.length-1] >>> (rows % 8)) { fail(new Error('Invalid catalog source-row bitmap padding')); return }
                const uploadedMask = uploadedMasks.get(shard.chunk)
                if (!uploadedMask || uploadedMask.length !== shard.selectedRows.length ||
                    shard.selectedRows.some((value, index) => value !== uploadedMask[index])) { fail(new Error('Final source-row bitmap differs from uploaded tile')); return }
                const checked = screened.get(shard.chunk)
                if (!checked || checked.selectedRows !== selectedCount || checked.binarySha256 !== shard.sha256 ||
                    checked.metadataSha256 !== shard.metadataSha256) { fail(new Error('Selected shard differs from screening evidence')); return }
                mappedRows += selectedCount
                recordEpochBlockCounts(selectedCount)
              }
              if (mappedRows !== count.drawnRows) { fail(new Error('Catalog source selection does not cover uploaded rows')); return }
              if (plan.appendCapacity) { appendBase = mapping; appendLookup = createCatalogSourceAppendLookup(mapping,plan.capacity) }
              setSourceSelection({ contentSha256: mapping.contentSha256, indexSha256: mapping.indexSha256,
                shards: mapping.shards.map(shard => ({ chunk: shard.chunk, sha256: shard.sha256,
                  metadataSha256: shard.metadataSha256, selectedRows: shard.selectedRows })) })
              setSourceOwner(loadOwner)
              setScreeningEvidence({ ...screening })
              uploadedShards.length = 0; uploadedMasks.clear()
            }
            snapshotComplete = response.complete; epochReady = retainEpochs && response.retainedEpochs === true
            sourceMaximumSpeed = speed ?? null; setMaximumSpeed(sourceMaximumSpeed)
            setStatus({ ...count, phase: response.complete ? 'complete' : 'limited' })
            requestEpoch(targetEpochRef.current)
            draw()
          }
        }
      }
      post({ type: 'start', manifest, filters, julianDay, requestedRows, budgetBytes, mode, priority, retainEpochs, appendRows, priorityLocators: prioritySources?.map(source => source.locator) })
    }
    // Worker construction or start-message cloning can fail synchronously.
    // Keep the effect alive long enough to register its resource cleanup.
    if (initialize()) {
      try { startWorker() } catch (error) { fail(error) }
    }
    return () => {
      active = false
      exportCounter.current++
      stopRestoration()
      cancelRef.current = null
      drawRef.current = null
      epochRef.current = null
      appendRef.current = null
      if (epochFrame) cancelAnimationFrame(epochFrame)
      if (followFrame) cancelAnimationFrame(followFrame)
      if (frameId) cancelAnimationFrame(frameId)
      if (renderObservationFrame) cancelAnimationFrame(renderObservationFrame)
      terminateWorker()
      resize.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', initialize)
      canvas.removeEventListener('solar-atlas-prepare-canvas-capture', prepareCapture)
      renderer?.dispose()
      pendingTiles.length = 0; pendingTileOffset = 0
      retained.length = 0
    }
  }, [manifest, filters, julianDay, requestedRows, budgetBytes, plan.capacity, plan.initialCapacity, plan.appendCapacity, mode, dimensions, priority, retainEpochs, appendRows, prioritySources, retryGeneration, loadOwner, onStopped])

  return <>
    <canvas ref={canvasRef} className="viz-canvas catalog-point-canvas" role="img" aria-label={`${t('catalogPointAria')} ${mode}: ${displayCountLabel}`} data-testid="catalog-stream-canvas" data-drawn-rows={status.drawnRows} data-source-rows={status.sourceRows} data-phase={status.phase} data-capacity={plan.capacity} data-display-count={display.count} data-selection-rows={display.selectionRows} data-spatial-pending={display.pending} data-selection-ms={display.selectionMs} data-tested-rows={display.testedRows} data-skipped-rows={display.skippedRows} data-viewport-candidates={displayMode === 'spatial' ? inViewport : undefined} data-edge-candidates={displayMode === 'spatial' ? display.edgeCandidates : undefined} data-count-overlay-rows={display.countOverlay?.sourceRows} data-count-overlay-cells={display.countOverlay?.occupiedCells} data-count-overlay-max={display.countOverlay?.maximumCount} data-display-mode={displayMode} data-coordinate-mode={mode} data-target-utc-jd={targetJulianDay} data-temporal-budget-au={maximumTemporalDriftAU} />
    <canvas ref={countOverlayCanvasRef} className="catalog-screen-count-overlay" aria-hidden="true"
      style={{ display: displayMode === 'spatial' && !display.pending && !displayUnavailable && display.countOverlay ? 'block' : 'none' }} />
    <div className="catalog-stream-overlay">
    <div className="catalog-stream-status">
      <strong>{status.drawnRows.toLocaleString()} / {plan.capacity.toLocaleString()} · {t('catalogStreamLoaded')}</strong>
      {displayMode === 'all' && display.pending && <span>{t('catalogStreamDisplayed')}: {displayCountLabel}</span>}
      {!display.pending && <span>{t('catalogStreamDisplayed')}: {displayCountLabel}{displayMode === 'spatial' && !displayUnavailable ? ` / ${inViewport.toLocaleString()} ${t('catalogStreamInView')}` : ''}</span>}
      {notSubmittedRows !== null && <span>{t('catalogStreamNotSubmitted')}: {notSubmittedRows.toLocaleString()}</span>}
      {displayMode === 'spatial' && !displayUnavailable && <span>{t(display.pending ? 'catalogSpatialUpdating' : 'catalogSpatialExplanation')}</span>}
      {displayMode === 'spatial' && !displayUnavailable && !display.pending && display.countOverlay &&
        <span>{language === 'zh' ? '视口计数底图：' : 'Viewport count overlay: '}{display.countOverlay.sourceRows.toLocaleString()}
          {language === 'zh' ? ' 条记录，' : ' source rows across '}{display.countOverlay.occupiedCells.toLocaleString()}
          {language === 'zh' ? ` 个有记录的屏幕格，最高格 ${display.countOverlay.maximumCount.toLocaleString()} 条；颜色按当前视口对数缩放。`
            : ` occupied screen cells, maximum ${display.countOverlay.maximumCount.toLocaleString()} rows per cell; color is log-scaled within this view.`}</span>}
      {spatialLimitReached && <span>{t('catalogSpatialLimitApplied')} {display.count.toLocaleString()} / {inViewport.toLocaleString()}.</span>}
      {displayMode === 'spatial' && !displayUnavailable && !display.pending && display.edgeCandidates !== undefined && <span>{language === 'zh' ? '其中边缘余量候选：' : 'Candidates admitted by edge margin: '}{display.edgeCandidates.toLocaleString()}</span>}
      {displayMode === 'spatial' && !displayUnavailable && !display.pending && display.testedRows !== undefined && <span>{language === 'zh' ? '逐点筛选 / 整块跳过：' : 'Points screened / skipped by block: '}{display.testedRows.toLocaleString()} / {display.skippedRows?.toLocaleString()}</span>}
      {!displayUnavailable && !display.pending && display.selectionRows !== undefined && <span>{t('catalogSelectionSnapshotRows')}: {display.selectionRows.toLocaleString()}</span>}
      <span>{t('catalogStreamScanned')}: {status.sourceRows.toLocaleString()} / {manifest.totalCount.toLocaleString()}</span>
      <span role="status">{status.phase === "cancelled" ? (discardedOnCancel
        ? (language === "zh" ? "已停止；未完成的历元快照已丢弃，请重新加载。" : "Stopped; the incomplete epoch snapshot was discarded. Reload to continue.")
        : (language === "zh" ? "已停止更新；保留已加载快照，不代表当前请求时刻已完成。" : "Updates stopped; loaded snapshot retained. The current requested epoch is not confirmed complete.")) : status.phase === 'updating' ? (language === 'zh' ? '正在更新星表对象或历元；完成前隐藏画面。' : 'Updating catalog bodies or epochs; hidden until completion.') : t(status.phase === 'loading' ? 'catalogStreamLoading' : status.phase === 'complete' ? 'catalogStreamComplete' : status.phase === 'limited' ? 'catalogStreamLimited' : 'catalogStreamFailed')}</span>
      {restoration && <span role="status">{language === 'zh' ? '恢复显示：' : 'Restoring display: '}{restoration.rows.toLocaleString()} / {restoration.total.toLocaleString()}</span>}
      {sourceOwner === loadOwner && screeningEvidence?.completionReason === 'exhausted' && status.drawnRows === 0 && <span role="status">{language === 'zh'
        ? '当前目录与筛选条件未找到匹配星体；可导出筛选记录。'
        : 'No matching bodies were found in this catalog for the current filters. Screening evidence can be exported.'}</span>}
      {focusedSource && <span>{focusedSource.id} · {focusedRow === undefined
        ? (language === 'zh' ? '当前快照尚无可确认的上传行' : 'No confirmed uploaded row in this snapshot')
        : (language === 'zh' ? '已载入；位于视野内时保留为代表点' : 'Loaded; retained as a representative when in view')}</span>}
      {Boolean(selectedSources?.length) && <span>{language === 'zh' ? '可定位多选已载入：' : 'Loaded located selections: '}{selectedRows.length} / {selectedSources!.length}.
        {' '}{language === 'zh' ? '最多接入当前记录中 256 个可定位选择；焦点优先，其余按选择顺序占用视野内绘制预算。缺失对象的加载由优先加载与自动跟随选项控制，仍受筛选和总容量限制。' : 'Up to 256 selections with locators in the current records are admitted; focus first, then selection order within the visible draw budget. Loading missing bodies depends on the priority/follow option and remains subject to filters and total capacity.'}</span>}
      {(status.phase === 'loading' || status.phase === 'updating' || restoration !== null) && <button className="secondary-button" data-testid="catalog-stream-cancel" onClick={() => cancelRef.current?.()}>{t('catalogStreamCancel')}</button>}
      {plan.appendCapacity > 0 && <button type="button" className="secondary-button"
        disabled={status.phase !== 'complete' && status.phase !== 'limited' || displayUnavailable ||
          appendReceipts.reduce((total,receipt) => total+receipt.addedRows,0) >= plan.appendCapacity}
        onClick={() => appendRef.current?.([...(focusedSource ? [focusedSource.locator] : []),...(selectedSources ?? []).map(source => source.locator)])}>
        {language === 'zh' ? '追加所选缺失对象' : 'Append missing selected bodies'}
      </button>}
      {plan.appendCapacity > 0 && <span>{language === 'zh' ? '剩余追加名额：' : 'Remaining append slots: '}
        {plan.appendCapacity-appendReceipts.reduce((total,receipt) => total+receipt.addedRows,0)} / {plan.appendCapacity}</span>}
      {plan.appendCapacity > 0 && <span>{language === 'zh'
        ? '追加准备与上传确认限时 300 秒；后续全目录历元核对单独进行。'
        : 'Append preparation and upload acknowledgement have a 300-second limit; subsequent catalog epoch reconciliation is separate.'}</span>}
      {appendNotice && <span role="status">{appendNotice === 'busy'
        ? (language === 'zh' ? '当前加载、历元更新或画面呈现尚未完成，请完成后重试追加。' : 'Loading, epoch updates or presentation are still pending. Retry appending after completion.')
        : appendNotice === 'capacity' ? (language === 'zh' ? '追加名额已耗尽，请刷新以重新分配容量。' : 'Append slots are exhausted. Refresh to allocate a new snapshot.')
        : (language === 'zh' ? '当前可定位的所选对象没有缺失项。' : 'No located selected bodies are missing from this snapshot.')}</span>}
      {lastAppendAttempt && !appendNotice && <span role="status">{language === 'zh' ? '最近一次追加：' : 'Last append: '}
        {lastAppendAttempt.addedRows} / {lastAppendAttempt.requestedLocators.length}
        {' · '}{lastAppendAttempt.result.complete
          ? (language === 'zh' ? '请求对象的筛选已完成；未载入项未通过当前筛选。' : 'Requested-source screening completed; omitted bodies did not match current filters.')
          : (language === 'zh' ? '达到追加容量；未载入项不一定是不匹配。' : 'Append capacity reached; omitted bodies are not necessarily filter mismatches.')}</span>}
      {lastAppendAttempt && <span>{language === 'zh' ? '本次 Worker 索引 / 分片缓存命中：' : 'Worker index / binary cache hits in this attempt: '}
        {lastAppendAttempt.result.reads.indexCacheHits} / {lastAppendAttempt.result.reads.binaryCacheHits}
        {' · '}{language === 'zh' ? '应用层计数，非实测网络节省。' : 'Application counters, not measured network savings.'}</span>}
      {status.error && <span role="alert">{status.error}</span>}
      {spatialWorkerError && <div role="alert"><p>{language === 'zh'
        ? '星表显示筛选 Worker 已停止。已加载快照仍保留；回退画面不再生成视野或均匀间隔代表点。'
        : 'Catalog display selection worker stopped. The loaded snapshot is retained; the fallback no longer selects viewport or evenly spaced representatives.'}
        {status.drawnRows > Math.min(plan.capacity, displayLimit) && <> {language === 'zh'
          ? `为限制绘制量，当前仅按上传顺序绘制前 ${Math.min(plan.capacity, displayLimit).toLocaleString()} 行；它不是均匀或空间代表样本。`
          : `To bound drawing, only the first ${Math.min(plan.capacity, displayLimit).toLocaleString()} uploaded rows are drawn; this is not an even or spatially representative sample.`}</>}
        {' '}{spatialWorkerError}</p>
        <button type="button" className="secondary-button" onClick={() => { onRestarted?.(); setRetryGeneration(value => value+1) }}>{language === 'zh' ? '重新加载' : 'Reload'}</button></div>}
    </div>
    {computedEpoch !== null && status.drawnRows > 0 && <p className="catalog-point-epoch" data-testid="catalog-point-epoch" data-utc-jd={computedEpoch}>
      {t(mode === '3d' ? 'catalogPointModel3d' : 'catalogPointModel')} <time dateTime={julianDayToDate(computedEpoch).toISOString()}>{julianDayToDate(computedEpoch).toISOString().replace('T', ' ')}</time>
    </p>}
    {epochEvidence && <p className="catalog-result-note" data-testid="catalog-block-epochs"
      data-min-computed-utc-jd={epochEvidence.computedEpochRange?.[0]}
      data-max-computed-utc-jd={epochEvidence.computedEpochRange?.[1]}
      data-maximum-displacement-au={epochEvidence.maximumDisplacementAU}>
      {language === 'zh' ? '本次复算 / 复用行数：' : 'Rows recomputed / reused: '}{epochEvidence.recomputedRows.toLocaleString()} / {epochEvidence.reusedRows.toLocaleString()}.
      {epochEvidence.computedEpochRange && <> {language === 'zh' ? '实际计算历元范围（UTC JD）：' : 'Actual computed epoch range (UTC JD): '}{epochEvidence.computedEpochRange.join(' – ')}.</>}
      {' '}{language === 'zh' ? '验收目标（UTC JD）：' : 'Evaluated target (UTC JD): '}{epochEvidence.julianDay}.
      {' '}{language === 'zh' ? '跨历元复用属于所选两体模型预算内的近似，不是同一时刻的精确星历。' : 'Cross-epoch reuse is an approximation under the selected two-body displacement budget, not exact same-epoch ephemerides.'}
    </p>}
    {sourceSelection && screeningEvidence && sourceOwner === loadOwner && <button type="button" className="secondary-button" onClick={() => {
      const generation = ++exportGeneration.current
      setExportError('')
      const reportError = (error: unknown) => {
        if (generation === exportGeneration.current) setExportError(error instanceof Error ? error.message : String(error))
      }
      try {
        const receipt = { schemaVersion: plan.appendCapacity ? 4 : 3, calculation: epochEvidence ? 'catalog-block-temporal-reuse-evidence-v1' : 'catalog-source-screening-evidence-v1', build: BUILD_INFO,
          source: { manifest, filters, priority, prioritySources: prioritySources ?? [], requestedRows, mode, initialJulianDayUTC: julianDay,
            screening: screeningEvidence,
            reads: readEvidence,
            examinedRows: status.sourceRows, loadedRows: status.drawnRows-appendReceipts.reduce((total,receipt) => total+receipt.addedRows,0),
            selection: { contentSha256: sourceSelection.contentSha256, indexSha256: sourceSelection.indexSha256,
              integrity: 'Worker verified loaded source bytes against the checksum descriptor bound to manifest.contentSha256. This is not an independent signature or scientific accuracy assessment.',
              layout: 'Shards in upload order; within each shard, ascending row indices with least-significant-bit-first bitmap bytes. Binary paths are binary/chunk-NNNN.bin; metadata paths are meta/chunk-NNNN.json. Metadata hashes cover original JSON bytes.',
              shards: sourceSelection.shards.map(shard => ({ chunk: shard.chunk, sha256: shard.sha256,
                metadataSha256: shard.metadataSha256, selectedRows: encodeCatalogMask(shard.selectedRows) })) } },
          additions: appendReceipts.map(receipt => ({ ...receipt, result: { ...receipt.result,
            sourceSelection: { ...receipt.result.sourceSelection!, shards: receipt.result.sourceSelection!.shards.map(shard => ({
              ...shard, selectedRows: encodeCatalogMask(shard.selectedRows) })) } } })),
          totalLoadedRows: status.drawnRows,
          lastAppendAttempt: lastAppendAttempt ? { ...lastAppendAttempt, result: { ...lastAppendAttempt.result,
            sourceSelection: { ...lastAppendAttempt.result.sourceSelection!, shards: lastAppendAttempt.result.sourceSelection!.shards.map(shard => ({
              ...shard, selectedRows: encodeCatalogMask(shard.selectedRows) })) } } } : null,
          additionLayout: 'Base source rows first, then additions in acknowledged order at each startRow; preserve repeated shards as separate batches. Never union masks to derive upload rows.',
          budget: { bytes: budgetBytes, admittedRows: plan.capacity, initialRows: plan.initialCapacity, appendRows: plan.appendCapacity,
            appendReservedBytes: plan.appendReservedBytes, reservedBytes: plan.reservedBytes,
            appendTimeoutMs: plan.appendCapacity ? CATALOG_APPEND_TIMEOUT_MS : null,
            metadataMaximumBytes: plan.metadataMaximumBytes, metadataReservedBytes: plan.metadataReservedBytes,
            metadataHeapReservation: 'estimate, not an engine heap or browser RSS bound' },
          epoch: epochEvidence ? { ...epochEvidence, blockEpochs: encodeCatalogEpochs(epochEvidence.blockEpochs),
            blockLayout: ['startUploadedRow', 'rowCount', 'computedJulianDayUTC', 'displacementToEvaluatedTargetAU'] } : null,
          display: { requestedJulianDayUTC: targetJulianDay, phase: status.phase, mode: displayMode, maximumPoints: displayLimit,
            spatialWorkerError: spatialWorkerError || null,
            selectionPending: display.pending,
            available: !displayUnavailable,
            counts: display.pending || displayUnavailable ? null : { submittedPoints: display.count, selectionRows: display.selectionRows,
              ...(displayMode === 'spatial' ? { viewportCandidates: inViewport, edgeCandidates: display.edgeCandidates,
                testedRows: display.testedRows, skippedRows: display.skippedRows,
                countOverlay: display.countOverlay ? { ...display.countOverlay, model: 'exact-in-viewport-source-row-count-per-equal-area-projected-screen-cell',
                  meaning: 'Screen-bin counts only; not depth-normalized three-dimensional physical density, probability or event rate.' } : null } : {}) },
            selectionPolicy: spatialWorkerError
              ? status.drawnRows > Math.min(plan.capacity, displayLimit)
                ? { model: 'upload-order prefix fallback after selection worker failure', priority: 'first rows up to the draw cap',
                    meaning: 'Not a spatially or statistically representative sample; source ordering may bias what is shown.' }
                : { model: 'direct uploaded rows after selection worker failure', priority: 'all rows fit under the draw cap',
                    meaning: 'No viewport representative selection was performed.' }
              : displayMode === 'spatial'
                ? { model: 'screen-cell representatives', priority: 'focus-and-selections-first; viewport-interior before margin-only; deterministic hash within tier',
                    meaning: 'Exact selected source positions plus a count overlay for every mathematical-viewport source row; screen-bin counts are not depth-normalized three-dimensional physical density or event probability.' }
                : { model: 'deterministic-even-spacing-in-upload-order', priority: 'focus then located selections before remaining rows',
                    meaning: 'Display thinning only; not a spatial or statistical sample.' },
            viewportPolicy: displayMode === 'spatial' && !spatialWorkerError ? { model: 'outward-Float32-screening', relativeMargin: CATALOG_CLIP_RELATIVE_MARGIN,
              representativePriority: 'explicit-pins-then-viewport-interior-before-margin-only; deterministic-hash-within-tier',
              meaning: 'Candidate admission, not an on-screen pixel count or physical position uncertainty.' } : null,
            focusedSource: focusedSource ?? null, focusedUploadedRow: focusedRow ?? null,
            selectedSources: selectedSources ?? [], selectedUploadedRows: selectedRows,
            selectedSourceRows,
            selectedSourceRowLayout: 'One entry per selected source in caller order; uploadedRow is null for an absent source. selectedUploadedRows is the compact list of present rows, not positionally aligned with selectedSources.',
            radiusAU: viewRadiusAU, rotation: mode === '3d' ? rotation : null, currentTargetDisplacementAU: temporalDrift },
          limitations: ['Source locators and checked content hashes, not hydrated object identities or an exported position catalog. Hashes establish consistency with the fetched checksum list, not independent source authentication.',
            'Read counters describe application attempts and successfully completed artifact bodies, including prefetch outcomes. They exclude partial failed-body bytes, transport compression/overhead and browser HTTP-cache behavior; worker-cache reused bytes are not measured network savings or throughput.',
            'Scanned source rows can include metadata-only name-query rejections. Their orbital bytes need not have been downloaded or validated.',
            'A null epoch means no completed temporal-reuse evidence is attached; source screening is not a temporal propagation result.',
            'Computed dates may differ per block. Displacement covers only temporal reuse of the selected two-body model.',
            'Physical orbit uncertainty, solver/GPU error and unknown future leap seconds are excluded.',
            'An evaluated target is not confirmation that the current requested target or current display has completed.'] }
        void saveTextExport(JSON.stringify(receipt, null, 2), epochEvidence ? 'solar-catalog-block-epochs.json' : 'solar-catalog-screening.json', 'application/json')
          .catch(reportError)
      } catch (error) { reportError(error) }
    }}>{epochEvidence ? (language === 'zh' ? '导出分块历元与来源 JSON' : 'Export block epochs and sources JSON')
      : (language === 'zh' ? '导出筛选与来源 JSON' : 'Export screening and sources JSON')}</button>}
    {exportError && <p role="alert">{exportError}</p>}
    {retainEpochs && maximumTemporalDriftAU > 0 && <p className="catalog-result-note" data-testid="catalog-stream-temporal-budget">
      {language === 'zh' ? '请求时刻相对已计算历元的两体模型位移上限：' : 'Two-body model displacement cap from computed to requested epoch: '}
      {temporalDrift === null ? (language === 'zh' ? '当前不可用' : 'currently unavailable') : `${temporalDrift.toPrecision(6)} AU`}
      {' · '}{language === 'zh' ? '复用预算：' : 'Reuse budget: '}{maximumTemporalDriftAU} AU.
      {' '}{language === 'zh' ? '计算日期保持不变；此界不含轨道物理误差、求解舍入或 GPU 精度。TT 间隔使用固定闰秒表，未知未来闰秒沿用末值，数值 UTC 不表示闰秒标签本身。更新或取消时不承诺请求历元已满足预算。' : 'The computed date is unchanged. This cap excludes physical orbit error, solver rounding and GPU precision. TT intervals use a frozen leap-second table with the last value held for unknown future leaps; numeric UTC cannot encode the leap-second label itself. Updating or cancellation does not certify the requested epoch is within budget.'}
    </p>}
    </div>
    {unavailable && <div className="empty-state catalog-render-status" role="status"><p>{language === "zh" ? "当前星表视图不可用，可重新加载；表格仍可使用。" : "This catalog view is unavailable. Reload the view; the table remains usable."}</p>
      <button type="button" className="secondary-button" onClick={() => { onRestarted?.(); setRetryGeneration(value => value+1) }}>{language === 'zh' ? '重新加载当前星表视图' : 'Reload this catalog view'}</button>
    </div>}
  </>
}
