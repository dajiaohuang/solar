import { useEffect, useMemo, useRef, useState } from 'react'
import { PRODUCT_PROFILE } from '../../lib/productAvailability'
import { TrajectoryCanvas3D } from '../../components/TrajectoryCanvas3D'
import { majorBodiesWithPhysicalData, useBodyRegistry } from '../../app/bodyRegistry'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { useI18n } from '../../i18n/context'
import { asteroidRecordToBody } from '../../lib/catalogLoader'
import { catalogSampleErrorMessage } from '../../lib/catalogSampleProfile'
import { EXACT_CATALOG_LOCATOR_LIMIT, createCatalogScanKey, scanAsteroidCatalog } from '../../lib/catalogScan'
import { elementPlotCoordinates } from '../../lib/elementPlot'
import { buildCurrentPositions } from '../../lib/trajectory'
import { catalogActions, catalogDisplayRecords, catalogStore, filterCatalogRecords } from '../../state/catalog-store'
import { selectionActions, selectionStore } from '../../state/selection-store'
import { uiActions, uiStore, type ElementPlotMode } from '../../state/ui-store'
import type { AsteroidRecord, BodyId, CelestialBody } from '../../types'
import { bodyDisplayName } from '../../lib/bodyNames'
import { useCatalogSample } from '../../hooks/useCatalogSample'

type PlotMode = ElementPlotMode
type PlotDatum = { record: AsteroidRecord; x: number; y: number }

const RESONANCE_BANDS = [
  { a: 2.50, label: '3:1' }, { a: 2.82, label: '5:2' }, { a: 2.96, label: '7:3' },
  { a: 3.28, label: '2:1' }, { a: 3.97, label: '3:2' }, { a: 4.29, label: '4:3' }, { a: 5.20, label: '1:1' },
]

const CLASS_COLORS: Record<string, string> = {
  MBA: '#72a6c9', APO: '#ff745f', ATE: '#ffad55', AMO: '#e78fd8', ATI: '#f4d35e',
  MCR: '#f08f6a', HUN: '#6fd0a8', HIL: '#9e8cff', JTA: '#c9a66b', TNO: '#8eaeff', OTHER: '#8795a5',
}

function toPlotDatum(record: AsteroidRecord, mode: PlotMode): PlotDatum | null {
  const coordinates = elementPlotCoordinates(record, mode)
  if (!coordinates) return null
  const [x, y] = coordinates
  return { record, x, y }
}

function labelsFor(mode: PlotMode) {
  const values: Record<PlotMode, [string, string]> = {
    'a-e': ['a · semi-major axis (AU)', 'e · eccentricity'],
    'a-i': ['a · semi-major axis (AU)', 'i · inclination (°)'],
    'a-H': ['a · semi-major axis (AU)', 'H · absolute magnitude'],
    'q-Q': ['q · perihelion (AU)', 'Q · aphelion (AU)'],
    'a-period': ['a · semi-major axis (AU)', 'period (years)'],
  }
  return values[mode]
}

type ScatterProps = {
  data: PlotDatum[]
  mode: PlotMode
  selectedIds: Set<BodyId>
  onSelect: (records: AsteroidRecord[]) => void
  onFocus: (record: AsteroidRecord) => void
  ariaLabel: string
}

