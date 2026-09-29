import { useEffect, useMemo, useRef, useState } from 'react'
import { majorBodiesWithPhysicalData, useBodyRegistry } from '../../app/bodyRegistry'
import { computeHohmann, type HohmannResult } from '../../engine/mission/hohmann'
import { SOLAR_GM_AU3_PER_DAY2 } from '../../engine/units'
import { solveBodyToBodyLambert, type LambertSolution, type PorkchopPoint, type computePorkchopGrid } from '../../engine/mission/lambert'
import { createPorkchopWindow } from '../../engine/mission/porkchopWindow'
import { createAnalysisEphemeris } from '../../engine/ephemeris/analysisEphemeris'
import { useI18n } from '../../i18n/context'
import { kernelFilesForBodies, kernelsForWindow } from '../../engine/ephemeris/kernelStore'
import { dateToJulianDay, julianDayToDate } from '../../lib/julianDate'
import type { CelestialBody } from '../../types'
import type { PorkchopWorkerRequest, PorkchopWorkerResponse } from '../../workers/porkchop.worker'
import { bodyDisplayName } from '../../lib/bodyNames'
import { missionActions, missionStore } from '../../state/mission-store'
import { jplApproxWindowWarning } from '../../engine/ephemeris/modelValidity'
import { AnalysisPolicySelect, AnalysisSourceSummary } from '../../components/AnalysisSourceSummary'
import { saveTextExport } from '../../lib/platform'
import { uiActions } from '../../state/ui-store'
import { BUILD_INFO } from '../../lib/buildInfo'
import { managedEphemerisWorker } from '../../lib/managedEphemerisWorker'
import { useEphemerisRevision } from '../../hooks/useEphemerides'
import { assertPorkchopResultBinding } from '../../engine/mission/porkchopResultBinding'
import { admitPorkchopRequest } from '../../engine/mission/porkchopRequest'
import { loadBackendAnalysisEphemeris } from '../../lib/backendAnalysisEphemeris'
import type { BodyId } from '../../types'

function orbitRadius(body: CelestialBody) {
  if (!body.orbit) return null
  return body.orbit.model === 'planetaryApprox' ? body.orbit.base.semiMajorAxisAU : body.orbit.semiMajorAxisAU
}
function normalizeDegrees(value: number) { const wrapped = value % 360; return wrapped < 0 ? wrapped + 360 : wrapped }

async function solveMissionLambert(params: {
  policy: 'prefer-spk' | 'require-spk'
  departureBodyId: BodyId
  arrivalBodyId: BodyId
  bodiesById: Map<BodyId, CelestialBody>
  departureJulianDay: number
  arrivalJulianDay: number
  signal: AbortSignal
  expectedCatalogManifestSha256?: string
  expectedInventoryManifestSha256?: string
}) {
  const { policy, signal, expectedCatalogManifestSha256, expectedInventoryManifestSha256, ...solverParams } = params
  const backendBase = typeof import.meta.env.VITE_SOLAR_API_BASE_URL === 'string'
    ? import.meta.env.VITE_SOLAR_API_BASE_URL.trim() : ''
  if (policy === 'require-spk' && backendBase) {
    const ephemeris = await loadBackendAnalysisEphemeris({
      base: backendBase, bodiesById: solverParams.bodiesById,
      bodyIds: [solverParams.departureBodyId, solverParams.arrivalBodyId],
      epochUtcJds: [solverParams.departureJulianDay, solverParams.arrivalJulianDay], signal,
      expectedCatalogManifestSha256, expectedInventoryManifestSha256,
    })
    if (expectedCatalogManifestSha256 && (ephemeris.backendStateAudit.catalogManifestSha256 !== expectedCatalogManifestSha256 ||
        ephemeris.backendStateAudit.inventoryManifestSha256 !== expectedInventoryManifestSha256)) {
      throw new Error('Backend mission source snapshot changed')
    }
    signal.throwIfAborted()
    return solveBodyToBodyLambert({ ...solverParams, ephemerisPolicy: policy,
      ephemerisProvider: ephemeris, backendStateAudit: ephemeris.backendStateAudit })
  }
  signal.throwIfAborted()
  return solveBodyToBodyLambert({ ...solverParams, ephemerisPolicy: policy })
}

