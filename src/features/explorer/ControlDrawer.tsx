import { useMemo, useRef, useState } from 'react'
import { fetchSbdbBody } from '../../data/loaders/sbdb'
import { SCENE_PRESETS } from '../../data/presets'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { useI18n } from '../../i18n/context'
import { bodyDisplayName } from '../../lib/bodyNames'
import { buildScenePresetApplication, buildScenePresetUrlState } from '../../lib/scenePreset'
import { requestOnboarding } from '../../lib/onboarding'
import { exportAnnotatedScenePng } from '../../lib/sceneExport'
import { loadSavedScenes, localizeSavedSceneUrl, mergeSceneLibrary, parseSceneLibrary, removeSavedScene, saveCurrentScene, sceneLibraryDocument } from '../../lib/sceneLibrary'
import { encodeCurrentScene } from '../../lib/shareScene'
import { IS_NATIVE_APP, saveTextExport, shareSceneUrl } from '../../lib/platform'
import { encodeUrlState } from '../../lib/urlState'
import { VIEW_CAPABILITIES } from '../../lib/viewCapabilities'
import { catalogActions, DEFAULT_CATALOG_FILTERS } from '../../state/catalog-store'
import { selectionActions, selectionStore } from '../../state/selection-store'
import { simulationActions, simulationStore } from '../../state/simulation-store'
import { uiActions } from '../../state/ui-store'
import type { CelestialBody, RenderQuality } from '../../types'

type Props = {
  bodies: CelestialBody[]
  referenceOptions: CelestialBody[]
  onResetView: () => void
}

const HISTORY_OPTIONS = [90, 365, 1825, 4383, 7300, 12053, 43830, 90580]
const BODY_KIND_TRANSLATION = {
  star: 'bodyKindStar',
  planet: 'bodyKindPlanet',
  moon: 'bodyKindMoon',
  dwarfPlanet: 'bodyKindDwarfPlanet',
  asteroid: 'bodyKindAsteroid',
  spacecraft: 'bodyKindSpacecraft',
} as const

