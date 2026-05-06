import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react'
import { CatalogPanel } from './components/CatalogPanel'
import { TrajectoryCanvas } from './components/TrajectoryCanvas'
import { TrajectoryCanvas3D } from './components/TrajectoryCanvas3D'
import { ConjunctionPanel } from './components/ConjunctionPanel'
import { useConjunctionWorker } from './hooks/useConjunctionWorker'
import './App.css'
import { defaultHistoryOptions, defaultSelectedBodyIds, majorBodies } from './data/majorBodies'
import { SCENE_PRESETS } from './data/presets'
import { decodeUrlState, encodeUrlState } from './lib/urlState'
import { deleteGroup, loadGroups, saveGroup, type StoredGroup } from './lib/storedGroups'
import { exportAsCSV, exportAsJSON } from './lib/dataExport'
import { computeOrbitEllipses } from './lib/orbitEllipse'
import { useTrajectoryWorker } from './hooks/useTrajectoryWorker'
import {
  asteroidRecordToBody,
  loadAsteroidChunk,
  loadAsteroidManifest,
  loadAsteroidSectionPreviousPage,
  loadAsteroidSearchBucket,
  loadAsteroidSectionPage,
  normalizeSearchText,
} from './lib/catalogLoader'
import { dateToJulianDay, formatJulianDayAsDate, julianDayToDate, todayJulianDay } from './lib/julianDate'
import { getSuggestedViewRadius } from './lib/referenceFrame'
import { getRecommendedSampleCount } from './lib/trajectory'
import { SVG_PADDING, SVG_SIZE, createProjection, unprojectPoint } from './lib/viewProjection'
import type {
  AsteroidIndexEntry,
  AsteroidManifest,
  AsteroidRecord,
  AsteroidSectionCursor,
  BodyId,
  CelestialBody,
  Vector2,
} from './types'

const PRESET_SELECTIONS: Record<'inner' | 'outer' | 'dwarfs' | 'all', BodyId[]> = {
  inner: ['mercury', 'venus', 'earth', 'moon', 'mars'],
  outer: ['jupiter', 'saturn', 'uranus', 'neptune'],
  dwarfs: ['ceres', 'pluto', 'eris', 'haumea', 'makemake'],
  all: defaultSelectedBodyIds,
}

const DRAWER_SECTIONS = [
  { id: 'overview', label: '概览' },
  { id: 'controls', label: '控制' },
  { id: 'major', label: '主要天体' },
  { id: 'asteroids', label: '小行星' },
  { id: 'conjunctions', label: '交会' },
  { id: 'loaded', label: '已载入' },
] as const

const SECTION_PAGE_SIZE = 36
const CATALOG_WINDOW_MAX = 108
const MIN_ZOOM = 0.4
const MAX_ZOOM = 4

type CatalogWindowPage = {
  records: AsteroidRecord[]
  startCursor: AsteroidSectionCursor
  endCursor: AsteroidSectionCursor
}

function formatDays(days: number) {
  if (days >= 365) {
    return `${(days / 365).toFixed(days >= 3650 ? 0 : 1)} 年`
  }

  return `${Math.round(days)} 天`
}

function dedupeIds(ids: BodyId[]) {
  return [...new Set(ids)]
}

function isCursorAtStart(cursor: AsteroidSectionCursor) {
  return cursor.chunkIndex === 0 && cursor.recordOffset === 0
}

function isCursorAtEnd(cursor: AsteroidSectionCursor, manifest: AsteroidManifest | null) {
  return !manifest || cursor.chunkIndex >= manifest.chunkCount
}

function trimPagesToRecordLimit(pages: CatalogWindowPage[], direction: 'start' | 'end') {
  const nextPages = [...pages]
  let totalRecords = nextPages.reduce((sum, page) => sum + page.records.length, 0)

  while (nextPages.length > 1 && totalRecords > CATALOG_WINDOW_MAX) {
    const removedPage = direction === 'start' ? nextPages.shift() : nextPages.pop()
    totalRecords -= removedPage?.records.length ?? 0
  }

  return nextPages
}