function PorkchopCanvas({ points, columns, rows, ariaLabel, selectedIndex, onSelect }: { points: PorkchopPoint[]; columns: number; rows: number; ariaLabel: string; selectedIndex: number; onSelect: (index: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const palette = useMemo(() => {
    let low = Infinity, high = -Infinity
    for (const point of points) {
      if (!point.feasible) continue
      low = Math.min(low, point.totalVInfinityKmS)
      high = Math.max(high, point.totalVInfinityKmS)
    }
    const hasFeasible = low !== Infinity
    if (!hasFeasible) { low = 0; high = 1 }
    else high = Math.min(high, low + 35)
    const colors = points.map(point => {
      if (!point.feasible) return '#0b1016'
      const normalized = Math.max(0, Math.min(1, (point.totalVInfinityKmS - low) / Math.max(high - low, 0.001)))
      return `hsl(${174 - normalized * 174} 68% ${52 - normalized * 24}%)`
    })
    return { colors, low, high, hasFeasible }
  }, [points])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !points.length) return
    let pendingFrame: number | null = null
    const draw = () => {
      pendingFrame = null
      const width = canvas.clientWidth, height = canvas.clientHeight
      if (width <= 0 || height <= 0) return
      // At most 4M pixels and 4096 per edge; browser backing overhead is separate.
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / width, 4096 / height, Math.sqrt(4_194_304 / (width * height)))
      const pixelWidth = Math.max(1, Math.floor(width * ratio)), pixelHeight = Math.max(1, Math.floor(height * ratio))
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      const context = canvas.getContext('2d'); if (!context) return
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
      context.clearRect(0, 0, width, height)
      const cellWidth = width / columns, cellHeight = height / rows
      palette.colors.forEach((color, index) => {
        const column = index % columns, row = Math.floor(index / columns)
        context.fillStyle = color
        context.fillRect(column * cellWidth, height - (row + 1) * cellHeight, cellWidth + 0.5, cellHeight + 0.5)
      })
      if (selectedIndex >= 0 && selectedIndex < points.length) {
        const column = selectedIndex % columns, row = Math.floor(selectedIndex / columns)
        context.strokeStyle = '#fff2bd'; context.lineWidth = 2
        context.strokeRect(column * cellWidth + 1, height - (row + 1) * cellHeight + 1, Math.max(1, cellWidth - 2), Math.max(1, cellHeight - 2))
      }
      if (palette.hasFeasible) {
        context.fillStyle = 'rgba(5,8,12,.78)'; context.fillRect(12, 12, 176, 26)
        context.fillStyle = '#d8e4e8'; context.font = '12px ui-monospace, monospace'; context.fillText(`Σv∞ ${palette.low.toFixed(1)} — ${palette.high.toFixed(1)} km/s`, 22, 29)
      }
    }
    const scheduleDraw = () => { if (pendingFrame === null) pendingFrame = requestAnimationFrame(draw) }
    const observer = new ResizeObserver(scheduleDraw)
    observer.observe(canvas)
    window.addEventListener('resize', scheduleDraw)
    scheduleDraw()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleDraw)
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
    }
  }, [columns, palette, points.length, rows, selectedIndex])
  return <canvas ref={canvasRef} className="porkchop-canvas" role="img" tabIndex={0} aria-label={ariaLabel} onClick={(event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || !points.length) return
    const column = Math.max(0, Math.min(columns - 1, Math.floor((event.clientX - rect.left) / rect.width * columns)))
    const row = Math.max(0, Math.min(rows - 1, rows - 1 - Math.floor((event.clientY - rect.top) / rect.height * rows)))
    onSelect(row * columns + column)
  }} onKeyDown={(event) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: columns, ArrowDown: -columns }
    const delta = deltas[event.key]
    if (delta === undefined) return
    event.preventDefault()
    onSelect(Math.max(0, Math.min(points.length - 1, selectedIndex + delta)))
  }} />
}

