import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CatalogPointCanvas } from '../../components/CatalogPointCanvas'
import { CatalogStreamCanvas } from '../../components/CatalogStreamCanvas'
import { planCatalogStream, type CatalogStreamPriority, type CatalogSourceSelection } from '../../lib/catalogStreaming'
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
import type { AsteroidManifest, AsteroidRecord, AsteroidSectionCursor, MagnitudeStatus } from '../../types'
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
  const [searchPage, setSearchPage] = useState<{ total: number; nextCursor: number | null; query: string; manifest: AsteroidManifest | null }>({ total: 0, nextCursor: null, query: '', manifest: null })
  const searchPageCurrent = searchPage.manifest === catalog.manifest && searchPage.query === catalog.filters.query.trim()
  const loadController = useRef<AbortController | null>(null)
  const activeScanController = useRef<AbortController | null>(null)
  const currentScanKey = useRef(catalog.activeResultScanKey ?? '')
  const [playingEpoch, setPlayingEpoch] = useState(clock.julianDay)
  const catalogEpoch = clock.isPlaying ? playingEpoch : clock.julianDay
  const [streamBudget, setStreamBudget] = useState(() => {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    return (memory !== undefined && memory <= 4 ? 64 : window.innerWidth <= 800 ? 128 : 256) * 1024 * 1024
  })
  const [streamLimit, setStreamLimit] = useState(() => window.innerWidth <= 800 ? 30_000 : 100_000)
  const [streamRetainEpochs, setStreamRetainEpochs] = useState(false)
  const [streamAppend, setStreamAppend] = useState(false)
  const streamAppendRows = streamRetainEpochs && streamAppend ? 256 : 0
  const [streamTemporalBudget, setStreamTemporalBudget] = useState(0)
  const [streamRadius, setStreamRadius] = useState(8)
  const [streamMode,setStreamMode] = useState<'2d' | '3d'>('2d')
  const [sampleTemporalBudget, setSampleTemporalBudget] = useState(0)
  const [streamSelectedFirst, setStreamSelectedFirst] = useState(false)
  const [streamPriority, setStreamPriority] = useState<CatalogStreamPriority>('source')
  const [streamAzimuth,setStreamAzimuth] = useState(0), [streamTilt,setStreamTilt] = useState(30)
  const streamRotation = useMemo(() => ({ azimuthDegrees: streamAzimuth,tiltDegrees: streamTilt }),[streamAzimuth,streamTilt])
  const [streamDisplay, setStreamDisplay] = useState<'spatial' | 'all'>('spatial')
  const [streamDisplayLimit, setStreamDisplayLimit] = useState(() => window.innerWidth <= 800 ? 30_000 : 100_000)
  const [streamRequest, setStreamRequest] = useState<{ key: string; epoch: number; id: number; prioritySources: { id: string; locator: { chunkIndex: number; rowIndex: number } }[] } | null>(null)
  const activeStreamRef = useRef<typeof streamRequest>(null)
  const [stoppedStreamRequest, setStoppedStreamRequest] = useState<typeof streamRequest>(null)
  const stoppedStreamRef = useRef<typeof streamRequest>(null)
  const stopAutomaticStream = useCallback(() => {
    if (!streamRequest || activeStreamRef.current !== streamRequest) return
    // Synchronous guard closes the timer race before effect cleanup runs.
    stoppedStreamRef.current = streamRequest
    setStoppedStreamRequest(streamRequest)
  }, [streamRequest])
  const resumeAutomaticStream = useCallback(() => {
    if (!streamRequest || activeStreamRef.current !== streamRequest) return
    if (stoppedStreamRef.current === streamRequest) stoppedStreamRef.current = null
    setStoppedStreamRequest(current => current === streamRequest ? null : current)
  }, [streamRequest])
  const [loadedSelection, setLoadedSelection] = useState<{ request: NonNullable<typeof streamRequest>; selection: CatalogSourceSelection } | null>(null)
  const receiveSourceSelection = useCallback((selection: CatalogSourceSelection | null) => {
    if (!streamRequest) return
    setLoadedSelection(current => {
      if (!selection) return current?.request === streamRequest ? null : current
      return activeStreamRef.current === streamRequest ? { request: streamRequest, selection } : current
    })
  }, [streamRequest])
  const streamKey = useMemo(() => JSON.stringify([catalog.manifest, catalog.filters, streamLimit, streamMode,
    streamPriority, streamBudget, streamRetainEpochs, streamSelectedFirst, streamAppendRows]),
  [catalog.manifest, catalog.filters, streamLimit, streamMode, streamPriority, streamBudget, streamRetainEpochs, streamSelectedFirst, streamAppendRows])
  const streaming = streamRequest?.key === streamKey
  // Publish only committed ownership. Passive cleanup may run after an old
  // timer or worker callback is already queued, and renders can be abandoned.
  useLayoutEffect(() => {
    activeStreamRef.current = streaming ? streamRequest : null
    return () => { activeStreamRef.current = null }
  }, [streaming, streamRequest])
  let streamCapacity = 0, streamMetadataMaximumBytes = 0
  try { if (catalog.manifest) {
    const plan = planCatalogStream(catalog.manifest, streamLimit, streamBudget, streamMode, streamRetainEpochs, streamAppendRows)
    streamCapacity = plan.capacity
    streamMetadataMaximumBytes = plan.metadataMaximumBytes
  } }
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
  const scanKey = useMemo(() => catalog.manifest
    ? createCatalogScanKey(catalog.manifest, catalog.filters, sampleLimit)
    : '', [catalog.manifest, catalog.filters, sampleLimit])
  const selectionScope = useMemo(() => catalog.manifest && catalog.selectionScope &&
    catalog.selectionScope.manifestIdentity === JSON.stringify(catalog.manifest) &&
    JSON.stringify(catalog.selectionScope.filters) === JSON.stringify(catalog.filters)
    ? catalog.selectionScope : null, [catalog.manifest, catalog.selectionScope, catalog.filters])

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
  }, [scanKey, catalog.manifest])

  function beginLoad() {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    return controller
  }

  const isCurrentBrowseLoad = useCallback((controller: AbortController) => {
    const current = catalogStore.getState()
    return !controller.signal.aborted && loadController.current === controller &&
      current.manifest === catalog.manifest && current.filters.query.trim() === catalog.filters.query.trim() &&
      current.filters.orbitClass === catalog.filters.orbitClass
  }, [catalog.manifest, catalog.filters.query, catalog.filters.orbitClass])

  function isCurrentExactLoad(controller: AbortController) {
    const current = catalogStore.getState()
    return !controller.signal.aborted && activeScanController.current === controller &&
      current.manifest === catalog.manifest && current.manifest !== null &&
      createCatalogScanKey(current.manifest, current.filters, sampleLimit) === scanKey
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
      if (!isCurrentBrowseLoad(controller)) return
      catalogActions.patch({ browseRecords: page.records, isLoading: false })
      setCursor(page.endCursor)
      setHasMore(page.endCursor.chunkIndex < catalog.manifest!.chunkCount)
    }).catch((error: unknown) => {
      if (isCurrentBrowseLoad(controller)) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      if (loadController.current === controller) loadController.current = null
    })
    return () => controller.abort()
  }, [catalog.filters.orbitClass, catalog.filters.query, catalog.manifest, isCurrentBrowseLoad])

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
    void searchAsteroidCatalogPage({ query, manifest: catalog.manifest, signal: controller.signal }).then((page) => {
      if (isCurrentBrowseLoad(controller)) {
        catalogActions.patch({ browseRecords: page.records, isLoading: false, recordsSampled: page.nextCursor !== null })
        setSearchPage({ total: page.total, nextCursor: page.nextCursor, query, manifest: catalog.manifest })
      }
    }).catch((error: unknown) => {
      if (isCurrentBrowseLoad(controller)) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      if (loadController.current === controller) loadController.current = null
    })
    return () => controller.abort()
  }, [catalog.filters.query, catalog.filters.orbitClass, catalog.manifest, isCurrentBrowseLoad])

  const displayedRecords = catalogDisplayRecords(catalog, scanKey)
  const streamFocus = useMemo(() => {
    const record = displayedRecords.find(value => value.id === selection.focusedId)
    return record && Number.isSafeInteger(record.chunkIndex) && Number.isSafeInteger(record.rowIndex)
      ? { id: record.id, locator: { chunkIndex: record.chunkIndex!, rowIndex: record.rowIndex! } } : undefined
  }, [displayedRecords, selection.focusedId])
  const streamSelections = useMemo(() => {
    const records = new Map(displayedRecords.map(record => [record.id, record]))
    const sources: { id: string; locator: { chunkIndex: number; rowIndex: number } }[] = []
    for (const id of selection.selectedIds) {
      const record = records.get(id)
      if (record && Number.isSafeInteger(record.chunkIndex) && Number.isSafeInteger(record.rowIndex)) {
        sources.push({ id, locator: { chunkIndex: record.chunkIndex!, rowIndex: record.rowIndex! } })
        if (sources.length === 256) break
      }
    }
    return sources
  }, [displayedRecords, selection.selectedIds])
  const prioritySourcesKey = JSON.stringify(streamSelectedFirst
    ? [...new Map([...(streamFocus ? [streamFocus] : []), ...streamSelections]
      .map(source => [source.id, source])).values()].slice(0, 256)
    : [])
  // Stabilize by content: catalog/clock notifications can recreate record arrays.
  const prioritySources = useMemo(() => JSON.parse(prioritySourcesKey) as
    { id: string; locator: { chunkIndex: number; rowIndex: number } }[], [prioritySourcesKey])
  const desiredPriorityRef = useRef(prioritySourcesKey)
  useLayoutEffect(() => { desiredPriorityRef.current = prioritySourcesKey }, [prioritySourcesKey])
  const prioritiesAlreadyLoaded = useMemo(() => {
    if (!prioritySources.length) return true
    if (!loadedSelection || loadedSelection.request !== streamRequest) return false
    // Membership needs no full-mask population scan or coordinate copy.
    const masks = new Map(loadedSelection.selection.shards.map(shard => [shard.chunk, shard.selectedRows]))
    return prioritySources.every(({ locator }) => {
      const mask = masks.get(locator.chunkIndex), byte = Math.floor(locator.rowIndex / 8)
      return mask !== undefined && byte >= 0 && byte < mask.length &&
        Boolean(mask[byte] & (1 << (locator.rowIndex & 7)))
    })
  }, [loadedSelection, streamRequest, prioritySources])
  useEffect(() => {
    if (streamAppendRows || !streaming || !streamSelectedFirst || !streamRequest || stoppedStreamRequest === streamRequest || prioritiesAlreadyLoaded ||
      JSON.stringify(streamRequest.prioritySources) === prioritySourcesKey) return
    const requested = streamRequest
    const timer = window.setTimeout(() => {
      if (activeStreamRef.current !== requested || stoppedStreamRef.current === requested ||
        desiredPriorityRef.current !== prioritySourcesKey) return
      try {
        requireCatalogAccess('scan')
        setStreamRequest(current => current === requested && activeStreamRef.current === requested && current.key === streamKey &&
          stoppedStreamRef.current !== requested && desiredPriorityRef.current === prioritySourcesKey
          ? { ...current, id: current.id + 1, prioritySources }
          : current)
      } catch (error: unknown) {
        catalogActions.patch({ error: error instanceof Error ? error.message : String(error) })
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [streaming, streamSelectedFirst, streamAppendRows, streamRequest, streamKey, prioritySourcesKey, prioritySources, prioritiesAlreadyLoaded, stoppedStreamRequest])
  const filtered = useMemo(() => filterCatalogRecords(displayedRecords, catalog.filters), [catalog.filters, displayedRecords])
  const exactResultIsPartial = catalog.activeResultScanKey === scanKey && catalog.exactFilteredTotal !== null &&
    catalog.exactFilteredTotal > catalog.activeResultRecords.length
  const pointRecords = useMemo(() => exactResultIsPartial && !catalog.filters.query.trim()
    ? filterCatalogRecords(catalog.baseSampleRecords, catalog.filters)
    : filtered, [catalog.baseSampleRecords, catalog.filters, exactResultIsPartial, filtered])
  const pointCloud = useCatalogPointWorker(streaming ? EMPTY_RECORDS : pointRecords, sampleTemporalBudget > 0 ? clock.julianDay : catalogEpoch, '2d', sampleTemporalBudget)

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
          if (isCurrentExactLoad(controller)) catalogActions.patch({ loadProgress })
        },
      })
      if (!isCurrentExactLoad(controller) || result.scanKey !== requestedScanKey) return null
      catalogActions.setExactResult(result.scanKey, result.records, result.total, result.hasMore)
      setCursor({ chunkIndex: catalog.manifest.chunkCount, recordOffset: 0 })
      setHasMore(false)
      return result
    } catch (error) {
      if (!isCurrentExactLoad(controller)) return null
      catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
      return null
    } finally {
      if (activeScanController.current === controller) activeScanController.current = null
    }
  }

  async function selectAllFiltered() {
    if (!catalog.manifest) return
    if (catalog.activeResultScanKey !== scanKey || catalog.exactFilteredTotal === null) return
    if (catalogActions.selectAllFiltered(catalog.manifest, catalog.filters, catalog.exactFilteredTotal)) {
      uiActions.toast(`${catalog.exactFilteredTotal.toLocaleString()} ${t('selectedCount')}`)
    }
  }

  async function loadNextExactPage() {
    if (!catalog.manifest || !catalog.exactHydrationHasMore || isLoading) return
    catalogActions.patch({ isLoading: true, error: null })
    const controller = new AbortController()
    activeScanController.current = controller
    try {
      const page = await loadNextCatalogScanPage(scanKey, catalog.manifest, controller.signal)
      if (isCurrentExactLoad(controller)) catalogActions.setExactPage(page.records, page.hasMore)
    } catch (error) {
      if (isCurrentExactLoad(controller)) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
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
      if (!isCurrentBrowseLoad(controller)) return
      catalogActions.patch({
        browseRecords: [...catalog.browseRecords, ...page.records], isLoading: false,
        exactFilteredTotal: null, recordsSampled: false,
        exactHydrationHasMore: false,
      })
      setCursor(page.endCursor)
      setHasMore(page.endCursor.chunkIndex < catalog.manifest.chunkCount)
    } catch (error) {
      if (isCurrentBrowseLoad(controller)) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (loadController.current === controller) loadController.current = null
    }
  }

  async function loadMoreSearchResults() {
    const query = catalog.filters.query.trim()
    if (!query || !searchPageCurrent || searchPage.nextCursor === null || isLoading) return
    catalogActions.patch({ isLoading: true, error: null })
    const controller = beginLoad()
    try {
      const page = await searchAsteroidCatalogPage({ query, manifest: searchPage.manifest, cursor: searchPage.nextCursor, signal: controller.signal })
      if (!isCurrentBrowseLoad(controller)) return
      const recordsById = new Map([...catalog.browseRecords, ...page.records].map((record) => [record.id, record]))
      catalogActions.patch({ browseRecords: [...recordsById.values()], isLoading: false, recordsSampled: page.nextCursor !== null })
      setSearchPage({ total: page.total, nextCursor: page.nextCursor, query, manifest: searchPage.manifest })
    } catch (error) {
      if (isCurrentBrowseLoad(controller)) catalogActions.patch({ isLoading: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (loadController.current === controller) loadController.current = null
    }
  }

  const nameSearchTooShort = Boolean(catalog.manifest && isNameSearchTooShort(catalog.filters.query, catalog.manifest))
  const textMatchTotal = catalog.filters.query.trim() ? nameSearchTooShort ? 0 : searchPageCurrent ? searchPage.total : null : null
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
            <label className="field"><span>{language === 'zh' ? '目录数组与 GPU 预算（MiB）' : 'Catalog array and GPU budget (MiB)'}</span><select value={streamBudget} onChange={event => setStreamBudget(Number(event.target.value))}>
              {[64, 128, 256, 384, 512].map(value => <option key={value} value={value*1024*1024}>{value}</option>)}
            </select></label>
            <label className="dynamics-check"><input type="checkbox" checked={streamRetainEpochs} onChange={event => setStreamRetainEpochs(event.target.checked)} />{language === 'zh' ? '保留轨道并跟随时间更新' : 'Retain orbits and follow time changes'}</label>
            {streamRetainEpochs && <label className="dynamics-check"><input type="checkbox" checked={streamAppend} onChange={event => setStreamAppend(event.target.checked)} />{language === 'zh' ? '为所选对象预留追加空间' : 'Reserve space to append selected bodies'}</label>}
            {streamAppendRows > 0 && <p className="catalog-result-note">{language === 'zh'
              ? '从总容量内预留最多 256 个追加名额，并额外预留来源记录内存。加载完成后点击图下“追加所选缺失对象”；按原筛选条件加载，保留旧对象与行号，上传及历元核对期间暂时隐藏画面。选择变化不再自动全量重载；初次优先加载仍有效。名额耗尽后需手动刷新，取消选择不会回收名额。更改此选项后需重新开始加载。'
              : 'Reserves up to 256 append slots within total capacity plus source-record memory. After loading, use “Append missing selected bodies” below the plot. Original filters apply; old bodies and row numbers are retained, with the plot hidden during upload and epoch reconciliation. Selection changes no longer reload the full snapshot; initial priority loading still applies. Refresh manually after slots are exhausted; deselection does not reclaim slots. Restart loading after changing this option.'}</p>}
            {streamRetainEpochs && <label className="field"><span>{language === 'zh' ? '目录时间复用位移预算（AU）' : 'Catalog temporal reuse displacement budget (AU)'}</span><select value={streamTemporalBudget} onChange={event => setStreamTemporalBudget(Number(event.target.value))}>
              <option value="0">{language === 'zh' ? '0 · 每个请求时刻计算' : '0 · Compute each requested epoch'}</option>
              {[0.000001, 0.0001, 0.001].map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>}
            {streamRetainEpochs && <p className="catalog-result-note">{language === 'zh' ? '每行额外保留 80 字节轨道系数，容量按预算重新计算。播放时每 5 秒请求一次历元；繁忙时只保留最新目标，完整上传前隐藏画面。换时间不重新下载已载入轨道。预算不等于浏览器总内存，尚无实时帧率保证。' : 'Retains 80 additional bytes of orbital coefficients per row, reducing capacity under the same budget. Playback requests an epoch every 5 seconds; while busy, only the latest target is retained. The plot is hidden until upload completes. Time changes reuse loaded orbits. This budget is not total browser memory and does not guarantee real-time frame rates.'}</p>}
            {!streaming && <label className="field"><span>{language === 'zh' ? '样本地图位移预算（AU）' : 'Sample map displacement budget (AU)'}</span><select value={sampleTemporalBudget} onChange={event => { setPlayingEpoch(simulationClock.getJulianDay()); setSampleTemporalBudget(Number(event.target.value)) }}>
              <option value="0">{language === 'zh' ? '0 · 每个请求时刻计算' : '0 · Compute each requested epoch'}</option>
              {[0.000001, 0.0001, 0.001].map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>}
            {!streaming && sampleTemporalBudget > 0 && <p className="catalog-result-note">{language === 'zh' ? '仅在两体模型的速度上限允许时复用样本坐标，显示的计算时刻保持不变。预算只约束时刻复用引入的模型位移，不包含轨道物理误差、数值误差或 GPU 舍入；新计算期间可能暂时超出预算。' : 'Reuse sample coordinates only within the two-body speed limit; the displayed computation epoch stays unchanged. This budgets temporal model displacement, not physical orbit error, numerical error or GPU rounding; a pending computation can temporarily exceed the budget.'}</p>}
            <label className="field"><span>{language === 'zh' ? '分片加载顺序' : 'Source shard order'}</span><select value={streamPriority} onChange={event => setStreamPriority(event.target.value as CatalogStreamPriority)}>
              <option value="source">{language === 'zh' ? '原始目录顺序' : 'Original catalog order'}</option>
              <option value="neo-first">{language === 'zh' ? '含近地天体的分片优先' : 'NEO-containing shards first'}</option>
              <option value="pha-first">{language === 'zh' ? '含 PHA 标签的分片优先' : 'PHA-containing shards first'}</option>
            </select></label>
            <label className="dynamics-check"><input type="checkbox" checked={streamSelectedFirst} onChange={event => setStreamSelectedFirst(event.target.checked)} />{streamAppendRows
              ? (language === 'zh' ? '初次加载时优先焦点和已选对象所在分片' : 'Prioritize focused and selected shards on initial load')
              : (language === 'zh' ? '优先加载并跟随焦点和已选对象所在分片' : 'Prioritize and follow focused and selected source shards')}</label>
            {streamSelectedFirst && !streamAppendRows && <p className="catalog-result-note">{language === 'zh' ? '最多固定 256 个可定位对象，焦点优先。先逐片核对优先对象，再跨分片为通过筛选的对象预留名额；容量不足时按名单顺序保留。不绕过筛选或总容量。运行期间名单变化先复用已载入对象；有缺失对象时在 250 毫秒后重新加载，连续变化合并处理，保留原快照计算时刻。取消选择不会移除已载入对象。重新加载会清空旧画面并额外读取优先分片，首批显示可能变慢。' : 'Pins up to 256 located objects, focus first. Checks priority bodies before reserving slots across shards; list order decides when capacity is insufficient. Filters and total capacity still apply. While running, changed lists reuse already loaded objects; missing objects trigger a reload after 250 ms, coalescing consecutive changes and preserving the snapshot epoch. Deselecting does not remove loaded objects. Reload clears the previous view and reads priority shards again, which may delay first display.'}</p>}
            {streamPriority !== 'source' && <p className="catalog-result-note">{language === 'zh' ? '仅按原始目录标签调整分片顺序；分片内仍保留普通天体，并应用原有筛选。有限容量结果受加载顺序影响，不代表完整分布或碰撞风险。' : 'Reorders shards using original catalog flags; ordinary bodies remain within each shard and existing filters still apply. Capacity-limited results depend on this order and do not represent the full distribution or collision risk.'}</p>}
            <label className="field"><span>{language === 'zh' ? '目录快照投影' : 'Catalog snapshot projection'}</span><select value={streamMode} onChange={event => setStreamMode(event.target.value as '2d' | '3d')}>
              <option value="2d">2D</option><option value="3d">{language === 'zh' ? '3D 正交投影' : '3D orthographic'}</option>
            </select></label>
            {streamMode === '3d' && <>
              <label className="field"><span>{language === 'zh' ? '目录方位角' : 'Catalog azimuth'}: {streamAzimuth}°</span><input aria-label={language === 'zh' ? '目录方位角' : 'Catalog azimuth'} type="range" min="-180" max="180" value={streamAzimuth} onChange={event => setStreamAzimuth(Number(event.target.value))} /></label>
              <label className="field"><span>{language === 'zh' ? '目录倾斜角' : 'Catalog tilt'}: {streamTilt}°</span><input aria-label={language === 'zh' ? '目录倾斜角' : 'Catalog tilt'} type="range" min="-90" max="90" value={streamTilt} onChange={event => setStreamTilt(Number(event.target.value))} /></label>
              <p className="catalog-result-note">{language === 'zh' ? '真实三维坐标的正交视图；旋转复用当前已完成历元，不重新下载目录。时间跟随按完整历元更新，不做帧间插值。' : 'Orthographic view of actual 3D positions. Rotation reuses the completed epoch without downloading the catalog. Time following publishes complete epochs without frame interpolation.'}</p>
            </>}
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
            {streamMetadataMaximumBytes > 0 && <p className="catalog-result-note">{language === 'zh'
              ? `当前预算允许每片最多 ${(streamMetadataMaximumBytes/1024/1024).toFixed(1)} MiB 的源元数据；超限时需提高预算。容量包含元数据解析预留，不代表浏览器总内存上限。`
              : `This budget admits up to ${(streamMetadataMaximumBytes/1024/1024).toFixed(1)} MiB of source metadata per shard; increase the budget if a shard exceeds it. Capacity includes metadata parsing reserves, not a total browser memory limit.`}</p>}
            <button className="secondary-button full-width" disabled={!streamCapacity || nameSearchTooShort} onClick={() => {
              requireCatalogAccess('scan')
              setStreamRequest({ key: streamKey, epoch: simulationClock.getJulianDay(), id: (streamRequest?.id ?? 0) + 1, prioritySources })
            }}>{streaming ? t('catalogStreamRefresh') : t('catalogStreamStart')} · {streamCapacity.toLocaleString()}</button>
            {!streamCapacity && <p className="catalog-result-note">{t('catalogStreamNoBudget')}</p>}
            {streaming && !streamAppendRows && streamSelectedFirst && stoppedStreamRequest === streamRequest && <p className="catalog-result-note">{language === 'zh' ? '自动跟随已停止；点击刷新或重新加载可恢复。' : 'Automatic following is stopped; refresh or reload to resume.'}</p>}
            {streaming && <button className="text-button full-width" onClick={() => setStreamRequest(null)}>{t('catalogStreamSample')}</button>}
          </div>}
          <button className="primary-button full-width" disabled={!filtered.length} onClick={() => selectionActions.addCatalogBodies(filtered.slice(0, focusBodyLimit).map(asteroidRecordToBody), true)}>{t('addSelection')} · {Math.min(filtered.length, focusBodyLimit)}</button>
          <button className="secondary-button full-width" disabled={!catalog.manifest || isLoading || nameSearchTooShort} onClick={() => {
            if (catalog.activeResultScanKey === scanKey) selectAllFiltered()
            else void scanEntireCatalog()
          }}>{catalog.activeResultScanKey === scanKey ? t('selectAllCatalog') : `${t('loadAllCatalog')} · ${Math.round(catalog.loadProgress * 100)}%`}</button>
          {selectionScope && <button className="text-button full-width" onClick={catalogActions.clearCatalogSelection}>{t('clearCatalogSelection')} · {selectionScope.count.toLocaleString()}</button>}
        </aside>

        <section className="catalog-map glass-panel">
          <div className="map-caption"><span>{t('catalogModeCaption')}</span><strong>{streaming ? t('catalogStreamSnapshot') : `${Math.floor(pointCloud.positions.length / 2).toLocaleString()} / ${resultTotal.toLocaleString()}`}</strong></div>
          {streaming && catalog.manifest ? <CatalogStreamCanvas onRestarted={resumeAutomaticStream} onStopped={stopAutomaticStream} onSourceSelectionChange={receiveSourceSelection} prioritySources={streamRequest.prioritySources} selectedSources={streamSelections} focusedSource={streamFocus} key={streamRequest.id} manifest={catalog.manifest} filters={catalog.filters} julianDay={streamRequest.epoch} targetJulianDay={streamRetainEpochs ? catalogEpoch : streamRequest.epoch} retainEpochs={streamRetainEpochs} appendRows={streamAppendRows} maximumTemporalDriftAU={streamTemporalBudget} requestedRows={streamLimit} budgetBytes={streamBudget} viewRadiusAU={streamRadius} displayMode={streamDisplay} displayLimit={streamDisplayLimit} mode={streamMode} priority={streamPriority} rotation={streamRotation} /> : pointCloud.positions.length === pointRecords.length * 2 && pointRecords.length ? <CatalogPointCanvas
            records={pointRecords}
            positions={pointCloud.positions}
            viewRadiusAU={catalog.filters.semiMajorAxis[1] || 50}
            ariaLabel={t('catalogPointAria')}
            unavailableLabel={t('catalogRenderUnavailable')}
            retryLabel={t('retry')}
          /> : <div className="empty-state"><span>◎</span><p>{catalog.manifest && !pointCloud.error ? t('loading') : t('unavailable')}</p></div>}
          {pointCloud.progress > 0 && pointCloud.progress < 1 && <div className="compute-progress"><i style={{ width: `${pointCloud.progress * 100}%` }} /></div>}
          {pointCloud.error && <div className="error-banner" role="alert">{pointCloud.error} <button type="button" onClick={pointCloud.retry}>{t('retry')}</button></div>}
          {pointCloud.readyCount > 0 && <p className="catalog-point-epoch" data-testid="catalog-point-epoch" data-utc-jd={pointCloud.computedJulianDay}>
            {t('catalogPointModel')} <time dateTime={julianDayToDate(pointCloud.computedJulianDay).toISOString()}>{julianDayToDate(pointCloud.computedJulianDay).toISOString().replace('T', ' ')}</time>
          </p>}
          {!streaming && sampleTemporalBudget > 0 && pointCloud.readyCount > 0 && <p className="catalog-result-note" data-testid="catalog-temporal-budget" data-drift-au={pointCloud.temporalDriftAU ?? 'unavailable'}>
            {language === 'zh' ? '模型时间位移上限（AU）：' : 'Temporal model displacement limit (AU): '}{pointCloud.temporalDriftAU?.toExponential(3) ?? '—'}
          </p>}
        </section>

        <section className="catalog-results glass-panel">
          <div className="section-heading"><span>{resultTotal.toLocaleString()} {t('results')}</span><small>{(selectionScope?.count ?? selection.selectedIds.filter((id) => id.startsWith('asteroid:')).length).toLocaleString()} {t('selectedCount')}</small></div>
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
              const selected = Boolean(selectionScope) || selection.selectedIds.includes(record.id)
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
          {catalog.manifest && catalog.filters.query && !nameSearchTooShort && searchPageCurrent && searchPage.nextCursor !== null && <button className="load-more" disabled={isLoading} onClick={() => void loadMoreSearchResults()}>{isLoading ? t('loading') : t('loadMore')}</button>}
          {catalog.activeResultScanKey === scanKey && catalog.exactHydrationHasMore && <button className="load-more" disabled={isLoading} onClick={() => void loadNextExactPage()}>{isLoading ? t('loading') : t('loadNextExactPage')}</button>}
        </section>
      </div>
    </div>
  )
}

function RangeFields({ label, minimumLabel, maximumLabel, value, onChange, step }: { label: string; minimumLabel: string; maximumLabel: string; value: [number, number]; onChange: (value: [number, number]) => void; step: string }) {
  return <div className="range-fields"><span>{label}</span><input aria-label={`${label}: ${minimumLabel}`} type="number" value={value[0]} step={step} onChange={(event) => onChange([Number(event.target.value), value[1]])} /><b>—</b><input aria-label={`${label}: ${maximumLabel}`} type="number" value={value[1]} step={step} onChange={(event) => onChange([value[0], Number(event.target.value)])} /></div>
}
