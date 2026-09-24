import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { catalogPointColor, catalogPointSize } from '../lib/catalogPointAppearance'
import { createCatalogPointRenderer, type CatalogPointFrame } from '../lib/catalogPointRenderer'
import { planCatalogStream, type CatalogStreamPriority, type CatalogSourceSelection, type CatalogStreamResult } from '../lib/catalogStreaming'
import { julianDayToDate } from '../lib/julianDate'
import type { AsteroidManifest, CatalogFilters, CatalogLocator } from '../types'
import type { CatalogStreamRequest, CatalogStreamResponse } from '../workers/catalog-stream.protocol'
import { CATALOG_TRANSFER_WINDOW } from '../lib/catalogTransferWindow'
import type { CatalogRotation } from '../lib/catalogProjection'
import { catalogTemporalDisplacementAU } from '../engine/ephemeris/catalogTemporalBudget'
import type { CatalogEpochResult } from '../lib/catalogEpochStore'
import { saveTextExport } from '../lib/platform'
import { BUILD_INFO } from '../lib/buildInfo'
import { encodeCatalogEpochs, encodeCatalogMask } from '../lib/catalogEvidenceEncoding'
import { createCatalogSourceRowLookup } from '../lib/catalogSourceRow'
import { createCatalogSourceAppendLookup } from '../lib/catalogSourceAppendLookup'
import { checkCatalogAppendReceipt } from '../lib/catalogAppendReceipt'
import { CATALOG_APPEND_TIMEOUT_MS } from '../lib/catalogAppendLimits'
import { checkCatalogReadEvidence } from '../lib/catalogReadEvidence'
import { CATALOG_CLIP_RELATIVE_MARGIN } from '../lib/catalogProjection'
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
  onStopped?: () => void
  onRestarted?: () => void
}
type Status = { drawnRows: number; sourceRows: number; phase: 'loading' | 'updating' | 'complete' | 'limited' | 'cancelled' | 'error'; error?: string }
type Attributes = Pick<CatalogPointFrame, 'positions' | 'colors' | 'sizes'>
type AppendReceipt = Extract<CatalogStreamResponse, { type: 'append-done' }> & { requestedLocators: readonly CatalogLocator[] }

const DEFAULT_ROTATION: CatalogRotation = { azimuthDegrees: 0,tiltDegrees: 0 }
const UPLOAD_SLICE_ROWS = 4096
const UPLOAD_FRAME_BUDGET_MS = 3

