import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TrajectoryCanvas } from '../../components/TrajectoryCanvas'
import { SPACECRAFT } from '../../data/spacecraft'
import { BODY_PHYSICAL } from '../../data/physical'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { buildSpacecraftFrame } from '../../engine/ephemeris/spacecraft'
import { computeInfluenceRadii } from '../../engine/ephemeris/spheresOfInfluence'
import { useTrajectoryWorker } from '../../hooks/useTrajectoryWorker'
import { useEphemerisRevision } from '../../hooks/useEphemerides'
import { useCatalogPointWorker } from '../../hooks/useCatalogPointWorker'
import { useCatalogSample } from '../../hooks/useCatalogSample'
import { useExplorerCatalog } from '../../hooks/useExplorerCatalog'
import { catalogSourceLocator } from '../../lib/catalogSourceRow'
import { asteroidRecordToBody, loadAsteroidRecordsByLocators } from '../../lib/catalogLoader'
import { useAdaptiveRenderBudget } from '../../hooks/useAdaptiveRenderBudget'
import { useI18n } from '../../i18n/context'
import { bodyPositionOrNull, createBodyPositionResolver, MissingBodyStateError, vector3Magnitude, subtractVector3 } from '../../lib/ephemeris'
import { computeLagrangePoints } from '../../lib/lagrange'
import { computeOrbitEllipses } from '../../lib/orbitEllipse'
import { getSuggestedViewRadius } from '../../lib/referenceFrame'
import { selectionActions, selectionStore } from '../../state/selection-store'
import { simulationActions, simulationStore } from '../../state/simulation-store'
import { catalogActions, catalogStore, filterCatalogRecords } from '../../state/catalog-store'
import type { AsteroidRecord, BodyId, CelestialBody, TrajectoryFrameData } from '../../types'
import { useBodyRegistry } from '../../app/bodyRegistry'
import { BodyInspector } from '../body-inspector/BodyInspector'
import { ControlDrawer } from './ControlDrawer'
import { bodyDisplayName } from '../../lib/bodyNames'
import { formatDistanceAU } from '../../lib/formatDistance'
import { catalogSampleErrorMessage } from '../../lib/catalogSampleProfile'
import { isOnboardingRendererReady, ONBOARDING_RENDER_READY_EVENT } from '../../lib/onboarding'
import { SimulationControls } from './SimulationControls'
import { EphemerisStatus } from './EphemerisStatus'
import { VIEW_CAPABILITIES } from '../../lib/viewCapabilities'
import { selectDetailBodies } from '../../lib/focusLayers'
import { PagedBodyList } from '../../components/PagedBodyList'
import { PRODUCT_PROFILE } from '../../lib/productAvailability'
import { createBackendPositionResolver, type BackendFrame } from '../../lib/backendFrames'
import { useStateTiles } from '../../hooks/useStateTiles'
import { useStateDisplayBudget } from '../../hooks/useStateDisplayBudget'
import { selectStateDisplayPositions } from '../../lib/stateDisplayBudget'
import { summarizeExactBackendCoverage, type ExactBackendCoverageCounts } from '../../lib/backendCoverage'
import { concatCurrentPositions, currentPositionDetails, EMPTY_CURRENT_POSITIONS } from '../../lib/currentPositions'
import { exportBackendTrajectoryAudit } from '../../lib/backendTrajectories'
import { saveTextExport } from '../../lib/platform'
import { sourcePinFor } from '../../lib/sourceScene'
import type { TranslationKey } from '../../i18n/en'
import { uiActions } from '../../state/ui-store'
import { catalogFramingRadius } from '../../lib/catalogScenePresentation'
import { julianDayToDate } from '../../lib/julianDate'

const TrajectoryCanvas3D = lazy(async () => {
  const module = await import('../../components/TrajectoryCanvas3D')
  return { default: module.TrajectoryCanvas3D }
})
const ignoreFrameDuration = () => {}
const EMPTY_CATALOG_RECORDS: AsteroidRecord[] = []
const EMPTY_CATALOG_POSITIONS = new Float64Array(0)

function SpatialPreview() {
  return (
    <div className="trajectory-3d-placeholder" aria-hidden="true">
      <i /><i /><i /><i /><span />
    </div>
  )
}

type FrameViewProps = {
  referenceId: BodyId
  selectedBodies: CelestialBody[]
  trajectoryBodies: CelestialBody[]
  resolveCurrentPosition: ReturnType<typeof createBodyPositionResolver>
  resolutionBodies: CelestialBody[]
  bodiesById: Map<BodyId, CelestialBody>
  julianDay: number
  trajectoryJulianDay: number
  seekRevision: number
  onFrame: (frame: TrajectoryFrameData) => void
  onHover: (item: { body: CelestialBody; distance: number; x: number; y: number } | null) => void
  catalogAppearance?: Uint8Array
  onCatalogSelect?: (ordinal: number) => void
  catalogRecords: AsteroidRecord[]
  catalogPositions: Float64Array
  catalogDrawCount: number
  catalogSampleTotal: number
  catalogFitKey: string
  catalogSamplingActive: boolean
  pixelRatioLimit: number
  onFrameDuration: (durationMs: number) => void
  stateDisplay: ReturnType<typeof useStateDisplayBudget>
  statePriorityIds: string[]
  exactCoverageCounts: ExactBackendCoverageCounts
  samplingActive: boolean
  isPlaying: boolean
  render3DReady: boolean
  cameraResetKey: number
  backendFrame?: BackendFrame | null
  backendStatus: { configured: boolean; loading: boolean; error: string | null; publishedEpochUtcJd?: number | null; requestedEpochUtcJd?: number }
}

