import { useEffect, useMemo, useRef, useState } from 'react'
import { TrajectoryCanvas } from '../../components/TrajectoryCanvas'
import { TrajectoryCanvas3D } from '../../components/TrajectoryCanvas3D'
import { SPACECRAFT } from '../../data/spacecraft'
import { BODY_PHYSICAL } from '../../data/physical'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { buildSpacecraftFrame } from '../../engine/ephemeris/spacecraft'
import { computeInfluenceRadii } from '../../engine/ephemeris/spheresOfInfluence'
import { useTrajectoryWorker } from '../../hooks/useTrajectoryWorker'
import { useI18n } from '../../i18n/context'
import { createBodyPositionResolver, vector3Magnitude, subtractVector3 } from '../../lib/ephemeris'
import { computeLagrangePoints } from '../../lib/lagrange'
import { computeOrbitEllipses } from '../../lib/orbitEllipse'
import { getSuggestedViewRadius } from '../../lib/referenceFrame'
import { selectionActions, selectionStore } from '../../state/selection-store'
import { simulationActions, simulationStore } from '../../state/simulation-store'
import type { BodyId, CelestialBody, TrajectoryFrameData } from '../../types'
import { useBodyRegistry } from '../../app/bodyRegistry'
import { BodyInspector } from '../body-inspector/BodyInspector'
import { ControlDrawer } from './ControlDrawer'
import { bodyDisplayName } from '../../lib/bodyNames'
import { SimulationControls } from './SimulationControls'

function useTrajectoryAnchor(julianDay: number, isPlaying: boolean) {
  const [anchor, setAnchor] = useState(julianDay)
  const lastUpdateRef = useRef(0)
  useEffect(() => {
    const now = performance.now()
    if (!isPlaying || now - lastUpdateRef.current > 2200) {
      lastUpdateRef.current = now
      setAnchor(julianDay)
    }
  }, [isPlaying, julianDay])
  return anchor
}

type FrameViewProps = {
  referenceId: BodyId
  selectedBodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  bodiesById: Map<BodyId, CelestialBody>
  julianDay: number
  trajectoryAnchor: number
  onFrame: (frame: TrajectoryFrameData) => void
  onHover: (item: { body: CelestialBody; distance: number; x: number; y: number } | null) => void
}

