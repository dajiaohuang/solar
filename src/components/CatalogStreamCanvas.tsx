import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { catalogPointColor, catalogPointSize } from '../lib/catalogPointAppearance'
import { createCatalogPointRenderer, type CatalogPointFrame } from '../lib/catalogPointRenderer'
import { planCatalogStream } from '../lib/catalogStreaming'
import { julianDayToDate } from '../lib/julianDate'
import type { AsteroidManifest, CatalogFilters } from '../types'
import type { CatalogStreamRequest, CatalogStreamResponse } from '../workers/catalog-stream.protocol'
import { CATALOG_TRANSFER_WINDOW } from '../lib/catalogTransferWindow'

type Props = {
  manifest: AsteroidManifest
  filters: CatalogFilters
  julianDay: number
  requestedRows: number
  budgetBytes: number
  viewRadiusAU: number
}
type Status = { drawnRows: number; sourceRows: number; phase: 'loading' | 'complete' | 'limited' | 'cancelled' | 'error'; error?: string }
type Attributes = Pick<CatalogPointFrame, 'positions' | 'colors' | 'sizes'>

export function CatalogStreamCanvas({ manifest, filters, julianDay, requestedRows, budgetBytes, viewRadiusAU }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const radiusRef = useRef(viewRadiusAU)
  const [status, setStatus] = useState<Status>({ drawnRows: 0, sourceRows: 0, phase: 'loading' })
  const [unavailable, setUnavailable] = useState(false)
  const plan = planCatalogStream(manifest, requestedRows, budgetBytes)

  useEffect(() => { radiusRef.current = viewRadiusAU; drawRef.current?.() }, [viewRadiusAU])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let active = true, acceptingTiles = true, worker: Worker | null = null, frameId = 0
    let renderer: ReturnType<typeof createCatalogPointRenderer> | null = null
    let gl: WebGLRenderingContext | null = null
    const retained: Attributes[] = []
    const pendingTiles: Extract<CatalogStreamResponse, { type: 'tile' }>[] = []
    const count = { drawnRows: 0, sourceRows: 0 }
    const post = (request: CatalogStreamRequest) => worker?.postMessage(request)
    const cancel = () => {
      // Explicit abort ends admitted fetches and the pending upload ACK. The
      // worker is terminated after reporting cancellation; cleanup also has a
      // hard termination boundary for navigation and changed filters.
      acceptingTiles = false
      pendingTiles.length = 0
      post({ type: 'cancel' })
      if (frameId) { cancelAnimationFrame(frameId); frameId = 0 }
      setStatus({ ...count, phase: 'cancelled' })
    }
    cancelRef.current = cancel
    const fail = (error: unknown) => {
      acceptingTiles = false
      pendingTiles.length = 0
      if (frameId) { cancelAnimationFrame(frameId); frameId = 0 }
      worker?.terminate(); worker = null
      if (active) setStatus({ ...count, phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
    const draw = () => {
      if (!renderer) return
      const rect = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio, 2)
      const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      renderer.drawRetained(radiusRef.current, 0.82, width, height, ratio)
    }
    const checkGl = () => { if (gl?.getError() !== gl?.NO_ERROR) throw new Error('Catalog GPU allocation or upload failed') }
    const flushTiles = () => {
      frameId = 0
      if (!active || !acceptingTiles) return
      try {
        if (!renderer) throw new Error('Catalog GPU context is unavailable')
        const started = performance.now(), acknowledgements: number[] = []
        let changed = false
        // The 3 ms budget is checked between tiles. A single source shard may
        // exceed it on slow hardware; neither compute nor upload is unbounded.
        while (pendingTiles.length && (!acknowledgements.length || performance.now() - started < 3)) {
          const response = pendingTiles.shift()!
          const points = response.positions.length / 2
          if (!Number.isSafeInteger(points) || points > manifest.chunkSize || response.appearance.length !== points * 2 || response.drawnRows !== count.drawnRows + points || response.drawnRows > plan.capacity || response.sourceRows < count.sourceRows || response.sourceRows > manifest.totalCount) throw new Error('Invalid catalog streaming tile')
          const tile: Attributes = { positions: new Float32Array(response.positions), colors: new Float32Array(points * 3), sizes: new Float32Array(points) }
          for (let row = 0; row < points; row++) {
            if (!Number.isFinite(tile.positions[row * 2]) || !Number.isFinite(tile.positions[row * 2 + 1])) throw new Error('Catalog position exceeds GPU coordinates')
            const orbitClass = manifest.compactIndex!.classCodes[response.appearance[row * 2]], flags = response.appearance[row * 2 + 1]
            if (!orbitClass || flags > 7) throw new Error('Invalid catalog appearance')
            tile.colors.set(catalogPointColor(orbitClass, flags), row * 3)
            tile.sizes[row] = catalogPointSize(flags)
          }
          if (points) { renderer.append(tile); retained.push(tile); changed = true }
          count.drawnRows = response.drawnRows; count.sourceRows = response.sourceRows
          acknowledgements.push(response.tileId)
        }
        if (changed) { checkGl(); draw() }
        setStatus({ ...count, phase: 'loading' })
        // Acknowledge only after the batch has actually reached the renderer.
        for (const tileId of acknowledgements) post({ type: 'ack', tileId })
        if (pendingTiles.length) frameId = requestAnimationFrame(flushTiles)
      } catch (error) { fail(error) }
    }
    const initialize = () => {
      renderer?.dispose(); renderer = null
      try {
        gl = canvas.getContext('webgl', { antialias: false, alpha: false })
        if (!gl) throw new Error('WebGL unavailable')
        renderer = createCatalogPointRenderer(gl, plan.capacity)
        checkGl()
        for (const tile of retained) renderer.append(tile)
        checkGl(); draw()
        queueMicrotask(() => { if (active) setUnavailable(false) })
        return true
      } catch (error) {
        renderer?.dispose(); renderer = null
        queueMicrotask(() => { if (active) { setUnavailable(true); fail(error) } })
        return false
      }
    }
    const lost = (event: Event) => {
      event.preventDefault()
      renderer?.dispose(); renderer = null
      setUnavailable(true)
      if (worker) cancel()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', initialize)
    drawRef.current = draw
    const resize = new ResizeObserver(draw); resize.observe(canvas)
    if (initialize()) {
      worker = new Worker(new URL('../workers/catalog-stream.worker.ts', import.meta.url), { type: 'module' })
      worker.onerror = event => fail(new Error(event.message || 'Catalog streaming failed'))
      worker.onmessage = (event: MessageEvent<CatalogStreamResponse>) => {
        if (!active) return
        const response = event.data
        if (response.type === 'tile') {
          if (!acceptingTiles) return
          if (pendingTiles.length >= CATALOG_TRANSFER_WINDOW) { fail(new Error('Catalog transfer window exceeded')); return }
          pendingTiles.push(response)
          if (!frameId) frameId = requestAnimationFrame(flushTiles)
        } else {
          worker?.terminate(); worker = null
          if (response.type === 'error') fail(new Error(response.error))
          else if (response.type === 'cancelled') setStatus({ ...count, phase: 'cancelled' })
          else if (pendingTiles.length || response.drawnRows !== count.drawnRows || response.sourceRows !== count.sourceRows) fail(new Error('Catalog completed before all tiles were uploaded'))
          else setStatus({ ...count, phase: response.complete ? 'complete' : 'limited' })
        }
      }
      post({ type: 'start', manifest, filters, julianDay, requestedRows, budgetBytes })
    }
    return () => {
      active = false
      cancelRef.current = null
      drawRef.current = null
      if (frameId) cancelAnimationFrame(frameId)
      worker?.terminate()
      resize.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', initialize)
      renderer?.dispose()
      pendingTiles.length = 0
      retained.length = 0
    }
  }, [manifest, filters, julianDay, requestedRows, budgetBytes, plan.capacity])

  return <>
    <canvas ref={canvasRef} className="viz-canvas catalog-point-canvas" role="img" aria-label={`${t('catalogPointAria')}: ${status.drawnRows.toLocaleString()}`} data-testid="catalog-stream-canvas" data-drawn-rows={status.drawnRows} data-source-rows={status.sourceRows} data-phase={status.phase} data-capacity={plan.capacity} />
    <div className="catalog-stream-status">
      <strong>{status.drawnRows.toLocaleString()} / {plan.capacity.toLocaleString()} · {t('catalogStreamDrawn')}</strong>
      <span>{t('catalogStreamScanned')}: {status.sourceRows.toLocaleString()} / {manifest.totalCount.toLocaleString()}</span>
      <span role="status">{t(status.phase === 'loading' ? 'catalogStreamLoading' : status.phase === 'complete' ? 'catalogStreamComplete' : status.phase === 'limited' ? 'catalogStreamLimited' : status.phase === 'cancelled' ? 'catalogStreamCancelled' : 'catalogStreamFailed')}</span>
      {status.phase === 'loading' && <button className="secondary-button" onClick={() => cancelRef.current?.()}>{t('catalogStreamCancel')}</button>}
      {status.error && <span role="alert">{status.error}</span>}
    </div>
    {unavailable && <div className="empty-state catalog-render-status" role="status"><p>{t('catalogRenderUnavailable')}</p></div>}
    <p className="catalog-point-epoch" data-testid="catalog-point-epoch" data-utc-jd={julianDay}>
      {t('catalogPointModel')} <time dateTime={julianDayToDate(julianDay).toISOString()}>{julianDayToDate(julianDay).toISOString().replace('T', ' ')}</time>
    </p>
  </>
}
