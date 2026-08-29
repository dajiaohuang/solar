import { useEffect, useMemo, useRef, useState } from 'react'
import { majorBodiesWithPhysicalData } from '../../app/bodyRegistry'
import { computeHohmann, type HohmannResult } from '../../engine/mission/hohmann'
import { solveBodyToBodyLambert, type LambertSolution, type PorkchopPoint } from '../../engine/mission/lambert'
import { createPorkchopWindow } from '../../engine/mission/porkchopWindow'
import { useI18n } from '../../i18n/context'
import { createBodyPositionResolver, crossVector3, dotVector3 } from '../../lib/ephemeris'
import { dateToJulianDay, julianDayToDate } from '../../lib/julianDate'
import type { BodyId, CelestialBody } from '../../types'
import type { PorkchopWorkerRequest, PorkchopWorkerResponse } from '../../workers/porkchop.worker'
import { bodyDisplayName } from '../../lib/bodyNames'
import { missionActions, missionStore } from '../../state/mission-store'
import { jplApproxWindowWarning } from '../../engine/ephemeris/modelValidity'

function orbitRadius(body: CelestialBody) {
  if (!body.orbit) return null
  return body.orbit.model === 'planetaryApprox' ? body.orbit.base.semiMajorAxisAU : body.orbit.semiMajorAxisAU
}
function normalizeDegrees(value: number) { const wrapped = value % 360; return wrapped < 0 ? wrapped + 360 : wrapped }