function App() {
  const initialUrl = useMemo(() => decodeUrlState(), [])
  const [epochJulianDay] = useState(() => todayJulianDay())
  const [referenceId, setReferenceId] = useState<BodyId>(initialUrl.ref ?? 'sun')
  const [selectedMajorBodyIds, setSelectedMajorBodyIds] = useState<BodyId[]>(
    initialUrl.bodies ?? defaultSelectedBodyIds,
  )
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<BodyId[]>([])
  const [historyDays, setHistoryDays] = useState(initialUrl.history ?? 365)
  const [speedDaysPerSecond, setSpeedDaysPerSecond] = useState(initialUrl.speed ?? 120)
  const [zoomLevel, setZoomLevel] = useState(initialUrl.zoom ?? 1)
  const [viewOffsetAU, setViewOffsetAU] = useState<Vector2>({ x: 0, y: 0 })
  const [simOffsetDays, setSimOffsetDays] = useState(initialUrl.offset ?? 0)
  const [splitMode, setSplitMode] = useState(false)
  const [splitReferenceId, setSplitReferenceId] = useState<BodyId>('earth')
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('3d')
  const [showOrbitEllipses, setShowOrbitEllipses] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)
  const [manifest, setManifest] = useState<AsteroidManifest | null>(null)
  const [searchText, setSearchText] = useState(initialUrl.search ?? '')
  const [orbitClassFilter, setOrbitClassFilter] = useState(initialUrl.filter ?? 'MBA')
  const [searchBucketEntries, setSearchBucketEntries] = useState<AsteroidIndexEntry[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [loadedCatalogBodies, setLoadedCatalogBodies] = useState<Record<BodyId, CelestialBody>>({})
  const [savedGroups, setSavedGroups] = useState<Record<string, StoredGroup>>(() => loadGroups())
  const [groupNameInput, setGroupNameInput] = useState('')
  const [isSavingGroup, setIsSavingGroup] = useState(false)
  const [conjunctionThresholdAU, setConjunctionThresholdAU] = useState(0.05)
  const [conjunctionWindowDays, setConjunctionWindowDays] = useState(365)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeDrawerSection, setActiveDrawerSection] =
    useState<(typeof DRAWER_SECTIONS)[number]['id']>('controls')
  const [sectionPages, setSectionPages] = useState<CatalogWindowPage[]>([])
  const [isSectionLoading, setIsSectionLoading] = useState(false)

  const loadedCatalogBodiesRef = useRef<Record<BodyId, CelestialBody>>({})
  const selectedCatalogIdsRef = useRef<BodyId[]>([])
  const sectionPagesRef = useRef<CatalogWindowPage[]>([])

  useEffect(() => {
    loadedCatalogBodiesRef.current = loadedCatalogBodies
  }, [loadedCatalogBodies])

  useEffect(() => {
    selectedCatalogIdsRef.current = selectedCatalogIds
  }, [selectedCatalogIds])

  useEffect(() => {
    sectionPagesRef.current = sectionPages
  }, [sectionPages])

  useEffect(() => {
    if (!isPlaying) {
      return
    }

    let lastTime = performance.now()
    let frameId = 0

    const tick = (now: number) => {
      const deltaSeconds = (now - lastTime) / 1000
      lastTime = now
      setSimOffsetDays((previous) => previous + deltaSeconds * speedDaysPerSecond)
      frameId = window.requestAnimationFrame(tick)
    }

    frameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameId)
  }, [isPlaying, speedDaysPerSecond])

  useEffect(() => {
    void loadAsteroidManifest().then((loadedManifest) => {
      if (!loadedManifest) {
        return
      }

      setManifest(loadedManifest)
    })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      const queryString = encodeUrlState({
        ref: referenceId !== 'sun' ? referenceId : undefined,
        bodies: selectedMajorBodyIds,
        offset: simOffsetDays !== 0 ? simOffsetDays : undefined,
        zoom: zoomLevel !== 1 ? zoomLevel : undefined,
        speed: speedDaysPerSecond !== 120 ? speedDaysPerSecond : undefined,
        history: historyDays !== 365 ? historyDays : undefined,
        filter: orbitClassFilter !== 'MBA' ? orbitClassFilter : undefined,
        search: searchText || undefined,
      })

      const nextUrl = queryString
        ? `${window.location.pathname}?${queryString}`
        : window.location.pathname

      window.history.replaceState(null, '', nextUrl)
    }, 500)

    return () => clearTimeout(timer)
  }, [
    referenceId,
    selectedMajorBodyIds,
    simOffsetDays,
    zoomLevel,
    speedDaysPerSecond,
    historyDays,
    orbitClassFilter,
    searchText,
  ])

  const allBodies = useMemo(
    () => [...majorBodies, ...Object.values(loadedCatalogBodies)],
    [loadedCatalogBodies],
  )
  const majorBodyIdSet = useMemo(() => new Set(majorBodies.map((body) => body.id)), [])
  const bodiesById = useMemo(() => new Map(allBodies.map((body) => [body.id, body])), [allBodies])
  const selectedBodyIds = useMemo(
    () => dedupeIds([...selectedMajorBodyIds, ...selectedCatalogIds]),
    [selectedCatalogIds, selectedMajorBodyIds],
  )
  const selectedBodySet = useMemo(() => new Set(selectedBodyIds), [selectedBodyIds])
  const loadedCatalogIdSet = useMemo(() => new Set(Object.keys(loadedCatalogBodies)), [loadedCatalogBodies])
  const normalizedSearchQuery = useMemo(() => normalizeSearchText(searchText), [searchText])
  const sectionEntries = useMemo(() => sectionPages.flatMap((page) => page.records), [sectionPages])
  const sectionHasPrevious = useMemo(() => {
    if (!sectionPages.length) {
      return false
    }

    return !isCursorAtStart(sectionPages[0].startCursor)
  }, [sectionPages])
  const sectionHasNext = useMemo(() => {
    if (!sectionPages.length) {
      return false
    }

    return !isCursorAtEnd(sectionPages[sectionPages.length - 1].endCursor, manifest)
  }, [manifest, sectionPages])

  const syncCatalogWindow = useCallback(
    (pages: CatalogWindowPage[]) => {
      const flatRecords = pages.flatMap((page) => page.records)
      const nextBodies = Object.fromEntries(
        flatRecords.map((record) => [record.id, asteroidRecordToBody(record)]),
      ) as Record<BodyId, CelestialBody>

      for (const id of selectedCatalogIdsRef.current) {
        if (!nextBodies[id] && loadedCatalogBodiesRef.current[id]) {
          nextBodies[id] = loadedCatalogBodiesRef.current[id]
        }
      }

      if (referenceId !== 'sun' && !nextBodies[referenceId] && !majorBodyIdSet.has(referenceId)) {
        setReferenceId('sun')
      }

      setSectionPages(pages)
      setLoadedCatalogBodies(nextBodies)
    },
    [majorBodyIdSet, referenceId],
  )

  useEffect(() => {
    if (!manifest || normalizedSearchQuery || orbitClassFilter === 'all') {
      return
    }

    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) {
        setIsSectionLoading(true)
      }
    })

    void loadAsteroidSectionPage({
      manifest,
      orbitClassCode: orbitClassFilter,
      pageSize: SECTION_PAGE_SIZE,
    })
      .then((page) => {
        if (cancelled) {
          return
        }

        syncCatalogWindow([page])
      })
      .finally(() => {
        if (!cancelled) {
          setIsSectionLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [manifest, normalizedSearchQuery, orbitClassFilter, syncCatalogWindow])

  useEffect(() => {
    if (!manifest || !normalizedSearchQuery) {
      return
    }

    const bucketKey = /^[0-9]/.test(normalizedSearchQuery) ? 'digit' : normalizedSearchQuery[0]
    let cancelled = false

    Promise.resolve().then(() => {
      if (!cancelled) {
        setIsSearching(true)
      }
    })

    void loadAsteroidSearchBucket(bucketKey)
      .then((entries) => {
        if (cancelled) {
          return
        }

        const filtered = entries.filter((entry) => {
          const matchesClass = orbitClassFilter === 'all' || entry.orbitClassCode === orbitClassFilter
          return matchesClass && entry.searchKey.includes(normalizedSearchQuery)
        })

        setSearchBucketEntries(filtered.slice(0, 120))
      })
      .finally(() => {
        if (!cancelled) {
          setIsSearching(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [manifest, normalizedSearchQuery, orbitClassFilter])

  const handleLoadMoreSection = async () => {
    if (!manifest || normalizedSearchQuery || orbitClassFilter === 'all' || isSectionLoading || !sectionHasNext) {
      return
    }

    setIsSectionLoading(true)

    try {
      const currentPages = sectionPagesRef.current
      const currentCursor = currentPages[currentPages.length - 1]?.endCursor
      if (!currentCursor) {
        return
      }

      const page = await loadAsteroidSectionPage({
        manifest,
        orbitClassCode: orbitClassFilter,
        cursor: currentCursor,
        pageSize: SECTION_PAGE_SIZE,
      })

      syncCatalogWindow(trimPagesToRecordLimit([...currentPages, page], 'start'))
    } finally {
      setIsSectionLoading(false)
    }
  }

  const handleLoadPreviousSection = async () => {
    if (!manifest || normalizedSearchQuery || orbitClassFilter === 'all' || isSectionLoading || !sectionHasPrevious) {
      return
    }

    setIsSectionLoading(true)

    try {
      const currentPages = sectionPagesRef.current
      const currentCursor = currentPages[0]?.startCursor
      if (!currentCursor || isCursorAtStart(currentCursor)) {
        return
      }

      const page = await loadAsteroidSectionPreviousPage({
        manifest,
        orbitClassCode: orbitClassFilter,
        cursor: currentCursor,
        pageSize: SECTION_PAGE_SIZE,
      })

      syncCatalogWindow(trimPagesToRecordLimit([page, ...currentPages], 'end'))
    } finally {
      setIsSectionLoading(false)
    }
  }

  const currentJulianDay = epochJulianDay + simOffsetDays
  const quantizedJulianDay = Math.round(currentJulianDay * 4) / 4
  const activeReferenceId = bodiesById.has(referenceId) ? referenceId : 'sun'

  const displayedBodies = useMemo(() => {
    return allBodies.filter((body) => body.id !== activeReferenceId && selectedBodySet.has(body.id))
  }, [activeReferenceId, allBodies, selectedBodySet])

  const suggestedViewRadius = useMemo(() => {
    return getSuggestedViewRadius(
      displayedBodies.map((body) => body.id),
      activeReferenceId,
      bodiesById,
    )
  }, [activeReferenceId, bodiesById, displayedBodies])

  const viewRadiusAU = suggestedViewRadius / zoomLevel
  const referenceBody = bodiesById.get(activeReferenceId) ?? majorBodies[0]
  const sampleCount = useMemo(() => getRecommendedSampleCount(displayedBodies.length), [displayedBodies.length])
  const { currentPositions, trajectories, maxDistance: maxRelativeDistance } = useTrajectoryWorker({
    bodies: displayedBodies,
    resolutionBodies: allBodies,
    referenceId: activeReferenceId,
    centerJulianDay: quantizedJulianDay,
    historyDays,
    sampleCount,
  })

  const effectiveSplitReferenceId = splitMode && splitReferenceId !== activeReferenceId ? splitReferenceId : activeReferenceId
  const {
    currentPositions: splitCurrentPositions,
    trajectories: splitTrajectories,
  } = useTrajectoryWorker({
    bodies: splitMode ? displayedBodies : [],
    resolutionBodies: allBodies,
    referenceId: effectiveSplitReferenceId,
    centerJulianDay: quantizedJulianDay,
    historyDays,
    sampleCount,
  })

  const splitReferenceBody = bodiesById.get(splitReferenceId) ?? majorBodies[0]

  const { events: conjunctionEvents, isComputing: isConjunctionComputing } = useConjunctionWorker({
    bodies: displayedBodies,
    resolutionBodies: allBodies,
    referenceId: activeReferenceId,
    centerJulianDay: quantizedJulianDay,
    windowDays: conjunctionWindowDays,
    thresholdAU: conjunctionThresholdAU,
  })

  const orbitEllipses = useMemo(() => {
    if (!showOrbitEllipses) {
      return []
    }

    return computeOrbitEllipses(displayedBodies, bodiesById, activeReferenceId, quantizedJulianDay)
  }, [showOrbitEllipses, displayedBodies, bodiesById, activeReferenceId, quantizedJulianDay])

  const catalogResults = useMemo(() => {
    if (!manifest) {
      return []
    }

    if (normalizedSearchQuery) {
      return searchBucketEntries
    }

    if (orbitClassFilter === 'all') {
      return manifest.featured
    }

    return sectionEntries
  }, [manifest, normalizedSearchQuery, orbitClassFilter, searchBucketEntries, sectionEntries])

  const toggleCatalogBodySelection = async (entry: Pick<AsteroidIndexEntry, 'id' | 'chunkId'>) => {
    if (selectedCatalogIds.includes(entry.id)) {
      setSelectedCatalogIds((previous) => previous.filter((id) => id !== entry.id))

      if (!sectionEntries.some((record) => record.id === entry.id)) {
        setLoadedCatalogBodies((previous) => {
          const next = { ...previous }
          delete next[entry.id]
          return next
        })
      }

      return
    }

    if (loadedCatalogBodies[entry.id]) {
      setSelectedCatalogIds((previous) => dedupeIds([...previous, entry.id]))
      return
    }

    const chunk = await loadAsteroidChunk(entry.chunkId)
    const match = chunk.find((record) => record.id === entry.id)
    if (!match) {
      return
    }

    const body = asteroidRecordToBody(match)
    setLoadedCatalogBodies((previous) => ({ ...previous, [body.id]: body }))
    setSelectedCatalogIds((previous) => dedupeIds([...previous, body.id]))
  }

  const toggleMajorBody = (bodyId: BodyId) => {
    resetViewTransform()
    setSelectedMajorBodyIds((previous) =>
      previous.includes(bodyId) ? previous.filter((id) => id !== bodyId) : [...previous, bodyId],
    )
  }

  const setPreset = (preset: keyof typeof PRESET_SELECTIONS) => {
    resetViewTransform()
    setSelectedMajorBodyIds(PRESET_SELECTIONS[preset])
  }

  const handleAddCatalogBody = async (entry: AsteroidIndexEntry) => {
    await toggleCatalogBodySelection(entry)
  }

  const handleClearCatalogBodies = () => {
    const catalogIds = new Set(Object.keys(loadedCatalogBodiesRef.current))
    if (catalogIds.has(referenceId)) {
      setReferenceId('sun')
    }

    setLoadedCatalogBodies({})
    setSelectedCatalogIds([])
    setSectionPages([])
  }

  const handleSearchTextChange = (value: string) => {
    setSearchText(value)

    if (!normalizeSearchText(value)) {
      setSearchBucketEntries([])
    }
  }

  const handleOrbitClassFilterChange = (value: string) => {
    setOrbitClassFilter(value)
    setSectionPages([])
  }

  const resetViewTransform = () => {
    setZoomLevel(1)
    setViewOffsetAU({ x: 0, y: 0 })
  }

  const handleChangeReference = useCallback(
    (bodyId: BodyId) => {
      if (bodyId !== activeReferenceId && bodiesById.has(bodyId)) {
        setReferenceId(bodyId)
        resetViewTransform()
      }
    },
    [activeReferenceId, bodiesById],
  )

  const handleCanvasWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault()

      const rect = event.currentTarget.getBoundingClientRect()
      const width = Math.max(rect.width, 1)
      const height = Math.max(rect.height, 1)
      const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }

      const zoomFactor = Math.exp(-event.deltaY * 0.0015)
      const nextZoomLevel = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel * zoomFactor))
      if (Math.abs(nextZoomLevel - zoomLevel) < 1e-4) {
        return
      }

      const oldProjection = createProjection(
        suggestedViewRadius / zoomLevel,
        width,
        height,
        (SVG_PADDING / SVG_SIZE) * width,
        viewOffsetAU,
      )
      const worldPoint = unprojectPoint(pointer, oldProjection)
      const nextProjection = createProjection(
        suggestedViewRadius / nextZoomLevel,
        width,
        height,
        (SVG_PADDING / SVG_SIZE) * width,
        viewOffsetAU,
      )

      setZoomLevel(nextZoomLevel)
      setViewOffsetAU({
        x: worldPoint.x - (pointer.x - nextProjection.centerX) / nextProjection.scale,
        y: worldPoint.y + (pointer.y - nextProjection.centerY) / nextProjection.scale,
      })
    },
    [suggestedViewRadius, viewOffsetAU, zoomLevel],
  )

  const loadedCatalogList = Object.values(loadedCatalogBodies)

  return (
    <main className="fullscreen-app">
      <div className={`drawer-backdrop ${drawerOpen ? 'open' : ''}`} onClick={() => setDrawerOpen(false)} />

      <aside className={`left-drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Solar System Planar Trajectories</p>
            <h1 className="drawer-title">太阳系控制台</h1>
          </div>
          <button type="button" className="drawer-close-button" onClick={() => setDrawerOpen(false)}>
            收起
          </button>
        </div>

        <div className="drawer-tab-row">
          {DRAWER_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`drawer-tab ${activeDrawerSection === section.id ? 'active' : ''}`}
              onClick={() => setActiveDrawerSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>

        <div className="drawer-scroll">
          {activeDrawerSection === 'overview' && (
            <div className="drawer-panel">
              <div className="stats-grid drawer-stats">
                <article className="stat-card">
                  <span>当前参考点</span>
                  <strong>{referenceBody.name}</strong>
                </article>
                <article className="stat-card">
                  <span>模拟时间</span>
                  <strong>{formatDays(simOffsetDays)}</strong>
                </article>
                <article className="stat-card">
                  <span>当前日期</span>
                  <strong>{formatJulianDayAsDate(currentJulianDay)}</strong>
                </article>
                <article className="stat-card">
                  <span>当前最远距离</span>
                  <strong>{maxRelativeDistance.toFixed(maxRelativeDistance < 10 ? 2 : 1)} AU</strong>
                </article>
              </div>

              <div className="panel-block note-block drawer-section-card">
                <h2>说明</h2>
                <p>轨迹区域已全屏显示。左侧抽屉按板块组织控制项，可随时拉出调整参数或浏览小行星分区。</p>
                <p>当选择某个小行星分区时，会自动载入该分区的一批星体；列表滚动接近底部后会继续追加加载。</p>
              </div>
            </div>
          )}

          {activeDrawerSection === 'controls' && (
            <div className="drawer-panel">
              <div className="panel-block drawer-section-card">
                <label className="field">
                  <span>场景</span>
                  <select
                    value=""
                    onChange={(event) => {
                      const preset = SCENE_PRESETS.find((p) => p.id === event.target.value)
                      if (!preset) {
                        return
                      }

                      setIsPlaying(false)
                      setSimOffsetDays(preset.julianDay - epochJulianDay)
                      setReferenceId(preset.referenceId)
                      setSelectedMajorBodyIds(preset.selectedMajorBodyIds)
                      setZoomLevel(preset.zoomLevel)
                      setHistoryDays(preset.historyDays)
                      setViewOffsetAU({ x: 0, y: 0 })
                    }}
                  >
                    <option value="">选择场景…</option>
                    {SCENE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                  <small>选择一个预设场景，自动配置参考点、天体、缩放和轨迹时长</small>
                </label>

                <label className="field">
                  <span>固定参考点</span>
                  <select
                    value={activeReferenceId}
                    onChange={(event) => {
                      setReferenceId(event.target.value)
                      resetViewTransform()
                    }}
                  >
                    {allBodies
                      .filter(
                        (body) =>
                          !body.isCatalogBody || selectedBodySet.has(body.id) || body.id === activeReferenceId,
                      )
                      .map((body) => (
                        <option key={body.id} value={body.id}>
                          {body.name}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="field">
                  <span>轨迹时长</span>
                  <select
                    value={historyDays}
                    onChange={(event) => {
                      setHistoryDays(Number(event.target.value))
                      resetViewTransform()
                    }}
                  >
                    {defaultHistoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>跳转日期</span>
                  <input
                    type="date"
                    value={julianDayToDate(currentJulianDay).toISOString().slice(0, 10)}
                    onChange={(event) => {
                      const date = new Date(event.target.value)
                      if (Number.isNaN(date.getTime())) {
                        return
                      }

                      setIsPlaying(false)
                      setSimOffsetDays(dateToJulianDay(date) - epochJulianDay)
                    }}
                  />
                </label>
              </div>

              <div className="panel-block drawer-section-card">
                <div className="field">
                  <div className="field-header">
                    <span>时间倍率</span>
                    <strong>{speedDaysPerSecond} 天/秒</strong>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="720"
                    step="10"
                    value={speedDaysPerSecond}
                    onChange={(event) => setSpeedDaysPerSecond(Number(event.target.value))}
                  />
                </div>

                <div className="field">
                  <div className="field-header">
                    <span>缩放倍率</span>
                    <strong>{zoomLevel.toFixed(1)}x</strong>
                  </div>
                  <input
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step="0.1"
                    value={zoomLevel}
                    onChange={(event) => setZoomLevel(Number(event.target.value))}
                  />
                  <small>轨迹部分全屏显示，缩放更适合用于观察某一类小天体的局部结构。</small>
                </div>

                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={splitMode}
                    disabled={viewMode === '3d'}
                    onChange={(event) => setSplitMode(event.target.checked)}
                  />
                  <span>对比模式（分屏）</span>
                </label>

                {splitMode && (
                  <label className="field">
                    <span>对比参考点</span>
                    <select
                      value={splitReferenceId}
                      onChange={(event) => setSplitReferenceId(event.target.value)}
                    >
                      {allBodies
                        .filter(
                          (body) =>
                            !body.isCatalogBody || selectedBodySet.has(body.id) || body.id === splitReferenceId,
                        )
                        .map((body) => (
                          <option key={body.id} value={body.id}>
                            {body.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}

                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={showOrbitEllipses}
                    onChange={(event) => setShowOrbitEllipses(event.target.checked)}
                  />
                  <span>显示完整轨道椭圆</span>
                </label>

                <div className="button-row">
                  <button type="button" onClick={() => setIsPlaying((value) => !value)}>
                    {isPlaying ? '暂停' : '继续'}
                  </button>
                  <button type="button" onClick={() => setSimOffsetDays(0)}>
                    回到起点
                  </button>
                  <button type="button" onClick={resetViewTransform}>
                    重置缩放
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode((mode) => (mode === '2d' ? '3d' : '2d'))}
                  >
                    {viewMode === '2d' ? '3D 视图' : '2D 视图'}
                  </button>
                </div>

                <div className="button-row">
                  <button
                    type="button"
                    disabled={!trajectories.length}
                    onClick={() =>
                      exportAsJSON({ currentPositions, trajectories, maxDistance: maxRelativeDistance })
                    }
                  >
                    导出 JSON
                  </button>
                  <button
                    type="button"
                    disabled={!trajectories.length}
                    onClick={() =>
                      exportAsCSV({ currentPositions, trajectories, maxDistance: maxRelativeDistance })
                    }
                  >
                    导出 CSV
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeDrawerSection === 'major' && (
            <div className="drawer-panel">
              <div className="panel-block drawer-section-card">
                <div className="button-row preset-row">
                  <button type="button" onClick={() => setPreset('inner')}>
                    内行星
                  </button>
                  <button type="button" onClick={() => setPreset('outer')}>
                    外行星
                  </button>
                  <button type="button" onClick={() => setPreset('dwarfs')}>
                    矮行星
                  </button>
                </div>

                <div className="button-row preset-row">
                  <button type="button" onClick={() => setPreset('all')}>
                    主要天体全选
                  </button>
                </div>
              </div>

              <div className="panel-block drawer-section-card">
                <div className="field-header">
                  <span>主要天体</span>
                  <strong>{displayedBodies.length} 个</strong>
                </div>

                <div className="chip-grid">
                  {majorBodies.filter((body) => body.id !== 'sun').map((body) => {
                    const isSelected = selectedBodySet.has(body.id)
                    const isReference = body.id === activeReferenceId

                    return (
                      <button
                        key={body.id}
                        type="button"
                        className={`body-chip ${isSelected ? 'selected' : ''} ${isReference ? 'disabled' : ''}`}
                        onClick={() => toggleMajorBody(body.id)}
                        disabled={isReference}
                        style={{ '--chip-color': body.color } as CSSProperties}
                      >
                        <span className="chip-dot" />
                        {body.name}
                        {isReference ? '（参考）' : ''}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="panel-block drawer-section-card">
                <div className="field-header">
                  <span>自定义组</span>
                  <strong>{Object.keys(savedGroups).length} 组</strong>
                </div>

                {isSavingGroup ? (
                  <div className="field" style={{ marginTop: 8 }}>
                    <input
                      type="text"
                      value={groupNameInput}
                      onChange={(event) => setGroupNameInput(event.target.value)}
                      placeholder="输入组名…"
                      autoFocus
                    />
                    <div className="button-row" style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        disabled={!groupNameInput.trim()}
                        onClick={() => {
                          const name = groupNameInput.trim()
                          if (!name) {
                            return
                          }

                          saveGroup(name, selectedMajorBodyIds, selectedCatalogIds)
                          setSavedGroups(loadGroups())
                          setGroupNameInput('')
                          setIsSavingGroup(false)
                        }}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGroupNameInput('')
                          setIsSavingGroup(false)
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setIsSavingGroup(true)}>
                    保存当前选择
                  </button>
                )}

                {Object.keys(savedGroups).length > 0 && (
                  <div className="chip-grid" style={{ marginTop: 8 }}>
                    {Object.entries(savedGroups).map(([name, group]) => (
                      <div key={name} className="button-row" style={{ gap: 4 }}>
                        <button
                          type="button"
                          className="body-chip"
                          onClick={() => {
                            setSelectedMajorBodyIds(group.majorBodyIds)
                            if (group.catalogBodyIds.length > 0) {
                              for (const id of group.catalogBodyIds) {
                                if (!loadedCatalogBodies[id]) {
                                  void (async () => {
                                    const idxEntry = { id, chunkId: `body:${id}` }
                                    await toggleCatalogBodySelection(idxEntry)
                                  })()
                                }
                              }

                              setSelectedCatalogIds((previous) =>
                                dedupeIds([...previous, ...group.catalogBodyIds]),
                              )
                            }

                            resetViewTransform()
                          }}
                        >
                          {name}
                          <span className="result-meta" style={{ marginLeft: 6 }}>
                            {group.majorBodyIds.length + group.catalogBodyIds.length} 个
                          </span>
                        </button>
                        <button
                          type="button"
                          className="chip-dot"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#888',
                            padding: '2px 4px',
                          }}
                          onClick={() => {
                            deleteGroup(name)
                            setSavedGroups(loadGroups())
                          }}
                          title={`删除 ${name}`}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeDrawerSection === 'asteroids' && (
            <div className="drawer-panel">
              <div className="drawer-section-card">
                <CatalogPanel
                  manifest={manifest}
                  searchText={searchText}
                  orbitClassFilter={orbitClassFilter}
                  results={catalogResults}
                  selectedIds={selectedBodySet}
                  isSearching={isSearching}
                  isSectionLoading={isSectionLoading}
                  hasMore={!normalizedSearchQuery && orbitClassFilter !== 'all' && sectionHasNext}
                  hasPrevious={!normalizedSearchQuery && orbitClassFilter !== 'all' && sectionHasPrevious}
                  loadedCatalogCount={loadedCatalogList.length}
                  loadedIds={loadedCatalogIdSet}
                  onSearchTextChange={handleSearchTextChange}
                  onOrbitClassFilterChange={handleOrbitClassFilterChange}
                  onAddResult={handleAddCatalogBody}
                  onRemoveLoadedCatalogBodies={handleClearCatalogBodies}
                  onLoadPrevious={handleLoadPreviousSection}
                  onLoadMore={handleLoadMoreSection}
                />
              </div>
            </div>
          )}

          {activeDrawerSection === 'conjunctions' && (
            <div className="drawer-panel">
              <div className="drawer-section-card">
                <ConjunctionPanel
                  events={conjunctionEvents}
                  isComputing={isConjunctionComputing}
                  thresholdAU={conjunctionThresholdAU}
                  windowDays={conjunctionWindowDays}
                  bodyCount={displayedBodies.length}
                  onThresholdChange={setConjunctionThresholdAU}
                  onWindowDaysChange={setConjunctionWindowDays}
                  onJumpToEvent={(julianDay) => {
                    setIsPlaying(false)
                    setSimOffsetDays(julianDay - epochJulianDay)
                  }}
                />
              </div>
            </div>
          )}

          {activeDrawerSection === 'loaded' && (
            <div className="drawer-panel">
              <div className="panel-block drawer-section-card">
                <div className="field-header">
                  <span>已载入小天体</span>
                  <strong>{loadedCatalogList.length} 个</strong>
                </div>

                <button type="button" onClick={handleClearCatalogBodies} disabled={!loadedCatalogList.length}>
                  清空当前小行星会话
                </button>

                <div className="chip-grid">
                  {loadedCatalogList.length ? (
                    loadedCatalogList.map((body) => {
                      const isSelected = selectedBodySet.has(body.id)
                      const isReference = body.id === activeReferenceId

                      return (
                        <button
                          key={body.id}
                          type="button"
                          className={`body-chip ${isSelected ? 'selected' : ''} ${isReference ? 'disabled' : ''}`}
                          onClick={() => {
                            void toggleCatalogBodySelection({ id: body.id, chunkId: `body:${body.id}` })
                          }}
                          disabled={isReference}
                          style={{ '--chip-color': body.color } as CSSProperties}
                        >
                          <span className="chip-dot" />
                          {body.shortName ?? body.name}
                        </button>
                      )
                    })
                  ) : (
                    <div className="catalog-empty">选择某个分区或搜索并点击结果后，已载入的小天体会显示在这里。</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      <section className="fullscreen-stage">
        <div className="stage-topbar">
          <button type="button" className="drawer-toggle-button" onClick={() => setDrawerOpen(true)}>
            菜单
          </button>

          <div className="compact-stats">
            <span>参考点 {referenceBody.name}{splitMode ? ` / ${splitReferenceBody.name}` : ''}</span>
            <span>日期 {formatJulianDayAsDate(currentJulianDay)}</span>
            <span>倍率 {speedDaysPerSecond} 天/秒</span>
            <span>显示 {displayedBodies.length} 个</span>
          </div>
        </div>

        {splitMode && viewMode === '2d' ? (
          <div className="split-stage" style={{ display: 'flex', flex: 1, flexDirection: 'row' }}>
            <div className="stage-canvas-shell" style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,0.1)' }} onWheel={handleCanvasWheel}>
              <TrajectoryCanvas
                referenceBody={referenceBody}
                trajectories={trajectories}
                currentPositions={currentPositions}
                viewRadiusAU={viewRadiusAU}
                viewOffsetAU={viewOffsetAU}
                showOrbits={showOrbitEllipses}
                orbitEllipses={orbitEllipses}
                onReferenceChange={handleChangeReference}
              />
            </div>
            <div className="stage-canvas-shell" style={{ flex: 1 }} onWheel={handleCanvasWheel}>
              <TrajectoryCanvas
                referenceBody={splitReferenceBody}
                trajectories={splitTrajectories}
                currentPositions={splitCurrentPositions}
                viewRadiusAU={viewRadiusAU}
                viewOffsetAU={viewOffsetAU}
                showOrbits={false}
                orbitEllipses={[]}
                onReferenceChange={handleChangeReference}
              />
            </div>
          </div>
        ) : (
          <div className="stage-canvas-shell" onWheel={viewMode === '2d' ? handleCanvasWheel : undefined}>
            {viewMode === '2d' ? (
              <TrajectoryCanvas
                referenceBody={referenceBody}
                trajectories={trajectories}
                currentPositions={currentPositions}
                viewRadiusAU={viewRadiusAU}
                viewOffsetAU={viewOffsetAU}
                showOrbits={showOrbitEllipses}
                orbitEllipses={orbitEllipses}
                onReferenceChange={handleChangeReference}
              />
            ) : (
              <TrajectoryCanvas3D
                referenceBody={referenceBody}
                trajectories={trajectories}
                currentPositions={currentPositions}
                onReferenceChange={handleChangeReference}
              />
            )}
          </div>
        )}

        <div className="stage-bottombar">
          <div className="legend">
            {displayedBodies.slice(0, 28).map((body) => (
              <span
                key={body.id}
                className="legend-item"
                style={{ cursor: 'pointer' }}
                title={`双击切换参考点为 ${body.name}`}
                onClick={() => handleChangeReference(body.id)}
              >
                <i style={{ backgroundColor: body.color }} />
                {body.shortName ?? body.name}
              </span>
            ))}
            {activeReferenceId === 'earth' && displayedBodies.some((b) => b.orbitClassCode && ['APO', 'ATE', 'AMO', 'ATI'].includes(b.orbitClassCode)) && (
              <span className="legend-item" title="NEO 距离热力图：红=近，蓝=远">
                <i
                  style={{
                    background: 'linear-gradient(to right, #ff4444, #ffcc00, #4466ff)',
                    width: 48,
                    borderRadius: 2,
                  }}
                />
                NEO 距离
              </span>
            )}
          </div>
          <p className="stage-footer-copy">轨迹全屏显示。左侧抽屉可切换概览、控制、主要天体、小行星和已载入分区。</p>
        </div>
      </section>
    </main>
  )
}

export default App