export function ControlDrawer({ bodies, referenceOptions, onResetView }: Props) {
  const simulation = simulationStore.useStore()
  const clock = useSimulationClock()
  const selection = selectionStore.useStore()
  const { t, language } = useI18n()
  const [collectionName, setCollectionName] = useState('')
  const [sbdbQuery, setSbdbQuery] = useState('')
  const [sbdbState, setSbdbState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [sceneTitle, setSceneTitle] = useState('')
  const [savedScenes, setSavedScenes] = useState(loadSavedScenes)
  const [bodyQuery, setBodyQuery] = useState('')
  const sceneImportRef = useRef<HTMLInputElement | null>(null)
  const capabilities = VIEW_CAPABILITIES[simulation.viewMode]
  const sortedBodies = useMemo(() => [...bodies].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)), [bodies])
  const filteredBodies = useMemo(() => {
    const query = bodyQuery.trim().toLocaleLowerCase()
    if (!query) return sortedBodies
    return sortedBodies.filter((body) => [bodyDisplayName(body, language), body.name, body.id, body.kind, body.orbitClassCode]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(query)))
  }, [bodyQuery, language, sortedBodies])
  const selectedPresetId = useMemo(() => {
    const selectedIds = new Set(selection.selectedIds)
    return SCENE_PRESETS.find((preset) => (
      !preset.catalogSelection
      && (
      Math.abs(preset.julianDay - clock.julianDay) < 0.00001
      && preset.referenceId === simulation.referenceId
      && preset.viewMode === simulation.viewMode
      && preset.historyDays === simulation.historyDays
      && preset.zoomLevel === simulation.zoom
      && !simulation.comparisonEnabled
      && simulation.viewOffset.x === 0
      && simulation.viewOffset.y === 0
      && selectedIds.size === preset.selectedMajorBodyIds.length
      && preset.selectedMajorBodyIds.every((bodyId) => selectedIds.has(bodyId))
      )
    ))?.id ?? null
  }, [clock.julianDay, selection.selectedIds, simulation.comparisonEnabled, simulation.historyDays, simulation.referenceId, simulation.viewMode, simulation.viewOffset.x, simulation.viewOffset.y, simulation.zoom])

  function applySelectedPreset(preset: typeof SCENE_PRESETS[number]) {
    if (preset.catalogSelection) {
      const query = encodeUrlState(buildScenePresetUrlState(preset, language))
      window.location.assign(`${window.location.pathname}?${query}`)
      return
    }
    const application = buildScenePresetApplication(preset)
    catalogActions.patch({
      requestedSampleProfile: null,
      requestedSampleCount: null,
      requestedSampleCountRaw: null,
      requestedSampleInvalid: false,
      filters: structuredClone(DEFAULT_CATALOG_FILTERS),
      baseSampleRecords: [],
      baseSampleKey: null,
      baseSampleProfile: null,
      browseRecords: [],
      activeResultRecords: [],
      activeResultScanKey: null,
      exactFilteredTotal: null,
      exactHydrationHasMore: false,
      selectionScope: null,
      recordsSampled: false,
      loadProgress: 0,
      isLoading: false,
      error: null,
      sampleError: null,
    })
    simulationActions.pause()
    simulationActions.seek(application.julianDay)
    simulationActions.patch(application.simulation.viewMode === '3d'
      ? { ...application.simulation, showOrbits: false, showHillSphere: false, showLaplaceSoi: false }
      : application.simulation)
    onResetView()
    selectionActions.setSelectedIds(application.selectedIds)
    selectionActions.focus(application.focusedId)
    uiActions.navigate(application.route ?? 'explorer')
    uiActions.toast(`${t('presetApplied')}: ${preset.name[language]}`)
  }

  return (
    <aside className="control-drawer glass-panel">
      <section id="scene-presets" className="drawer-section preset-console" data-story-target="preset">
        <div className="preset-console-heading">
          <div className="section-kicker">{t('scenePresets').toUpperCase()}</div>
          <span className="preset-index">{String(SCENE_PRESETS.length).padStart(2, '0')}</span>
        </div>
        <p className="preset-description">{t('presetListDescription')}</p>
        <div className="preset-list" aria-label={t('scenePresets')}>
          {SCENE_PRESETS.map((preset) => {
            const reference = referenceOptions.find((body) => body.id === preset.referenceId)
            return <button
              type="button"
              className={preset.id === selectedPresetId ? 'active' : ''}
              aria-pressed={preset.id === selectedPresetId}
              aria-label={`${t('applyPreset')}: ${preset.name[language]}`}
              key={preset.id}
              onClick={() => applySelectedPreset(preset)}
            >
              <span><strong>{preset.name[language]}</strong><small>{preset.description[language]}</small></span>
              <em>{reference ? bodyDisplayName(reference, language) : preset.referenceId} · {preset.catalogSelection ? preset.catalogSelection.sampleCount.toLocaleString() : preset.selectedMajorBodyIds.length}</em>
            </button>
          })}
        </div>
        <button type="button" className="preset-tutorial" onClick={requestOnboarding}>{t('startTutorial')} →</button>
      </section>

      <details className="advanced-controls">
        <summary><span>{t('advancedControls')}</span><small>{t('advancedControlsDescription')}</small></summary>
        <div className="advanced-controls-body">

      <section className="drawer-section" data-story-target="frame">
        <div className="section-kicker">{t('referenceFrame').toUpperCase()}</div>
        <label className="field">
          <span>{t('referenceFrame')}</span>
          <select value={simulation.referenceId} onChange={(event) => simulationActions.patch({ referenceId: event.target.value })}>
            {referenceOptions.map((body) => <option value={body.id} key={body.id}>{bodyDisplayName(body, language)}</option>)}
          </select>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={simulation.comparisonEnabled} onChange={(event) => simulationActions.patch({ comparisonEnabled: event.target.checked })} />
          <span>{t('comparison')}</span>
        </label>
        {simulation.comparisonEnabled && (
          <label className="field">
            <span>{t('compareFrame')}</span>
            <select value={simulation.comparisonReferenceId} onChange={(event) => simulationActions.patch({ comparisonReferenceId: event.target.value })}>
              {referenceOptions.map((body) => <option value={body.id} key={body.id}>{bodyDisplayName(body, language)}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span>{t('trail')}</span>
          <select value={simulation.historyDays} onChange={(event) => simulationActions.patch({ historyDays: Number(event.target.value) })}>
            {(!HISTORY_OPTIONS.includes(simulation.historyDays) ? [simulation.historyDays, ...HISTORY_OPTIONS] : HISTORY_OPTIONS).map((days) => <option value={days} key={days}>{days < 365 ? `${days} ${t('days')}` : `${Math.round(days / 365)} ${t('years')}`}</option>)}
          </select>
        </label>
      </section>

      <section className="drawer-section view-parameters">
        <div className="section-kicker">{t('viewParameters').toUpperCase()}</div>
        <label className="field range-field">
          <span>{t(simulation.viewMode === '3d' ? 'zoom3d' : 'zoom2d')} <strong>{simulation.zoom.toFixed(2)}×</strong></span>
          <input aria-label={t(simulation.viewMode === '3d' ? 'zoom3d' : 'zoom2d')} type="range" min="0.15" max="12" step="0.05" disabled={!capabilities.zoom} value={simulation.zoom} onChange={(event) => simulationActions.patch({ zoom: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>{t('trajectorySamples')}</span>
          <select value={simulation.sampleCount} onChange={(event) => simulationActions.patch({ sampleCount: Number(event.target.value) })}>
            {[64, 120, 180, 240, 360].map((count) => <option value={count} key={count}>{count} {t('samples')}</option>)}
          </select>
        </label>
        <div className="view-offset-grid">
          <label className="field">
            <span>{t('offsetX')}</span>
            <input type="number" step="0.1" disabled={!capabilities.offset} value={simulation.viewOffset.x} onChange={(event) => simulationActions.patch({ viewOffset: { ...simulation.viewOffset, x: Number(event.target.value) || 0 } })} />
          </label>
          <label className="field">
            <span>{t('offsetY')}</span>
            <input type="number" step="0.1" disabled={!capabilities.offset} value={simulation.viewOffset.y} onChange={(event) => simulationActions.patch({ viewOffset: { ...simulation.viewOffset, y: Number(event.target.value) || 0 } })} />
          </label>
        </div>
        {!capabilities.offset && <p className="fine-print">{t('offset2dOnly')}</p>}
        <button type="button" className="view-reset" onClick={() => { simulationActions.patch({ zoom: 1, viewOffset: { x: 0, y: 0 } }); onResetView() }}>{t('resetView')}</button>
        {simulation.viewMode === '3d' && <p className="fine-print">{t('camera3dBoundary')}</p>}
      </section>

      <section className="drawer-section" data-story-target="layers">
        <div className="section-kicker">{t('layers').toUpperCase()}</div>
        {([
          ['showEcliptic', 'ecliptic', capabilities.ecliptic], ['showOrbits', 'fullOrbits', capabilities.fullOrbits], ['showLagrange', 'lagrange', capabilities.lagrange],
          ['showHillSphere', 'hill', capabilities.hillSphere], ['showLaplaceSoi', 'soi', capabilities.laplaceSoi], ['showSpacecraft', 'spacecraft', capabilities.spacecraft],
        ] as const).map(([property, label, supported]) => (
          <label className="toggle-row" key={property}>
            <input type="checkbox" disabled={!supported} checked={simulation[property]} onChange={(event) => simulationActions.patch({ [property]: event.target.checked })} />
            <span>{t(label)}{!supported ? ` · ${t('twoDOnly')}` : ''}</span>
          </label>
        ))}
        <label className="toggle-row">
          <input type="checkbox" disabled={!capabilities.catalogCloud} checked={simulation.showCatalogCloud} onChange={(event) => simulationActions.patch({ showCatalogCloud: event.target.checked })} />
          <span>{t('catalogCloud')}</span>
        </label>
        <label className="field">
          <span>{t('renderQuality')}</span>
          <select value={simulation.renderQuality} onChange={(event) => simulationActions.patch({ renderQuality: event.target.value as RenderQuality })}>
            <option value="auto">{t('renderQualityAuto')}</option>
            <option value="balanced">{t('renderQualityBalanced')}</option>
            <option value="max">{t('renderQualityMax')}</option>
          </select>
        </label>
        <p className="fine-print">{t('renderQualityBoundary')}</p>
      </section>

      <section className="drawer-section focus-list-section">
        <div className="section-heading"><span>{t('selectedBodies')}</span><strong>{selection.selectedIds.length}/{simulation.viewMode === '2d' ? 320 : 160}</strong></div>
        <label className="field body-filter">
          <span>{t('filterBodies')}</span>
          <input type="search" value={bodyQuery} onChange={(event) => setBodyQuery(event.target.value)} placeholder={t('filterBodies')} />
        </label>
        <div className="body-match-count">{filteredBodies.length} {t('matchingBodies')}</div>
        <div className="body-check-list">
          {filteredBodies.map((body) => (
            <div className="body-check-row" key={body.id}>
              <label className="body-check-toggle">
                <input type="checkbox" checked={selection.selectedIds.includes(body.id)} onChange={() => selectionActions.toggle(body.id)} />
                <span className="sr-only">{bodyDisplayName(body, language)} {body.orbitClassCode ?? t(BODY_KIND_TRANSLATION[body.kind])}</span>
              </label>
              <i aria-hidden="true" style={{ backgroundColor: body.color }} />
              <button type="button" className="body-focus-button" onClick={() => selectionActions.focus(body.id)}>{bodyDisplayName(body, language)}</button>
              <small>{body.orbitClassCode ?? t(BODY_KIND_TRANSLATION[body.kind])}</small>
            </div>
          ))}
        </div>
        <div className="inline-actions body-selection-actions">
          <button onClick={() => selectionActions.setSelectedIds(referenceOptions.filter((body) => body.id !== 'sun' && body.kind !== 'spacecraft').map((body) => body.id).slice(0, simulation.viewMode === '2d' ? 320 : 160))}>{t('selectMajorBodies')}</button>
          <button onClick={() => selectionActions.setSelectedIds(sortedBodies.slice(0, simulation.viewMode === '2d' ? 320 : 160).map((body) => body.id))}>{t('selectAllAvailable')}</button>
          <button onClick={() => selectionActions.setSelectedIds([])}>{t('clear')}</button>
        </div>
      </section>

      <section className="drawer-section">
        <div className="section-kicker">{t('collection').toUpperCase()}</div>
        <div className="input-action">
          <input value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder={t('collectionName')} />
          <button onClick={() => { selectionActions.saveCollection(collectionName); setCollectionName('') }}>{t('saveCollection')}</button>
        </div>
        {Object.entries(selection.savedCollections).map(([name, ids]) => (
          <div className="saved-row" key={name}>
            <button onClick={() => selectionActions.setSelectedIds(ids)}>{name} <small>{ids.length}</small></button>
            <button aria-label={`${t('deleteCollection')}: ${name}`} onClick={() => selectionActions.removeCollection(name)}>×</button>
          </div>
        ))}
      </section>

      <section className="drawer-section">
        <div className="section-kicker">{t('sceneLibrary').toUpperCase()}</div>
        <p className="fine-print">{t('sceneLibraryDescription')}</p>
        <div className="input-action">
          <input value={sceneTitle} onChange={(event) => setSceneTitle(event.target.value)} placeholder={t('sceneTitle')} />
          <button disabled={!sceneTitle.trim()} onClick={() => {
            try { setSavedScenes(saveCurrentScene(sceneTitle)); setSceneTitle(''); uiActions.toast(t('sceneSaved')) }
            catch (error) { uiActions.toast(error instanceof Error ? error.message : String(error)) }
          }}>{t('saveScene')}</button>
        </div>
        <div className="scene-library-list">{savedScenes.map((scene) => <div className="saved-row" key={scene.id}>
          <button title={scene.notes || scene.url} onClick={() => window.location.assign(localizeSavedSceneUrl(scene.url))}>{scene.title}<small>{scene.datasetVersion ?? t('noDataset')} · {scene.createdAt.slice(0, 10)}</small></button>
          <button aria-label={`${t('deleteScene')}: ${scene.title}`} onClick={() => setSavedScenes(removeSavedScene(scene.id))}>×</button>
        </div>)}</div>
        <div className="inline-actions scene-library-actions">
          <button disabled={!savedScenes.length} onClick={() => void saveTextExport(sceneLibraryDocument(savedScenes), 'solar-atlas-scenes.json', 'application/json').catch((error: unknown) => uiActions.toast(error instanceof Error ? error.message : String(error)))}>{t('exportScenes')}</button>
          <button onClick={() => sceneImportRef.current?.click()}>{t('importScenes')}</button>
          <input className="sr-only" ref={sceneImportRef} type="file" accept="application/json,.json" onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            try { setSavedScenes(mergeSceneLibrary(parseSceneLibrary(await file.text()))); uiActions.toast(t('scenesImported')) }
            catch (error) { uiActions.toast(error instanceof Error ? error.message : String(error)) }
            event.target.value = ''
          }} />
        </div>
      </section>

      <section className="drawer-section">
        <div className="section-kicker">{t('sbdbLookup').toUpperCase()}</div>
        <p className="fine-print">{t('ellipticOnly')}</p>
        <div className="input-action">
          <input value={sbdbQuery} onChange={(event) => setSbdbQuery(event.target.value)} placeholder="Bennu / 99942 / 2024 YR4" />
          <button disabled={!sbdbQuery.trim() || sbdbState === 'loading'} onClick={async () => {
            setSbdbState('loading')
            try {
              const body = await fetchSbdbBody(sbdbQuery.trim())
              selectionActions.addCatalogBodies([body], true)
              selectionActions.focus(body.id)
              setSbdbState('idle')
              setSbdbQuery('')
            } catch (error) {
              setSbdbState('error')
              uiActions.toast(error instanceof Error ? error.message : String(error))
            }
          }}>{sbdbState === 'loading' ? '…' : t('addSbdb')}</button>
        </div>
      </section>

      <div className="drawer-export-actions">
        <button className="share-button" onClick={() => void (async () => {
          try {
            const outcome = await shareSceneUrl(encodeCurrentScene())
            if (outcome !== 'cancelled') uiActions.toast(t(outcome === 'shared' ? 'sceneShared' : 'linkCopied'))
          } catch (error) {
            uiActions.toast(error instanceof Error ? error.message : String(error))
          }
        })()}>↗ {t(IS_NATIVE_APP ? 'shareNative' : 'share')}</button>
        <button className="share-button" onClick={() => void exportAnnotatedScenePng(language).catch((error: unknown) => uiActions.toast(error instanceof Error ? error.message : String(error)))}>▣ {t('exportPng')}</button>
      </div>
        </div>
      </details>
    </aside>
  )
}