function PorkchopCanvas({ points, columns, rows, ariaLabel, selectedIndex, onSelect }: { points: PorkchopPoint[]; columns: number; rows: number; ariaLabel: string; selectedIndex: number; onSelect: (index: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !points.length) return
    const ratio = Math.min(window.devicePixelRatio, 2), width = canvas.clientWidth, height = canvas.clientHeight
    canvas.width = width * ratio; canvas.height = height * ratio
    const context = canvas.getContext('2d'); if (!context) return
    context.scale(ratio, ratio); context.clearRect(0, 0, width, height)
    const finite = points.filter((point) => point.feasible).map((point) => point.totalVInfinityKmS)
    const low = finite.length ? Math.min(...finite) : 0
    const high = finite.length ? Math.min(Math.max(...finite), low + 35) : 1
    const cellWidth = width / columns, cellHeight = height / rows
    points.forEach((point, index) => {
      const column = index % columns, row = Math.floor(index / columns)
      if (!point.feasible) context.fillStyle = '#0b1016'
      else {
        const normalized = Math.max(0, Math.min(1, (point.totalVInfinityKmS - low) / Math.max(high - low, 0.001)))
        const hue = 174 - normalized * 174
        context.fillStyle = `hsl(${hue} 68% ${52 - normalized * 24}%)`
      }
      context.fillRect(column * cellWidth, height - (row + 1) * cellHeight, cellWidth + 0.5, cellHeight + 0.5)
    })
    if (selectedIndex >= 0) {
      const column = selectedIndex % columns, row = Math.floor(selectedIndex / columns)
      context.strokeStyle = '#fff2bd'; context.lineWidth = 2
      context.strokeRect(column * cellWidth + 1, height - (row + 1) * cellHeight + 1, Math.max(1, cellWidth - 2), Math.max(1, cellHeight - 2))
    }
    if (finite.length) {
      context.fillStyle = 'rgba(5,8,12,.78)'; context.fillRect(12, 12, 176, 26)
      context.fillStyle = '#d8e4e8'; context.font = '12px ui-monospace, monospace'; context.fillText(`Σv∞ ${low.toFixed(1)} — ${high.toFixed(1)} km/s`, 22, 29)
    }
  }, [columns, points, rows, selectedIndex])
  return <canvas ref={canvasRef} className="porkchop-canvas" role="img" tabIndex={0} aria-label={ariaLabel} onClick={(event) => {
    const rect = event.currentTarget.getBoundingClientRect()
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
  const candidates = useMemo(() => majorBodiesWithPhysicalData.filter((body) => body.orbit && !body.parentId), [])
  const bodiesById = useMemo(() => new Map<BodyId, CelestialBody>(majorBodiesWithPhysicalData.map((body) => [body.id, body])), [])
  const { departureId, arrivalId, departureDate, arrivalDate } = missionStore.useStore()
  const [hohmann, setHohmann] = useState<HohmannResult | null>(null)
  const [lambert, setLambert] = useState<LambertSolution | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [porkchop, setPorkchop] = useState<{ columns: number; rows: number; points: PorkchopPoint[] } | null>(null)
  const [porkchopStatus, setPorkchopStatus] = useState<'idle' | 'running' | 'error'>('idle')
  const [selectedPorkchopIndex, setSelectedPorkchopIndex] = useState(-1)
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const { t, language } = useI18n()
  useEffect(() => () => workerRef.current?.terminate(), [])

  const departureBody = bodiesById.get(departureId)!
  const arrivalBody = bodiesById.get(arrivalId)!
  const departureJd = dateToJulianDay(new Date(`${departureDate}T12:00:00Z`))
  const arrivalJd = dateToJulianDay(new Date(`${arrivalDate}T12:00:00Z`))
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
    const resolver = createBodyPositionResolver(bodiesById, departureJd)
    const depart = resolver(departureId), arrive = resolver(arrivalId)
    const actual = normalizeDegrees(Math.atan2(crossVector3(depart, arrive).z, dotVector3(depart, arrive)) * 180 / Math.PI)
    if (!hohmann) return { actual, required: null }
    const arrivalRadius = orbitRadius(arrivalBody) ?? 1
    const arrivalMeanMotion = Math.sqrt(0.0002959122082855911 / arrivalRadius ** 3)
    return { actual, required: normalizeDegrees(180 - arrivalMeanMotion * hohmann.transferTimeDays * 180 / Math.PI) }
  }, [arrivalBody, arrivalId, bodiesById, departureId, departureJd, hohmann])
  const porkchopFailures = useMemo(() => {
    const counts = new Map<string, number>()
    for (const point of porkchop?.points ?? []) {
      if (!point.feasible) counts.set(point.failureCode ?? 'unknown', (counts.get(point.failureCode ?? 'unknown') ?? 0) + 1)
    }
    return [...counts.entries()].sort(([, left], [, right]) => right - left)
  }, [porkchop])
  const selectedPorkchopPoint = porkchop?.points[selectedPorkchopIndex] ?? null

  function computeTransfer() {
    setTransferError(null)
    try {
      const departureRadius = orbitRadius(departureBody), arrivalRadius = orbitRadius(arrivalBody)
      if (!departureRadius || !arrivalRadius) throw new Error(t('endpointsRequireElliptic'))
      setHohmann(computeHohmann(departureRadius, arrivalRadius))
      setLambert(solveBodyToBodyLambert({ departureBodyId: departureId, arrivalBodyId: arrivalId, bodiesById, departureJulianDay: departureJd, arrivalJulianDay: arrivalJd }))
    } catch (error) {
      setLambert(null); setTransferError(error instanceof Error ? error.message : String(error))
    }
  }

  function computePorkchop() {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../../workers/porkchop.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const requestId = requestIdRef.current + 1; requestIdRef.current = requestId
    setTransferError(null); setSelectedPorkchopIndex(-1); setPorkchopStatus('running'); setPorkchop(null)
    worker.onmessage = (event: MessageEvent<PorkchopWorkerResponse>) => {
      if (event.data.requestId !== requestId) return
      if (event.data.result) {
        setPorkchop(event.data.result)
        let best = -1
        for (const [index, point] of event.data.result.points.entries()) {
          if (point.feasible && (best < 0 || point.totalVInfinityKmS < event.data.result.points[best].totalVInfinityKmS)) best = index
        }
        setSelectedPorkchopIndex(best)
        setPorkchopStatus('idle')
      }
      else { setTransferError(event.data.error ?? t('porkchopFailed')); setPorkchopStatus('error') }
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
    worker.onerror = (event) => { setTransferError(event.message || t('porkchopFailed')); setPorkchopStatus('error'); worker.terminate(); if (workerRef.current === worker) workerRef.current = null }
    const request: PorkchopWorkerRequest = {
      requestId,
      departureBodyId: departureId,
      arrivalBodyId: arrivalId,
      bodies: majorBodiesWithPhysicalData,
      departureStartJd: porkchopWindow.departureStartJd,
      departureSpanDays: porkchopWindow.departureSpanDays,
      minFlightDays: porkchopWindow.minFlightDays,
      maxFlightDays: porkchopWindow.maxFlightDays,
    }
    worker.postMessage(request)
  }

  return <div className="workspace-page mission-workspace" data-story-target="mission">
    <header className="page-heading"><div><span className="eyebrow">{t('missionKicker')}</span><h1>{t('mission')}</h1><p>{t('educationalWarning')}</p></div></header>
    <div className="mission-layout">
      <aside className="mission-config glass-panel">
        <div className="section-kicker">{t('transferEndpoints').toUpperCase()}</div>
        <label className="field"><span>{t('depart')}</span><select value={departureId} onChange={(event) => missionActions.patch({ departureId: event.target.value })}>{candidates.map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select></label>
        <label className="field"><span>{t('arrive')}</span><select value={arrivalId} onChange={(event) => missionActions.patch({ arrivalId: event.target.value })}>{candidates.map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select></label>
        <label className="field"><span>{t('departureDate')}</span><input type="date" value={departureDate} onChange={(event) => missionActions.patch({ departureDate: event.target.value })} /></label>
        <label className="field"><span>{t('arrivalDate')}</span><input type="date" value={arrivalDate} onChange={(event) => missionActions.patch({ arrivalDate: event.target.value })} /></label>
        <button className="primary-button full-width" disabled={departureId === arrivalId || arrivalJd <= departureJd} onClick={computeTransfer}>{t('computeTransfer')}</button>
        {transferError && <div className="error-banner">{transferError}</div>}
        {(usesDerivedEarthGeocenter || modelValidityWarning) && <div className="mission-model-boundary" aria-label={t('missionModelBoundary')}>
          <strong>{t('missionModelBoundary')}</strong>
          {usesDerivedEarthGeocenter && <p>{t('earthGeocenterDisclosure')}</p>}
          {modelValidityWarning && <p className="model-validity-warning" role="status">⚠ {modelValidityWarning}</p>}
        </div>}
        <div className="phase-gauge"><span>{t('actualPhase').toUpperCase()}</span><strong>{phase.actual.toFixed(1)}°</strong>{phase.required !== null && <small>{t('hohmannTarget')} {phase.required.toFixed(1)}°</small>}<div><i style={{ transform: `rotate(${phase.actual}deg)` }} /></div></div>
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
          </> : <EmptyResult label={t('configureEndpoints')} />}</article>
        </div>
        <article className="porkchop-module glass-panel"><div className="module-heading"><span>{t('porkchop')}</span><button disabled={!hohmann || porkchopStatus === 'running'} onClick={computePorkchop}>{porkchopStatus === 'running' ? t('loading') : t('computePorkchop')}</button></div>{porkchop ? <><PorkchopCanvas {...porkchop} selectedIndex={selectedPorkchopIndex} onSelect={setSelectedPorkchopIndex} ariaLabel={t('porkchopAria')} />{selectedPorkchopPoint && <div className={`porkchop-selection ${selectedPorkchopPoint.feasible ? '' : 'infeasible'}`}><div><span>{t('selectedOpportunity')}</span><strong>{selectedPorkchopPoint.feasible ? `${selectedPorkchopPoint.totalVInfinityKmS.toFixed(3)} km/s · Σv∞` : selectedPorkchopPoint.failureCode}</strong><small>{julianDayToDate(selectedPorkchopPoint.departureJulianDay).toISOString().slice(0, 10)} → {julianDayToDate(selectedPorkchopPoint.arrivalJulianDay).toISOString().slice(0, 10)} · {(selectedPorkchopPoint.arrivalJulianDay - selectedPorkchopPoint.departureJulianDay).toFixed(1)} d</small></div><button disabled={!selectedPorkchopPoint.feasible} onClick={() => {
            const nextDepartureDate = julianDayToDate(selectedPorkchopPoint.departureJulianDay).toISOString().slice(0, 10)
            const nextArrivalDate = julianDayToDate(selectedPorkchopPoint.arrivalJulianDay).toISOString().slice(0, 10)
            missionActions.patch({ departureDate: nextDepartureDate, arrivalDate: nextArrivalDate })
            try {
              const departureRadius = orbitRadius(departureBody), arrivalRadius = orbitRadius(arrivalBody)
              if (departureRadius && arrivalRadius) setHohmann(computeHohmann(departureRadius, arrivalRadius))
              setLambert(solveBodyToBodyLambert({ departureBodyId: departureId, arrivalBodyId: arrivalId, bodiesById, departureJulianDay: selectedPorkchopPoint.departureJulianDay, arrivalJulianDay: selectedPorkchopPoint.arrivalJulianDay }))
              setTransferError(null)
            } catch (error) { setTransferError(error instanceof Error ? error.message : String(error)) }
          }}>{t('applyOpportunity')}</button></div>}{porkchopFailures.length > 0 && <p className="fine-print">{t('solverFailures')}: {porkchopFailures.map(([code, count]) => `${code} ${count}`).join(' · ')}</p>}</> : <div className="porkchop-placeholder"><div className="contours" /><p>{t('porkchopDescription')}</p></div>}</article>
      </section>

      <aside className="mission-evidence glass-panel">
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