export function MissionWorkspace() {
  const ephemerisRevision = useEphemerisRevision()
  const candidates = useMemo(() => majorBodiesWithPhysicalData.filter((body) => body.orbit && !body.parentId), [])
  const { bodiesById } = useBodyRegistry()
  const { departureId, arrivalId, departureDate, arrivalDate, departureJulianDay, arrivalJulianDay, ephemerisPolicy } = missionStore.useStore()
  const [storedHohmann, setHohmann] = useState<HohmannResult | null>(null)
  const [storedLambert, setLambert] = useState<LambertSolution | null>(null)
  const [transferInputKey, setTransferInputKey] = useState<string | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferRunning, setTransferRunning] = useState(false)
  const [porkchop, setPorkchop] = useState<ReturnType<typeof computePorkchopGrid> | null>(null)
  const [porkchopRequest, setPorkchopRequest] = useState<PorkchopWorkerRequest | null>(null)
  const currentTransferKey = JSON.stringify([departureId, arrivalId, departureDate, arrivalDate, ephemerisPolicy, departureJulianDay, arrivalJulianDay])
  const currentTransferKeyRef = useRef(currentTransferKey)
  useEffect(() => { currentTransferKeyRef.current = currentTransferKey }, [currentTransferKey])
  const transferRequestRef = useRef<{ controller: AbortController; key: string } | null>(null)
  // Hide stale transfer values synchronously on input changes, including the
  // Hohmann hint used to construct the next grid; no delayed effect cleanup.
  const hohmann = transferInputKey === currentTransferKey ? storedHohmann : null
  const lambert = transferInputKey === currentTransferKey ? storedLambert : null
  const [porkchopStatus, setPorkchopStatus] = useState<'idle' | 'running' | 'error'>('idle')
  const [selectedPorkchopIndex, setSelectedPorkchopIndex] = useState(-1)
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const { t, language } = useI18n()
  useEffect(() => () => {
    transferRequestRef.current?.controller.abort()
    transferRequestRef.current = null
    requestIdRef.current += 1
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])
  useEffect(() => {
    const active = transferRequestRef.current
    if (active && active.key !== currentTransferKey) {
      active.controller.abort()
      transferRequestRef.current = null
      setTransferRunning(false)
      setTransferError(null)
    }
  }, [currentTransferKey])

  const departureBody = bodiesById.get(departureId)!
  const arrivalBody = bodiesById.get(arrivalId)!
  const departureJd = departureJulianDay ?? dateToJulianDay(new Date(`${departureDate}T12:00:00Z`))
  const arrivalJd = arrivalJulianDay ?? dateToJulianDay(new Date(`${arrivalDate}T12:00:00Z`))
  const usesJplApproximation = departureBody.orbit?.model === 'planetaryApprox' || arrivalBody.orbit?.model === 'planetaryApprox'
  const usesDerivedEarthGeocenter = departureBody.orbitRepresents === 'earth-moon-barycenter' || arrivalBody.orbitRepresents === 'earth-moon-barycenter'
  const porkchopWindow = createPorkchopWindow(departureJd, arrivalJd, hohmann?.transferTimeDays)
  const modelValidityWarning = usesJplApproximation
    ? jplApproxWindowWarning(
        Math.min(departureJd, porkchopWindow.propagationStartJd),
        Math.max(arrivalJd, porkchopWindow.propagationEndJd),
        language,
      )
    : null
  const phase = useMemo(() => {
    void ephemerisRevision
    const arrivalRadius = orbitRadius(arrivalBody)
    const arrivalMeanMotion = hohmann && arrivalRadius
      ? Math.sqrt(SOLAR_GM_AU3_PER_DAY2 / arrivalRadius ** 3) : null
    const required = hohmann && arrivalMeanMotion !== null
      ? normalizeDegrees(180 - arrivalMeanMotion * hohmann.transferTimeDays * 180 / Math.PI) : null
    try {
      const ephemeris = createAnalysisEphemeris({
        bodiesById,
        kernels: kernelsForWindow(departureJd, departureJd, kernelFilesForBodies([departureBody, arrivalBody])),
        startJulianDay: departureJd,
        endJulianDay: departureJd,
        policy: ephemerisPolicy,
      })
      const epoch = ephemeris.at(departureJd)
      const depart = epoch.position(departureId), arrive = epoch.position(arrivalId)
      // The Hohmann target is an ecliptic-longitude phase. A 3D dot product
      // mixed with a planar cross product would skew it for inclined orbits.
      const departureLongitude = Math.atan2(depart.y, depart.x)
      const arrivalLongitude = Math.atan2(arrive.y, arrive.x)
      const actual = normalizeDegrees((arrivalLongitude - departureLongitude) * 180 / Math.PI)
      return { actual, required, evidence: ephemeris.evidence() }
    } catch {
      // Strict SPK mode must not leave an approximate phase visible beside a
      // failed strict transfer request.
      return { actual: null, required, evidence: null }
    }
  }, [arrivalBody, arrivalId, bodiesById, departureBody, departureId, departureJd, ephemerisPolicy, hohmann, ephemerisRevision])
  const porkchopFailures = useMemo(() => {
    const counts = new Map<string, number>()
    for (const point of porkchop?.points ?? []) {
      if (!point.feasible) counts.set(point.failureCode ?? 'unknown', (counts.get(point.failureCode ?? 'unknown') ?? 0) + 1)
    }
    return [...counts.entries()].sort(([, left], [, right]) => right - left)
  }, [porkchop])
  const selectedPorkchopPoint = porkchop?.points[selectedPorkchopIndex] ?? null

  async function computeTransfer() {
    const requestKey = currentTransferKey
    const controller = new AbortController()
    transferRequestRef.current?.controller.abort()
    transferRequestRef.current = { controller, key: requestKey }
    setTransferRunning(true)
    setTransferInputKey(null)
    setHohmann(null)
    setLambert(null)
    setTransferError(null)
    try {
      const departureRadius = orbitRadius(departureBody), arrivalRadius = orbitRadius(arrivalBody)
      if (!departureRadius || !arrivalRadius) throw new Error(t('endpointsRequireElliptic'))
      const nextHohmann = computeHohmann(departureRadius, arrivalRadius)
      const nextLambert = await solveMissionLambert({ policy: ephemerisPolicy, departureBodyId: departureId, arrivalBodyId: arrivalId,
        bodiesById, departureJulianDay: departureJd, arrivalJulianDay: arrivalJd, signal: controller.signal })
      if (controller.signal.aborted || transferRequestRef.current?.controller !== controller || currentTransferKeyRef.current !== requestKey) return
      setHohmann(nextHohmann)
      setLambert(nextLambert)
      setTransferInputKey(currentTransferKey)
    } catch (error) {
      if (controller.signal.aborted || transferRequestRef.current?.controller !== controller || currentTransferKeyRef.current !== requestKey) return
      setHohmann(null); setLambert(null); setTransferError(error instanceof Error ? error.message : String(error))
    } finally {
      if (transferRequestRef.current?.controller === controller) {
        transferRequestRef.current = null
        setTransferRunning(false)
      }
    }
  }

  function cancelTransfer() {
    const active = transferRequestRef.current
    if (!active) return
    active.controller.abort()
    transferRequestRef.current = null
    setTransferRunning(false)
    setTransferError(null)
  }

  async function applyOpportunity(point: PorkchopPoint, grid: NonNullable<typeof porkchop>, gridRequest: PorkchopWorkerRequest | null) {
    if (!point.feasible) return
    const nextDepartureDate = julianDayToDate(point.departureJulianDay).toISOString().slice(0, 10)
    const nextArrivalDate = julianDayToDate(point.arrivalJulianDay).toISOString().slice(0, 10)
    const { departureBodyId, arrivalBodyId } = grid.endpoints
    const policy = grid.ephemeris.policy
    const nextInputKey = JSON.stringify([departureBodyId, arrivalBodyId, nextDepartureDate, nextArrivalDate, policy,
      point.departureJulianDay, point.arrivalJulianDay])
    transferRequestRef.current?.controller.abort()
    transferRequestRef.current = null
    setTransferRunning(false)
    const controller = grid.backendStateAudit ? new AbortController() : null
    if (controller) {
      transferRequestRef.current = { controller, key: nextInputKey }
      currentTransferKeyRef.current = nextInputKey
      setTransferRunning(true)
      setTransferInputKey(null)
      setHohmann(null)
      setLambert(null)
    }
    missionActions.patch({ departureId: departureBodyId, arrivalId: arrivalBodyId, departureDate: nextDepartureDate, arrivalDate: nextArrivalDate,
      departureJulianDay: point.departureJulianDay, arrivalJulianDay: point.arrivalJulianDay, ephemerisPolicy: policy })
    try {
      if (!gridRequest) throw new Error('Mission grid input snapshot is unavailable')
      const frozenBodies = new Map(gridRequest.bodies.map(body => [body.id, body]))
      const departureBody = frozenBodies.get(departureBodyId), arrivalBody = frozenBodies.get(arrivalBodyId)
      if (!departureBody || !arrivalBody) throw new Error('Mission grid endpoint body is unavailable')
      const departureRadius = orbitRadius(departureBody), arrivalRadius = orbitRadius(arrivalBody)
      const nextHohmann = departureRadius && arrivalRadius ? computeHohmann(departureRadius, arrivalRadius) : null
      let nextLambert: LambertSolution
      if (controller && grid.backendStateAudit) {
        nextLambert = await solveMissionLambert({ policy, departureBodyId, arrivalBodyId, bodiesById: frozenBodies,
          departureJulianDay: point.departureJulianDay, arrivalJulianDay: point.arrivalJulianDay, signal: controller.signal,
          expectedCatalogManifestSha256: grid.backendStateAudit.catalogManifestSha256,
          expectedInventoryManifestSha256: grid.backendStateAudit.inventoryManifestSha256 })
        if (controller.signal.aborted || transferRequestRef.current?.controller !== controller || currentTransferKeyRef.current !== nextInputKey) return
      } else {
        nextLambert = solveBodyToBodyLambert({ ephemerisPolicy: policy,
          kernels: kernelsForWindow(grid.ephemeris.startJulianDay, grid.ephemeris.endJulianDay, grid.ephemerisFiles),
          departureBodyId, arrivalBodyId, bodiesById: frozenBodies,
          departureJulianDay: point.departureJulianDay, arrivalJulianDay: point.arrivalJulianDay })
      }
      setHohmann(nextHohmann)
      setLambert(nextLambert)
      setTransferInputKey(nextInputKey)
      setTransferError(null)
    } catch (error) {
      if (controller && (controller.signal.aborted || transferRequestRef.current?.controller !== controller || currentTransferKeyRef.current !== nextInputKey)) return
      setHohmann(null)
      setLambert(null)
      setTransferError(error instanceof Error ? error.message : String(error))
    } finally {
      if (controller && transferRequestRef.current?.controller === controller) {
        transferRequestRef.current = null
        setTransferRunning(false)
      }
    }
  }

  function cancelPorkchop() {
    requestIdRef.current += 1
    workerRef.current?.terminate()
    workerRef.current = null
    setPorkchopStatus('idle')
  }

  function computePorkchop() {
    workerRef.current?.terminate()
    workerRef.current = null
    const requestId = requestIdRef.current + 1; requestIdRef.current = requestId
    setTransferError(null); setSelectedPorkchopIndex(-1); setPorkchopStatus('running'); setPorkchop(null)
    setPorkchopRequest(null)
    const fail = (error: unknown) => {
      if (requestIdRef.current !== requestId) return
      workerRef.current?.terminate()
      workerRef.current = null
      setPorkchop(null)
      setPorkchopRequest(null)
      setSelectedPorkchopIndex(-1)
      setTransferError(error instanceof Error ? error.message : String(error))
      setPorkchopStatus('error')
    }
    let worker: Worker
    let request: PorkchopWorkerRequest
    try {
      const input: PorkchopWorkerRequest = {
        ephemerisFiles: kernelFilesForBodies([departureBody, arrivalBody]), ephemerisPolicy, requestId,
        departureBodyId: departureId, arrivalBodyId: arrivalId,
        bodies: majorBodiesWithPhysicalData,
        departureStartJd: porkchopWindow.departureStartJd,
        departureSpanDays: porkchopWindow.departureSpanDays,
        minFlightDays: porkchopWindow.minFlightDays,
        maxFlightDays: porkchopWindow.maxFlightDays,
      }
      admitPorkchopRequest(input)
      request = structuredClone(input)
      worker = managedEphemerisWorker(new Worker(new URL('../../workers/porkchop.worker.ts', import.meta.url), { type: 'module' }))
    }
    catch (error) { fail(error); return }
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<PorkchopWorkerResponse>) => {
      if (requestIdRef.current !== requestId || workerRef.current !== worker) return
      if (!event.data || event.data.requestId !== requestId) { fail(new Error('Invalid mission worker response')); return }
      if (event.data.result) {
        const result = event.data.result
        try { assertPorkchopResultBinding(request, result) }
        catch (error) { fail(error); return }
        let best = -1
        for (const [index, point] of result.points.entries()) {
          if (point.feasible && (best < 0 || point.totalVInfinityKmS < result.points[best].totalVInfinityKmS)) best = index
        }
        setPorkchop(result)
        setPorkchopRequest(request)
        setSelectedPorkchopIndex(best)
        setPorkchopStatus('idle')
      }
      else { fail(new Error(typeof event.data.error === 'string' ? event.data.error : t('porkchopFailed'))); return }
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
    worker.onerror = (event) => {
      if (requestIdRef.current === requestId && workerRef.current === worker) fail(new Error(event.message || t('porkchopFailed')))
    }
    worker.onmessageerror = () => {
      if (requestIdRef.current === requestId && workerRef.current === worker) fail(new Error('Mission worker message could not be decoded'))
    }
    try { worker.postMessage(request) }
    catch (error) { fail(error) }
  }

  return <div className="workspace-page mission-workspace" data-story-target="mission">
    <div className="page-heading"><div><span className="eyebrow">{t('missionKicker')}</span><h1>{t('mission')}</h1><p>{t('educationalWarning')}</p></div></div>
    <div className="mission-layout">
      <aside className="mission-config glass-panel">
        <div className="section-kicker">{t('transferEndpoints').toUpperCase()}</div>
        <label className="field"><span>{t('depart')}</span><select value={departureId} onChange={(event) => missionActions.patch({ departureId: event.target.value })}>{candidates.map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select></label>
        <label className="field"><span>{t('arrive')}</span><select value={arrivalId} onChange={(event) => missionActions.patch({ arrivalId: event.target.value })}>{candidates.map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select></label>
        <label className="field"><span>{t('departureDate')}</span><input type="date" value={departureDate} onChange={(event) => missionActions.patch({ departureDate: event.target.value })} />{departureJulianDay !== undefined && <small>{julianDayToDate(departureJulianDay).toISOString()} · JD {departureJulianDay} UTC</small>}</label>
        <label className="field"><span>{t('arrivalDate')}</span><input type="date" value={arrivalDate} onChange={(event) => missionActions.patch({ arrivalDate: event.target.value })} />{arrivalJulianDay !== undefined && <small>{julianDayToDate(arrivalJulianDay).toISOString()} · JD {arrivalJulianDay} UTC</small>}</label>
        <AnalysisPolicySelect value={ephemerisPolicy} onChange={(value) => missionActions.patch({ ephemerisPolicy: value })} />
        <button className="primary-button full-width" disabled={!transferRunning && (departureId === arrivalId || arrivalJd <= departureJd)} aria-busy={transferRunning} onClick={transferRunning ? cancelTransfer : computeTransfer}>{transferRunning ? t('cancelAnalysis') : t('computeTransfer')}</button>
        {transferError && <div className="error-banner">{transferError}</div>}
        {(usesDerivedEarthGeocenter || modelValidityWarning) && <div className="mission-model-boundary" aria-label={t('missionModelBoundary')}>
          <strong>{t('missionModelBoundary')}</strong>
          {usesDerivedEarthGeocenter && <p>{t('earthGeocenterDisclosure')}</p>}
          {modelValidityWarning && <p className="model-validity-warning" role="status">⚠ {modelValidityWarning}</p>}
        </div>}
        <div className="phase-gauge"><span>{t('actualPhase').toUpperCase()}</span>{phase.actual === null ? <strong>—</strong> : <strong>{phase.actual.toFixed(1)}°</strong>}{phase.required !== null && <small>{t('hohmannTarget')} {phase.required.toFixed(1)}°</small>}{phase.actual !== null && <div><i style={{ transform: `rotate(${phase.actual}deg)` }} /></div>}{phase.actual === null && <small role="status">{t('phaseSourceUnavailable')}</small>}</div>
        <AnalysisSourceSummary evidence={phase.evidence} testId="mission-phase-source-summary" />
      </aside>

      <section className="mission-results">
        <div className="transfer-summary-grid">
          <article className="result-module glass-panel"><div className="module-heading"><span>{t('hohmann')}</span><em>{t('level').toUpperCase()} 1</em></div>{hohmann ? <>
            <div className="hero-metric"><strong>{hohmann.totalDeltaVKmS.toFixed(3)}</strong><span>km/s · {t('deltaV')}</span></div>
            <div className="metric-grid"><Metric label={t('departureBurn')} value={`${hohmann.departureDeltaVKmS.toFixed(3)} km/s`} /><Metric label={t('arrivalBurn')} value={`${hohmann.arrivalDeltaVKmS.toFixed(3)} km/s`} /><Metric label={t('timeOfFlight')} value={`${hohmann.transferTimeDays.toFixed(1)} d`} /><Metric label={t('transferEccentricity')} value={hohmann.eccentricity.toFixed(4)} /></div>
          </> : <EmptyResult label={t('configureEndpoints')} />}</article>
          <article className="result-module glass-panel"><div className="module-heading"><span>{t('lambert')}</span><em>{t('level').toUpperCase()} 2</em></div>{lambert ? <>
            <div className="hero-metric"><strong>{lambert.departureVInfinityKmS.toFixed(3)}</strong><span>km/s · {t('departureVInfinity')}</span></div>
            <div className="metric-grid"><Metric label={t('arrivalVInfinity')} value={`${lambert.arrivalVInfinityKmS.toFixed(3)} km/s`} /><Metric label="C3" value={`${lambert.c3Km2S2.toFixed(2)} km²/s²`} /><Metric label={t('timeOfFlight')} value={`${lambert.timeOfFlightDays.toFixed(1)} d`} /><Metric label={t('solver')} value={`${lambert.iterations} iter · |r| ${Math.abs(lambert.residual).toExponential(1)}`} /></div>
            <AnalysisSourceSummary evidence={lambert.ephemeris} testId="mission-lambert-source-summary" />
            {lambert.backendStateAudit && <p className="fine-print">{lambert.backendStateAudit.catalogVersion} · {lambert.backendStateAudit.epochsTdbJd.length} exact TDB epochs · {lambert.backendStateAudit.plans.length} plans · {lambert.backendStateAudit.tiles.length} verified tiles · {lambert.backendStateAudit.catalogManifestSha256}</p>}
            <button onClick={() => void saveTextExport(JSON.stringify({ schemaVersion: 1, kind: 'solar-atlas-lambert-transfer', build: BUILD_INFO, solution: lambert }, null, 2), 'solar-atlas-transfer.json', 'application/json').catch(error => uiActions.toast(String(error)))}>{t('exportJson')}</button>
          </> : <EmptyResult label={t('configureEndpoints')} />}</article>
        </div>
        <article className="porkchop-module glass-panel"><div className="module-heading"><span>{t('porkchop')}</span><button disabled={!hohmann && porkchopStatus !== 'running'} onClick={porkchopStatus === 'running' ? cancelPorkchop : computePorkchop}>{porkchopStatus === 'running' ? t('cancelAnalysis') : t('computePorkchop')}</button></div>{porkchop ? <><PorkchopCanvas {...porkchop} selectedIndex={selectedPorkchopIndex} onSelect={setSelectedPorkchopIndex} ariaLabel={t('porkchopAria')} />{selectedPorkchopPoint && <div className={`porkchop-selection ${selectedPorkchopPoint.feasible ? '' : 'infeasible'}`}><div><span>{t('selectedOpportunity')}</span><strong>{selectedPorkchopPoint.feasible ? `${selectedPorkchopPoint.totalVInfinityKmS.toFixed(3)} km/s · Σv∞` : selectedPorkchopPoint.failureCode}</strong><small>{julianDayToDate(selectedPorkchopPoint.departureJulianDay).toISOString().slice(0, 10)} → {julianDayToDate(selectedPorkchopPoint.arrivalJulianDay).toISOString().slice(0, 10)} · {(selectedPorkchopPoint.arrivalJulianDay - selectedPorkchopPoint.departureJulianDay).toFixed(1)} d</small></div><button disabled={!selectedPorkchopPoint.feasible || transferRunning} onClick={() => void applyOpportunity(selectedPorkchopPoint, porkchop, porkchopRequest)}>{t('applyOpportunity')}</button></div>}{porkchopFailures.length > 0 && <p className="fine-print">{t('solverFailures')}: {porkchopFailures.map(([code, count]) => `${code} ${count}`).join(' · ')}</p>}</> : <div className="porkchop-placeholder"><div className="contours" /><p>{t('porkchopDescription')}</p></div>}</article>
      </section>

      <aside className="mission-evidence glass-panel">
        <AnalysisSourceSummary evidence={porkchop?.ephemeris} testId="mission-porkchop-source-summary" />
        {porkchop?.backendStateAudit && <p className="fine-print">{porkchop.backendStateAudit.catalogVersion} · {porkchop.backendStateAudit.epochsTdbJd.length} exact TDB epochs · {porkchop.backendStateAudit.tiles.length} verified tiles · SHA-256 {porkchop.backendStateAudit.catalogManifestSha256.slice(0, 12)}…</p>}
        {porkchop && porkchopRequest && <button onClick={() => {
          const payload = {
            schemaVersion: 1, kind: 'solar-atlas-porkchop-grid', build: BUILD_INFO,
            request: porkchopRequest,
            selectedPointIndex: selectedPorkchopIndex >= 0 && selectedPorkchopIndex < porkchop.points.length ? selectedPorkchopIndex : null,
            unavailableMetricEncoding: 'null-for-infeasible-points',
            result: { ...porkchop, points: porkchop.points.map(point => point.feasible ? point : {
              ...point, departureVInfinityKmS: null, arrivalVInfinityKmS: null, totalVInfinityKmS: null,
            }) },
          }
          void saveTextExport(JSON.stringify(payload, null, 2), 'solar-atlas-porkchop.json', 'application/json').catch(error => uiActions.toast(String(error)))
        }}>{t('porkchop')} · {t('exportJson')}</button>}
        <div className="section-kicker">{t('assumptions').toUpperCase()}</div>
        <ol className="model-ladder"><li className="active"><i>1</i><div><strong>{t('circularHohmann')}</strong><span>{t('circularHohmannDescription')}</span></div></li><li className="active"><i>2</i><div><strong>{t('lambertTwoBody')}</strong><span>{t('lambertDescription')}</span></div></li><li><i>3</i><div><strong>{t('patchedConics')}</strong><span>{t('patchedConicsDescription')}</span></div></li><li><i>4</i><div><strong>{t('nBodyValidation')}</strong><span>{t('nBodyOutOfScope')}</span></div></li></ol>
        <div className="assist-diagram"><span className="sun-node">☉</span><span className="planet-node earth-node">{language === 'zh' ? '地球' : 'Earth'}</span><span className="planet-node jupiter-node">{language === 'zh' ? '木星' : 'Jupiter'}</span><span className="planet-node target-node">{t('target')}</span><svg viewBox="0 0 260 160"><path d="M35 125 C78 62 116 45 150 78 S214 76 236 30" /><circle cx="150" cy="78" r="16" /></svg><small>{t('gravityAssistTeaching')}</small></div>
        {hohmann && <div className="model-note"><b>{t('model')}</b><p>{hohmann.model} · {t('centralBody')} {hohmann.centralBody} · {hohmann.direction}</p><small>{t('epoch')} {julianDayToDate(departureJd).toISOString()} · {t('hohmannIgnoresEccentricity')}</small></div>}
      </aside>
    </div>
  </div>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }
function EmptyResult({ label }: { label: string }) { return <div className="empty-result"><span>∿</span><p>{label}</p></div> }
