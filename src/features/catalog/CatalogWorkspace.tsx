import { useEffect, useMemo, useRef, useState } from 'react'
import { CatalogPointCanvas } from '../../components/CatalogPointCanvas'
import { simulationClock } from '../../engine/clock/SimulationClock'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { useI18n } from '../../i18n/context'
import { useCatalogPointWorker } from '../../hooks/useCatalogPointWorker'
import {
  asteroidRecordToBody,
  getSearchBucketKey,
  loadAllAsteroidRecords,
  loadAsteroidChunk,
  loadAsteroidSearchBucket,
  loadAsteroidSectionPage,
  normalizeSearchText,
} from '../../lib/catalogLoader'
import { catalogActions, catalogStore, filterCatalogRecords } from '../../state/catalog-store'
import { selectionActions, selectionStore } from '../../state/selection-store'
import { uiActions } from '../../state/ui-store'
import type { AsteroidSectionCursor } from '../../types'
import { bodyDisplayName } from '../../lib/bodyNames'
import { DatasetCard } from './DatasetCard'

const CLASS_OPTIONS = ['all', 'MBA', 'MCR', 'APO', 'ATE', 'AMO', 'ATI', 'HUN', 'HIL', 'JTA', 'TNO', 'OTHER']

export function CatalogWorkspace() {
  const catalog = catalogStore.useStore()
  const selection = selectionStore.useStore()
  const clock = useSimulationClock()
  const { t, language } = useI18n()
  const installedMode = catalog.manifest?.datasetMode ?? catalog.mode
  const [cursor, setCursor] = useState<AsteroidSectionCursor>({ chunkIndex: 0, recordOffset: 0 })
  const [hasMore, setHasMore] = useState(true)
  const loadController = useRef<AbortController | null>(null)
  const [playingEpoch, setPlayingEpoch] = useState(clock.julianDay)
  const catalogEpoch = clock.isPlaying ? playingEpoch : clock.julianDay

  useEffect(() => {
    if (!clock.isPlaying) return
    const timer = window.setInterval(() => setPlayingEpoch(simulationClock.getJulianDay()), 5000)
    return () => window.clearInterval(timer)
  }, [clock.isPlaying])

  useEffect(() => () => loadController.current?.abort(), [])

  useEffect(() => {
    if (!catalog.manifest || catalog.filters.query.trim()) return
    let cancelled = false
    loadController.current?.abort()
    catalogActions.patch({ isLoading: true, error: null, records: [], recordsComplete: false, loadProgress: 0 })
    void loadAsteroidSectionPage({
      manifest: catalog.manifest,
      orbitClassCode: catalog.filters.orbitClass,
      pageSize: 400,
    }).then((page) => {
      if (cancelled) return
      catalogActions.patch({ records: page.records, isLoading: false })
      setCursor(page.endCursor)
      setHasMore(page.endCursor.chunkIndex < catalog.manifest!.chunkCount)
    }).catch((error: unknown) => {
      if (!cancelled) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [catalog.filters.orbitClass, catalog.filters.query, catalog.manifest])

  useEffect(() => {
    const query = catalog.filters.query.trim()
    if (!catalog.manifest || !query) return
    let cancelled = false
    loadController.current?.abort()
    catalogActions.patch({ isLoading: true, error: null, recordsComplete: false, loadProgress: 0 })
    void loadAsteroidSearchBucket(getSearchBucketKey(query)).then(async (entries) => {
      const normalized = normalizeSearchText(query)
      const matches = entries.filter((entry) => entry.searchKey.includes(normalized)).slice(0, 1200)
      const chunkIds = [...new Set(matches.map((entry) => entry.chunkId))].slice(0, 30)
      const chunks = await Promise.all(chunkIds.map(loadAsteroidChunk))
      const matchIds = new Set(matches.map((entry) => entry.id))
      return chunks.flat().filter((record) => matchIds.has(record.id))
    }).then((records) => {
      if (!cancelled) catalogActions.patch({ records, isLoading: false })
    }).catch((error: unknown) => {
      if (!cancelled) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [catalog.filters.query, catalog.manifest])

  const filtered = useMemo(() => filterCatalogRecords(catalog.records, catalog.filters), [catalog.filters, catalog.records])
  const pointCloud = useCatalogPointWorker(filtered, catalogEpoch)

  async function loadEntireCatalog() {
    if (!catalog.manifest) return []
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    catalogActions.patch({ isLoading: true, error: null, loadProgress: 0 })
    try {
      const records = await loadAllAsteroidRecords({
        manifest: catalog.manifest,
        orbitClassCode: catalog.filters.orbitClass,
        signal: controller.signal,
        onProgress: (loadProgress) => catalogActions.patch({ loadProgress }),
      })
      if (controller.signal.aborted) return []
      catalogActions.patch({ records, recordsComplete: true, loadProgress: 1, isLoading: false })
      setCursor({ chunkIndex: catalog.manifest.chunkCount, recordOffset: 0 })
      setHasMore(false)
      return records
    } catch (error) {
      if (controller.signal.aborted) return []
      catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
      return []
    } finally {
      if (loadController.current === controller) loadController.current = null
    }
  }

  async function selectAllFiltered() {
    const source = catalog.recordsComplete ? catalog.records : await loadEntireCatalog()
    if (!catalog.manifest || !source.length) return
    const matches = filterCatalogRecords(source, catalog.filters)
    catalogActions.selectAllFiltered(catalog.manifest.version, catalog.filters, matches.length)
    uiActions.toast(`${matches.length.toLocaleString()} ${t('selectedCount')}`)
  }

  async function loadMore() {
    if (!catalog.manifest || catalog.isLoading || !hasMore || catalog.filters.query.trim()) return
    catalogActions.patch({ isLoading: true })
    try {
      const page = await loadAsteroidSectionPage({
        manifest: catalog.manifest,
        orbitClassCode: catalog.filters.orbitClass,
        cursor,
        pageSize: 400,
      })
      catalogActions.patch({ records: [...catalog.records, ...page.records], isLoading: false })
      setCursor(page.endCursor)
      setHasMore(page.endCursor.chunkIndex < catalog.manifest.chunkCount)
    } catch (error) {
      catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="workspace-page catalog-workspace">
      <header className="page-heading">
        <div><span className="eyebrow">MPCORB / BINARY SHARDS / INDEXEDDB</span><h1>{t('catalog')}</h1><p>{t('tagline')}</p></div>
        <div className="mode-switch segmented-control">
          <button className={installedMode === 'lite' ? 'active' : ''} disabled={installedMode !== 'lite'}>{t('lite')}</button>
          <button className={installedMode === 'full' ? 'active' : ''} disabled={installedMode !== 'full'}>{t('full')}</button>
        </div>
      </header>

      <div className="catalog-layout">
        <aside className="filter-panel glass-panel">
          <DatasetCard />
          <label className="field"><span>{t('query')}</span><input type="search" value={catalog.filters.query} onChange={(event) => catalogActions.patchFilters({ query: event.target.value })} placeholder="Ceres / 433 Eros / 2024 YR4" /></label>
          <label className="field"><span>{t('orbitClass')}</span><select value={catalog.filters.orbitClass} onChange={(event) => catalogActions.patchFilters({ orbitClass: event.target.value })}>{CLASS_OPTIONS.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <div className="section-kicker">{t('filters').toUpperCase()}</div>
          <RangeFields label="a (AU)" value={catalog.filters.semiMajorAxis} onChange={(value) => catalogActions.patchFilters({ semiMajorAxis: value })} step="0.1" />
          <RangeFields label="e" value={catalog.filters.eccentricity} onChange={(value) => catalogActions.patchFilters({ eccentricity: value })} step="0.01" />
          <RangeFields label="i (°)" value={catalog.filters.inclination} onChange={(value) => catalogActions.patchFilters({ inclination: value })} step="1" />
          <RangeFields label="H" value={catalog.filters.absoluteMagnitude} onChange={(value) => catalogActions.patchFilters({ absoluteMagnitude: value })} step="0.5" />
          <RangeFields label="q (AU)" value={catalog.filters.perihelion} onChange={(value) => catalogActions.patchFilters({ perihelion: value })} step="0.1" />
          <button className="primary-button full-width" disabled={!filtered.length} onClick={() => selectionActions.addCatalogBodies(filtered.slice(0, 160).map(asteroidRecordToBody), true)}>{t('addSelection')} · {Math.min(filtered.length, 160)}</button>
          <button className="secondary-button full-width" disabled={!catalog.manifest || catalog.isLoading} onClick={() => void selectAllFiltered()}>{catalog.recordsComplete ? t('selectAllCatalog') : `${t('loadAllCatalog')} · ${Math.round(catalog.loadProgress * 100)}%`}</button>
          {catalog.selectionScope && <button className="text-button full-width" onClick={catalogActions.clearCatalogSelection}>{t('clearCatalogSelection')} · {catalog.selectionScope.count.toLocaleString()}</button>}
        </aside>

        <section className="catalog-map glass-panel">
          <div className="map-caption"><span>CATALOG MODE · GPU POINTS</span><strong>{Math.floor(pointCloud.positions.length / 2).toLocaleString()} / {filtered.length.toLocaleString()}</strong></div>
          {pointCloud.positions.length === filtered.length * 2 && filtered.length ? <CatalogPointCanvas
            records={filtered}
            positions={pointCloud.positions}
            viewRadiusAU={catalog.filters.semiMajorAxis[1] || 50}
          /> : <div className="empty-state"><span>◎</span><p>{catalog.manifest ? t('loading') : t('unavailable')}</p></div>}
          {pointCloud.progress > 0 && pointCloud.progress < 1 && <div className="compute-progress"><i style={{ width: `${pointCloud.progress * 100}%` }} /></div>}
          {pointCloud.error && <div className="error-banner">{pointCloud.error}</div>}
        </section>

        <section className="catalog-results glass-panel">
          <div className="section-heading"><span>{filtered.length.toLocaleString()} {t('results')}</span><small>{(catalog.selectionScope?.count ?? selection.selectedIds.filter((id) => id.startsWith('asteroid:')).length).toLocaleString()} {t('selectedCount')}</small></div>
          {catalog.error && <div className="error-banner">{catalog.error}</div>}
          <div className="catalog-table" role="list">
            {filtered.slice(0, 240).map((record) => {
              const selected = Boolean(catalog.selectionScope) || selection.selectedIds.includes(record.id)
              return <button role="listitem" className={selected ? 'selected' : ''} key={record.id} onClick={() => {
                selectionActions.addCatalogBodies([asteroidRecordToBody(record)])
                selectionActions.toggle(record.id)
                selectionActions.focus(record.id)
              }}>
                <i className={`class-dot class-${record.orbitClassCode.toLowerCase()}`} />
                <span><strong>{bodyDisplayName(asteroidRecordToBody(record), language)}</strong><small>{record.label}</small></span>
                <span className="numeric"><b>{record.semiMajorAxisAU.toFixed(3)}</b><small>a / AU</small></span>
                <span className="numeric"><b>{record.eccentricity.toFixed(3)}</b><small>e</small></span>
                <span className="numeric"><b>{record.inclinationDeg.toFixed(1)}°</b><small>i</small></span>
                <em>{record.orbitClassCode}{record.isPha ? ' · PHA' : record.isNeo ? ' · NEO' : ''}</em>
              </button>
            })}
          </div>
          {catalog.manifest && !catalog.filters.query && hasMore && <button className="load-more" disabled={catalog.isLoading} onClick={() => void loadMore()}>{catalog.isLoading ? t('loading') : t('loadMore')}</button>}
        </section>
      </div>
    </div>
  )
}

function RangeFields({ label, value, onChange, step }: { label: string; value: [number, number]; onChange: (value: [number, number]) => void; step: string }) {
  return <div className="range-fields"><span>{label}</span><input type="number" value={value[0]} step={step} onChange={(event) => onChange([Number(event.target.value), value[1]])} /><b>—</b><input type="number" value={value[1]} step={step} onChange={(event) => onChange([value[0], Number(event.target.value)])} /></div>
}
