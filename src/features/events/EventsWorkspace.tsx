import { useMemo, useState } from 'react'
import { useBodyRegistry } from '../../app/bodyRegistry'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { useConjunctionWorker } from '../../hooks/useConjunctionWorker'
import { useI18n } from '../../i18n/context'
import { formatJulianDayAsDate } from '../../lib/julianDate'
import { simulationActions, simulationStore } from '../../state/simulation-store'
import { uiActions } from '../../state/ui-store'
import type { AnalysisEvent, EventKind } from '../../workers/conjunction.worker'
import { bodyDisplayName } from '../../lib/bodyNames'
import { catalogStore } from '../../state/catalog-store'
import { jplApproxWindowWarning } from '../../engine/ephemeris/modelValidity'
import { eventSamplingPlan } from '../../engine/events/eventSampling'
import { BUILD_INFO } from '../../lib/buildInfo'
import { createBodyPositionResolver, dotVector3, subtractVector3, vector3Magnitude } from '../../lib/ephemeris'
import type { CelestialBody, Vector3 } from '../../types'
import { saveTextExport } from '../../lib/platform'

const ALL_KINDS: EventKind[] = ['close-approach', 'conjunction', 'opposition', 'perihelion', 'aphelion']
const EVENT_ALGORITHM_VERSION = 'event-search-v4'

function angularSeparation(a: Vector3, b: Vector3) {
  const denominator = vector3Magnitude(a) * vector3Magnitude(b)
  if (denominator < 1e-15) return Number.NaN
  return Math.acos(Math.max(-1, Math.min(1, dotVector3(a, b) / denominator))) * 180 / Math.PI
}

function EventDetailCurve({ event, bodies, referenceId, onOpen, label }: { event: AnalysisEvent; bodies: CelestialBody[]; referenceId: string; onOpen: () => void; label: string }) {
  const curve = useMemo(() => {
    const bodiesById = new Map(bodies.map((body) => [body.id, body]))
    const halfWindow = Math.min(60, Math.max(event.sampleIntervalDays * 1.25, event.numericalRefinementHalfWidthDays * 10, .25))
    const samples = Array.from({ length: 81 }, (_, index) => event.julianDay - halfWindow + index / 80 * halfWindow * 2)
    const values = samples.map((julianDay) => {
      const resolve = createBodyPositionResolver(bodiesById, julianDay)
      if (event.kind === 'conjunction' || event.kind === 'opposition') {
        const reference = resolve(referenceId)
        return angularSeparation(subtractVector3(resolve(event.bodyAId), reference), subtractVector3(resolve(event.bodyBId!), reference))
      }
      const otherId = event.bodyBId ?? event.centralBodyId ?? 'sun'
      return vector3Magnitude(subtractVector3(resolve(event.bodyAId), resolve(otherId)))
    })
    const finiteValues = values.filter(Number.isFinite)
    const minimum = finiteValues.length ? Math.min(...finiteValues) : 0
    const maximum = finiteValues.length ? Math.max(...finiteValues) : 1
    const yFor = (value: number) => 92 - ((Number.isFinite(value) ? value : minimum) - minimum) / Math.max(maximum - minimum, 1e-12) * 78
    const points = values.map((value, index) => `${(index / 80 * 100).toFixed(2)},${yFor(value).toFixed(2)}`).join(' ')
    const coarseOffset = Math.min(45, event.sampleIntervalDays / halfWindow * 50)
    const refinementHalfWidth = Math.max(.25, Math.min(45, event.numericalRefinementHalfWidthDays / halfWindow * 50))
    return { halfWindow, minimum, maximum, points, centerY: yFor(values[40]), coarseOffset, refinementHalfWidth }
  }, [bodies, event, referenceId])
  return <article className="event-detail-curve">
    <header><div><span>{label}</span><strong>{event.bodyAName}{event.bodyBName ? ` ↔ ${event.bodyBName}` : ''}</strong></div><button aria-label={`${label}: ${event.bodyAName}${event.bodyBName ? ` ${event.bodyBName}` : ''}`} onClick={onOpen}>↗</button></header>
    <svg viewBox="0 0 100 100" role="img" aria-label={`${label}: ${event.value.toFixed(5)} ${event.unit}`} preserveAspectRatio="none">
      <rect x={50 - curve.refinementHalfWidth} y="5" width={curve.refinementHalfWidth * 2} height="91" className="refined-window" />
      <line x1="50" y1="5" x2="50" y2="96" className="refined-marker" />
      <line x1={50 - curve.coarseOffset} y1="5" x2={50 - curve.coarseOffset} y2="96" className="coarse-marker" /><line x1={50 + curve.coarseOffset} y1="5" x2={50 + curve.coarseOffset} y2="96" className="coarse-marker" />
      <polyline points={curve.points} />
      <circle cx="50" cy={curve.centerY} r="2.4" />
    </svg>
    <dl><div><dt>−{curve.halfWindow.toFixed(3)} d</dt><dd>{curve.minimum.toFixed(event.unit === 'AU' ? 6 : 3)}–{curve.maximum.toFixed(event.unit === 'AU' ? 6 : 3)} {event.unit}</dd><dt>+{curve.halfWindow.toFixed(3)} d</dt></div></dl>
  </article>
}