function ElementScatter({ data, mode, selectedIds, onSelect, onFocus, ariaLabel }: ScatterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [brush, setBrush] = useState<{ startX: number; startY: number; x: number; y: number } | null>(null)
  const [keyboardIndex, setKeyboardIndex] = useState(0)
  const activeKeyboardIndex = Math.min(keyboardIndex, Math.max(data.length - 1, 0))
  const bounds = useMemo(() => {
    if (!data.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
    const xs = data.map((point) => point.x).filter(Number.isFinite)
    const ys = data.map((point) => point.y).filter(Number.isFinite)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    return { minX, maxX: maxX === minX ? minX + 1 : maxX, minY, maxY: maxY === minY ? minY + 1 : maxY }
  }, [data])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ratio = Math.min(window.devicePixelRatio, 2)
    const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1)
    canvas.width = width * ratio; canvas.height = height * ratio; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(ratio, ratio)
    context.clearRect(0, 0, width, height)
    const pad = { left: 56, right: 24, top: 26, bottom: 48 }
    const px = (value: number) => pad.left + (value - bounds.minX) / (bounds.maxX - bounds.minX) * (width - pad.left - pad.right)
    const py = (value: number) => height - pad.bottom - (value - bounds.minY) / (bounds.maxY - bounds.minY) * (height - pad.top - pad.bottom)
    context.strokeStyle = 'rgba(126,163,184,.16)'; context.fillStyle = '#7890a0'; context.font = '11px ui-monospace, monospace'
    for (let index = 0; index <= 5; index += 1) {
      const x = pad.left + index / 5 * (width - pad.left - pad.right)
      const y = pad.top + index / 5 * (height - pad.top - pad.bottom)
      context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, height - pad.bottom); context.stroke()
      context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke()
      context.fillText((bounds.minX + index / 5 * (bounds.maxX - bounds.minX)).toFixed(2), x - 10, height - 20)
      context.fillText((bounds.maxY - index / 5 * (bounds.maxY - bounds.minY)).toFixed(2), 6, y + 4)
    }
    if (mode.startsWith('a-')) {
      context.setLineDash([3, 4])
      for (const resonance of RESONANCE_BANDS) {
        if (resonance.a < bounds.minX || resonance.a > bounds.maxX) continue
        const x = px(resonance.a)
        context.strokeStyle = 'rgba(244,196,102,.48)'; context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, height - pad.bottom); context.stroke()
        context.fillStyle = '#d7b86c'; context.fillText(resonance.label, x + 3, pad.top + 12)
      }
      context.setLineDash([])
    }
    for (const point of data) {
      const selected = selectedIds.has(point.record.id)
      context.beginPath(); context.arc(px(point.x), py(point.y), selected ? 4.4 : 2.2, 0, Math.PI * 2)
      context.fillStyle = selected ? '#fff2bd' : CLASS_COLORS[point.record.orbitClassCode] ?? CLASS_COLORS.OTHER
      context.globalAlpha = selected ? 1 : 0.62; context.fill()
    }
    const keyboardPoint = data[activeKeyboardIndex]
    if (keyboardPoint) {
      context.beginPath(); context.arc(px(keyboardPoint.x), py(keyboardPoint.y), 7, 0, Math.PI * 2)
      context.strokeStyle = '#fff2bd'; context.lineWidth = 1.5; context.stroke()
    }
    context.globalAlpha = 1
    if (brush) {
      context.fillStyle = 'rgba(97,210,184,.13)'; context.strokeStyle = '#61d2b8'; context.setLineDash([5, 4])
      context.fillRect(brush.startX, brush.startY, brush.x - brush.startX, brush.y - brush.startY)
      context.strokeRect(brush.startX, brush.startY, brush.x - brush.startX, brush.y - brush.startY)
    }
  }, [activeKeyboardIndex, bounds, brush, data, mode, selectedIds])

  function coordinates(event: React.MouseEvent) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height }
  }

  return <div ref={containerRef} className="element-scatter" tabIndex={0} role="group" aria-label={`${ariaLabel} ${mode}`}
    onKeyDown={(event) => {
      if (!data.length) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); setKeyboardIndex((index) => (index + 1) % data.length) }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); setKeyboardIndex((index) => (index - 1 + data.length) % data.length) }
      else if (event.key === 'Enter') { event.preventDefault(); onFocus(data[activeKeyboardIndex].record) }
      else if (event.key === ' ') { event.preventDefault(); onSelect([data[activeKeyboardIndex].record]) }
    }}
    onMouseDown={(event) => { const p = coordinates(event); setBrush({ startX: p.x, startY: p.y, x: p.x, y: p.y }) }}
    onMouseMove={(event) => { if (!brush) return; const p = coordinates(event); setBrush({ ...brush, x: p.x, y: p.y }) }}
    onMouseUp={(event) => {
      if (!brush) return
      const p = coordinates(event)
      const width = p.width, height = p.height, pad = { left: 56, right: 24, top: 26, bottom: 48 }
      const x0 = Math.min(brush.startX, p.x), x1 = Math.max(brush.startX, p.x), y0 = Math.min(brush.startY, p.y), y1 = Math.max(brush.startY, p.y)
      const px = (value: number) => pad.left + (value - bounds.minX) / (bounds.maxX - bounds.minX) * (width - pad.left - pad.right)
      const py = (value: number) => height - pad.bottom - (value - bounds.minY) / (bounds.maxY - bounds.minY) * (height - pad.top - pad.bottom)
      if (Math.hypot(x1 - x0, y1 - y0) < 6) {
        const nearest = data.reduce<{ point: PlotDatum; distance: number } | null>((best, point) => {
          const distance = Math.hypot(px(point.x) - p.x, py(point.y) - p.y)
          return !best || distance < best.distance ? { point, distance } : best
        }, null)
        if (nearest && nearest.distance < 12) onFocus(nearest.point.record)
      } else {
        onSelect(data.filter((point) => { const x = px(point.x), y = py(point.y); return x >= x0 && x <= x1 && y >= y0 && y <= y1 }).map((point) => point.record))
      }
      setBrush(null)
    }}
  >
    <canvas ref={canvasRef} role="img" aria-label={`${ariaLabel} ${mode}`} />
    {data[activeKeyboardIndex] && <div className="element-keyboard-readout" aria-live="polite">{data[activeKeyboardIndex].record.label} · x {data[activeKeyboardIndex].x.toFixed(4)} · y {data[activeKeyboardIndex].y.toFixed(4)}</div>}
  </div>
}

