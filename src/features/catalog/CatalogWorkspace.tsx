import { useEffect, useMemo, useRef, useState } from 'react'
import { CatalogPointCanvas } from '../../components/CatalogPointCanvas'
import { CatalogStreamCanvas } from '../../components/CatalogStreamCanvas'
import { planCatalogStream } from '../../lib/catalogStreaming'
import { requireCatalogAccess } from '../../lib/productAccess'
import { simulationClock } from '../../engine/clock/SimulationClock'
import { useSimulationClock } from '../../engine/clock/useSimulationClock'
import { useI18n } from '../../i18n/context'
import { useCatalogPointWorker } from '../../hooks/useCatalogPointWorker'
import { useCatalogSample } from '../../hooks/useCatalogSample'
import {
  asteroidRecordToBody,
  isNameSearchTooShort,
  loadAsteroidSectionPage,
  searchAsteroidCatalogPage,
} from '../../lib/catalogLoader'
import {
  EXACT_CATALOG_LOCATOR_LIMIT,
  createCatalogScanKey,
  discardCatalogScanPages,
  loadNextCatalogScanPage,
  resetCatalogScanWorker,
  scanAsteroidCatalog,
} from '../../lib/catalogScan'
import { catalogActions, catalogDisplayRecords, catalogStore, filterCatalogRecords } from '../../state/catalog-store'
import { selectionActions, selectionStore } from '../../state/selection-store'
import { uiActions } from '../../state/ui-store'
import { simulationStore } from '../../state/simulation-store'
import type { AsteroidRecord, AsteroidSectionCursor, MagnitudeStatus } from '../../types'
import { bodyDisplayName } from '../../lib/bodyNames'
import { catalogSampleErrorMessage } from '../../lib/catalogSampleProfile'
import { CATALOG_ORBIT_CLASS_FILTERS } from '../../lib/catalogFilters'
import { DatasetCard } from './DatasetCard'
import { julianDayToDate } from '../../lib/julianDate'
import { SourceIdentityBrowser } from './SourceIdentityBrowser'

const EMPTY_RECORDS: AsteroidRecord[] = []

