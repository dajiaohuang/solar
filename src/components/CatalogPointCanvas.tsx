import { useEffect, useMemo, useRef, useState } from 'react'
import { createCatalogPointRenderer, type CatalogPointFrame } from '../lib/catalogPointRenderer'
import type { AsteroidRecord } from '../types'

type Props = {
  records: AsteroidRecord[]
  positions: Float64Array
  viewRadiusAU: number
  opacity?: number
  ariaLabel?: string
  unavailableLabel?: string
}

const CLASS_COLORS: Record<string, [number, number, number]> = {
  MBA: [0.45, 0.65, 0.79], APO: [1, 0.45, 0.37], ATE: [1, 0.68, 0.33],
  AMO: [0.91, 0.56, 0.85], ATI: [0.96, 0.83, 0.37], MCR: [0.94, 0.56, 0.42], HUN: [0.44, 0.82, 0.66],
  HIL: [0.62, 0.55, 1], JTA: [0.79, 0.65, 0.42], TNO: [0.56, 0.68, 1],
}

export function CatalogPointCanvas({ records, positions, viewRadiusAU, opacity = 0.82, ariaLabel = 'GPU small-body catalog view', unavailableLabel = 'Catalog rendering is unavailable. The table remains usable.' }: Props) {
  // This map is heliocentric. Other panes subtract their Float64 reference
  // origin first; only GPU attributes use Float32.
  const gpuPositions = useMemo(() => new Float32Array(positions), [positions])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<CatalogPointFrame | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const appearance = useMemo(() => {
    const colors = new Float32Array(records.length * 3)
    const sizes = new Float32Array(records.length)
    records.forEach((record, index) => {
      const color = record.isPha ? [1, 0.35, 0.3] : record.isNeo ? [1, 0.62, 0.5] : CLASS_COLORS[record.orbitClassCode] ?? [0.62, 0.7, 0.76]
      colors.set(color, index * 3)
      sizes[index] = record.isPha ? 3.2 : record.isNeo ? 2.5 : 1.7
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
      if (!renderer || !frameRef.current) return
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio, 2)
      const width = Math.max(1, Math.round(bounds.width * ratio)), height = Math.max(1, Math.round(bounds.height * ratio))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      try { renderer.draw(frameRef.current, width, height, ratio) }
      catch { renderer.dispose(); renderer = null; report(true) }
    }
    const initialize = () => {
      renderer?.dispose()
      renderer = null
      try {
        const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
        if (!gl) throw new Error('WebGL unavailable')
        renderer = createCatalogPointRenderer(gl)
        report(false)
        draw()
      } catch { report(true) }
    }
    const onLost = (event: Event) => {
      event.preventDefault()
      renderer?.dispose(); renderer = null
      report(true)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', initialize)
    drawRef.current = draw
    initialize()
    const observer = new ResizeObserver(draw); observer.observe(canvas)
    return () => {
      active = false
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', initialize)
      drawRef.current = null
      renderer?.dispose()
    }
  }, [])

  return <>
    <canvas ref={canvasRef} className="viz-canvas catalog-point-canvas" role="img" aria-label={`${ariaLabel}: ${records.length.toLocaleString()}`} />
    {unavailable && <div className="empty-state catalog-render-status" role="status"><p>{unavailableLabel}</p></div>}
  </>
}
