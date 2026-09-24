import { useEffect, useMemo, useRef, useState } from 'react'
import { createCatalogPointRenderer, type CatalogPointFrame } from '../lib/catalogPointRenderer'
import { catalogPointColor, catalogPointSize } from '../lib/catalogPointAppearance'
import type { AsteroidRecord } from '../types'

type Props = {
  records: AsteroidRecord[]
  positions: Float64Array
  viewRadiusAU: number
  opacity?: number
  ariaLabel?: string
  unavailableLabel?: string
  retryLabel?: string
}

export function CatalogPointCanvas({ records, positions, viewRadiusAU, opacity = 0.82, ariaLabel = 'GPU small-body catalog view', unavailableLabel = 'Catalog rendering is unavailable. The table remains usable.', retryLabel = 'Retry' }: Props) {
  // This map is heliocentric. Other panes subtract their Float64 reference
  // origin first; only GPU attributes use Float32.
  const gpuPositions = useMemo(() => new Float32Array(positions), [positions])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<CatalogPointFrame | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const retryRef = useRef<(() => void) | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const appearance = useMemo(() => {
    const colors = new Float32Array(records.length * 3)
    const sizes = new Float32Array(records.length)
    records.forEach((record, index) => {
      const flags = (record.isPha ? 2 : 0) | (record.isNeo ? 1 : 0)
      colors.set(catalogPointColor(record.orbitClassCode, flags), index * 3)
      sizes[index] = catalogPointSize(flags)
    })
    return { colors, sizes }
  }, [records])

  useEffect(() => {
    frameRef.current = { positions: gpuPositions, ...appearance, radius: viewRadiusAU, opacity }
    drawRef.current?.()
  }, [appearance, gpuPositions, viewRadiusAU, opacity])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let renderer: ReturnType<typeof createCatalogPointRenderer> | null = null
    let active = true
    const report = (failed: boolean) => queueMicrotask(() => { if (active) setUnavailable(failed) })
    const draw = () => {
      if (!renderer || !frameRef.current) return false
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio, 2)
      const width = Math.max(1, Math.round(bounds.width * ratio)), height = Math.max(1, Math.round(bounds.height * ratio))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      try { renderer.draw(frameRef.current, width, height, ratio); return true }
      catch { renderer.dispose(); renderer = null; report(true); return false }
    }
    const initialize = () => {
      renderer?.dispose()
      renderer = null
      try {
        const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
        if (!gl) throw new Error('WebGL unavailable')
        renderer = createCatalogPointRenderer(gl)
        if (draw()) report(false)
      } catch {
        renderer?.dispose(); renderer = null
        report(true)
      }
    }
    const onLost = (event: Event) => {
      event.preventDefault()
      renderer?.dispose(); renderer = null
      report(true)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', initialize)
    retryRef.current = initialize
    drawRef.current = draw
    initialize()
    const observer = new ResizeObserver(draw); observer.observe(canvas)
    return () => {
      active = false
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', initialize)
      retryRef.current = null
      drawRef.current = null
      renderer?.dispose()
    }
  }, [])

  return <>
    <canvas ref={canvasRef} className="viz-canvas catalog-point-canvas" role="img" aria-hidden={unavailable || undefined} style={{ visibility: unavailable ? 'hidden' : undefined }} aria-label={`${ariaLabel}: ${records.length.toLocaleString()}`} />
    {unavailable && <div className="empty-state catalog-render-status" role="status"><p>{unavailableLabel}</p><button type="button" onClick={() => retryRef.current?.()}>{retryLabel}</button></div>}
  </>
}