export function CatalogWorkspace() {
  useCatalogSample()
  const catalog = catalogStore.useStore()
  const isLoading = catalog.isLoading || catalog.sampleLoading
  const selection = selectionStore.useStore()
  const simulation = simulationStore.useStore()
  const clock = useSimulationClock()
  const { t, language } = useI18n()
  const installedMode = catalog.manifest?.datasetMode ?? catalog.mode
  const [cursor, setCursor] = useState<AsteroidSectionCursor>({ chunkIndex: 0, recordOffset: 0 })
  const [hasMore, setHasMore] = useState(true)
  const [searchPage, setSearchPage] = useState<{ total: number; nextCursor: number | null }>({ total: 0, nextCursor: null })
  const loadController = useRef<AbortController | null>(null)
  const activeScanController = useRef<AbortController | null>(null)
  const currentScanKey = useRef(catalog.activeResultScanKey ?? '')
  const [playingEpoch, setPlayingEpoch] = useState(clock.julianDay)
  const catalogEpoch = clock.isPlaying ? playingEpoch : clock.julianDay
  const [streamBudget] = useState(() => {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    return (memory !== undefined && memory <= 4 ? 64 : window.innerWidth <= 800 ? 128 : 256) * 1024 * 1024
  })
  const [streamLimit, setStreamLimit] = useState(() => window.innerWidth <= 800 ? 30_000 : 100_000)
  const [streamRadius, setStreamRadius] = useState(8)
  const [streamDisplay, setStreamDisplay] = useState<'spatial' | 'all'>('spatial')
  const [streamDisplayLimit, setStreamDisplayLimit] = useState(() => window.innerWidth <= 800 ? 30_000 : 100_000)
  const [streamRequest, setStreamRequest] = useState<{ key: string; epoch: number; id: number } | null>(null)
  const streamKey = JSON.stringify([catalog.manifest?.releasePath, catalog.manifest?.version, catalog.filters, streamLimit])
  const streaming = streamRequest?.key === streamKey
  let streamCapacity = 0
  try { if (catalog.manifest) streamCapacity = planCatalogStream(catalog.manifest, streamLimit, streamBudget).capacity }
  catch { /* Older dataset formats retain their existing sample renderer. */ }

  useEffect(() => {
    if (!clock.isPlaying) return
    const timer = window.setInterval(() => setPlayingEpoch(simulationClock.getJulianDay()), 5000)
    return () => window.clearInterval(timer)
  }, [clock.isPlaying])

  useEffect(() => () => {
    loadController.current?.abort()
    activeScanController.current?.abort()
    if (loadController.current || activeScanController.current) catalogActions.patch({ isLoading: false, loadProgress: 0 })
  }, [])

  useEffect(() => {
    if (loadController.current) {
      loadController.current.abort()
      loadController.current = null
      catalogActions.patch({ isLoading: false })
    }
  }, [catalog.filters.query, catalog.filters.orbitClass, catalog.manifest])

  const sampleLimit = EXACT_CATALOG_LOCATOR_LIMIT
  const scanKey = catalog.manifest
    ? createCatalogScanKey(catalog.manifest.version, catalog.filters, sampleLimit)
    : ''

  useEffect(() => {
    if (currentScanKey.current !== scanKey) discardCatalogScanPages(currentScanKey.current)
    currentScanKey.current = scanKey
    if (activeScanController.current) {
      activeScanController.current.abort()
      catalogActions.patch({ isLoading: false, loadProgress: 0 })
    }
    activeScanController.current = null
    // Completed pages belong to the retained catalog result. Navigation only
    // cancels active transport; a changed filter discards its paging cursor.
  }, [scanKey])

  function beginLoad() {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    return controller
  }

  useEffect(() => {
    if (!catalog.manifest || catalog.filters.query.trim()) return
    if (catalog.manifest.precomputedSamples) {
      return
    }
    const controller = beginLoad()
    catalogActions.patch({
      isLoading: true, error: null, browseRecords: [],
      activeResultRecords: [], activeResultScanKey: null, exactFilteredTotal: null,
      exactHydrationHasMore: false,
      recordsSampled: false, loadProgress: 0,
    })
    void loadAsteroidSectionPage({
      manifest: catalog.manifest,
      orbitClassCode: catalog.filters.orbitClass,
      pageSize: 400,
      signal: controller.signal,
    }).then((page) => {
      if (controller.signal.aborted) return
      catalogActions.patch({ browseRecords: page.records, isLoading: false })
      setCursor(page.endCursor)
      setHasMore(page.endCursor.chunkIndex < catalog.manifest!.chunkCount)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      if (loadController.current === controller) loadController.current = null
    })
    return () => controller.abort()
  }, [catalog.filters.orbitClass, catalog.filters.query, catalog.manifest])

  useEffect(() => {
    const query = catalog.filters.query.trim()
    if (!catalog.manifest || !query) return
    if (isNameSearchTooShort(query, catalog.manifest)) {
      catalogActions.patch({
        isLoading: false, error: null, browseRecords: [], recordsSampled: false,
        activeResultRecords: [], activeResultScanKey: null, exactFilteredTotal: null,
        exactHydrationHasMore: false,
      })
      return
    }
    const controller = beginLoad()
    catalogActions.patch({
      isLoading: true, error: null, browseRecords: [],
      activeResultRecords: [], activeResultScanKey: null, exactFilteredTotal: null,
      exactHydrationHasMore: false,
      recordsSampled: false, loadProgress: 0,
    })
    void searchAsteroidCatalogPage({ query, signal: controller.signal }).then((page) => {
      if (!controller.signal.aborted) {
        catalogActions.patch({ browseRecords: page.records, isLoading: false, recordsSampled: page.nextCursor !== null })
        setSearchPage({ total: page.total, nextCursor: page.nextCursor })
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      if (loadController.current === controller) loadController.current = null
    })
    return () => controller.abort()
  }, [catalog.filters.query, catalog.filters.orbitClass, catalog.manifest])

  const displayedRecords = catalogDisplayRecords(catalog, scanKey)
  const filtered = useMemo(() => filterCatalogRecords(displayedRecords, catalog.filters), [catalog.filters, displayedRecords])
  const exactResultIsPartial = catalog.activeResultScanKey === scanKey && catalog.exactFilteredTotal !== null &&
    catalog.exactFilteredTotal > catalog.activeResultRecords.length
  const pointRecords = useMemo(() => exactResultIsPartial && !catalog.filters.query.trim()
    ? filterCatalogRecords(catalog.baseSampleRecords, catalog.filters)
    : filtered, [catalog.baseSampleRecords, catalog.filters, exactResultIsPartial, filtered])
  const pointCloud = useCatalogPointWorker(streaming ? EMPTY_RECORDS : pointRecords, catalogEpoch, '2d')

  async function scanEntireCatalog() {
    if (!catalog.manifest) return null
    activeScanController.current?.abort()
    const controller = new AbortController()
    const requestedScanKey = scanKey
    activeScanController.current = controller
    catalogActions.patch({ isLoading: true, error: null, loadProgress: 0 })
    try {
      const result = await scanAsteroidCatalog({
        manifest: catalog.manifest,
        filters: catalog.filters,
        sampleLimit,
        signal: controller.signal,
        onProgress: (loadProgress) => {
          if (currentScanKey.current === requestedScanKey) catalogActions.patch({ loadProgress })
        },
      })
      if (controller.signal.aborted || result.scanKey !== requestedScanKey || currentScanKey.current !== requestedScanKey) return null
      catalogActions.setExactResult(result.scanKey, result.records, result.total, result.hasMore)
      setCursor({ chunkIndex: catalog.manifest.chunkCount, recordOffset: 0 })
      setHasMore(false)
      return result
    } catch (error) {
      if (controller.signal.aborted) return null
      catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
      return null
    } finally {
      if (activeScanController.current === controller) activeScanController.current = null
    }
  }

  async function selectAllFiltered() {
    if (!catalog.manifest) return
    if (catalog.activeResultScanKey !== scanKey || catalog.exactFilteredTotal === null) return
    catalogActions.selectAllFiltered(catalog.manifest.version, catalog.filters, catalog.exactFilteredTotal)
    uiActions.toast(`${catalog.exactFilteredTotal.toLocaleString()} ${t('selectedCount')}`)
  }

  async function loadNextExactPage() {
    if (!catalog.manifest || !catalog.exactHydrationHasMore || isLoading) return
    catalogActions.patch({ isLoading: true, error: null })
    const controller = new AbortController()
    activeScanController.current = controller
    try {
      const page = await loadNextCatalogScanPage(scanKey, catalog.manifest, controller.signal)
      if (!controller.signal.aborted && currentScanKey.current === scanKey) catalogActions.setExactPage(page.records, page.hasMore)
    } catch (error) {
      if (!controller.signal.aborted) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (activeScanController.current === controller) activeScanController.current = null
    }
  }

  async function loadMore() {
    if (!catalog.manifest || isLoading || !hasMore || catalog.filters.query.trim()) return
    catalogActions.patch({ isLoading: true })
    const controller = beginLoad()
    try {
      const page = await loadAsteroidSectionPage({
        manifest: catalog.manifest,
        orbitClassCode: catalog.filters.orbitClass,
        cursor,
        pageSize: 400,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      catalogActions.patch({
        browseRecords: [...catalog.browseRecords, ...page.records], isLoading: false,
        exactFilteredTotal: null, recordsSampled: false,
        exactHydrationHasMore: false,
      })
      setCursor(page.endCursor)
      setHasMore(page.endCursor.chunkIndex < catalog.manifest.chunkCount)
    } catch (error) {
      if (!controller.signal.aborted) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (loadController.current === controller) loadController.current = null
    }
  }

  async function loadMoreSearchResults() {
    const query = catalog.filters.query.trim()
    if (!query || searchPage.nextCursor === null || isLoading) return
    catalogActions.patch({ isLoading: true, error: null })
    const controller = beginLoad()
    try {
      const page = await searchAsteroidCatalogPage({ query, cursor: searchPage.nextCursor, signal: controller.signal })
      if (controller.signal.aborted) return
      const recordsById = new Map([...catalog.browseRecords, ...page.records].map((record) => [record.id, record]))
      catalogActions.patch({ browseRecords: [...recordsById.values()], isLoading: false, recordsSampled: page.nextCursor !== null })
      setSearchPage({ total: page.total, nextCursor: page.nextCursor })
    } catch (error) {
      if (!controller.signal.aborted) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (loadController.current === controller) loadController.current = null
    }
  }

  const nameSearchTooShort = Boolean(catalog.manifest && isNameSearchTooShort(catalog.filters.query, catalog.manifest))
  const textMatchTotal = catalog.filters.query.trim() ? nameSearchTooShort ? 0 : searchPage.total : null
  const exactFilteredTotal = catalog.activeResultScanKey === scanKey ? catalog.exactFilteredTotal : null
  const resultTotal = exactFilteredTotal ?? textMatchTotal ?? filtered.length
  const visibleTableCount = Math.min(filtered.length, 240)
  const focusBodyLimit = simulation.viewMode === '2d' ? 320 : 160

  return (
    <div className="workspace-page catalog-workspace" data-story-target="catalog">
      <div className="page-heading">
        <div><span className="eyebrow">{t('catalogKicker')}</span><h1>{t('catalog')}</h1><p>{t('tagline')}</p></div>
        <div className="mode-switch segmented-control">
          <button className={installedMode === 'lite' ? 'active' : ''} disabled={installedMode !== 'lite'}>{t('lite')}</button>
          <button className={installedMode === 'full' ? 'active' : ''} disabled={installedMode !== 'full'}>{t('full')}</button>
        </div>
      </div>

      <SourceIdentityBrowser onSelectPage={(page) => {
        const base = import.meta.env.VITE_SOLAR_API_BASE_URL?.trim() || ''
        const selected = selectionActions.selectSourcePage(page, base)
        if (selected) uiActions.navigate('explorer')
        return selected
      }} />
      <div className="catalog-layout">
        <aside className="filter-panel glass-panel">
          <DatasetCard />
          <label className="field"><span>{t('query')}</span><input type="search" value={catalog.filters.query} onChange={(event) => catalogActions.patchFilters({ query: event.target.value })} placeholder="Ceres / 433 Eros / 2024 YR4" /></label>
          {nameSearchTooShort && <p className="catalog-result-note">{t('minimumNameSearch')}</p>}
          <label className="field"><span>{t('orbitClass')}</span><select value={catalog.filters.orbitClass} onChange={(event) => catalogActions.patchFilters({ orbitClass: event.target.value })}>{CATALOG_ORBIT_CLASS_FILTERS.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <div className="section-kicker">{t('filters').toUpperCase()}</div>
          <RangeFields label="a (AU)" minimumLabel={t('minimum')} maximumLabel={t('maximum')} value={catalog.filters.semiMajorAxis} onChange={(value) => catalogActions.patchFilters({ semiMajorAxis: value })} step="0.1" />
          <RangeFields label="e" minimumLabel={t('minimum')} maximumLabel={t('maximum')} value={catalog.filters.eccentricity} onChange={(value) => catalogActions.patchFilters({ eccentricity: value })} step="0.01" />
          <RangeFields label="i (°)" minimumLabel={t('minimum')} maximumLabel={t('maximum')} value={catalog.filters.inclination} onChange={(value) => catalogActions.patchFilters({ inclination: value })} step="1" />
          <RangeFields label="H" minimumLabel={t('minimum')} maximumLabel={t('maximum')} value={catalog.filters.absoluteMagnitude} onChange={(value) => catalogActions.patchFilters({ absoluteMagnitude: value })} step="0.5" />
          <label className="field"><span>{t('magnitudeStatus')}</span><select value={catalog.filters.magnitudeStatus} onChange={(event) => catalogActions.patchFilters({ magnitudeStatus: event.target.value as MagnitudeStatus })}>
            <option value="all">{t('magnitudeAll')}</option>
            <option value="known">{t('magnitudeKnown')}</option>
            <option value="unknown">{t('magnitudeUnknown')}</option>
          </select></label>
          <RangeFields label="q (AU)" minimumLabel={t('minimum')} maximumLabel={t('maximum')} value={catalog.filters.perihelion} onChange={(value) => catalogActions.patchFilters({ perihelion: value })} step="0.1" />
          {catalog.manifest?.compactIndex && <div className="catalog-stream-controls">
            <label className="field"><span>{t('catalogStreamLimit')}</span><select value={streamLimit} onChange={event => setStreamLimit(Number(event.target.value))}>
              {[...new Set([30_000, 100_000, 300_000, 1_000_000, catalog.manifest.totalCount])].sort((a, b) => a - b).map(limit => <option key={limit} value={limit}>{limit === catalog.manifest!.totalCount ? t('catalogStreamAll') : limit.toLocaleString()}</option>)}
            </select></label>
            <label className="field"><span>{t('catalogStreamRadius')}</span><input type="number" min="0.001" max="1000000" step="1" value={streamRadius} onChange={event => {
              const radius = Number(event.target.value)
              if (Number.isFinite(radius) && radius > 0 && radius <= 1_000_000) setStreamRadius(radius)
            }} /></label>
            <label className="field"><span>{t('catalogSpatialDetail')}</span><select value={streamDisplay} onChange={event => setStreamDisplay(event.target.value as 'spatial' | 'all')}>
              <option value="spatial">{t('catalogSpatialMode')}</option><option value="all">{t('catalogSpatialAll')}</option>
            </select></label>
            {streamDisplay === 'spatial' && <label className="field"><span>{t('catalogSpatialLimit')}</span><select value={streamDisplayLimit} onChange={event => setStreamDisplayLimit(Number(event.target.value))}>
              {[10_000, 30_000, 100_000, 300_000, 500_000].map(value => <option value={value} key={value}>{value.toLocaleString()}</option>)}
            </select></label>}
            <p className="catalog-result-note">{t('catalogStreamExplanation')}</p>
            <button className="secondary-button full-width" disabled={!streamCapacity || nameSearchTooShort} onClick={() => {
              requireCatalogAccess('scan')
              setStreamRequest({ key: streamKey, epoch: simulationClock.getJulianDay(), id: (streamRequest?.id ?? 0) + 1 })
            }}>{streaming ? t('catalogStreamRefresh') : t('catalogStreamStart')} · {streamCapacity.toLocaleString()}</button>
            {!streamCapacity && <p className="catalog-result-note">{t('catalogStreamNoBudget')}</p>}
            {streaming && <button className="text-button full-width" onClick={() => setStreamRequest(null)}>{t('catalogStreamSample')}</button>}
          </div>}
          <button className="primary-button full-width" disabled={!filtered.length} onClick={() => selectionActions.addCatalogBodies(filtered.slice(0, focusBodyLimit).map(asteroidRecordToBody), true)}>{t('addSelection')} · {Math.min(filtered.length, focusBodyLimit)}</button>
          <button className="secondary-button full-width" disabled={!catalog.manifest || isLoading || nameSearchTooShort} onClick={() => {
            if (catalog.activeResultScanKey === scanKey) selectAllFiltered()
            else void scanEntireCatalog()
          }}>{catalog.activeResultScanKey === scanKey ? t('selectAllCatalog') : `${t('loadAllCatalog')} · ${Math.round(catalog.loadProgress * 100)}%`}</button>
          {catalog.selectionScope && <button className="text-button full-width" onClick={catalogActions.clearCatalogSelection}>{t('clearCatalogSelection')} · {catalog.selectionScope.count.toLocaleString()}</button>}
        </aside>

        <section className="catalog-map glass-panel">
          <div className="map-caption"><span>{t('catalogModeCaption')}</span><strong>{streaming ? t('catalogStreamSnapshot') : `${Math.floor(pointCloud.positions.length / 2).toLocaleString()} / ${resultTotal.toLocaleString()}`}</strong></div>
          {streaming && catalog.manifest ? <CatalogStreamCanvas key={streamRequest.id} manifest={catalog.manifest} filters={catalog.filters} julianDay={streamRequest.epoch} requestedRows={streamLimit} budgetBytes={streamBudget} viewRadiusAU={streamRadius} displayMode={streamDisplay} displayLimit={streamDisplayLimit} /> : pointCloud.positions.length === pointRecords.length * 2 && pointRecords.length ? <CatalogPointCanvas
            records={pointRecords}
            positions={pointCloud.positions}
            viewRadiusAU={catalog.filters.semiMajorAxis[1] || 50}
            ariaLabel={t('catalogPointAria')}
            unavailableLabel={t('catalogRenderUnavailable')}
          /> : <div className="empty-state"><span>◎</span><p>{catalog.manifest ? t('loading') : t('unavailable')}</p></div>}
          {pointCloud.progress > 0 && pointCloud.progress < 1 && <div className="compute-progress"><i style={{ width: `${pointCloud.progress * 100}%` }} /></div>}
          {pointCloud.error && <div className="error-banner">{pointCloud.error}</div>}
          {pointCloud.readyCount > 0 && <p className="catalog-point-epoch" data-testid="catalog-point-epoch" data-utc-jd={pointCloud.computedJulianDay}>
            {t('catalogPointModel')} <time dateTime={julianDayToDate(pointCloud.computedJulianDay).toISOString()}>{julianDayToDate(pointCloud.computedJulianDay).toISOString().replace('T', ' ')}</time>
          </p>}
        </section>

        <section className="catalog-results glass-panel">
          <div className="section-heading"><span>{resultTotal.toLocaleString()} {t('results')}</span><small>{(catalog.selectionScope?.count ?? selection.selectedIds.filter((id) => id.startsWith('asteroid:')).length).toLocaleString()} {t('selectedCount')}</small></div>
          <div className="catalog-counts" aria-label={t('catalogResultCounts')}>
            <span>{t('loadedCount')} <strong>{displayedRecords.length.toLocaleString()}</strong></span>
            <span>{t('textMatches')} <strong>{textMatchTotal === null ? '—' : textMatchTotal.toLocaleString()}</strong></span>
            <span>{t('exactFilteredTotal')} <strong>{exactFilteredTotal === null ? '—' : exactFilteredTotal.toLocaleString()}</strong></span>
          </div>
          {catalog.sampleError && <div className="error-banner">{catalogSampleErrorMessage(catalog.sampleError, t)}</div>}
          {catalog.sampleLoadError && <div className="error-banner" role="alert">{catalog.sampleLoadError}</div>}
          {catalog.error && <div className="error-banner">{catalog.error}{catalog.manifest && <div className="export-actions">
            <button onClick={() => { resetCatalogScanWorker(); void scanEntireCatalog() }}>{t('retryExactScan')}</button>
            <button onClick={() => { resetCatalogScanWorker(); catalogActions.patch({ error: null, isLoading: false }) }}>{t('resetCatalogWorker')}</button>
          </div>}</div>}
          {(catalog.recordsSampled || filtered.length > visibleTableCount) && <p className="catalog-result-note">
            {t('showing')} {visibleTableCount.toLocaleString()} / {resultTotal.toLocaleString()}
            {catalog.activeResultScanKey === scanKey ? ` · ${t('stratifiedSample')}` : catalog.recordsSampled ? ` · ${t('refineSearch')}` : ''}
          </p>}
          <ul className="catalog-table">
            {filtered.slice(0, 240).map((record) => {
              const selected = Boolean(catalog.selectionScope) || selection.selectedIds.includes(record.id)
              return <li key={record.id}><button className={selected ? 'selected' : ''} onClick={() => {
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
              </button></li>
            })}
          </ul>
          {catalog.manifest && !catalog.manifest.precomputedSamples && !catalog.filters.query && hasMore && <button className="load-more" disabled={isLoading} onClick={() => void loadMore()}>{isLoading ? t('loading') : t('loadMore')}</button>}
          {catalog.manifest && catalog.filters.query && !nameSearchTooShort && searchPage.nextCursor !== null && <button className="load-more" disabled={isLoading} onClick={() => void loadMoreSearchResults()}>{isLoading ? t('loading') : t('loadMore')}</button>}
          {catalog.activeResultScanKey === scanKey && catalog.exactHydrationHasMore && <button className="load-more" disabled={isLoading} onClick={() => void loadNextExactPage()}>{isLoading ? t('loading') : t('loadNextExactPage')}</button>}
        </section>
      </div>
    </div>
  )
}

function RangeFields({ label, minimumLabel, maximumLabel, value, onChange, step }: { label: string; minimumLabel: string; maximumLabel: string; value: [number, number]; onChange: (value: [number, number]) => void; step: string }) {
  return <div className="range-fields"><span>{label}</span><input aria-label={`${label}: ${minimumLabel}`} type="number" value={value[0]} step={step} onChange={(event) => onChange([Number(event.target.value), value[1]])} /><b>—</b><input aria-label={`${label}: ${maximumLabel}`} type="number" value={value[1]} step={step} onChange={(event) => onChange([value[0], Number(event.target.value)])} /></div>
}