function ElementDistributionSummary({ data }: { data: PlotDatum[] }) {
  const { t } = useI18n()
  const summary = useMemo(() => {
    if (!data.length) return { median: 0, minimum: 0, maximum: 0, bins: [] as number[], classes: [] as Array<[string, number]> }
    const values = data.map((point) => point.x).sort((left, right) => left - right)
    const minimum = values[0], maximum = values[values.length - 1]
    const bins = Array.from({ length: 16 }, () => 0)
    for (const value of values) bins[Math.min(bins.length - 1, Math.floor((value - minimum) / Math.max(maximum - minimum, 1e-12) * bins.length))] += 1
    const counts = new Map<string, number>()
    for (const point of data) counts.set(point.record.orbitClassCode, (counts.get(point.record.orbitClassCode) ?? 0) + 1)
    return { minimum, maximum, median: values[Math.floor(values.length / 2)], bins, classes: [...counts.entries()].sort(([, left], [, right]) => right - left).slice(0, 4) }
  }, [data])
  const peak = Math.max(...summary.bins, 1)
  return <div className="element-summary"><span className="section-kicker">{t('distributionSummary')}</span><div className="element-histogram" role="img" aria-label={t('distributionHistogram')}>{summary.bins.map((count, index) => <i key={index} style={{ height: `${count / peak * 100}%` }} title={`${count}`} />)}</div><dl><div><dt>{t('range')}</dt><dd>{summary.minimum.toFixed(3)} — {summary.maximum.toFixed(3)}</dd></div><div><dt>{t('median')}</dt><dd>{summary.median.toFixed(3)}</dd></div><div><dt>{t('sample')}</dt><dd>{data.length.toLocaleString()}</dd></div></dl><div className="element-class-summary">{summary.classes.map(([code, count]) => <span key={code}>{code}<b>{count.toLocaleString()}</b></span>)}</div></div>
}

