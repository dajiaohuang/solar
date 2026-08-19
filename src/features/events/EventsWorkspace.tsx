import { useMemo, useState } from 'react'
import { useBodyRegistry } from '../../app/bodyRegistry'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { useConjunctionWorker } from '../../hooks/useConjunctionWorker'
import { useI18n } from '../../i18n/context'
import { formatJulianDayAsDate } from '../../lib/julianDate'
import { simulationActions, simulationStore } from '../../state/simulation-store'
import { uiActions } from '../../state/ui-store'
import type { EventKind } from '../../workers/conjunction.worker'
import { bodyDisplayName } from '../../lib/bodyNames'
import { catalogStore } from '../../state/catalog-store'
import { jplApproxWindowWarning } from '../../engine/ephemeris/modelValidity'
import { eventSamplingPlan } from '../../engine/events/eventSampling'

const ALL_KINDS: EventKind[] = ['close-approach', 'conjunction', 'opposition', 'perihelion', 'aphelion']
const EVENT_ALGORITHM_VERSION = 'event-search-v4'

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  URL.revokeObjectURL(url)
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
  const exportMetadata = {
    generatedAt: new Date().toISOString(),
    datasetVersion: catalog.datasetVersion !== 'unavailable' ? catalog.datasetVersion : catalog.requestedDatasetVersion,
    algorithmVersion: EVENT_ALGORITHM_VERSION,
    model: 'sampled-two-body-local-refinement-v3',
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

  return <div className="workspace-page events-workspace">
    <header className="page-heading"><div><span className="eyebrow">EXPLICIT JOB / CANCELLABLE WORKER / CACHED RESULTS</span><h1>{t('events')}</h1><p>{t('analysisIdle')}</p></div><div className={`job-status status-${analysis.status}`}><i />{analysis.status.toUpperCase()}</div></header>
    <div className="events-layout">
      <aside className="event-config glass-panel">
        <div className="section-heading"><span>{t('selectedBodies')}</span><strong>{analysisBodies.length}/48</strong></div>
        <div className="event-body-chips">{analysisBodies.map((body) => <span key={body.id}><i style={{ background: body.color }} />{bodyDisplayName(body, language)}</span>)}</div>
        <label className="field"><span>{t('referenceFrame')}</span><select value={simulation.referenceId} onChange={(event) => simulationActions.patch({ referenceId: event.target.value })}>{allBodies.filter((body) => body.kind !== 'asteroid').map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select></label>
        <label className="field"><span>{t('window')}</span><select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option><option value={1825}>5 years</option></select></label>
        <label className="field"><span>{t('threshold')} (AU)</span><input type="number" min="0.0001" max="5" step="0.005" value={thresholdAU} onChange={(event) => setThresholdAU(Number(event.target.value))} /></label>
        <div className="section-kicker">{t('eventTypes').toUpperCase()}</div>
        <div className="event-kind-list">{ALL_KINDS.map((kind) => <label className="toggle-row" key={kind}><input type="checkbox" checked={eventKinds.includes(kind)} onChange={() => setEventKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind])} /><span>{kind.replace('-', ' ')}</span></label>)}</div>
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
        <div className="section-heading"><span>EVENT TIMELINE</span><strong>{analysis.events.length}</strong></div>
        {!analysis.events.length && analysis.status !== 'running' && <div className="empty-state"><span>⌁</span><p>{t('noEvents')}</p></div>}
        <div className="event-timeline">{analysis.events.map((event, index) => <button key={`${event.kind}-${event.bodyAId}-${event.bodyBId}-${index}`} onClick={() => {
          simulationActions.seek(event.julianDay)
          uiActions.navigate('explorer')
        }}>
          <time>{formatJulianDayAsDate(event.julianDay)}</time><i className={`event-${event.kind}`} />
          <div><strong>{event.kind.replace('-', ' ')}</strong><span>{event.bodyAName}{event.bodyBName ? ` ↔ ${event.bodyBName}` : event.centralBodyName ? ` · ${event.centralBodyName}-centered` : ''}</span><small>{event.value.toFixed(event.unit === 'AU' ? 5 : 2)} {event.unit} · numerical interval ±{event.numericalRefinementHalfWidthDays.toFixed(4)} d · physical uncertainty not estimated</small></div>
        </button>)}</div>
      </section>

      <aside className="event-evidence glass-panel">
        <div className="section-kicker">ANALYSIS CONTRACT</div>
        <dl><div><dt>{t('model')}</dt><dd>Coarse scan + local two-body re-propagation</dd></div><div><dt>{t('orbitEpoch')}</dt><dd>Per-object osculating epoch</dd></div><div><dt>{t('window')}</dt><dd>JD {(contractCenter - contractWindow / 2).toFixed(2)} — {(contractCenter + contractWindow / 2).toFixed(2)}</dd></div><div><dt>Sampling</dt><dd>{contractSamples} / {samplingPlan.requiredSamples} samples · {sampleIntervalDays.toFixed(4)} d interval · {samplingPlan.capped ? 'capped' : 'adequate cadence'}</dd></div></dl>
        {validityWarning && <div className="error-banner">{validityWarning}</div>}
        <p className="fine-print">A cadence adapted to orbital and relative angular rates identifies non-endpoint candidates; each bracket is refined and positions are propagated again at the refined Julian Day. The numerical interval is not a physical prediction uncertainty, which is not estimated.</p>
        <div className="export-actions"><button disabled={!analysis.events.length} onClick={() => download('solar-atlas-events.json', JSON.stringify({ ...exportMetadata, events: analysis.events }, null, 2), 'application/json')}>{t('exportJson')}</button><button disabled={!analysis.events.length} onClick={() => {
          const header = 'datasetVersion,algorithmVersion,kind,bodyA,bodyB,centralBodyId,julianDay,value,unit,model,sampleIntervalDays,numericalRefinementHalfWidthDays,physicalPredictionUncertainty\n'
          const rows = analysis.events.map((event) => [exportMetadata.datasetVersion ?? '', EVENT_ALGORITHM_VERSION, event.kind, event.bodyAName, event.bodyBName ?? '', event.centralBodyId ?? '', event.julianDay, event.value, event.unit, event.model, event.sampleIntervalDays, event.numericalRefinementHalfWidthDays, event.physicalPredictionUncertainty].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
          download('solar-atlas-events.csv', header + rows, 'text/csv')
        }}>{t('exportCsv')}</button></div>
      </aside>
    </div>
  </div>
}