function FrameView({
  referenceId,
  selectedBodies,
  trajectoryBodies,
  resolveCurrentPosition,
  resolutionBodies,
  bodiesById,
  julianDay,
  trajectoryJulianDay,
  seekRevision,
  onFrame,
  onHover,
  catalogAppearance,
  onCatalogSelect,
  catalogRecords,
  catalogPositions,
  catalogDrawCount,
  catalogSampleTotal,
  catalogFitKey,
  catalogSamplingActive,
  pixelRatioLimit,
  onFrameDuration,
  stateDisplay,
  statePriorityIds,
  exactCoverageCounts,
  samplingActive,
  isPlaying,
  render3DReady,
  cameraResetKey,
  backendFrame,
  backendStatus,
}: FrameViewProps) {
  const ephemerisRevision = useEphemerisRevision()
  const simulation = simulationStore.useStore()
  const { t, language } = useI18n()
  const referenceBody = bodiesById.get(referenceId) ?? bodiesById.get('sun')!
  const detailBodyIds = useMemo(() => trajectoryBodies.map(body => body.id), [trajectoryBodies])
  const qualityLabel = simulation.renderQuality === 'max'
    ? t('renderQualityMax')
    : simulation.renderQuality === 'balanced'
      ? t('renderQualityBalanced')
      : t('renderQualityAuto')
  const spacecraftMarkerOutsideRange = simulation.showSpacecraft && SPACECRAFT.some((body) => {
    const firstJulianDay = body.trajectoryPoints[0].jd
    const lastJulianDay = body.trajectoryPoints[body.trajectoryPoints.length - 1].jd
    return julianDay < firstJulianDay || julianDay > lastJulianDay
  })
  const referencePosition = useMemo(() => bodyPositionOrNull(resolveCurrentPosition, referenceBody.id), [resolveCurrentPosition, referenceBody.id])
  const catalogOrigin = useMemo(() => {
    if (!referencePosition) return null
    // Without a catalog overlay this only gates reference-dependent layers.
    if (!simulation.showCatalogCloud) return referencePosition
    // MPC catalog coordinates are heliocentric; backend exact states use the
    // solar-system barycenter, so rebase the reference origin to the Sun.
    const sun = bodyPositionOrNull(resolveCurrentPosition, 'sun')
    return sun ? subtractVector3(referencePosition, sun) : null
  }, [referencePosition, resolveCurrentPosition, simulation.showCatalogCloud])
  const visibleCatalogDrawCount = simulation.showCatalogCloud && !catalogOrigin ? 0 : catalogDrawCount
  const visibleCatalogRecords = visibleCatalogDrawCount > 0 ? catalogRecords : EMPTY_CATALOG_RECORDS
  const visibleCatalogPositions = visibleCatalogDrawCount > 0 ? catalogPositions : EMPTY_CATALOG_POSITIONS
  const { frame: baseFrame, progress, isComputing, error } = useTrajectoryWorker({
    bodies: selectedBodies,
    trajectoryBodies,
    resolveBodyPosition: resolveCurrentPosition,
    resolutionBodies,
    referenceId: referenceBody.id,
    currentJulianDay: julianDay,
    trajectoryJulianDay,
    historyDays: simulation.historyDays,
    seekRevision,
    // Inventory expansion must not silently undersample short-period moons.
    // Only historical trails are budgeted; current positions keep all selections.
    sampleCount: Math.min(simulation.sampleCount, 240),
    currentFrame: backendFrame,
  })
  const spacecraftFrame = useMemo(() => {
    void ephemerisRevision
    return simulation.showSpacecraft && referencePosition
    ? buildSpacecraftFrame(SPACECRAFT, referenceBody.id, bodiesById, julianDay)
    : { currentPositions: EMPTY_CURRENT_POSITIONS, trajectories: [], trajectoryUnavailableBodyIds: [] }
  }, [bodiesById, referencePosition, julianDay, referenceBody.id, simulation.showSpacecraft, ephemerisRevision])
  const frame = useMemo<TrajectoryFrameData>(() => ({
    currentPositions: concatCurrentPositions(baseFrame.currentPositions, spacecraftFrame.currentPositions),
    trajectories: [...baseFrame.trajectories, ...spacecraftFrame.trajectories],
    trajectoryUnavailableBodyIds: [...baseFrame.trajectoryUnavailableBodyIds, ...spacecraftFrame.trajectoryUnavailableBodyIds],
    maxDistance: Math.max(baseFrame.maxDistance, spacecraftFrame.currentPositions.maxDistance()),
    trajectoryAudit: baseFrame.trajectoryAudit,
  }), [baseFrame, spacecraftFrame])
  const displayedStates = useMemo(() => backendFrame
    ? selectStateDisplayPositions(baseFrame.currentPositions, stateDisplay.limitPerPane, statePriorityIds)
    : baseFrame.currentPositions, [backendFrame, baseFrame.currentPositions, stateDisplay.limitPerPane, statePriorityIds])
  const displayPositions = useMemo(() => concatCurrentPositions(displayedStates, spacecraftFrame.currentPositions), [displayedStates, spacecraftFrame.currentPositions])
  const backendStateAvailable = Boolean(backendFrame)
  const spacecraftFitIds = useMemo(() => {
    const positions = spacecraftFrame.currentPositions
    return Array.from({ length: positions.length }, (_, index) => positions.bodyAt(index).id).sort().join(',')
  }, [spacecraftFrame.currentPositions])
  const stateFitToken = useMemo(() => ({}),
    [backendStateAvailable, selectedBodies, baseFrame.currentPositions.length, spacecraftFitIds])
  useEffect(() => onFrame(frame), [frame, onFrame])
  const focusSuggested = useMemo(() => getSuggestedViewRadius(
    selectedBodies.map((body) => body.id), referenceBody.id, bodiesById, baseFrame.maxDistance,
  ), [bodiesById, referenceBody.id, selectedBodies, baseFrame.maxDistance])
  const catalogSuggested = useMemo(() => {
    // The 3D renderer fits its own xyz data. Do not scan a spatial buffer as
    // planar pairs or compute an unused 2D extent while 3D is active.
    if (!catalogOrigin || simulation.viewMode !== '2d') return 0
    return catalogFramingRadius(catalogPositions, 2, catalogPositions.length / 2, catalogOrigin)
  }, [catalogOrigin, catalogPositions, simulation.viewMode])
  const suggested = Math.max(focusSuggested, catalogSuggested)
  const orbitEllipses = useMemo(() => {
    void ephemerisRevision
    return VIEW_CAPABILITIES[simulation.viewMode].fullOrbits && simulation.showOrbits
    ? computeOrbitEllipses(selectedBodies.slice(0, 40), bodiesById, referenceBody.id, trajectoryJulianDay)
    : []
  }, [bodiesById, referenceBody.id, selectedBodies, simulation.showOrbits, simulation.viewMode, trajectoryJulianDay, ephemerisRevision])
  const auxiliaryPositions = useMemo(() => referenceBody.id === 'sun' && (simulation.showLagrange || simulation.showHillSphere || simulation.showLaplaceSoi)
    ? currentPositionDetails(frame.currentPositions, detailBodyIds, simulation.viewMode === '2d' ? 320 : 160) : [],
  [frame.currentPositions, detailBodyIds, referenceBody.id, simulation.showLagrange, simulation.showHillSphere, simulation.showLaplaceSoi, simulation.viewMode])
  const lagrangePoints = useMemo(() => {
    if (!simulation.showLagrange || referenceBody.id !== 'sun') return []
    return auxiliaryPositions.filter(item => item.body.kind === 'planet').flatMap(item => {
      const points = computeLagrangePoints(item.body, item.planarPosition)
      return points.length ? [{ body: item.body, points }] : []
    })
  }, [auxiliaryPositions, referenceBody.id, simulation.showLagrange])
  const influenceCircles = useMemo(() => {
    if (referenceBody.id !== 'sun' || (!simulation.showHillSphere && !simulation.showLaplaceSoi)) return []
    return auxiliaryPositions.flatMap(item => {
      if (!item.body.orbit || item.body.parentId) return []
      const physical = BODY_PHYSICAL[item.body.id]
      if (!physical) return []
      const orbit = item.body.orbit.model === 'planetaryApprox' ? item.body.orbit.base : item.body.orbit
      const radii = computeInfluenceRadii(orbit.semiMajorAxisAU, orbit.eccentricity, physical.massKg, BODY_PHYSICAL.sun.massKg)
      if (!radii) return []
      return [
        ...(simulation.showHillSphere ? [{
          body: item.body,
          position: item.planarPosition,
          radiusAU: radii.hillRadiusAU,
          definition: 'hill' as const,
        }] : []),
        ...(simulation.showLaplaceSoi ? [{
          body: item.body,
          position: item.planarPosition,
          radiusAU: radii.laplaceSoiRadiusAU,
          definition: 'laplace-soi' as const,
        }] : []),
      ]
    })
  }, [auxiliaryPositions, referenceBody.id, simulation.showHillSphere, simulation.showLaplaceSoi])

  return (
    <div className="frame-view" onWheel={(event) => {
      if (simulation.viewMode !== '2d') return
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.12 : 0.89
      simulationActions.patch({ zoom: Math.max(0.15, Math.min(12, simulation.zoom * factor)) })
    }}>
      <div className="frame-overlays" onWheel={event => event.stopPropagation()}>
      <div className="frame-label"><span>{bodyDisplayName(referenceBody, language)}</span><small>{simulation.viewMode.toUpperCase()}{simulation.showCatalogCloud ? ` · ${t('catalogCloudRendered')} ${visibleCatalogDrawCount.toLocaleString()} / ${catalogSampleTotal.toLocaleString()} · ${qualityLabel} · JD ${julianDay.toFixed(3)}` : ''}</small></div>
      <EphemerisStatus bodies={selectedBodies} references={[referenceBody]} julianDay={julianDay} historyDays={simulation.historyDays} exactCoverageCounts={exactCoverageCounts} backendStatus={backendStatus} backendFrame={backendFrame} />
      {frame.trajectoryAudit && <details className="frame-layer-budget glass-panel" data-testid="backend-trajectory-audit"
        data-start-utc-jd={frame.trajectoryAudit.startUtcJd} data-end-utc-jd={frame.trajectoryAudit.endUtcJd}
        data-samples={frame.trajectoryAudit.epochsTdbJd.length} data-trails={baseFrame.trajectories.length}>
        <summary>{t('trajectoryBackendEvidence')}: {baseFrame.trajectories.length}/{trajectoryBodies.length}</summary>
        <p>{t('trajectoryBackendBoundary')}</p>
        {!!frame.trajectoryAudit.sourceTransitions?.length && <p>{language === 'zh'
          ? `检测到 ${frame.trajectoryAudit.sourceTransitions.length} 次采样来源或中心变化；对应连线已断开，详情随审计 JSON 导出。`
          : `${frame.trajectoryAudit.sourceTransitions.length} sampled source or center transitions detected; affected edges are disconnected and details are included in the audit JSON.`}</p>}
        <p>UTC JD {frame.trajectoryAudit.startUtcJd.toFixed(6)} → {frame.trajectoryAudit.endUtcJd.toFixed(6)} · TDB / ECLIPJ2000 / AU · {referenceId}</p>
        <p><code style={{ overflowWrap: 'anywhere' }}>{frame.trajectoryAudit.catalogManifestSha256}</code></p>
        {frame.trajectoryAudit.gaps.map(gap => <p key={gap.bodyId}>{bodyDisplayName(bodiesById.get(gap.bodyId)!, language)}: <code>{gap.reason}</code> · TDB JD {frame.trajectoryAudit!.epochsTdbJd[gap.epochIndex].toFixed(6)}</p>)}
        <button onClick={() => void saveTextExport(JSON.stringify(exportBackendTrajectoryAudit(frame.trajectoryAudit!), null, 2), 'solar-history-audit.json', 'application/json').catch((reason: unknown) => uiActions.toast(String(reason)))}>{t('trajectoryExportAudit')}</button>
      </details>}
      {backendFrame && <details className="frame-layer-budget glass-panel" data-testid="exact-display-budget"
        data-computed={exactCoverageCounts.exactCount} data-displayed={displayedStates.length}
        data-limit={stateDisplay.limitPerPane} data-sampling={samplingActive} data-samples={stateDisplay.metrics?.samples ?? 0}>
        <summary>{t('exactDisplayCount')}: {displayedStates.length.toLocaleString()}/{exactCoverageCounts.exactCount.toLocaleString()} · {t('exactDisplayUnshown')}: {(exactCoverageCounts.exactCount - displayedStates.length).toLocaleString()}</summary>
        <p>{t('exactDisplayPolicy')} ({stateDisplay.limitPerPane.toLocaleString()})</p>
        <p>{t(stateDisplay.reason === 'slow' ? 'exactDisplaySlow' : stateDisplay.reason === 'headroom' ? 'exactDisplayHeadroom' : 'exactDisplayInitial')}</p>
        <p>{stateDisplay.metrics ? `${t('exactDisplayTiming')}: p50 ${stateDisplay.metrics.p50Ms.toFixed(1)} / p95 ${stateDisplay.metrics.p95Ms.toFixed(1)} ms · ${(stateDisplay.metrics.missedRatio * 100).toFixed(1)}%` : t('exactDisplayPending')}</p>
      </details>}
      {selectedBodies.length > trajectoryBodies.length && <div className="frame-layer-budget glass-panel" data-testid="focus-layer-budget">{t('currentPositionCount')}: {baseFrame.currentPositions.length}/{selectedBodies.length} · {t('trailBudgetCount')}: {trajectoryBodies.length}/{selectedBodies.length}</div>}
      {spacecraftMarkerOutsideRange && (
        <div className="frame-layer-budget glass-panel" data-testid="spacecraft-marker-range-notice">
          {t('spacecraftMarkerRangeNotice')}
        </div>
      )}
      {error && <div className="canvas-error">{error}</div>}
      {referencePosition && baseFrame.missingBodyIds.length > 0 && <details className="canvas-error" data-testid="missing-position-notice"><summary>{t('bodyStateUnavailable')} ({baseFrame.missingBodyIds.length})</summary><p>{baseFrame.missingBodyIds.map(id => bodyDisplayName(bodiesById.get(id)!, language)).join(', ')}</p></details>}
      {referencePosition && frame.trajectoryUnavailableBodyIds.length > 0 && <details className="canvas-error" data-testid="missing-trajectory-notice"><summary>{t('trajectoryCoverageUnavailable')} ({frame.trajectoryUnavailableBodyIds.length})</summary><p>{frame.trajectoryUnavailableBodyIds.map(id => bodyDisplayName(bodiesById.get(id) ?? SPACECRAFT.find(body => body.id === id)!, language)).join(', ')}</p></details>}
      {!referencePosition && <div className="canvas-error" role="status">{t('referenceStateUnavailable')}</div>}
      {referencePosition && simulation.showCatalogCloud && !catalogOrigin && <div className="canvas-error catalog-cloud-error" role="status">{t('catalogOriginUnavailable')}</div>}
      </div>
      {isComputing && <div className="compute-progress"><i style={{ width: `${progress * 100}%` }} /></div>}
      {!referencePosition ? null : simulation.viewMode === '3d' && !render3DReady ? (
        <SpatialPreview />
      ) : simulation.viewMode === '3d' ? (
        <Suspense fallback={<SpatialPreview />}>
          <TrajectoryCanvas3D
            referenceBody={referenceBody}
            trajectories={frame.trajectories}
            currentPositions={displayPositions}
            stateFitToken={stateFitToken}
            stateFitRadius={backendFrame ? baseFrame.maxDistance : undefined}
            detailBodyIds={detailBodyIds}
            onReferenceChange={(id) => { if (bodiesById.has(id)) simulationActions.patch({ referenceId: id }) }}
            onBodySelect={selectionActions.focus}
            onHover={(body, distance, x, y) => onHover(body ? { body, distance, x, y } : null)}
            lagrangePoints={lagrangePoints}
            showEcliptic={simulation.showEcliptic}
            ariaLabel={t('interactive3d')}
            fallbackLabel={t('webgl3dUnavailable')}
            onUnavailable={() => simulationActions.patch({ viewMode: '2d' })}
            catalogRecords={visibleCatalogRecords}
            catalogAppearance={catalogAppearance}
            onCatalogSelect={onCatalogSelect}
            catalogPositions3D={visibleCatalogPositions}
            catalogDrawCount={visibleCatalogDrawCount}
            catalogOrigin={catalogOrigin ?? referencePosition}
            catalogFitKey={catalogFitKey}
            continuous={samplingActive || (isPlaying && simulation.showCatalogCloud)}
            pixelRatioLimit={pixelRatioLimit}
            onFrameDuration={onFrameDuration}
            zoomLevel={simulation.zoom}
            resetViewKey={cameraResetKey}
          />
        </Suspense>
      ) : (
        <TrajectoryCanvas
          referenceBody={referenceBody}
          trajectories={frame.trajectories}
          currentPositions={displayPositions}
          viewRadiusAU={suggested / simulation.zoom}
          viewOffsetAU={simulation.viewOffset}
          showEcliptic={simulation.showEcliptic}
          showOrbits={simulation.showOrbits}
          orbitEllipses={orbitEllipses}
          onReferenceChange={(id) => { if (bodiesById.has(id)) simulationActions.patch({ referenceId: id }) }}
          onHover={(body, distance, x, y) => onHover(body ? { body, distance, x, y } : null)}
          lagrangePoints={lagrangePoints}
          influenceCircles={influenceCircles}
          ariaLabel={t('interactive2d')}
          language={language}
          emptyLabel={t('selectBodyPrompt')}
          webglUnavailableLabel={t('webglUnavailable')}
          influenceLabels={{ hill: t('hill'), soi: t('soi') }}
          catalogRecords={visibleCatalogRecords}
          catalogAppearance={catalogAppearance}
          onCatalogSelect={onCatalogSelect}
          catalogPositions={visibleCatalogPositions}
          catalogDrawCount={visibleCatalogDrawCount}
          catalogOrigin={catalogOrigin ?? referencePosition}
          pixelRatioLimit={pixelRatioLimit}
          continuous={samplingActive}
          sampleFrameCadence={catalogSamplingActive}
          onFrameDuration={onFrameDuration}
        />
      )}
    </div>
  )
}