function FrameView({
  referenceId,
  selectedBodies,
  resolutionBodies,
  bodiesById,
  julianDay,
  trajectoryAnchor,
  onFrame,
  onHover,
}: FrameViewProps) {
  const simulation = simulationStore.useStore()
  const { t } = useI18n()
  const referenceBody = bodiesById.get(referenceId) ?? bodiesById.get('sun')!
  const { frame: baseFrame, progress, isComputing, error } = useTrajectoryWorker({
    bodies: selectedBodies,
    resolutionBodies,
    referenceId: referenceBody.id,
    currentJulianDay: julianDay,
    trajectoryJulianDay: trajectoryAnchor,
    historyDays: simulation.historyDays,
    sampleCount: Math.min(simulation.sampleCount, selectedBodies.length > 80 ? 64 : 240),
  })
  const spacecraftFrame = useMemo(() => simulation.showSpacecraft
    ? buildSpacecraftFrame(SPACECRAFT, referenceBody.id, bodiesById, julianDay)
    : { currentPositions: [], trajectories: [] },
  [bodiesById, julianDay, referenceBody.id, simulation.showSpacecraft])
  const frame = useMemo<TrajectoryFrameData>(() => ({
    currentPositions: [...baseFrame.currentPositions, ...spacecraftFrame.currentPositions],
    trajectories: [...baseFrame.trajectories, ...spacecraftFrame.trajectories],
    maxDistance: Math.max(baseFrame.maxDistance, ...spacecraftFrame.currentPositions.map((item) => item.distance), 0),
  }), [baseFrame, spacecraftFrame])
  useEffect(() => onFrame(frame), [frame, onFrame])
  const suggested = useMemo(() => getSuggestedViewRadius(
    selectedBodies.map((body) => body.id), referenceBody.id, bodiesById,
  ), [bodiesById, referenceBody.id, selectedBodies])
  const orbitEllipses = useMemo(() => simulation.showOrbits
    ? computeOrbitEllipses(selectedBodies.slice(0, 40), bodiesById, referenceBody.id, trajectoryAnchor)
    : [], [bodiesById, referenceBody.id, selectedBodies, simulation.showOrbits, trajectoryAnchor])
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
      <div className="frame-label"><span>{bodyDisplayName(referenceBody, document.documentElement.lang === 'zh' ? 'zh' : 'en')}</span><small>{simulation.viewMode.toUpperCase()}</small></div>
      {isComputing && <div className="compute-progress"><i style={{ width: `${progress * 100}%` }} /></div>}
      {error && <div className="canvas-error">{error}</div>}
      {simulation.viewMode === '3d' ? (
        <TrajectoryCanvas3D
          referenceBody={referenceBody}
          trajectories={frame.trajectories}
          currentPositions={frame.currentPositions}
          onReferenceChange={(id) => { if (bodiesById.has(id)) simulationActions.patch({ referenceId: id }) }}
          onBodySelect={selectionActions.focus}
          onHover={(body, distance, x, y) => onHover(body ? { body, distance, x, y } : null)}
          lagrangePoints={lagrangePoints}
          showEcliptic={simulation.showEcliptic}
          ariaLabel={t('interactive3d')}
        />
      ) : (
        <TrajectoryCanvas
          referenceBody={referenceBody}
          trajectories={frame.trajectories}
          currentPositions={frame.currentPositions}
          viewRadiusAU={suggested / simulation.zoom}
          viewOffsetAU={simulation.viewOffset}
          showOrbits={simulation.showOrbits}
          orbitEllipses={orbitEllipses}
          onReferenceChange={(id) => { if (bodiesById.has(id)) simulationActions.patch({ referenceId: id }) }}
          onHover={(body, distance, x, y) => onHover(body ? { body, distance, x, y } : null)}
          lagrangePoints={lagrangePoints}
          influenceCircles={influenceCircles}
          ariaLabel={t('interactive2d')}
          emptyLabel={t('selectBodyPrompt')}
          webglUnavailableLabel={t('webglUnavailable')}
          influenceLabels={{ hill: t('hill'), soi: t('soi') }}
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
  const { t, language } = useI18n()
  const selectedBodies = useMemo(() => selectedFromStore.slice(0, 160), [selectedFromStore])
  const resolutionBodies = useMemo(() => {
    const required = new Map(allBodies.map((body) => [body.id, body]))
    return [...required.values()]
  }, [allBodies])
  const trajectoryAnchor = useTrajectoryAnchor(clock.julianDay, clock.isPlaying)
  const [primaryFrame, setPrimaryFrame] = useState<TrajectoryFrameData>({ currentPositions: [], trajectories: [], maxDistance: 0 })
  const [secondaryFrame, setSecondaryFrame] = useState<TrajectoryFrameData>({ currentPositions: [], trajectories: [], maxDistance: 0 })
  const [hovered, setHovered] = useState<{ body: CelestialBody; distance: number; x: number; y: number } | null>(null)
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
    const resolver = createBodyPositionResolver(bodiesById, clock.julianDay)
    if (!bodiesById.has(measuredBodyA) || !bodiesById.has(measuredBodyB)) return null
    return vector3Magnitude(subtractVector3(resolver(measuredBodyA), resolver(measuredBodyB)))
  }, [bodiesById, clock.julianDay, measuredBodyA, measuredBodyB])

  return (
    <div className="explorer-workspace">
      <ControlDrawer bodies={allBodies} referenceOptions={allBodies.filter((body) => body.kind !== 'spacecraft')} />
      <main className="explorer-stage">
        <SimulationControls />
        <div className={`frames-grid ${simulation.comparisonEnabled ? 'split' : ''}`}>
          <FrameView
            referenceId={simulation.referenceId}
            selectedBodies={selectedBodies}
            resolutionBodies={resolutionBodies}
            bodiesById={bodiesById}
            julianDay={clock.julianDay}
            trajectoryAnchor={trajectoryAnchor}
            onFrame={setPrimaryFrame}
            onHover={setHovered}
          />
          {simulation.comparisonEnabled && (
            <FrameView
              referenceId={simulation.comparisonReferenceId}
              selectedBodies={selectedBodies}
              resolutionBodies={resolutionBodies}
              bodiesById={bodiesById}
              julianDay={clock.julianDay}
              trajectoryAnchor={trajectoryAnchor}
              onFrame={setSecondaryFrame}
              onHover={setHovered}
            />
          )}
        </div>
        <div className="measure-ribbon glass-panel">
          <span>{t('distance')}</span>
          <select value={measuredBodyA} onChange={(event) => setMeasureA(event.target.value)}>{selectedBodies.map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select>
          <span>↔</span>
          <select value={measuredBodyB} onChange={(event) => setMeasureB(event.target.value)}>{selectedBodies.map((body) => <option key={body.id} value={body.id}>{bodyDisplayName(body, language)}</option>)}</select>
          <strong>{measuredDistance === null ? '—' : `${measuredDistance.toFixed(5)} AU · ${(measuredDistance * 149_597_870.7).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`}</strong>
        </div>
        <details className="accessible-scene-controls glass-panel">
          <summary>{t('keyboardControls')}</summary>
          <div className="accessible-view-actions" aria-label={t('view')}>
            <button onClick={() => simulationActions.patch({ zoom: Math.min(12, simulation.zoom * 1.25) })}>{t('zoomIn')} +</button>
            <button onClick={() => simulationActions.patch({ zoom: Math.max(.15, simulation.zoom / 1.25) })}>{t('zoomOut')} −</button>
            <button onClick={() => simulationActions.patch({ zoom: 1, viewOffset: { x: 0, y: 0 } })}>{t('resetView')}</button>
          </div>
          <ul aria-label={t('selectedObjectList')}>{selectedBodies.map((body) => <li key={body.id}>
            <span><i style={{ background: body.color }} />{bodyDisplayName(body, language)}</span>
            <button onClick={() => selectionActions.focus(body.id)}>{t('focusObject')}</button>
            <button onClick={() => simulationActions.patch({ referenceId: body.id })}>{t('setReference')}</button>
          </li>)}</ul>
        </details>
        {hovered && <div className="atlas-tooltip" style={{ left: hovered.x + 14, top: hovered.y + 12 }}>
          <strong>{bodyDisplayName(hovered.body, language)}</strong><span>{hovered.distance.toFixed(4)} AU</span>
        </div>}
      </main>
      <BodyInspector body={focusedBody} currentPositions={simulation.comparisonEnabled ? secondaryFrame.currentPositions : primaryFrame.currentPositions} bodiesById={bodiesById} />
    </div>
  )
}