export function ElementSpaceWorkspace() {
  useCatalogSample()
  const mode = uiStore.useStore((state) => state.elementPlot)
  const catalog = catalogStore.useStore()
  const selection = selectionStore.useStore()
  const { bodiesById } = useBodyRegistry()
  const clock = useSimulationClock()
  const { t, language } = useI18n()

  useEffect(() => {
    if (!catalog.manifest || catalog.manifest.precomputedSamples) return
    const controller = new AbortController()
    const sampleLimit = EXACT_CATALOG_LOCATOR_LIMIT
    const scanKey = createCatalogScanKey(catalog.manifest.version, catalog.filters, sampleLimit)
    const timer = window.setTimeout(() => {
      catalogActions.patch({ isLoading: true, error: null, loadProgress: 0 })
      void scanAsteroidCatalog({
        manifest: catalog.manifest!,
        filters: catalog.filters,
        sampleLimit,
        signal: controller.signal,
        onProgress: (loadProgress) => catalogActions.patch({ loadProgress }),
      }).then((result) => {
        const current = catalogStore.getState()
        const currentKey = current.manifest
          ? createCatalogScanKey(current.manifest.version, current.filters, sampleLimit)
          : ''
        if (controller.signal.aborted || result.scanKey !== scanKey || currentKey !== scanKey) return
        catalogActions.setExactResult(result.scanKey, result.records, result.total, result.hasMore)
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) catalogActions.patch({ error: error instanceof Error ? error.message : String(error), isLoading: false })
      })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [catalog.filters, catalog.manifest])

  const sampleLimit = EXACT_CATALOG_LOCATOR_LIMIT
  const scanKey = catalog.manifest ? createCatalogScanKey(catalog.manifest.version, catalog.filters, sampleLimit) : ''
  const exactResultIsPartial = catalog.activeResultScanKey === scanKey && catalog.exactFilteredTotal !== null &&
    catalog.exactFilteredTotal > catalog.activeResultRecords.length
  const displayedRecords = exactResultIsPartial && catalog.baseSampleRecords.length
    ? catalog.baseSampleRecords
    : catalogDisplayRecords(catalog, scanKey)
  const records = useMemo(() => filterCatalogRecords(displayedRecords, catalog.filters), [catalog.filters, displayedRecords])
  const data = useMemo(() => records
    .map((record) => toPlotDatum(record, mode))
    .filter((datum): datum is PlotDatum => datum !== null), [mode, records])
  const selectedSet = useMemo(() => new Set(selection.selectedIds), [selection.selectedIds])
  const miniBodies = useMemo(() => selection.selectedIds.map((id) => bodiesById.get(id)).filter((body): body is CelestialBody => Boolean(body)).slice(0, 160), [bodiesById, selection.selectedIds])
  const miniFrame = useMemo(() => buildCurrentPositions({ bodies: miniBodies, bodiesById, referenceId: 'sun', julianDay: clock.julianDay }), [bodiesById, clock.julianDay, miniBodies])
  const [xLabel, yLabel] = labelsFor(mode)

  return <div className="workspace-page elements-workspace" data-story-target="elements">
    <div className="page-heading"><div><span className="eyebrow">{t('elementsKicker')}</span><h1>{t('elements')}</h1><p>{t(PRODUCT_PROFILE === 'preview' ? 'previewBrushHint' : 'brushHint')}</p></div><strong className="selection-stat">{selection.selectedIds.length} {t('selectedCount')}</strong></div>
    <div className="elements-toolbar glass-panel">
      <div className="segmented-control">{(['a-e', 'a-i', 'a-H', 'q-Q', 'a-period'] as PlotMode[]).map((item) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => uiActions.setElementPlot(item)}>{item}</button>)}</div>
      <div className="legend">{Object.entries(CLASS_COLORS).slice(0, 9).map(([key, color]) => <span key={key}><i style={{ background: color }} />{key}</span>)}</div>
    </div>
    {catalog.sampleError && <div className="error-banner">{catalogSampleErrorMessage(catalog.sampleError, t)}</div>}
    <div className="elements-layout">
      <section className="chart-panel glass-panel">
        <div className="sample-caption">{t('showing')} {data.length.toLocaleString()} / {(catalog.activeResultScanKey === scanKey ? catalog.exactFilteredTotal ?? records.length : records.length).toLocaleString()} · {t('stratifiedSample')}{mode === 'a-H' ? ` · ${t('unknownMagnitudeExcluded')}` : ''}</div>
        <div className="axis-title y">{yLabel}</div><ElementScatter data={data} mode={mode} selectedIds={selectedSet} onSelect={(selected) => {
          const limited = selected.slice(0, 160)
          if (selectionActions.addCatalogBodies(limited.map(asteroidRecordToBody)) === false) return
          if (!selectionActions.setSelectedIds(limited.map((record) => record.id))) return
          uiActions.toast(`${limited.length} ${t('selectedCount')}`)
        }} onFocus={(record) => {
          if (selectionActions.addCatalogBodies([asteroidRecordToBody(record)]) === false) return
          selectionActions.focus(record.id)
          if (!selection.selectedIds.includes(record.id)) selectionActions.toggle(record.id)
        }} ariaLabel={t('elementScatterAria')} /><div className="axis-title x">{xLabel}</div>
      </section>
      <section className="linked-space-panel glass-panel">
        <div className="map-caption"><span>{t('linkedHeliocentric3d')}</span><strong>{miniBodies.length}</strong></div>
        <TrajectoryCanvas3D referenceBody={majorBodiesWithPhysicalData[0]} trajectories={[]} currentPositions={miniFrame.currentPositions} onBodySelect={selectionActions.focus} showEcliptic ariaLabel={t('interactive3d')} fallbackLabel={t('webgl3dUnavailable')} />
      </section>
      <aside className="selection-panel glass-panel">
        <div className="section-heading"><span>{t('selectedBodies')}</span><button onClick={() => selectionActions.setSelectedIds([])}>{t('clear')}</button></div>
        <div className="selected-object-list">{miniBodies.map((body) => <button key={body.id} onClick={() => selectionActions.focus(body.id)}><i style={{ background: body.color }} /><span>{bodyDisplayName(body, language)}</span><small>{body.orbitClassCode ?? body.kind}</small></button>)}</div>
        <div className="resonance-note"><strong>{t('resonances')}</strong>{RESONANCE_BANDS.map((item) => <span key={item.label}>{item.label}<b>{item.a.toFixed(2)} AU</b></span>)}</div>
        <ElementDistributionSummary data={data} />
      </aside>
    </div>
  </div>
}