export function ExplorerWorkspace() {
  const ephemerisRevision = useEphemerisRevision()
  const { allBodies, bodiesById, selectedBodies: selectedFromStore } = useBodyRegistry()
  const simulation = simulationStore.useStore()
  const selection = selectionStore.useStore()
  const clock = useSimulationClock()
  const catalog = catalogStore.useStore()
  const { t, language } = useI18n()
  const [render3DReady, setRender3DReady] = useState(isOnboardingRendererReady)
  const [cameraResetKey, setCameraResetKey] = useState(0)
  const resetView = () => setCameraResetKey((value) => value + 1)
  useEffect(() => {
    const activate = () => setRender3DReady(true)
    window.addEventListener(ONBOARDING_RENDER_READY_EVENT, activate)
    if (isOnboardingRendererReady()) activate()
    return () => window.removeEventListener(ONBOARDING_RENDER_READY_EVENT, activate)
  }, [])
  const streamEnabled = simulation.showCatalogCloud && PRODUCT_PROFILE === 'full' && catalog.explorerStreamRows !== null
  useCatalogSample(simulation.showCatalogCloud && !streamEnabled)
  const catalogStream = useExplorerCatalog(catalog.manifest, catalog.filters, simulation.viewMode,
    streamEnabled ? catalog.explorerStreamRows : null, catalog.explorerBudgetMiB * 1024 * 1024, clock.julianDay)
  const selectedBodies = selectedFromStore
  const detailBodyLimit = simulation.viewMode === '2d' ? 320 : 160
  const trajectoryBodies = useMemo(() => selectDetailBodies(selectedBodies, detailBodyLimit,
    [selection.focusedId, simulation.referenceId, simulation.comparisonEnabled ? simulation.comparisonReferenceId : null].filter((id): id is string => Boolean(id))),
  [detailBodyLimit, selectedBodies, selection.focusedId, simulation.comparisonEnabled, simulation.comparisonReferenceId, simulation.referenceId])
  const catalogRecords = useMemo(() => simulation.showCatalogCloud && !streamEnabled
    ? filterCatalogRecords(catalog.baseSampleRecords, catalog.filters)
    : [], [catalog.baseSampleRecords, catalog.filters, simulation.showCatalogCloud, streamEnabled])
  const resolutionBodies = useMemo(() => {
    const required = new Map(allBodies.map((body) => [body.id, body]))
    return [...required.values()]
  }, [allBodies])
  const requestedJulianDay = clock.julianDay
  // One exact state plan serves both frames at this displayed epoch. The
  // renderer's adaptive draw/trail budgets remain independent from protocol
  // coverage, so selected identities are not silently dropped at 510 rows.
  const currentStateReferenceIds = useMemo(() => [simulation.referenceId, ...(simulation.comparisonEnabled ? [simulation.comparisonReferenceId] : [])], [simulation.comparisonEnabled, simulation.comparisonReferenceId, simulation.referenceId])
  const sourcePin = useMemo(() => selection.sourceScene && selection.sourceBase
    ? sourcePinFor(selection.sourceScene, selection.sourceBase)
    : undefined, [selection.sourceBase, selection.sourceScene])
  const currentStates = useStateTiles({
    // Protocol-sized plans are created as needed. Renderer budgets do not
    // silently truncate the exact-state identity set.
    bodies: useMemo(() => {
      const priority = new Set([simulation.referenceId, ...(simulation.comparisonEnabled ? [simulation.comparisonReferenceId] : []), selection.focusedId].filter((id): id is string => Boolean(id)))
      return [...selectedBodies.filter(body => priority.has(body.id)), ...selectedBodies.filter(body => !priority.has(body.id))]
    }, [selectedBodies, selection.focusedId, simulation.comparisonEnabled, simulation.comparisonReferenceId, simulation.referenceId]),
    resolutionBodies,
    referenceIds: currentStateReferenceIds,
    epochUtcJd: streamEnabled && catalogStream.snapshot ? catalogStream.snapshot.julianDay : requestedJulianDay,
    isPlaying: clock.isPlaying,
    seekRevision: clock.seekRevision,
    includeSunDependency: simulation.showCatalogCloud,
    sourcePin,
  })
  const stateEvidence = currentStates.frames.get(simulation.referenceId)?.evidence ?? null
  const exactCoverageCounts = useMemo(() => summarizeExactBackendCoverage(selectedBodies, stateEvidence), [selectedBodies, stateEvidence])
  // A backend frame is an audited snapshot, so its UTC epoch is the only
  // epoch allowed beside that frame while a newer request is loading.
  const renderedJulianDay = currentStates.configured && currentStates.publishedEpochUtcJd !== null
    ? currentStates.publishedEpochUtcJd
    : streamEnabled && catalogStream.snapshot ? catalogStream.snapshot.julianDay : requestedJulianDay
  // All visual layers in a scene use the same authoritative epoch. During a
  // backend refresh this intentionally keeps the previous frame/cloud epoch;
  // EphemerisStatus still exposes loading so a stale snapshot is explicit.
  const trajectoryJulianDay = renderedJulianDay
  const samplePointCloud = useCatalogPointWorker(catalogRecords, renderedJulianDay, simulation.viewMode)
  const catalogPointCloud = streamEnabled ? {
    positions: catalogStream.snapshot?.positions ?? EMPTY_CATALOG_POSITIONS,
    computedJulianDay: catalogStream.snapshot?.julianDay ?? renderedJulianDay,
    readyCount: catalogStream.snapshot?.count ?? 0, error: catalogStream.error, retry: catalogStream.retry,
  } : samplePointCloud
  const catalogPopulation = streamEnabled ? catalogStream.snapshot?.count ?? catalogStream.loaded : catalogRecords.length
  const advanceCatalog = catalogStream.advance
  useEffect(() => {
    if (streamEnabled && catalogStream.snapshot?.julianDay === renderedJulianDay) advanceCatalog(requestedJulianDay)
  }, [advanceCatalog, streamEnabled, catalogStream.snapshot, renderedJulianDay, requestedJulianDay])
  const catalogEpochAligned = !simulation.showCatalogCloud || Math.abs(catalogPointCloud.computedJulianDay - renderedJulianDay) <= 1e-9
  // Full Web uses the audited backend when configured. Pages remains its
  // declared curated static preview; an unconfigured full build has no exact
  // current-position resolver and never silently falls back to local physics.
  // The resolver identity is intentionally tied to the atomically published
  // backend frame.
  const resolveCurrentPosition = useMemo(() => {
    void ephemerisRevision
    if (currentStates.configured) {
      // Reference views share one absolute scientific snapshot. Resolve only
      // the requested body, without copying a full position Map per frame.
      const evidence = currentStates.frames.values().next().value?.evidence
      return createBackendPositionResolver(bodyId => evidence?.positionAu(bodyId), renderedJulianDay)
    }
    if (PRODUCT_PROFILE === 'preview') return createBodyPositionResolver(bodiesById, renderedJulianDay)
    return (bodyId: BodyId) => { throw new MissingBodyStateError(bodyId, renderedJulianDay) }
  }, [bodiesById, currentStates.configured, currentStates.frames, renderedJulianDay, ephemerisRevision])
  const renderBudget = useAdaptiveRenderBudget({
    viewMode: simulation.viewMode,
    quality: simulation.renderQuality,
    comparisonEnabled: simulation.comparisonEnabled,
    // Promote only after this epoch's positions are ready to draw. The full
    // filtered catalog remains the user-facing denominator while the worker
    // is still computing or the published positions are epoch-misaligned.
    availableCount: catalogPointCloud.readyCount,
    sampleTotal: catalogPopulation,
    samplingActive: clock.isPlaying && simulation.showCatalogCloud && catalogEpochAligned && catalogPointCloud.readyCount > 0,
  })
  const [interacting, setInteracting] = useState(false)
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const stop = () => setInteracting(false)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); window.removeEventListener('blur', stop)
      if (wheelTimer.current !== null) clearTimeout(wheelTimer.current)
    }
  }, [])
  const stateSamplingActive = currentStates.configured && (simulation.viewMode === '2d' || render3DReady) && (clock.isPlaying || interacting)
  const stateBudget = useStateDisplayBudget({ viewMode: simulation.viewMode, quality: simulation.renderQuality,
    comparison: simulation.comparisonEnabled, active: stateSamplingActive,
    availablePerPane: Math.min(...currentStateReferenceIds.map(id => currentStates.frames.get(id)?.currentPositions.length ?? 0)),
  })
  const statePriorityIds = useMemo(() => [...currentStateReferenceIds, ...(selection.focusedId ? [selection.focusedId] : [])], [currentStateReferenceIds, selection.focusedId])
  const catalogFrameDuration = renderBudget.onFrameDuration, stateFrameDuration = stateBudget.onFrameDuration
  const catalogSunReady = bodyPositionOrNull(resolveCurrentPosition, 'sun') !== null
  const primaryCatalogDrawCount = catalogEpochAligned && catalogSunReady && bodyPositionOrNull(resolveCurrentPosition, simulation.referenceId)
    ? Math.min(renderBudget.primary, catalogPointCloud.readyCount) : 0
  const secondaryCatalogDrawCount = catalogEpochAligned && catalogSunReady && bodyPositionOrNull(resolveCurrentPosition, simulation.comparisonReferenceId)
    ? Math.min(renderBudget.secondary, catalogPointCloud.readyCount) : 0
  const onPrimaryFrameDuration = useCallback((duration: number) => {
    catalogFrameDuration(duration, primaryCatalogDrawCount)
    stateFrameDuration(duration)
  }, [catalogFrameDuration, stateFrameDuration, primaryCatalogDrawCount])
  const catalogFitKey = simulation.showCatalogCloud
    ? `${streamEnabled ? 'stream' : catalog.baseSampleKey ?? 'unloaded'}|${JSON.stringify(catalog.filters)}`
    : ''
  const [primaryFrame, setPrimaryFrame] = useState<TrajectoryFrameData>({ currentPositions: EMPTY_CURRENT_POSITIONS, trajectories: [], trajectoryUnavailableBodyIds: [], maxDistance: 0 })
  const [secondaryFrame, setSecondaryFrame] = useState<TrajectoryFrameData>({ currentPositions: EMPTY_CURRENT_POSITIONS, trajectories: [], trajectoryUnavailableBodyIds: [], maxDistance: 0 })
  const [hovered, setHovered] = useState<{ body: CelestialBody; distance: number; x: number; y: number } | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const pickController = useRef<AbortController | null>(null)
  const [catalogPickError, setCatalogPickError] = useState<string | null>(null)
  useEffect(() => () => { pickController.current?.abort() }, [catalog.manifest, catalog.filters, streamEnabled])
  const selectCatalogPoint = useCallback((ordinal: number) => {
    const source = catalogStream.snapshot?.result.sourceSelection, manifest = catalog.manifest
    if (!source || !manifest) return
    const locator = catalogSourceLocator(source, ordinal)
    if (!locator) return
    pickController.current?.abort()
    const controller = new AbortController(); pickController.current = controller
    setCatalogPickError(null)
    void loadAsteroidRecordsByLocators(manifest, new Uint32Array([locator.chunkIndex, locator.rowIndex]), controller.signal).then(records => {
      if (controller.signal.aborted || !records[0]) return
      const body = asteroidRecordToBody(records[0])
      if (selectionActions.addCatalogBodies([body], true)) { selectionActions.focus(body.id); setInspectorOpen(true) }
    }).catch((error: unknown) => { if (!controller.signal.aborted) setCatalogPickError(error instanceof Error ? error.message : String(error)) })
  }, [catalog.manifest, catalogStream.snapshot])
  const [measureA, setMeasureA] = useState('earth')
  const [measureB, setMeasureB] = useState('mars')
  const focusedBody = selection.focusedId
    ? bodiesById.get(selection.focusedId) ?? SPACECRAFT.find((body) => body.id === selection.focusedId) ?? null
    : null
  const inspectorBackendFrame = PRODUCT_PROFILE === 'full'
    ? currentStates.frames.get(simulation.comparisonEnabled ? simulation.comparisonReferenceId : simulation.referenceId) ?? null
    : undefined
  const inspectorPositions = inspectorBackendFrame !== undefined && focusedBody?.source !== 'schematic'
    ? inspectorBackendFrame?.currentPositions ?? EMPTY_CURRENT_POSITIONS
    : simulation.comparisonEnabled ? secondaryFrame.currentPositions : primaryFrame.currentPositions
  const selectedBodyIds = useMemo(() => selectedBodies.map((body) => body.id), [selectedBodies])
  const measuredBodyA = selectedBodyIds.includes(measureA) ? measureA : selectedBodyIds[0] ?? ''
  const measuredBodyB = selectedBodyIds.includes(measureB) && measureB !== measuredBodyA
    ? measureB
    : selectedBodyIds.find((id) => id !== measuredBodyA) ?? measuredBodyA
  const measuredDistance = useMemo(() => {
    const resolver = resolveCurrentPosition
    if (!bodiesById.has(measuredBodyA) || !bodiesById.has(measuredBodyB)) return null
    const a = bodyPositionOrNull(resolver, measuredBodyA), b = bodyPositionOrNull(resolver, measuredBodyB)
    return a && b ? vector3Magnitude(subtractVector3(a, b)) : null
  }, [bodiesById, resolveCurrentPosition, measuredBodyA, measuredBodyB])

  return (
    <div className={`explorer-workspace ${inspectorOpen ? 'inspector-open' : ''}`}>
      <ControlDrawer bodies={allBodies} referenceOptions={allBodies.filter((body) => body.source !== 'schematic')} onResetView={resetView} trajectoryAudit={primaryFrame.trajectoryAudit ?? (PRODUCT_PROFILE === 'full' ? null : undefined)} />
        <main className="explorer-stage">
        <SimulationControls />
        {simulation.showCatalogCloud && PRODUCT_PROFILE === 'full' && <details name="explorer-scene-controls" className="catalog-scene-controls glass-panel">
          <summary>{language === 'zh' ? '目录与时间' : 'Catalog and time'} · {catalogPopulation.toLocaleString()} · {catalogStream.error ? (language === 'zh' ? '加载失败' : 'Load failed') : streamEnabled && !catalogStream.snapshot ? (language === 'zh' ? '目录加载中' : 'Loading catalog') : Math.abs(requestedJulianDay - renderedJulianDay) > 1e-6
            ? (language === 'zh' ? `时间追赶中（相差 ${Math.abs(requestedJulianDay - renderedJulianDay).toFixed(3)} 天）` : `Catching up (${Math.abs(requestedJulianDay - renderedJulianDay).toFixed(3)} days apart)`)
            : (language === 'zh' ? '时间已同步' : 'Time synchronized')}</summary>
          <div className="catalog-scene-options" aria-label={language === 'zh' ? '主场景目录' : 'Scene catalog'}>
          <label>{language === 'zh' ? '计算与显示来源' : 'Compute and display source'} <select aria-label={language === 'zh' ? '星体数量' : 'Catalog population'} value={catalog.explorerStreamRows ?? 0}
            onChange={event => catalogActions.patch({ explorerStreamRows: Number(event.target.value) || null })}>
            <option value={0}>{language === 'zh' ? '固定样本' : 'Fixed sample'}</option>
            <option value={100000}>100,000</option><option value={500000}>500,000</option>
            <option value={catalog.manifest?.totalCount ?? 2000000}>{language === 'zh' ? '完整目录（受内存预算限制）' : 'Full catalog (memory limited)'}</option>
          </select></label>
          <label>{language === 'zh' ? '内存规划' : 'Memory plan'} <select aria-label={language === 'zh' ? '目录内存预算' : 'Catalog memory budget'} value={catalog.explorerBudgetMiB} onChange={event => catalogActions.patch({ explorerBudgetMiB: Number(event.target.value) })}>
            {[256, 512, 1024].map(value => <option key={value} value={value}>{value} MiB</option>)}
          </select></label>
          {streamEnabled && <>
            {Math.abs(requestedJulianDay - renderedJulianDay) > 1e-6 && clock.isPlaying && <button type="button" onClick={simulationActions.pause}>{language === 'zh' ? '暂停，等待追赶' : 'Pause to catch up'}</button>}
            <span>{language === 'zh' ? '显示时间' : 'Displayed time'} · {julianDayToDate(renderedJulianDay).toISOString().replace('T', ' ').slice(0, 19)} UTC · {language === 'zh' ? '目标时间' : 'Target time'} · {julianDayToDate(requestedJulianDay).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
            <span role="status" data-testid="explorer-catalog-status" data-computed={catalogStream.snapshot?.count ?? 0} data-drawn={primaryCatalogDrawCount} data-epoch={catalogStream.snapshot?.julianDay ?? ''}>{language === 'zh' ? '已计算' : 'Computed'} {catalogPopulation.toLocaleString()} · {language === 'zh' ? '主视图绘制' : 'Primary draw'} {primaryCatalogDrawCount.toLocaleString()} · {language === 'zh' ? '容量' : 'Capacity'} {catalogStream.capacity.toLocaleString()}
              {catalogStream.snapshot && ` · UTC JD ${catalogStream.snapshot.julianDay.toFixed(6)} · Δt ${(requestedJulianDay - catalogStream.snapshot.julianDay).toFixed(6)} d`}
              {!catalogStream.snapshot && !catalogStream.error && (language === 'zh' ? ' · 加载中' : ' · Loading')}
            </span>
            <button type="button" onClick={() => catalogActions.patch({ explorerStreamRows: null })}>{language === 'zh' ? '停止并返回样本' : 'Stop and return to sample'}</button>
          </>}
          <small>{language === 'zh' ? 'MPC 二体传播；逐体绘制受显示预算限制，不是相互引力模拟。内存规划不是实测峰值。' : 'MPC two-body propagation; individual draws follow the display budget, without mutual gravity. Memory plan is not measured peak usage.'}</small>
          </div>
        </details>}
        {selection.sourceSceneError && <div className="error-banner" role="alert">{t(selection.sourceSceneError as TranslationKey)}</div>}
        {streamEnabled && catalogPickError && <div className="error-banner catalog-cloud-error" role="alert">{catalogPickError}</div>}
        {simulation.showCatalogCloud && !streamEnabled && catalog.sampleError && (
          <div className="error-banner catalog-cloud-error" role="alert">{catalogSampleErrorMessage(catalog.sampleError, t)}</div>
        )}
        {simulation.showCatalogCloud && catalog.error && (
          <div className="error-banner catalog-cloud-error" role="alert">{catalog.error}</div>
        )}
        {simulation.showCatalogCloud && !streamEnabled && catalog.sampleLoadError && (
          <div className="error-banner catalog-cloud-error" role="alert">{catalog.sampleLoadError}</div>
        )}
        {simulation.showCatalogCloud && catalogPointCloud.error && (
          <div className="error-banner catalog-cloud-error" role="alert">{catalogPointCloud.error} <button type="button" onClick={catalogPointCloud.retry}>{t('retry')}</button></div>
        )}
        <button className="inspector-toggle glass-panel" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((value) => !value)}>
          <span>{inspectorOpen ? t('hideBodyDetails') : t('showBodyDetails')}</span>
          <strong>{focusedBody ? bodyDisplayName(focusedBody, language) : t('noBody')}</strong>
        </button>
        <div className={`frames-grid ${simulation.comparisonEnabled ? 'split' : ''}`} data-story-target="scene"
          onPointerDownCapture={() => setInteracting(true)}
          onWheelCapture={() => { setInteracting(true); if (wheelTimer.current !== null) clearTimeout(wheelTimer.current); wheelTimer.current = setTimeout(() => setInteracting(false), 1500) }}>
          <FrameView
            referenceId={simulation.referenceId}
            selectedBodies={selectedBodies}
            trajectoryBodies={trajectoryBodies}
            resolveCurrentPosition={resolveCurrentPosition}
            resolutionBodies={resolutionBodies}
            bodiesById={bodiesById}
            julianDay={renderedJulianDay}
            trajectoryJulianDay={trajectoryJulianDay}
            seekRevision={clock.seekRevision}
            onFrame={setPrimaryFrame}
            onHover={setHovered}
            catalogRecords={catalogRecords}
            catalogAppearance={streamEnabled ? catalogStream.snapshot?.appearance : undefined}
            onCatalogSelect={streamEnabled ? selectCatalogPoint : undefined}
            catalogPositions={catalogPointCloud.positions}
            catalogDrawCount={primaryCatalogDrawCount}
            catalogSampleTotal={renderBudget.sampleTotal}
            catalogFitKey={catalogFitKey}
            catalogSamplingActive={clock.isPlaying && simulation.showCatalogCloud && catalogEpochAligned}
            pixelRatioLimit={renderBudget.pixelRatioLimit}
            onFrameDuration={onPrimaryFrameDuration}
            stateDisplay={stateBudget}
            statePriorityIds={statePriorityIds}
            exactCoverageCounts={exactCoverageCounts}
            samplingActive={stateSamplingActive}
            isPlaying={clock.isPlaying}
            render3DReady={render3DReady}
            cameraResetKey={cameraResetKey}
            backendFrame={currentStates.configured ? (currentStates.frames.get(simulation.referenceId) ?? null) : (PRODUCT_PROFILE === 'full' ? null : undefined)}
            backendStatus={{ ...currentStates, requestedEpochUtcJd: requestedJulianDay }}
          />
          {simulation.comparisonEnabled && (
            <FrameView
              referenceId={simulation.comparisonReferenceId}
              selectedBodies={selectedBodies}
              trajectoryBodies={trajectoryBodies}
              resolveCurrentPosition={resolveCurrentPosition}
              resolutionBodies={resolutionBodies}
              bodiesById={bodiesById}
              julianDay={renderedJulianDay}
              trajectoryJulianDay={trajectoryJulianDay}
              seekRevision={clock.seekRevision}
              onFrame={setSecondaryFrame}
              onHover={setHovered}
              catalogRecords={catalogRecords}
              catalogAppearance={streamEnabled ? catalogStream.snapshot?.appearance : undefined}
              onCatalogSelect={streamEnabled ? selectCatalogPoint : undefined}
              catalogPositions={catalogPointCloud.positions}
              catalogDrawCount={secondaryCatalogDrawCount}
              catalogSampleTotal={renderBudget.sampleTotal}
              catalogFitKey={catalogFitKey}
              catalogSamplingActive={false}
              pixelRatioLimit={renderBudget.pixelRatioLimit}
              onFrameDuration={ignoreFrameDuration}
              stateDisplay={stateBudget}
              statePriorityIds={statePriorityIds}
              exactCoverageCounts={exactCoverageCounts}
              samplingActive={stateSamplingActive}
              isPlaying={clock.isPlaying}
              render3DReady={render3DReady}
              cameraResetKey={cameraResetKey}
              backendFrame={currentStates.configured ? (currentStates.frames.get(simulation.comparisonReferenceId) ?? null) : (PRODUCT_PROFILE === 'full' ? null : undefined)}
              backendStatus={{ ...currentStates, requestedEpochUtcJd: requestedJulianDay }}
            />
          )}
        </div>
        <div className="measure-ribbon glass-panel">
          <span>{t('distance')}</span>
          <select aria-label={t('distanceFrom')} value={measuredBodyA} onChange={(event) => setMeasureA(event.target.value)}>{selectedBodies.map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select>
          <span>↔</span>
          <select aria-label={t('distanceTo')} value={measuredBodyB} onChange={(event) => setMeasureB(event.target.value)}>{selectedBodies.map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select>
          <strong>{measuredDistance === null ? '—' : `${measuredDistance.toFixed(5)} AU · ${(measuredDistance * 149_597_870.7).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`}</strong>
        </div>
        <details name="explorer-scene-controls" className="accessible-scene-controls glass-panel">
          <summary>{t('keyboardControls')}</summary>
          <div className="accessible-view-actions" aria-label={t('view')}>
            <button onClick={() => simulationActions.patch({ zoom: Math.min(12, simulation.zoom * 1.25) })}>{t('zoomIn')} +</button>
            <button onClick={() => simulationActions.patch({ zoom: Math.max(.15, simulation.zoom / 1.25) })}>{t('zoomOut')} −</button>
            <button onClick={() => { simulationActions.patch({ zoom: 1, viewOffset: { x: 0, y: 0 } }); resetView() }}>{t('resetView')}</button>
          </div>
          <PagedBodyList as="ul" label={t('selectedObjectList')} bodies={selectedBodies}>{body => <li key={body.id}>
            <span><i style={{ background: body.color }} />{bodyDisplayName(body, language)}</span>
            <button onClick={() => selectionActions.focus(body.id)}>{t('focusObject')}</button>
            <button onClick={() => simulationActions.patch({ referenceId: body.id })}>{t('setReference')}</button>
          </li>}</PagedBodyList>
        </details>
        {hovered && <div className="atlas-tooltip" style={{ left: hovered.x + 14, top: hovered.y + 12 }}>
          <strong>{bodyDisplayName(hovered.body, language)}</strong><span>{formatDistanceAU(hovered.distance, language)}</span>
        </div>}
      </main>
      {inspectorOpen && <BodyInspector key={focusedBody?.id ?? 'none'} body={focusedBody} currentPositions={inspectorPositions} bodiesById={bodiesById} backendFrame={inspectorBackendFrame} />}
    </div>
  )
}