export function EventsWorkspace() {
  const { selectedBodies, allBodies } = useBodyRegistry()
  const simulation = simulationStore.useStore()
  const clock = useSimulationClock()
  const { t, language } = useI18n()
  const analysis = useConjunctionWorker()
  const catalog = catalogStore.useStore()
  const [windowDays, setWindowDays] = useState(365)
  const [thresholdAU, setThresholdAU] = useState(0.05)
  const [eventKinds, setEventKinds] = useState<EventKind[]>(['close-approach', 'conjunction', 'opposition'])
  const [selectedEventIndex, setSelectedEventIndex] = useState(0)
  const analysisBodies = useMemo(() => selectedBodies.filter((body) => body.id !== simulation.referenceId).slice(0, 48), [selectedBodies, simulation.referenceId])
  const contractCenter = analysis.lastRun?.centerJulianDay ?? clock.julianDay
  const contractWindow = analysis.lastRun?.windowDays ?? windowDays
  const samplingPlan = eventSamplingPlan(analysis.lastRun?.bodies ?? analysisBodies, contractWindow, analysis.lastRun?.sampleCount)
  const contractSamples = samplingPlan.actualSamples
  const sampleIntervalDays = contractWindow / Math.max(contractSamples - 1, 1)
  const validityWarning = jplApproxWindowWarning(
    contractCenter - contractWindow / 2,
    contractCenter + contractWindow / 2,
    language,
  )
  const activeEventIndex = Math.min(selectedEventIndex, Math.max(analysis.events.length - 1, 0))
  const selectedEvent = analysis.events[activeEventIndex] ?? null
  const exportMetadata = {
    generatedAt: new Date().toISOString(),
    datasetVersion: catalog.datasetVersion !== 'unavailable' ? catalog.datasetVersion : catalog.requestedDatasetVersion,
    algorithmVersion: EVENT_ALGORITHM_VERSION,
    model: 'sampled-two-body-local-refinement-v3',
    build: BUILD_INFO,
    inputs: analysis.lastRun ? {
      bodyIds: analysis.lastRun.bodies.map((body) => body.id),
      referenceId: analysis.lastRun.referenceId,
      centerJulianDay: analysis.lastRun.centerJulianDay,
      windowDays: analysis.lastRun.windowDays,
      thresholdAU: analysis.lastRun.thresholdAU,
      eventKinds: analysis.lastRun.eventKinds,
      sampleCount: contractSamples,
      sampleIntervalDays,
      samplingPlan,
    } : null,
  }
  const eventLabels: Record<EventKind, string> = {
    'close-approach': t('eventCloseApproach'), conjunction: t('eventConjunction'), opposition: t('eventOpposition'),
    perihelion: t('eventPerihelion'), aphelion: t('eventAphelion'),
    periapsis: t('eventPeriapsis'), apoapsis: t('eventApoapsis'),
  }
  const statusLabels = {
    idle: t('statusIdle'), running: t('statusRunning'), complete: t('statusComplete'),
    cancelled: t('statusCancelled'), error: t('statusError'),
  }

  return <div className="workspace-page events-workspace" data-story-target="events">
    <header className="page-heading"><div><span className="eyebrow">{t('eventsKicker')}</span><h1>{t('events')}</h1><p>{t('analysisIdle')}</p></div><div className={`job-status status-${analysis.status}`}><i />{statusLabels[analysis.status]}</div></header>
    <div className="events-layout">
      <aside className="event-config glass-panel">
        <div className="section-heading"><span>{t('selectedBodies')}</span><strong>{analysisBodies.length}/48</strong></div>
        <div className="event-body-chips">{analysisBodies.map((body) => <span key={body.id}><i style={{ background: body.color }} />{bodyDisplayName(body, language)}</span>)}</div>
        <label className="field"><span>{t('referenceFrame')}</span><select value={simulation.referenceId} onChange={(event) => simulationActions.patch({ referenceId: event.target.value })}>{allBodies.filter((body) => body.kind !== 'asteroid').map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select></label>
        <label className="field"><span>{t('window')}</span><select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}><option value={30}>{t('thirtyDays')}</option><option value={90}>{t('ninetyDays')}</option><option value={365}>{t('oneYear')}</option><option value={1825}>{t('fiveYears')}</option></select></label>
        <label className="field"><span>{t('threshold')} (AU)</span><input type="number" min="0.0001" max="5" step="0.005" value={thresholdAU} onChange={(event) => setThresholdAU(Number(event.target.value))} /></label>
        <div className="section-kicker">{t('eventTypes').toUpperCase()}</div>
        <div className="event-kind-list">{ALL_KINDS.map((kind) => <label className="toggle-row" key={kind}><input type="checkbox" checked={eventKinds.includes(kind)} onChange={() => setEventKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind])} /><span>{eventLabels[kind]}</span></label>)}</div>
        {analysis.status === 'running' ? <button className="danger-button full-width" onClick={analysis.cancel}>{t('cancelAnalysis')}</button> : <button className="primary-button full-width" disabled={analysisBodies.length < 1 || !eventKinds.length} onClick={() => analysis.run({
          bodies: analysisBodies,
          resolutionBodies: allBodies,
          referenceId: simulation.referenceId,
          centerJulianDay: clock.julianDay,
          windowDays,
          thresholdAU,
          eventKinds,
        })}>{t('runAnalysis')}</button>}
        <div className="analysis-progress"><span>{t('progress')}</span><strong>{Math.round(analysis.progress * 100)}%</strong><div><i style={{ width: `${analysis.progress * 100}%` }} /></div></div>
        {analysis.error && <div className="error-banner">{analysis.error}</div>}
        {samplingPlan.capped && <div className="error-banner">{t('samplingInadequate')}</div>}
      </aside>

      <section className="timeline-panel glass-panel">
        <div className="section-heading"><span>{t('eventTimeline').toUpperCase()}</span><strong>{analysis.events.length}</strong></div>
        {selectedEvent && analysis.lastRun && <EventDetailCurve event={selectedEvent} bodies={analysis.lastRun.resolutionBodies} referenceId={analysis.lastRun.referenceId} label={t('localRefinementCurve')} onOpen={() => { simulationActions.seek(selectedEvent.julianDay); uiActions.navigate('explorer') }} />}
        {!analysis.events.length && analysis.status !== 'running' && <div className="empty-state"><span>⌁</span><p>{t('noEvents')}</p></div>}
        <div className="event-timeline">{analysis.events.map((event, index) => <button className={index === activeEventIndex ? 'selected' : ''} key={`${event.kind}-${event.bodyAId}-${event.bodyBId}-${index}`} onClick={() => setSelectedEventIndex(index)}>
          <time>{formatJulianDayAsDate(event.julianDay)}</time><i className={`event-${event.kind}`} />
          <div><strong>{eventLabels[event.kind]}</strong><span>{event.bodyAName}{event.bodyBName ? ` ↔ ${event.bodyBName}` : event.centralBodyName ? ` · ${event.centralBodyName} ${t('centered')}` : ''}</span><small>{event.value.toFixed(event.unit === 'AU' ? 5 : 2)} {event.unit} · {t('numericalInterval')} ±{event.numericalRefinementHalfWidthDays.toFixed(4)} d · {t('physicalUncertaintyMissing')}</small></div>
        </button>)}</div>
      </section>

      <aside className="event-evidence glass-panel">
        <div className="section-kicker">{t('analysisContract').toUpperCase()}</div>
        <dl><div><dt>{t('model')}</dt><dd>{t('coarseScanModel')}</dd></div><div><dt>{t('orbitEpoch')}</dt><dd>{t('perObjectEpoch')}</dd></div><div><dt>{t('window')}</dt><dd>JD {(contractCenter - contractWindow / 2).toFixed(2)} — {(contractCenter + contractWindow / 2).toFixed(2)}</dd></div><div><dt>{t('sampling')}</dt><dd>{contractSamples} / {samplingPlan.requiredSamples} {t('samples')} · {sampleIntervalDays.toFixed(4)} {t('dayInterval')} · {samplingPlan.capped ? t('capped') : t('adequateCadence')}</dd></div></dl>
        {validityWarning && <div className="error-banner">{validityWarning}</div>}
        <p className="fine-print">{t('analysisExplanation')}</p>
        <div className="export-actions"><button disabled={!analysis.events.length} onClick={() => void saveTextExport(JSON.stringify({ ...exportMetadata, events: analysis.events }, null, 2), 'solar-atlas-events.json', 'application/json').catch((error: unknown) => uiActions.toast(error instanceof Error ? error.message : String(error)))}>{t('exportJson')}</button><button disabled={!analysis.events.length} onClick={() => {
          const header = 'appVersion,commitSha,datasetVersion,algorithmVersion,kind,bodyA,bodyB,centralBodyId,julianDay,value,unit,model,sampleIntervalDays,numericalRefinementHalfWidthDays,physicalPredictionUncertainty\n'
          const rows = analysis.events.map((event) => [BUILD_INFO.version, BUILD_INFO.commitSha, exportMetadata.datasetVersion ?? '', EVENT_ALGORITHM_VERSION, event.kind, event.bodyAName, event.bodyBName ?? '', event.centralBodyId ?? '', event.julianDay, event.value, event.unit, event.model, event.sampleIntervalDays, event.numericalRefinementHalfWidthDays, event.physicalPredictionUncertainty].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
          void saveTextExport(header + rows, 'solar-atlas-events.csv', 'text/csv').catch((error: unknown) => uiActions.toast(error instanceof Error ? error.message : String(error)))
        }}>{t('exportCsv')}</button></div>
      </aside>
    </div>
  </div>
}