export function CatalogStreamCanvas({ manifest, filters, julianDay, requestedRows, budgetBytes, viewRadiusAU, displayMode, displayLimit, mode = '2d', priority = 'source', rotation = DEFAULT_ROTATION, retainEpochs = false, appendRows = 0, targetJulianDay = julianDay, maximumTemporalDriftAU = 0, focusedSource, selectedSources, prioritySources, onSourceSelectionChange, onStopped, onRestarted }: Props) {
  const { t, language } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
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
  const [display, setDisplay] = useState<{ count: number; visible: number; pending: boolean; edgeCandidates?: number; testedRows?: number; skippedRows?: number }>({ count: 0, visible: 0, pending: false })
  const [status, setStatus] = useState<Status>({ drawnRows: 0, sourceRows: 0, phase: 'loading' })
  const [unavailable, setUnavailable] = useState(false)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const [restoration, setRestoration] = useState<{ rows: number; total: number } | null>(null)
  const plan = planCatalogStream(manifest, requestedRows, budgetBytes, mode, retainEpochs, appendRows)
  const dimensions = mode === '3d' ? 3 : 2
  const displayUnavailable = unavailable || restoration !== null || (displayMode === 'spatial' && Boolean(spatialWorkerError))
  const displayCountLabel = displayUnavailable ? (language === 'zh' ? '不可用' : 'unavailable') : display.count.toLocaleString()
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
    const exportCounter = exportGeneration
    exportGeneration.current++
    let active = true, acceptingTiles = true, loading = true, stopped = false, failed = false, discardedSnapshot = false, worker: Worker | null = null, frameId = 0
    let renderer: ReturnType<typeof createCatalogPointRenderer> | null = null
    let restoring = false, restorationFrame = 0, restorationGeneration = 0
    let gl: WebGLRenderingContext | null = null
    let viewKey = '', selectionViewKey = '', viewRequestId = 0
    let inFlightView: number | null = null
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
    let sourceBlockCounts: number[] = []
    let observedBlockEpochs = new Float64Array(0), observedBlock = 0, observedBlockRows = 0
    const recordEpochRows = (rows: number, epoch: number, drift: number) => {
      while (rows > 0) {
        const blockSize = sourceBlockCounts[observedBlock]
        if (blockSize === undefined) throw new Error('Catalog epoch rows exceed source blocks')
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
    let epochTile: Extract<CatalogStreamResponse, { type: 'epoch-tile' }> | null = null
    let epochTileOffset = 0
    let displayScratch = new Float32Array()
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
      setSpatialWorkerError(error.message)
      setDisplay({ count: 0, visible: 0, pending: false })
      draw()
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
      epochReady = false; epochBusy = false; epochStarted = false; epochId++
      awaitingPresentation = false; if (followFrame) { cancelAnimationFrame(followFrame); followFrame = 0 }
      if (epochFrame) { cancelAnimationFrame(epochFrame); epochFrame = 0 }
      epochTile = null; epochTileOffset = 0
      if (!coherent) {
        // Epoch upload overwrites the restoration buffer incrementally. It is
        // neither the prior snapshot nor a completed new epoch after cancel.
        discardedSnapshot = true
        setDiscardedOnCancel(true)
        renderer?.dispose(); renderer = null
        retained.length = 0; displayScratch = new Float32Array(); sourceBlockCounts = []
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
      epochTile = null; epochTileOffset = 0
      // An upload error can leave attributes only partly replaced. Unlike a
      // user cancellation, failure does not retain a drawable snapshot or a
      // restoration copy whose GPU/CPU coherence is no longer established.
      renderer?.dispose(); renderer = null
      retained.length = 0; displayScratch = new Float32Array(); sourceBlockCounts = []
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
    const draw = () => {
      if (!renderer || restoring) return false
      try {
        if (appendPending) {
          gl?.clear(gl.COLOR_BUFFER_BIT); checkGl()
          return true
        }
        const rect = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio, 2)
        const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio))
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
        const detail = detailRef.current
        if (!coherent) {
          renderer.drawRetained(radiusRef.current, 0.82, width, height, ratio, mode === '3d' ? detail.rotation : undefined)
          return true
        }
        const spatialKey = `${detail.displayMode}:${detail.displayLimit}:${radiusRef.current}:${width}:${height}:${mode === '3d' ? `${detail.rotation.azimuthDegrees}:${detail.rotation.tiltDegrees}` : ''}:${focusedRowRef.current ?? 'none'}`
        const selectionKey = `${spatialKey}:${selectedRowsRef.current.join(',')}`
        const key = `${selectionKey}:${count.drawnRows}`
        if (key !== viewKey) {
          invalidatePresentation()
          viewKey = key
          viewRequestId++
          if (detail.displayMode === 'all') {
            selectionViewKey = ''
            renderer.setSpatialSelection(null)
            setDisplay({ count: count.drawnRows, visible: count.drawnRows, pending: false })
          } else {
            // A changed camera invalidates its representatives. More source
            // rows at the same epoch/view can keep the previous partial image
            // visible while the new selection is computed.
            const pending = count.drawnRows > 0 && worker !== null
            if (selectionViewKey !== selectionKey) {
              selectionViewKey = selectionKey
              renderer.setSpatialSelection(new Uint32Array())
              setDisplay({ count: 0, visible: 0, pending })
            } else setDisplay(previous => ({ ...previous, pending }))
            // One result may be in transit at a time. Camera changes update
            // refs/viewRequestId while busy; the receipt schedules the latest
            // view instead of building a queue of transferred index arrays.
            if (count.drawnRows && worker && inFlightView === null) {
              inFlightView = viewRequestId
              post({ type: 'view', requestId: viewRequestId, count: count.drawnRows,
                view: { radius: radiusRef.current, aspect: width / height, maximumPoints: Math.min(plan.capacity, detail.displayLimit),
                  focusedRow: focusedRowRef.current, selectedRows: selectedRowsRef.current, ...(mode === '3d' ? { rotation: detail.rotation } : {}) } })
            }
          }
        }
        renderer.drawRetained(radiusRef.current, 0.82, width, height, ratio, mode === '3d' ? detail.rotation : undefined)
        if (awaitingPresentation && (detail.displayMode === 'all' || !count.drawnRows)) finishPresentation()
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
    const advanceCpuSnapshot = (rows: number, positions?: Float32Array) => {
      let copied = 0
      while (copied < rows) {
        const destination = retained[retainedTile]
        if (!destination) throw new Error('Catalog epoch exceeds CPU restoration snapshot')
        const length = Math.min(rows-copied, destination.sizes.length-retainedOffset)
        if (length <= 0) throw new Error('Invalid CPU catalog range')
        if (positions) destination.positions.set(positions.subarray(copied*dimensions, (copied+length)*dimensions), retainedOffset*dimensions)
        copied += length; retainedOffset += length
        if (retainedOffset === destination.sizes.length) { retainedTile++; retainedOffset = 0 }
      }
    }
    const flushEpochTile = () => {
      epochFrame = 0
      const tile = epochTile
      if (!active || !tile) return
      if (!epochBusy || tile.requestId !== epochId) { epochTile = null; epochTileOffset = 0; recycle(tile); return }
      try {
        if (!renderer || tile.julianDay !== requestedEpoch || tile.startRow+epochTileOffset !== updatedRows || !Number.isSafeInteger(tile.count) || tile.count < 1 || tile.count > 16384 ||
            tile.positions.length !== tile.count*dimensions || tile.startRow+tile.count > count.drawnRows) throw new Error('Invalid catalog epoch tile')
        const started = performance.now()
        do {
          const end = Math.min(tile.count, epochTileOffset+UPLOAD_SLICE_ROWS), rows = end-epochTileOffset
          if (displayScratch.length !== rows*dimensions) displayScratch = new Float32Array(rows*dimensions)
          displayScratch.set(tile.positions.subarray(epochTileOffset*dimensions, end*dimensions))
          if (!hasOnlyFiniteValues(displayScratch)) throw new Error('Catalog epoch exceeds GPU coordinates')
          renderer.replacePositions(updatedRows, displayScratch); checkGl()
          advanceCpuSnapshot(rows, displayScratch)
          recordEpochRows(rows, tile.julianDay, 0)
          updatedRows += rows; epochTileOffset = end
        } while (epochTileOffset < tile.count && performance.now()-started < UPLOAD_FRAME_BUDGET_MS)
        minimumActualEpoch = Math.min(minimumActualEpoch, tile.julianDay); maximumActualEpoch = Math.max(maximumActualEpoch, tile.julianDay)
        if (epochTileOffset < tile.count) epochFrame = requestAnimationFrame(flushEpochTile)
        else {
          epochTile = null; epochTileOffset = 0
          recycle(tile)
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
          const tile: Attributes = { positions: new Float32Array(response.positions.subarray(pendingTileOffset*dimensions, end*dimensions)), colors: new Float32Array(rows * 3), sizes: new Float32Array(rows) }
          if (!hasOnlyFiniteValues(tile.positions)) throw new Error('Catalog position exceeds GPU coordinates')
          for (let row = 0; row < rows; row++) {
            const sourceRow = pendingTileOffset+row
            const orbitClass = manifest.compactIndex!.classCodes[response.appearance[sourceRow * 2]], flags = response.appearance[sourceRow * 2 + 1]
            if (!orbitClass || flags > 7) throw new Error('Invalid catalog appearance')
            tile.colors.set(catalogPointColor(orbitClass, flags), row * 3)
            tile.sizes[row] = catalogPointSize(flags)
          }
          if (rows) { renderer.append(tile); retained.push(tile); changed = true }
          count.drawnRows += rows; count.sourceRows = response.sourceRows
          pendingTileOffset = end; processed = true
          if (end === points) {
            uploadedMasks.set(response.sourceChunk, response.sourceRowMask)
            uploadedShards.push({ chunk: response.sourceChunk, selectedRows: points, sourceRows: response.sourceRows, drawnRows: response.drawnRows })
            pendingTiles.shift(); pendingTileOffset = 0
            acknowledgements.push(response)
          }
        }
        // drawRetained checks the shared GL error state after upload and draw.
        // A separate pre-draw getError synchronizes with the GPU twice while
        // adding no acknowledgement protection: a failed draw never reaches ACK.
        if (changed && !draw()) return
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
        renderer = createCatalogPointRenderer(gl, plan.capacity, dimensions)
        checkGl()
        const ownedRenderer = renderer, generation = restorationGeneration
        const finish = () => {
          restoring = false; setRestoration(null)
          if (!coherent) { ownedRenderer.invalidatePositions(); setDisplay({ count: 0, visible: 0, pending: false }) }
          viewKey = ''; selectionViewKey = ''
          checkGl()
          if (!draw()) return false
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
                ownedRenderer.append({ positions: tile.positions.subarray(rowOffset*dimensions, end*dimensions),
                  colors: tile.colors.subarray(rowOffset*3, end*3), sizes: tile.sizes.subarray(rowOffset, end) })
                restoredRows += end-rowOffset; rowOffset = end
                if (rowOffset === tile.sizes.length) { tileIndex++; rowOffset = 0 }
              } while (tileIndex < retained.length && performance.now()-start < UPLOAD_FRAME_BUDGET_MS)
              checkGl()
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
      invalidatePresentation()
      stopRestoration()
      renderer?.dispose(); renderer = null
      setUnavailable(true)
      if (worker && (loading || epochBusy || appendPending)) cancel()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', initialize)
    canvas.addEventListener('solar-atlas-prepare-canvas-capture', draw)
    drawRef.current = draw
    const resize = new ResizeObserver(draw); resize.observe(canvas)
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
                colors: new Float32Array(response.count*3), sizes: new Float32Array(response.count) }
              if (!hasOnlyFiniteValues(attributes.positions)) throw new Error('Catalog append exceeds GPU coordinates')
              for (let row=0;row<response.count;row++) {
                const orbitClass = manifest.compactIndex!.classCodes[response.appearance[row*2]], flags = response.appearance[row*2+1]
                if (!orbitClass || flags > 7) throw new Error('Invalid appended catalog appearance')
                attributes.colors.set(catalogPointColor(orbitClass,flags),row*3); attributes.sizes[row] = catalogPointSize(flags)
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
              sourceBlockCounts.push(response.addedRows)
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
            draw()
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
              updatedRows = 0; retainedTile = 0; retainedOffset = 0
              observedBlockEpochs = new Float64Array(sourceBlockCounts.length * 2)
              observedBlock = 0; observedBlockRows = 0
              reusedRows = 0; maximumReuseDrift = 0; minimumActualEpoch = Infinity; maximumActualEpoch = -Infinity
              renderer.beginPositionUpdate()
            } else if (response.type === 'epoch-reuse') {
              if (epochTile || response.startRow !== updatedRows || !Number.isSafeInteger(response.count) || response.count < 1 || response.count > Math.max(manifest.chunkSize,plan.appendCapacity) ||
                  updatedRows+response.count > count.drawnRows || !Number.isFinite(response.computedJulianDay) || response.computedJulianDay < 2441317.5 ||
                  !Number.isFinite(response.displacementAU) || response.displacementAU < 0 || response.displacementAU > requestedBudget ||
                  (response.computedJulianDay === requestedEpoch) !== (response.displacementAU === 0)) throw new Error('Invalid catalog reused-block receipt')
              renderer.retainPositions(response.startRow, response.count); advanceCpuSnapshot(response.count)
              recordEpochRows(response.count, response.computedJulianDay, response.displacementAU)
              updatedRows += response.count; reusedRows += response.count
              maximumReuseDrift = Math.max(maximumReuseDrift, response.displacementAU)
              minimumActualEpoch = Math.min(minimumActualEpoch, response.computedJulianDay); maximumActualEpoch = Math.max(maximumActualEpoch, response.computedJulianDay)
              post({ type: 'epoch-reuse-ack', requestId: response.requestId, startRow: response.startRow, count: response.count })
            } else if (response.type === 'epoch-tile') {
              if (epochTile || !(response.positions instanceof Float64Array)) throw new Error('Invalid catalog epoch transfer window or coordinates')
              epochTile = response; epochTileOffset = 0; epochFrame = requestAnimationFrame(flushEpochTile)
            } else {
              if (epochTile || response.count !== updatedRows || updatedRows !== count.drawnRows ||
                  observedBlock !== sourceBlockCounts.length || observedBlockRows !== 0) throw new Error('Catalog epoch completed before upload')
              if (response.reusedRows !== reusedRows || response.recomputedRows !== updatedRows-reusedRows || response.maximumDisplacementAU !== maximumReuseDrift ||
                  (updatedRows ? !response.computedEpochRange || response.computedEpochRange[0] !== minimumActualEpoch || response.computedEpochRange[1] !== maximumActualEpoch : response.computedEpochRange !== null)) throw new Error('Catalog epoch provenance summary mismatch')
              if (response.maximumDriftAU !== requestedBudget || !(response.blockEpochs instanceof Float64Array) ||
                  response.blockEpochs.length !== sourceBlockCounts.length*4) throw new Error('Invalid catalog block epoch evidence')
              let blockRows = 0, blockMinimum = Infinity, blockMaximum = -Infinity, blockDrift = 0
              for (let offset = 0; offset < response.blockEpochs.length; offset += 4) {
                const [start, rows, epoch, drift] = response.blockEpochs.subarray(offset, offset+4)
                if (start !== blockRows || rows !== sourceBlockCounts[offset/4] || !Number.isSafeInteger(rows) || rows < 1 || rows > Math.max(manifest.chunkSize,plan.appendCapacity) ||
                    !Number.isFinite(epoch) || epoch < 2441317.5 || !Number.isFinite(drift) || drift < 0 || drift > requestedBudget ||
                    (epoch === requestedEpoch) !== (drift === 0) || epoch !== observedBlockEpochs[offset/2] ||
                    drift !== observedBlockEpochs[offset/2+1]) throw new Error('Invalid contiguous catalog block evidence')
                blockRows += rows; blockMinimum = Math.min(blockMinimum, epoch); blockMaximum = Math.max(blockMaximum, epoch); blockDrift = Math.max(blockDrift, drift)
              }
              if (blockRows !== updatedRows || blockDrift !== maximumReuseDrift ||
                  updatedRows > 0 && (blockMinimum !== minimumActualEpoch || blockMaximum !== maximumActualEpoch)) throw new Error('Catalog block evidence differs from uploaded epoch')
              renderer.finishPositionUpdate(); coherent = true; epochBusy = false; epochStarted = false; installedEpoch = requestedEpoch
              installedDrift = response.maximumDisplacementAU
              uniformEpoch = response.computedEpochRange && response.computedEpochRange[0] === response.computedEpochRange[1] ? response.computedEpochRange[0] : null
              completedEpochEvidence = response
              awaitingPresentation = true
              setComputedEpoch(uniformEpoch); setEpochEvidence(response); viewKey = ''; selectionViewKey = ''
              if (!draw()) return
              setStatus({ ...count, phase: snapshotComplete ? 'complete' : 'limited' })
              // Spatial mode waits for matching selection before presenting;
              // all-points mode schedules presentation inside draw().
            }
          } catch (error) { fail(error) }
          return
        }
        if (response.type === 'selection' || response.type === 'selection-error') {
          if (response.requestId !== inFlightView) return
          inFlightView = null
          if (response.requestId !== viewRequestId || response.count !== count.drawnRows) {
            viewKey = ''
            draw()
            return
          }
          if (restoring || !coherent || response.requestId !== viewRequestId || response.count !== count.drawnRows || detailRef.current.displayMode !== 'spatial') return
          if (response.type === 'selection-error') { workerFailure(new Error(response.error)); return }
          try {
            if (!renderer || !(response.indices instanceof Uint32Array) || response.indices.length > detailRef.current.displayLimit ||
                !Number.isSafeInteger(response.visible) || response.visible < response.indices.length || response.visible > count.drawnRows ||
                !Number.isSafeInteger(response.edgeCandidates) || response.edgeCandidates < 0 || response.edgeCandidates > response.visible) throw new Error('Invalid catalog spatial selection')
            if (response.testedRows !== undefined || response.skippedRows !== undefined) {
              if (!Number.isSafeInteger(response.testedRows) || !Number.isSafeInteger(response.skippedRows) || response.testedRows! < 0 || response.skippedRows! < 0 ||
                  response.testedRows!+response.skippedRows! !== count.drawnRows || response.visible > response.testedRows!) throw new Error('Invalid catalog spatial work counters')
            }
            renderer.setSpatialSelection(response.indices)
            // The draw validates index upload and draw errors together before
            // publishing this selection as presented.
            if (!draw()) return
            // draw() may discover a newer camera/viewport and issue another
            // selection. Its pending state must not be overwritten by this one.
            if (response.requestId !== viewRequestId || !coherent) return
            setDisplay({ count: response.indices.length, visible: response.visible, edgeCandidates: response.edgeCandidates, pending: false, testedRows: response.testedRows, skippedRows: response.skippedRows })
            if (awaitingPresentation) finishPresentation()
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
            setStatus({ ...count, phase: 'cancelled' })
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
              sourceBlockCounts = []
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
                sourceBlockCounts.push(selectedCount)
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
      terminateWorker()
      resize.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', initialize)
      canvas.removeEventListener('solar-atlas-prepare-canvas-capture', draw)
      renderer?.dispose()
      pendingTiles.length = 0; pendingTileOffset = 0
      retained.length = 0
    }
  }, [manifest, filters, julianDay, requestedRows, budgetBytes, plan.capacity, plan.initialCapacity, plan.appendCapacity, mode, dimensions, priority, retainEpochs, appendRows, prioritySources, retryGeneration, loadOwner, onStopped])

  return <>
    <canvas ref={canvasRef} className="viz-canvas catalog-point-canvas" role="img" aria-label={`${t('catalogPointAria')} ${mode}: ${displayCountLabel}`} data-testid="catalog-stream-canvas" data-drawn-rows={status.drawnRows} data-source-rows={status.sourceRows} data-phase={status.phase} data-capacity={plan.capacity} data-display-count={display.count} data-spatial-pending={display.pending} data-display-mode={displayMode} data-coordinate-mode={mode} />
    <div className="catalog-stream-overlay">
    <div className="catalog-stream-status">
      <strong>{status.drawnRows.toLocaleString()} / {plan.capacity.toLocaleString()} · {t('catalogStreamLoaded')}</strong>
      <span>{t('catalogStreamDisplayed')}: {displayCountLabel}{displayMode === 'spatial' && !displayUnavailable ? ` / ${display.visible.toLocaleString()} ${t('catalogStreamInView')}` : ''}</span>
      {displayMode === 'spatial' && !displayUnavailable && <span>{t(display.pending ? 'catalogSpatialUpdating' : 'catalogSpatialExplanation')}</span>}
      {displayMode === 'spatial' && !displayUnavailable && !display.pending && display.edgeCandidates !== undefined && <span>{language === 'zh' ? '其中边缘余量候选：' : 'Candidates admitted by edge margin: '}{display.edgeCandidates.toLocaleString()}</span>}
      {displayMode === 'spatial' && !displayUnavailable && !display.pending && display.testedRows !== undefined && <span>{language === 'zh' ? '逐点筛选 / 整块跳过：' : 'Points screened / skipped by block: '}{display.testedRows.toLocaleString()} / {display.skippedRows?.toLocaleString()}</span>}
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
        ? '空间筛选已停止。已加载快照仍保留；可切换为全部显示，或重新加载以恢复空间筛选。'
        : 'Spatial selection stopped. The loaded snapshot is retained; use the all-points view or reload to restore spatial selection.'} {spatialWorkerError}</p>
        <button type="button" className="secondary-button" onClick={() => { onRestarted?.(); setRetryGeneration(value => value+1) }}>{language === 'zh' ? '重新加载' : 'Reload'}</button></div>}
    </div>
    {computedEpoch !== null && status.drawnRows > 0 && <p className="catalog-point-epoch" data-testid="catalog-point-epoch" data-utc-jd={computedEpoch}>
      {t(mode === '3d' ? 'catalogPointModel3d' : 'catalogPointModel')} <time dateTime={julianDayToDate(computedEpoch).toISOString()}>{julianDayToDate(computedEpoch).toISOString().replace('T', ' ')}</time>
    </p>}
    {epochEvidence && <p className="catalog-result-note" data-testid="catalog-block-epochs">
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
            counts: display.pending || displayUnavailable ? null : { submittedPoints: display.count,
              ...(displayMode === 'spatial' ? { viewportCandidates: display.visible, edgeCandidates: display.edgeCandidates,
                testedRows: display.testedRows, skippedRows: display.skippedRows } : {}) },
            viewportPolicy: { model: 'outward-Float32-screening', relativeMargin: CATALOG_CLIP_RELATIVE_MARGIN,
              representativePriority: 'explicit-pins-then-viewport-interior-before-margin-only; deterministic-hash-within-tier',
              meaning: 'Candidate admission, not an on-screen pixel count or physical position uncertainty.' },
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
