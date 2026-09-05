import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TrajectoryCanvas } from '../../components/TrajectoryCanvas'
import { SPACECRAFT } from '../../data/spacecraft'
import { BODY_PHYSICAL } from '../../data/physical'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { buildSpacecraftFrame } from '../../engine/ephemeris/spacecraft'
import { computeInfluenceRadii } from '../../engine/ephemeris/spheresOfInfluence'
import { useTrajectoryWorker } from '../../hooks/useTrajectoryWorker'
import { useCatalogPointWorker } from '../../hooks/useCatalogPointWorker'
import { useCatalogSample } from '../../hooks/useCatalogSample'
import { useAdaptiveRenderBudget } from '../../hooks/useAdaptiveRenderBudget'
import { useI18n } from '../../i18n/context'
import { bodyPositionOrNull, createBodyPositionResolver, MissingBodyStateError, vector3Magnitude, subtractVector3 } from '../../lib/ephemeris'
import { computeLagrangePoints } from '../../lib/lagrange'
import { computeOrbitEllipses } from '../../lib/orbitEllipse'
import { getSuggestedViewRadius } from '../../lib/referenceFrame'
import { selectionActions, selectionStore } from '../../state/selection-store'
import { simulationActions, simulationStore } from '../../state/simulation-store'
import { catalogStore, filterCatalogRecords } from '../../state/catalog-store'
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
import { summarizeBackendCoverage } from '../../lib/backendCoverage'

