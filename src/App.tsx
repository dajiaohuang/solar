import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react'
import { CatalogPanel } from './components/CatalogPanel'
import { TrajectoryCanvas } from './components/TrajectoryCanvas'
import { TrajectoryCanvas3D } from './components/TrajectoryCanvas3D'
import { BodyTooltip } from './components/BodyTooltip'
import { ConjunctionPanel } from './components/ConjunctionPanel'
import { useConjunctionWorker } from './hooks/useConjunctionWorker'
import './App.css'
import { defaultHistoryOptions, defaultSelectedBodyIds, majorBodies } from './data/majorBodies'
import { SCENE_PRESETS } from './data/presets'
import { decodeUrlState, encodeUrlState } from './lib/urlState'
import { deleteGroup, loadGroups, saveGroup, type StoredGroup } from './lib/storedGroups'
import { exportAsCSV, exportAsJSON } from './lib/dataExport'
import { computeOrbitEllipses, getOrbitalPeriodDays } from './lib/orbitEllipse'
import { computeLagrangePoints, type LagrangePoint } from './lib/lagrange'
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
  { id: 'properties', label: '属性' },
  { id: 'custom', label: '自定义' },
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
  const [timeFormat, setTimeFormat] = useState<'date' | 'julian'>('date')
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('3d')
  const [measuringMode, setMeasuringMode] = useState(false)
  const [measureBodyA, setMeasureBodyA] = useState<BodyId | null>(null)
  const [measureBodyB, setMeasureBodyB] = useState<BodyId | null>(null)
  const [selectedPropertyBodyId, setSelectedPropertyBodyId] = useState<BodyId>('sun')
  const [customForm, setCustomForm] = useState({
    name: '',
    semiMajorAxisAU: '2.5',
    eccentricity: '0.1',
    inclinationDeg: '5',
    ascendingNodeDeg: '80',
    argPeriapsisDeg: '30',
    meanAnomalyDeg: '0',
    color: '#ff9944',
  })
  const [showEcliptic, setShowEcliptic] = useState(false)
  const [showLagrange, setShowLagrange] = useState(false)
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
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [hoveredBody, setHoveredBody] = useState<{ body: CelestialBody; distance: number; x: number; y: number } | null>(null)
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

  const resetViewTransform = () => {
    setZoomLevel(1)
    setViewOffsetAU({ x: 0, y: 0 })
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        return
      }

      switch (event.key) {
        case ' ':
          event.preventDefault()
          setIsPlaying((value) => !value)
          break
        case 'r':
        case 'R':
          setSimOffsetDays(0)
          resetViewTransform()
          break
        case 'Escape':
          setMeasuringMode(false)
          setMeasureBodyA(null)
          setMeasureBodyB(null)
          break
        case 'f':
        case 'F':
          resetViewTransform()
          break
        case '+':
        case '=':
          setZoomLevel((z) => Math.min(MAX_ZOOM, z + 0.2))
          break
        case '-':
          setZoomLevel((z) => Math.max(MIN_ZOOM, z - 0.2))
          break
        case '1':
        case '2':
        case '3':
        case '4':
        case '5': {
          const idx = Number(event.key) - 1
          if (idx < SCENE_PRESETS.length) {
            const preset = SCENE_PRESETS[idx]
            setIsPlaying(false)
            setSimOffsetDays(preset.julianDay - epochJulianDay)
            setReferenceId(preset.referenceId)
            setSelectedMajorBodyIds(preset.selectedMajorBodyIds)
            setZoomLevel(preset.zoomLevel)
            setHistoryDays(preset.historyDays)
            setViewOffsetAU({ x: 0, y: 0 })
          }

          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const sampleCount = useMemo(
    () => getRecommendedSampleCount(displayedBodies.length, historyDays),
    [displayedBodies.length, historyDays],
  )
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

  const lagrangePoints = useMemo(() => {
    if (!showLagrange || activeReferenceId !== 'sun') {
      return []
    }

    const points: { body: CelestialBody; points: LagrangePoint[] }[] = []

    for (const pos of currentPositions) {
      if (pos.body.kind === 'planet' && pos.body.id !== 'sun') {
        const lp = computeLagrangePoints(pos.body, pos.planarPosition)
        if (lp.length > 0) {
          points.push({ body: pos.body, points: lp })
        }
      }
    }

    return points
  }, [showLagrange, activeReferenceId, currentPositions])

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

  const transitionRef = useRef<number | null>(null)

  const animateTransition = useCallback(
    (fromZoom: number, fromOffset: Vector2, toZoom: number, toOffset: Vector2) => {
      if (transitionRef.current !== null) {
        cancelAnimationFrame(transitionRef.current)
      }

      const duration = 400
      const startTime = performance.now()

      const step = (now: number) => {
        const elapsed = now - startTime
        const t = Math.min(elapsed / duration, 1)
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

        setZoomLevel(fromZoom + (toZoom - fromZoom) * ease)
        setViewOffsetAU({
          x: fromOffset.x + (toOffset.x - fromOffset.x) * ease,
          y: fromOffset.y + (toOffset.y - fromOffset.y) * ease,
        })

        if (t < 1) {
          transitionRef.current = requestAnimationFrame(step)
        } else {
          transitionRef.current = null
        }
      }

      transitionRef.current = requestAnimationFrame(step)
    },
    [],
  )

  const handleChangeReference = useCallback(
    (bodyId: BodyId) => {
      if (measuringMode) {
        if (!measureBodyA) {
          setMeasureBodyA(bodyId)
          setMeasureBodyB(null)
        } else if (measureBodyA === bodyId) {
          setMeasureBodyA(null)
        } else {
          setMeasureBodyB(bodyId)
        }

        return
      }

      if (bodyId !== activeReferenceId && bodiesById.has(bodyId)) {
        setReferenceId(bodyId)
        animateTransition(zoomLevel, viewOffsetAU, 1, { x: 0, y: 0 })
      }
    },
    [activeReferenceId, bodiesById, animateTransition, measuringMode, measureBodyA, zoomLevel, viewOffsetAU],
  )

  const handleScreenshot = useCallback(() => {
    const container = stageRef.current
    if (!container) {
      return
    }

    const canvas = container.querySelector('canvas')
    if (!canvas) {
      return
    }

    const dataUrl = canvas.toDataURL('image/png')
    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = `solar-${formatJulianDayAsDate(currentJulianDay).replace(/\//g, '-')}-${referenceId}.png`
    anchor.click()
  }, [currentJulianDay, referenceId])

  const handleHover = useCallback(
    (body: CelestialBody | null, distance: number, x: number, y: number) => {
      if (!body) {
        setHoveredBody(null)
        return
      }

      setHoveredBody({ body, distance, x, y })
    },
    [],
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
                  <strong>
                    {timeFormat === 'date'
                      ? formatJulianDayAsDate(currentJulianDay)
                      : `JD ${currentJulianDay.toFixed(2)}`}
                  </strong>
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

                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={showLagrange}
                    onChange={(event) => setShowLagrange(event.target.checked)}
                  />
                  <span>显示拉格朗日点</span>
                </label>

                {viewMode === '3d' && (
                  <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={showEcliptic}
                      onChange={(event) => setShowEcliptic(event.target.checked)}
                    />
                    <span>显示黄道面</span>
                  </label>
                )}

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

                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => {
                      setMeasuringMode((m) => !m)
                      setMeasureBodyA(null)
                      setMeasureBodyB(null)
                    }}
                    style={measuringMode ? { background: '#334', borderColor: '#68f' } : undefined}
                  >
                    {measuringMode ? '测量中…' : '测量距离'}
                  </button>
                  <button type="button" onClick={handleScreenshot}>
                    截图 PNG
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

          {activeDrawerSection === 'properties' && (
            <div className="drawer-panel">
              <div className="panel-block drawer-section-card">
                <div className="field-header">
                  <span>天体属性</span>
                </div>

                <label className="field">
                  <span>选择天体</span>
                  <select
                    value={selectedPropertyBodyId}
                    onChange={(event) => setSelectedPropertyBodyId(event.target.value)}
                  >
                    {allBodies.map((body) => (
                      <option key={body.id} value={body.id}>
                        {body.name}
                      </option>
                    ))}
                  </select>
                </label>

                {(() => {
                  const body = bodiesById.get(selectedPropertyBodyId)
                  if (!body) {
                    return null
                  }

                  return (
                    <div className="stats-grid drawer-stats" style={{ marginTop: 8 }}>
                      <article className="stat-card">
                        <span>类型</span>
                        <strong>
                          {body.kind === 'star'
                            ? '恒星'
                            : body.kind === 'planet'
                              ? '行星'
                              : body.kind === 'moon'
                                ? '卫星'
                                : body.kind === 'dwarfPlanet'
                                  ? '矮行星'
                                  : '小行星'}
                        </strong>
                      </article>
                      {body.parentId && (
                        <article className="stat-card">
                          <span>环绕</span>
                          <strong>{bodiesById.get(body.parentId)?.name ?? body.parentId}</strong>
                        </article>
                      )}
                      {body.orbit && (
                        <>
                          <article className="stat-card">
                            <span>半长轴</span>
                            <strong>
                              {(body.orbit.model === 'planetaryApprox'
                                ? body.orbit.base.semiMajorAxisAU
                                : body.orbit.semiMajorAxisAU
                              ).toFixed(4)}{' '}
                              AU
                            </strong>
                          </article>
                          <article className="stat-card">
                            <span>离心率</span>
                            <strong>
                              {(body.orbit.model === 'planetaryApprox'
                                ? body.orbit.base.eccentricity
                                : body.orbit.eccentricity
                              ).toFixed(4)}
                            </strong>
                          </article>
                          <article className="stat-card">
                            <span>倾角</span>
                            <strong>
                              {(body.orbit.model === 'planetaryApprox'
                                ? body.orbit.base.inclinationDeg
                                : body.orbit.inclinationDeg
                              ).toFixed(2)}°
                            </strong>
                          </article>
                          <article className="stat-card">
                            <span>轨道周期</span>
                            <strong>{formatDays(getOrbitalPeriodDays(body.orbit))}</strong>
                          </article>
                        </>
                      )}
                      {body.absoluteMagnitude !== undefined && (
                        <article className="stat-card">
                          <span>绝对星等</span>
                          <strong>{body.absoluteMagnitude.toFixed(1)}</strong>
                        </article>
                      )}
                      {body.orbitClassName && (
                        <article className="stat-card">
                          <span>轨道分类</span>
                          <strong>{body.orbitClassName}</strong>
                        </article>
                      )}
                      <article className="stat-card">
                        <span>数据来源</span>
                        <strong>{body.source}</strong>
                      </article>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {activeDrawerSection === 'custom' && (
            <div className="drawer-panel">
              <div className="panel-block drawer-section-card">
                <div className="field-header">
                  <span>创建自定义天体</span>
                </div>

                <p className="catalog-summary" style={{ marginBottom: 8 }}>
                  输入开普勒轨道根数创建一个虚拟天体并加入视图。创建后可在天体列表中选中等操作。
                </p>

                <label className="field">
                  <span>名称</span>
                  <input
                    type="text"
                    value={customForm.name}
                    onChange={(event) => setCustomForm((f) => ({ ...f, name: event.target.value }))}
                    placeholder="例如：我的彗星"
                  />
                </label>

                <label className="field">
                  <span>半长轴 (AU)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={customForm.semiMajorAxisAU}
                    onChange={(event) => setCustomForm((f) => ({ ...f, semiMajorAxisAU: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>离心率</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="0.99"
                    value={customForm.eccentricity}
                    onChange={(event) => setCustomForm((f) => ({ ...f, eccentricity: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>倾角 (°)</span>
                  <input
                    type="number"
                    step="1"
                    value={customForm.inclinationDeg}
                    onChange={(event) => setCustomForm((f) => ({ ...f, inclinationDeg: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>升交点黄经 (°)</span>
                  <input
                    type="number"
                    step="1"
                    value={customForm.ascendingNodeDeg}
                    onChange={(event) => setCustomForm((f) => ({ ...f, ascendingNodeDeg: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>近日点幅角 (°)</span>
                  <input
                    type="number"
                    step="1"
                    value={customForm.argPeriapsisDeg}
                    onChange={(event) => setCustomForm((f) => ({ ...f, argPeriapsisDeg: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>平近点角 (°)</span>
                  <input
                    type="number"
                    step="1"
                    value={customForm.meanAnomalyDeg}
                    onChange={(event) => setCustomForm((f) => ({ ...f, meanAnomalyDeg: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>颜色</span>
                  <input
                    type="color"
                    value={customForm.color}
                    onChange={(event) => setCustomForm((f) => ({ ...f, color: event.target.value }))}
                  />
                </label>

                <div className="button-row">
                  <button
                    type="button"
                    disabled={!customForm.name.trim()}
                    onClick={() => {
                      const id = `custom:${Date.now()}`
                      const a = Number(customForm.semiMajorAxisAU) || 2.5
                      const periodDays = 365.25 * Math.sqrt(a * a * a)

                      const body: CelestialBody = {
                        id,
                        name: customForm.name.trim(),
                        shortName: customForm.name.trim(),
                        kind: 'asteroid',
                        color: customForm.color,
                        size: 3,
                        source: 'jpl-sbdb',
                        isCatalogBody: true,
                        orbit: {
                          model: 'keplerian',
                          epochJd: epochJulianDay,
                          semiMajorAxisAU: a,
                          eccentricity: Number(customForm.eccentricity) || 0,
                          inclinationDeg: Number(customForm.inclinationDeg) || 0,
                          ascendingNodeDeg: Number(customForm.ascendingNodeDeg) || 0,
                          argPeriapsisDeg: Number(customForm.argPeriapsisDeg) || 0,
                          meanAnomalyDeg: Number(customForm.meanAnomalyDeg) || 0,
                          meanMotionDegPerDay: 360 / periodDays,
                        },
                      }

                      setLoadedCatalogBodies((prev) => ({ ...prev, [id]: body }))
                      setSelectedCatalogIds((prev) => dedupeIds([...prev, id]))
                      setActiveDrawerSection('loaded')
                    }}
                  >
                    创建天体
                  </button>
                </div>

                {Object.keys(loadedCatalogBodies).filter((id) => id.startsWith('custom:')).length > 0 && (
                  <div className="catalog-toolbar" style={{ marginTop: 10 }}>
                    <span className="catalog-hint">
                      已创建 {Object.keys(loadedCatalogBodies).filter((id) => id.startsWith('custom:')).length} 个自定义天体
                    </span>
                  </div>
                )}
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

      <section ref={stageRef} className="fullscreen-stage">
        <div className="stage-topbar">
          <button type="button" className="drawer-toggle-button" onClick={() => setDrawerOpen(true)}>
            菜单
          </button>

          <div className="compact-stats">
            <span>参考点 {referenceBody.name}{splitMode ? ` / ${splitReferenceBody.name}` : ''}</span>
            <span
              style={{ cursor: 'pointer' }}
              title="点击切换日期/儒略日"
              onClick={() => setTimeFormat((f) => (f === 'date' ? 'julian' : 'date'))}
            >
              {timeFormat === 'date'
                ? `日期 ${formatJulianDayAsDate(currentJulianDay)}`
                : `JD ${currentJulianDay.toFixed(2)}`}
            </span>
            <span>倍率 {speedDaysPerSecond} 天/秒</span>
            <span>显示 {displayedBodies.length} 个</span>
            {measuringMode && (
              <span style={{ color: '#ffcc44' }}>
                测量: {measureBodyA ? bodiesById.get(measureBodyA)?.name ?? measureBodyA : '双击天体选择'}
                {measureBodyA && !measureBodyB && ' → 双击第二个天体'}
                {measureBodyA && measureBodyB && (() => {
                  const posA = currentPositions.find((p) => p.body.id === measureBodyA)
                  const posB = currentPositions.find((p) => p.body.id === measureBodyB)
                  if (!posA || !posB) {
                    return ''
                  }

                  const dx = posA.planarPosition.x - posB.planarPosition.x
                  const dy = posA.planarPosition.y - posB.planarPosition.y
                  const dist = Math.hypot(dx, dy)

                  return ` → ${bodiesById.get(measureBodyB)?.name ?? measureBodyB} = ${dist.toFixed(4)} AU (${(dist * 149597870.7).toFixed(0)} km)`
                })()}
              </span>
            )}
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
                onHover={handleHover}
                lagrangePoints={lagrangePoints}
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
                onHover={handleHover}
                lagrangePoints={lagrangePoints}
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
                onHover={handleHover}
                lagrangePoints={lagrangePoints}
              />
            ) : (
              <TrajectoryCanvas3D
                referenceBody={referenceBody}
                trajectories={trajectories}
                currentPositions={currentPositions}
                onReferenceChange={handleChangeReference}
                onHover={handleHover}
                lagrangePoints={lagrangePoints}
                showEcliptic={showEcliptic}
              />
            )}
          </div>
        )}

        <div className="stage-bottombar">
          <div className="legend">
            {displayedBodies.slice(0, 28).map((body) => {
              const periodText = body.orbit ? ` (${formatDays(getOrbitalPeriodDays(body.orbit))})` : ''

              return (
                <span
                  key={body.id}
                  className="legend-item"
                  style={{ cursor: 'pointer' }}
                  title={`单击切换参考点为 ${body.name}${periodText ? `，轨道周期${periodText.slice(1, -1)}` : ''}`}
                  onClick={() => handleChangeReference(body.id)}
                >
                  <i style={{ backgroundColor: body.color }} />
                  {body.shortName ?? body.name}{periodText}
                </span>
              )
            })}
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
      <BodyTooltip
        body={hoveredBody?.body ?? null}
        distanceAU={hoveredBody?.distance ?? 0}
        x={hoveredBody?.x ?? 0}
        y={hoveredBody?.y ?? 0}
        visible={hoveredBody !== null}
      />
    </main>
  )
}

export default App
