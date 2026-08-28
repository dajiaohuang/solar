import { useMemo, useRef, useState } from 'react'
import { fetchSbdbBody } from '../../data/loaders/sbdb'
import { SCENE_PRESETS } from '../../data/presets'
import { useI18n } from '../../i18n/context'
import { bodyDisplayName } from '../../lib/bodyNames'
import { buildScenePresetApplication } from '../../lib/scenePreset'
import { exportAnnotatedScenePng } from '../../lib/sceneExport'
import { loadSavedScenes, localizeSavedSceneUrl, mergeSceneLibrary, parseSceneLibrary, removeSavedScene, saveCurrentScene, sceneLibraryDocument } from '../../lib/sceneLibrary'
import { encodeCurrentScene } from '../../lib/shareScene'
import { selectionActions, selectionStore } from '../../state/selection-store'
import { simulationActions, simulationStore } from '../../state/simulation-store'
import { uiActions } from '../../state/ui-store'
import type { CelestialBody } from '../../types'

type Props = {
  bodies: CelestialBody[]
  referenceOptions: CelestialBody[]
}

const HISTORY_OPTIONS = [90, 365, 1825, 4383, 7300, 12053, 43830, 90580]

export function ControlDrawer({ bodies, referenceOptions }: Props) {
  const simulation = simulationStore.useStore()
  const selection = selectionStore.useStore()
  const { t, language } = useI18n()
  const [collectionName, setCollectionName] = useState('')
  const [sbdbQuery, setSbdbQuery] = useState('')
  const [sbdbState, setSbdbState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [sceneTitle, setSceneTitle] = useState('')
  const [savedScenes, setSavedScenes] = useState(loadSavedScenes)
  const [selectedPresetId, setSelectedPresetId] = useState(SCENE_PRESETS[0].id)
  const [bodyQuery, setBodyQuery] = useState('')
  const sceneImportRef = useRef<HTMLInputElement | null>(null)
  const sortedBodies = useMemo(() => [...bodies].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)), [bodies])
  const selectedPreset = SCENE_PRESETS.find((preset) => preset.id === selectedPresetId) ?? SCENE_PRESETS[0]
  const filteredBodies = useMemo(() => {
    const query = bodyQuery.trim().toLocaleLowerCase()
    if (!query) return sortedBodies
    return sortedBodies.filter((body) => [bodyDisplayName(body, language), body.name, body.id, body.kind, body.orbitClassCode]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(query)))
  }, [bodyQuery, language, sortedBodies])

  function applySelectedPreset() {
    const application = buildScenePresetApplication(selectedPreset)
    simulationActions.pause()
    simulationActions.seek(application.julianDay)
    simulationActions.patch(application.simulation)
    selectionActions.setSelectedIds(application.selectedIds)
    selectionActions.focus(application.focusedId)
    uiActions.toast(`${t('presetApplied')}: ${selectedPreset.name[language]}`)
  }

  return (
    <aside className="control-drawer glass-panel">
      <section className="drawer-section preset-console" data-story-target="preset">
        <div className="preset-console-heading">
          <div className="section-kicker">{t('scenePresets').toUpperCase()}</div>
          <span className="preset-index">{String(SCENE_PRESETS.indexOf(selectedPreset) + 1).padStart(2, '0')} / {String(SCENE_PRESETS.length).padStart(2, '0')}</span>
        </div>
        <label className="field">
          <span>{t('scenePreset')}</span>
          <select aria-label={t('scenePreset')} value={selectedPreset.id} onChange={(event) => setSelectedPresetId(event.target.value)}>
            {SCENE_PRESETS.map((preset) => <option value={preset.id} key={preset.id}>{preset.name[language]}</option>)}
          </select>
        </label>
        <p className="preset-description">{selectedPreset.description[language]}</p>
        <button type="button" className="preset-apply" onClick={applySelectedPreset}>{t('applyPreset')} ↗</button>
      </section>

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
          <span>{t('zoom2d')} <strong>{simulation.zoom.toFixed(2)}×</strong></span>
          <input aria-label={t('zoom2d')} type="range" min="0.15" max="12" step="0.05" value={simulation.zoom} onChange={(event) => simulationActions.patch({ zoom: Number(event.target.value) })} />
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
            <input type="number" step="0.1" value={simulation.viewOffset.x} onChange={(event) => simulationActions.patch({ viewOffset: { ...simulation.viewOffset, x: Number(event.target.value) || 0 } })} />
          </label>
          <label className="field">
            <span>{t('offsetY')}</span>
            <input type="number" step="0.1" value={simulation.viewOffset.y} onChange={(event) => simulationActions.patch({ viewOffset: { ...simulation.viewOffset, y: Number(event.target.value) || 0 } })} />
          </label>
        </div>
        <button type="button" className="view-reset" onClick={() => simulationActions.patch({ zoom: 1, viewOffset: { x: 0, y: 0 } })}>{t('resetView')}</button>
      </section>

      <section className="drawer-section" data-story-target="layers">
        <div className="section-kicker">{t('layers').toUpperCase()}</div>
        {([
          ['showEcliptic', 'ecliptic'], ['showOrbits', 'fullOrbits'], ['showLagrange', 'lagrange'],
          ['showHillSphere', 'hill'], ['showLaplaceSoi', 'soi'], ['showSpacecraft', 'spacecraft'],
        ] as const).map(([property, label]) => (
          <label className="toggle-row" key={property}>
            <input type="checkbox" checked={simulation[property]} onChange={(event) => simulationActions.patch({ [property]: event.target.checked })} />
            <span>{t(label)}</span>
          </label>
        ))}
      </section>

      <section className="drawer-section focus-list-section">
        <div className="section-heading"><span>{t('selectedBodies')}</span><strong>{selection.selectedIds.length}/160</strong></div>
        <label className="field body-filter">
          <span>{t('filterBodies')}</span>
          <input type="search" value={bodyQuery} onChange={(event) => setBodyQuery(event.target.value)} placeholder={t('filterBodies')} />
        </label>
        <div className="body-match-count">{filteredBodies.length} {t('matchingBodies')}</div>
        <div className="body-check-list">
          {filteredBodies.map((body) => (
            <label className="body-check-row" key={body.id}>
              <input type="checkbox" checked={selection.selectedIds.includes(body.id)} onChange={() => selectionActions.toggle(body.id)} />
              <i style={{ backgroundColor: body.color }} />
              <span onClick={() => selectionActions.focus(body.id)}>{bodyDisplayName(body, language)}</span>
              <small>{body.orbitClassCode ?? body.kind}</small>
            </label>
          ))}
        </div>
        <div className="inline-actions body-selection-actions">
          <button onClick={() => selectionActions.setSelectedIds(referenceOptions.filter((body) => body.id !== 'sun' && body.kind !== 'spacecraft').map((body) => body.id).slice(0, 160))}>{t('selectMajorBodies')}</button>
          <button onClick={() => selectionActions.setSelectedIds(sortedBodies.slice(0, 160).map((body) => body.id))}>{t('selectAllAvailable')}</button>
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
          <button disabled={!savedScenes.length} onClick={() => {
            const url = URL.createObjectURL(new Blob([sceneLibraryDocument(savedScenes)], { type: 'application/json' }))
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'solar-atlas-scenes.json'; anchor.click(); URL.revokeObjectURL(url)
          }}>{t('exportScenes')}</button>
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
        <button className="share-button" onClick={async () => {
          const url = encodeCurrentScene()
          await navigator.clipboard.writeText(url)
          uiActions.toast(t('linkCopied'))
        }}>↗ {t('share')}</button>
        <button className="share-button" onClick={() => void exportAnnotatedScenePng(language).catch((error: unknown) => uiActions.toast(error instanceof Error ? error.message : String(error)))}>▣ {t('exportPng')}</button>
      </div>
    </aside>
  )
}