const TrajectoryCanvas3D = lazy(async () => {
  const module = await import('../../components/TrajectoryCanvas3D')
  return { default: module.TrajectoryCanvas3D }
})
const ignoreFrameDuration = () => {}

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
  onFrame: (frame: TrajectoryFrameData) => void
  onHover: (item: { body: CelestialBody; distance: number; x: number; y: number } | null) => void
  catalogRecords: AsteroidRecord[]
  catalogPositions: Float32Array
  catalogPositions3D: Float32Array
  catalogDrawCount: number
  catalogSampleTotal: number
  catalogFitKey: string
  pixelRatioLimit: number
  onFrameDuration: (durationMs: number) => void
  stateDisplay: ReturnType<typeof useStateDisplayBudget>
  statePriorityIds: string[]
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
  onFrame,
  onHover,
  catalogRecords,
  catalogPositions,
  catalogPositions3D,
  catalogDrawCount,
  catalogSampleTotal,
  catalogFitKey,
  pixelRatioLimit,
  onFrameDuration,
  stateDisplay,
  statePriorityIds,
  samplingActive,
  isPlaying,
  render3DReady,
  cameraResetKey,
  backendFrame,
  backendStatus,
}: FrameViewProps) {
  const simulation = simulationStore.useStore()
  const { t, language } = useI18n()
  const referenceBody = bodiesById.get(referenceId) ?? bodiesById.get('sun')!
  const detailBodyIds = useMemo(() => trajectoryBodies.map(body => body.id), [trajectoryBodies])
  const qualityLabel = simulation.renderQuality === 'max'
    ? t('renderQualityMax')
    : simulation.renderQuality === 'balanced'
      ? t('renderQualityBalanced')
      : t('renderQualityAuto')
  const catalogOrigin = useMemo(() => bodyPositionOrNull(resolveCurrentPosition, referenceBody.id), [resolveCurrentPosition, referenceBody.id])
  const { frame: baseFrame, progress, isComputing, error } = useTrajectoryWorker({
    bodies: selectedBodies,
    trajectoryBodies,
    resolveBodyPosition: resolveCurrentPosition,
    resolutionBodies,
    referenceId: referenceBody.id,
    currentJulianDay: julianDay,
    trajectoryJulianDay,
    historyDays: simulation.historyDays,
    // Inventory expansion must not silently undersample short-period moons.
    // Only historical trails are budgeted; current positions keep all selections.
    sampleCount: Math.min(simulation.sampleCount, 240),
    currentFrame: backendFrame,
  })
  const spacecraftFrame = useMemo(() => simulation.showSpacecraft && catalogOrigin
    ? buildSpacecraftFrame(SPACECRAFT, referenceBody.id, bodiesById, julianDay)
    : { currentPositions: [], trajectories: [], trajectoryUnavailableBodyIds: [] },
  [bodiesById, catalogOrigin, julianDay, referenceBody.id, simulation.showSpacecraft])
  const frame = useMemo<TrajectoryFrameData>(() => ({
    currentPositions: [...baseFrame.currentPositions, ...spacecraftFrame.currentPositions],
    trajectories: [...baseFrame.trajectories, ...spacecraftFrame.trajectories],
    trajectoryUnavailableBodyIds: [...baseFrame.trajectoryUnavailableBodyIds, ...spacecraftFrame.trajectoryUnavailableBodyIds],
    maxDistance: Math.max(baseFrame.maxDistance, ...spacecraftFrame.currentPositions.map((item) => item.distance), 0),
  }), [baseFrame, spacecraftFrame])
  const displayedStates = useMemo(() => backendFrame
    ? selectStateDisplayPositions(baseFrame.currentPositions, stateDisplay.limitPerPane, statePriorityIds)
    : baseFrame.currentPositions, [backendFrame, baseFrame.currentPositions, stateDisplay.limitPerPane, statePriorityIds])
  const receivedExactCount = useMemo(() => summarizeBackendCoverage(selectedBodies.map(body => body.id), backendFrame).exactCount, [selectedBodies, backendFrame])
  const displayPositions = useMemo(() => [...displayedStates, ...spacecraftFrame.currentPositions], [displayedStates, spacecraftFrame.currentPositions])
  const stateFitKey = useMemo(() => backendFrame ? `${selectedBodies.map(body => body.id).join(',')}|${baseFrame.currentPositions.length}` : undefined,
    [backendFrame, selectedBodies, baseFrame.currentPositions.length])
  useEffect(() => onFrame(frame), [frame, onFrame])
  const focusSuggested = useMemo(() => getSuggestedViewRadius(
    selectedBodies.map((body) => body.id), referenceBody.id, bodiesById, baseFrame.maxDistance,
  ), [bodiesById, referenceBody.id, selectedBodies, baseFrame.maxDistance])
  const catalogSuggested = useMemo(() => {
    if (!catalogOrigin) return 0
    const count = Math.min(catalogDrawCount, Math.floor(catalogPositions.length / 2))
    let radius = 0
    for (let index = 0; index < count; index += 1) {
      radius = Math.max(radius, Math.hypot(
        catalogPositions[index * 2] - catalogOrigin.x,
        catalogPositions[index * 2 + 1] - catalogOrigin.y,
      ))
    }
    return radius > 0 ? radius * 1.08 : 0
  }, [catalogDrawCount, catalogOrigin, catalogPositions])
  const suggested = Math.max(focusSuggested, catalogSuggested)
  const orbitEllipses = useMemo(() => VIEW_CAPABILITIES[simulation.viewMode].fullOrbits && simulation.showOrbits
    ? computeOrbitEllipses(selectedBodies.slice(0, 40), bodiesById, referenceBody.id, trajectoryJulianDay)
    : [], [bodiesById, referenceBody.id, selectedBodies, simulation.showOrbits, simulation.viewMode, trajectoryJulianDay])
  const lagrangePoints = useMemo(() => {
    if (!simulation.showLagrange || referenceBody.id !== 'sun') return []
    return frame.currentPositions.filter((item) => item.body.kind === 'planet').map((item) => ({
      body: item.body,
      points: computeLagrangePoints(item.body, item.planarPosition),
    })).filter((group) => group.points.length)
  }, [frame.currentPositions, referenceBody.id, simulation.showLagrange])
  const influenceCircles = useMemo(() => {
    if (referenceBody.id !== 'sun') return []
    return frame.currentPositions.flatMap((item) => {
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
  }, [frame.currentPositions, referenceBody.id, simulation.showHillSphere, simulation.showLaplaceSoi])

  return (
    <div className="frame-view" onWheel={(event) => {
      if (simulation.viewMode !== '2d') return
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.12 : 0.89
      simulationActions.patch({ zoom: Math.max(0.15, Math.min(12, simulation.zoom * factor)) })
    }}>
      <div className="frame-overlays" onWheel={event => event.stopPropagation()}>
      <div className="frame-label"><span>{bodyDisplayName(referenceBody, language)}</span><small>{simulation.viewMode.toUpperCase()}{simulation.showCatalogCloud ? ` · ${t('catalogCloudRendered')} ${catalogDrawCount.toLocaleString()} / ${catalogSampleTotal.toLocaleString()} · ${qualityLabel} · JD ${julianDay.toFixed(3)}` : ''}</small></div>
      <EphemerisStatus bodies={selectedBodies} references={[referenceBody]} julianDay={julianDay} historyDays={simulation.historyDays} backendStatus={backendStatus} backendFrame={backendFrame} />
      {backendFrame && <details className="frame-layer-budget glass-panel" data-testid="exact-display-budget"
        data-computed={receivedExactCount} data-displayed={displayedStates.length}
        data-limit={stateDisplay.limitPerPane} data-sampling={samplingActive} data-samples={stateDisplay.metrics?.samples ?? 0}>
        <summary>{t('exactDisplayCount')}: {displayedStates.length.toLocaleString()}/{receivedExactCount.toLocaleString()} · {t('exactDisplayUnshown')}: {(receivedExactCount - displayedStates.length).toLocaleString()}</summary>
        <p>{t('exactDisplayPolicy')} ({stateDisplay.limitPerPane.toLocaleString()})</p>
        <p>{t(stateDisplay.reason === 'slow' ? 'exactDisplaySlow' : stateDisplay.reason === 'headroom' ? 'exactDisplayHeadroom' : 'exactDisplayInitial')}</p>
        <p>{stateDisplay.metrics ? `${t('exactDisplayTiming')}: p50 ${stateDisplay.metrics.p50Ms.toFixed(1)} / p95 ${stateDisplay.metrics.p95Ms.toFixed(1)} ms · ${(stateDisplay.metrics.missedRatio * 100).toFixed(1)}%` : t('exactDisplayPending')}</p>
      </details>}
      {selectedBodies.length > trajectoryBodies.length && <div className="frame-layer-budget glass-panel" data-testid="focus-layer-budget">{t('currentPositionCount')}: {baseFrame.currentPositions.length}/{selectedBodies.length} · {t('trailBudgetCount')}: {trajectoryBodies.length}/{selectedBodies.length}</div>}
      {error && <div className="canvas-error">{error}</div>}
      {catalogOrigin && baseFrame.missingBodyIds.length > 0 && <details className="canvas-error" data-testid="missing-position-notice"><summary>{t('bodyStateUnavailable')} ({baseFrame.missingBodyIds.length})</summary><p>{baseFrame.missingBodyIds.map(id => bodyDisplayName(bodiesById.get(id)!, language)).join(', ')}</p></details>}
      {catalogOrigin && frame.trajectoryUnavailableBodyIds.length > 0 && <details className="canvas-error" data-testid="missing-trajectory-notice"><summary>{t('trajectoryCoverageUnavailable')} ({frame.trajectoryUnavailableBodyIds.length})</summary><p>{frame.trajectoryUnavailableBodyIds.map(id => bodyDisplayName(bodiesById.get(id) ?? SPACECRAFT.find(body => body.id === id)!, language)).join(', ')}</p></details>}
      {!catalogOrigin && <div className="canvas-error" role="status">{t('referenceStateUnavailable')}</div>}
      </div>
      {isComputing && <div className="compute-progress"><i style={{ width: `${progress * 100}%` }} /></div>}
      {!catalogOrigin ? null : simulation.viewMode === '3d' && !render3DReady ? (
        <SpatialPreview />
      ) : simulation.viewMode === '3d' ? (
        <Suspense fallback={<SpatialPreview />}>
          <TrajectoryCanvas3D
            referenceBody={referenceBody}
            trajectories={frame.trajectories}
            currentPositions={displayPositions}
            stateFitKey={stateFitKey}
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
            catalogRecords={catalogRecords}
            catalogPositions3D={catalogPositions3D}
            catalogDrawCount={catalogDrawCount}
            catalogOrigin={catalogOrigin}
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
          catalogRecords={catalogRecords}
          catalogPositions={catalogPositions}
          catalogDrawCount={catalogDrawCount}
          catalogOrigin={catalogOrigin}
          pixelRatioLimit={pixelRatioLimit}
          continuous={samplingActive}
          onFrameDuration={onFrameDuration}
        />
      )}
    </div>
  )
}

export function ExplorerWorkspace() {
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
  useCatalogSample(simulation.showCatalogCloud)
  const selectedBodies = selectedFromStore
  const detailBodyLimit = simulation.viewMode === '2d' ? 320 : 160
  const trajectoryBodies = useMemo(() => selectDetailBodies(selectedBodies, detailBodyLimit,
    [selection.focusedId, simulation.referenceId, simulation.comparisonEnabled ? simulation.comparisonReferenceId : null].filter((id): id is string => Boolean(id))),
  [detailBodyLimit, selectedBodies, selection.focusedId, simulation.comparisonEnabled, simulation.comparisonReferenceId, simulation.referenceId])
  const catalogRecords = useMemo(() => simulation.showCatalogCloud
    ? filterCatalogRecords(catalog.baseSampleRecords, catalog.filters)
    : [], [catalog.baseSampleRecords, catalog.filters, simulation.showCatalogCloud])
  const resolutionBodies = useMemo(() => {
    const required = new Map(allBodies.map((body) => [body.id, body]))
    return [...required.values()]
  }, [allBodies])
  const requestedJulianDay = clock.julianDay
  // One exact state plan serves both frames at this displayed epoch. The
  // renderer's adaptive draw/trail budgets remain independent from protocol
  // coverage, so selected identities are not silently dropped at 510 rows.
  const currentStateReferenceIds = useMemo(() => [simulation.referenceId, ...(simulation.comparisonEnabled ? [simulation.comparisonReferenceId] : [])], [simulation.comparisonEnabled, simulation.comparisonReferenceId, simulation.referenceId])
  const currentStates = useStateTiles({
    // Protocol-sized plans are created as needed. Renderer budgets do not
    // silently truncate the exact-state identity set.
    bodies: useMemo(() => {
      const priority = new Set([simulation.referenceId, ...(simulation.comparisonEnabled ? [simulation.comparisonReferenceId] : []), selection.focusedId].filter((id): id is string => Boolean(id)))
      return [...selectedBodies.filter(body => priority.has(body.id)), ...selectedBodies.filter(body => !priority.has(body.id))]
    }, [selectedBodies, selection.focusedId, simulation.comparisonEnabled, simulation.comparisonReferenceId, simulation.referenceId]),
    resolutionBodies,
    referenceIds: currentStateReferenceIds,
    epochUtcJd: requestedJulianDay,
    isPlaying: clock.isPlaying,
    seekRevision: clock.seekRevision,
  })
  // A backend frame is an audited snapshot, so its UTC epoch is the only
  // epoch allowed beside that frame while a newer request is loading.
  const renderedJulianDay = currentStates.configured && currentStates.publishedEpochUtcJd !== null
    ? currentStates.publishedEpochUtcJd
    : requestedJulianDay
  // All visual layers in a scene use the same authoritative epoch. During a
  // backend refresh this intentionally keeps the previous frame/cloud epoch;
  // EphemerisStatus still exposes loading so a stale snapshot is explicit.
  const trajectoryJulianDay = renderedJulianDay
  const catalogPointCloud = useCatalogPointWorker(catalogRecords, renderedJulianDay)
  const catalogEpochAligned = !simulation.showCatalogCloud || Math.abs(catalogPointCloud.computedJulianDay - renderedJulianDay) <= 1e-9
  // Full Web uses the audited backend when configured. Pages remains its
  // declared curated static preview; an unconfigured full build has no exact
  // current-position resolver and never silently falls back to local physics.
  // The resolver identity is intentionally tied to the atomically published
  // backend frame.
  const resolveCurrentPosition = useMemo(() => {
    if (currentStates.configured) {
      const absolute = new Map<BodyId, { x: number; y: number; z: number }>()
      for (const frame of currentStates.frames.values()) for (const [id, position] of frame.absolutePositions) absolute.set(id, position)
      return createBackendPositionResolver(absolute, renderedJulianDay)
    }
    if (PRODUCT_PROFILE === 'preview') return createBodyPositionResolver(bodiesById, renderedJulianDay)
    return (bodyId: BodyId) => { throw new MissingBodyStateError(bodyId, renderedJulianDay) }
  }, [bodiesById, currentStates.configured, currentStates.frames, renderedJulianDay])
  const renderBudget = useAdaptiveRenderBudget({
    viewMode: simulation.viewMode,
    quality: simulation.renderQuality,
    comparisonEnabled: simulation.comparisonEnabled,
    availableCount: catalogRecords.length,
    samplingActive: clock.isPlaying && simulation.showCatalogCloud,
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
  const onPrimaryFrameDuration = useCallback((duration: number) => {
    catalogFrameDuration(duration)
    stateFrameDuration(duration)
  }, [catalogFrameDuration, stateFrameDuration])
  const primaryCatalogDrawCount = catalogEpochAligned ? Math.min(renderBudget.primary, catalogPointCloud.readyCount) : 0
  const secondaryCatalogDrawCount = catalogEpochAligned ? Math.min(renderBudget.secondary, catalogPointCloud.readyCount) : 0
  const catalogFitKey = simulation.showCatalogCloud
    ? `${catalog.baseSampleKey ?? 'unloaded'}|${JSON.stringify(catalog.filters)}`
    : ''
  const [primaryFrame, setPrimaryFrame] = useState<TrajectoryFrameData>({ currentPositions: [], trajectories: [], trajectoryUnavailableBodyIds: [], maxDistance: 0 })
  const [secondaryFrame, setSecondaryFrame] = useState<TrajectoryFrameData>({ currentPositions: [], trajectories: [], trajectoryUnavailableBodyIds: [], maxDistance: 0 })
  const [hovered, setHovered] = useState<{ body: CelestialBody; distance: number; x: number; y: number } | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [measureA, setMeasureA] = useState('earth')
  const [measureB, setMeasureB] = useState('mars')
  const focusedBody = selection.focusedId
    ? bodiesById.get(selection.focusedId) ?? SPACECRAFT.find((body) => body.id === selection.focusedId) ?? null
    : null
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
      <ControlDrawer bodies={allBodies} referenceOptions={allBodies.filter((body) => body.kind !== 'spacecraft')} onResetView={resetView} />
      <main className="explorer-stage">
        <SimulationControls />
        {simulation.showCatalogCloud && catalog.sampleError && (
          <div className="error-banner catalog-cloud-error" role="alert">{catalogSampleErrorMessage(catalog.sampleError, t)}</div>
        )}
        {simulation.showCatalogCloud && catalog.error && (
          <div className="error-banner catalog-cloud-error" role="alert">{catalog.error}</div>
        )}
        {simulation.showCatalogCloud && catalogPointCloud.error && (
          <div className="error-banner catalog-cloud-error" role="alert">{catalogPointCloud.error}</div>
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
            onFrame={setPrimaryFrame}
            onHover={setHovered}
            catalogRecords={catalogRecords}
            catalogPositions={catalogPointCloud.positions}
            catalogPositions3D={catalogPointCloud.positions3D}
            catalogDrawCount={primaryCatalogDrawCount}
            catalogSampleTotal={renderBudget.sampleTotal}
            catalogFitKey={catalogFitKey}
            pixelRatioLimit={renderBudget.pixelRatioLimit}
            onFrameDuration={onPrimaryFrameDuration}
            stateDisplay={stateBudget}
            statePriorityIds={statePriorityIds}
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
              onFrame={setSecondaryFrame}
              onHover={setHovered}
              catalogRecords={catalogRecords}
              catalogPositions={catalogPointCloud.positions}
              catalogPositions3D={catalogPointCloud.positions3D}
              catalogDrawCount={secondaryCatalogDrawCount}
              catalogSampleTotal={renderBudget.sampleTotal}
              catalogFitKey={catalogFitKey}
              pixelRatioLimit={renderBudget.pixelRatioLimit}
              onFrameDuration={ignoreFrameDuration}
              stateDisplay={stateBudget}
              statePriorityIds={statePriorityIds}
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
        <details className="accessible-scene-controls glass-panel">
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
      {inspectorOpen && <BodyInspector key={focusedBody?.id ?? 'none'} body={focusedBody} currentPositions={simulation.comparisonEnabled ? secondaryFrame.currentPositions : primaryFrame.currentPositions} bodiesById={bodiesById} />}
    </div>
  )
}
