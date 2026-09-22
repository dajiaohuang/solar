import { useCallback, useEffect, useRef, useState } from 'react'
import storiesData from '../content/stories/stories.json'
import { useI18n } from '../i18n/context'
import { bodyDisplayName } from '../lib/bodyNames'
import { catalogStore } from '../state/catalog-store'
import { selectionStore } from '../state/selection-store'
import { uiActions, uiStore, type AppRoute } from '../state/ui-store'
import { missionStore } from '../state/mission-store'
import { FirstRunGuide } from '../features/home/FirstRunGuide'
import { GuidedStoryOverlay } from '../features/stories/GuidedStoryOverlay'
import { useBodyRegistry } from './bodyRegistry'
import { AppRouteView } from './routes'
import { CommandPalette } from './CommandPalette'
import { PRODUCT_PROFILE, routeAvailability } from '../lib/productAvailability'
import { availabilityActions } from '../state/availability-store'
import { PreviewAvailability } from './PreviewAvailability'

type NavLabel = 'explorer' | 'catalog' | 'elements' | 'events' | 'mission' | 'stories' | 'about'
type NavItem = { route: AppRoute; icon: string; label: NavLabel }
type StorySummary = { id: string; title: { en: string; zh: string } }

const NAVIGATION: NavItem[] = [
  { route: 'explorer', icon: '◉', label: 'explorer' },
  { route: 'catalog', icon: '⌘', label: 'catalog' },
  { route: 'elements', icon: '∷', label: 'elements' },
  { route: 'events', icon: '⌁', label: 'events' },
  { route: 'mission', icon: '↗', label: 'mission' },
  { route: 'stories', icon: '◇', label: 'stories' },
  { route: 'about', icon: 'ⓘ', label: 'about' },
]

const MOBILE_PRIMARY: NavItem[] = [
  NAVIGATION[0],
  NAVIGATION[5],
  NAVIGATION[1],
]

const MOBILE_MORE = NAVIGATION.filter((item) => !MOBILE_PRIMARY.some((primary) => primary.route === item.route))

export function AppShell() {
  const ui = uiStore.useStore()
  const focusedId = selectionStore.useStore(state => state.focusedId)
  const departureId = missionStore.useStore(state => state.departureId)
  const arrivalId = missionStore.useStore(state => state.arrivalId)
  const manifest = catalogStore.useStore(state => state.manifest)
  const datasetMode = catalogStore.useStore(state => state.mode)
  const { bodiesById } = useBodyRegistry()
  const { t, language, toggleLanguage } = useI18n()
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const closeCommand = useCallback(() => setCommandOpen(false), [])
  const routeContainerRef = useRef<HTMLDivElement | null>(null)
  const previousRouteRef = useRef(ui.route)
  const mobileMoreRef = useRef<HTMLDivElement | null>(null)
  const mobileMoreButtonRef = useRef<HTMLButtonElement | null>(null)
  const commandShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'

  useEffect(() => {
    if (!mobileMoreOpen) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && !mobileMoreRef.current?.contains(target) && !mobileMoreButtonRef.current?.contains(target)) setMobileMoreOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      setMobileMoreOpen(false)
      mobileMoreButtonRef.current?.focus()
    }
    const desktop = window.matchMedia('(min-width: 981px)')
    const closeOnDesktop = () => { if (desktop.matches) setMobileMoreOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    desktop.addEventListener('change', closeOnDesktop)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
      desktop.removeEventListener('change', closeOnDesktop)
    }
  }, [mobileMoreOpen])

  useEffect(() => { document.documentElement.lang = language }, [language])

  useEffect(() => {
    const productName = language === 'zh' ? '太阳系图谱' : 'Solar Atlas'
    let context = t(ui.route === 'home' ? 'home' : ui.route)
    if (ui.route === 'explorer' && focusedId) {
      const body = bodiesById.get(focusedId)
      context = body ? bodyDisplayName(body, language) : focusedId
    } else if (ui.route === 'stories') {
      const story = (storiesData as StorySummary[]).find((item) => item.id === ui.storyId)
      if (story) context = story.title[language]
    } else if (ui.route === 'mission') {
      const departure = bodiesById.get(departureId)
      const arrival = bodiesById.get(arrivalId)
      context = `${departure ? bodyDisplayName(departure, language) : departureId} → ${arrival ? bodyDisplayName(arrival, language) : arrivalId}`
    }
    document.title = ui.route === 'home' ? `${productName} — ${t('tagline')}` : `${context} — ${productName}`
  }, [bodiesById, language, arrivalId, departureId, focusedId, t, ui.route, ui.storyId])

  useEffect(() => {
    if (previousRouteRef.current === ui.route) return
    previousRouteRef.current = ui.route
    setMobileMoreOpen(false)
    window.requestAnimationFrame(() => routeContainerRef.current?.focus({ preventScroll: true }))
  }, [ui.route])

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const registration = (event as CustomEvent<ServiceWorkerRegistration>).detail
      if (registration?.waiting) setWaitingWorker(registration.waiting)
    }
    window.addEventListener('solar-atlas-update', onUpdate)
    void navigator.serviceWorker?.getRegistration().then((registration) => {
      if (registration?.waiting) setWaitingWorker(registration.waiting)
    })
    return () => window.removeEventListener('solar-atlas-update', onUpdate)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      const target = event.target as HTMLElement | null
      const isTyping = target?.matches('input, textarea, select, [contenteditable="true"]')
      if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !isTyping)) {
        event.preventDefault()
        setMobileMoreOpen(false)
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function navigate(route: AppRoute) {
    uiActions.navigate(route)
    setMobileMoreOpen(false)
  }

  function availabilityProps(route: AppRoute) {
    return routeAvailability(route).available ? {} : { 'aria-disabled': true as const, 'aria-describedby': 'preview-restriction-description' }
  }

  function activateUpdate() {
    if (!waitingWorker) return
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    })
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  }

  return <div className="atlas-app">
    <header className="app-header">
      <button className="brand-lockup" onClick={() => navigate('explorer')} aria-label={`${t('brand')} · ${t('explorer')}`}>
        <span className="brand-mark"><i /><b>☉</b></span>
        <span><strong>{t('brand')}</strong><small>{t('tagline')}</small></span>
      </button>
      <nav className="primary-navigation" aria-label={t('primaryNavigation')}>{NAVIGATION.map((item) => <button key={item.route} {...availabilityProps(item.route)} aria-current={ui.route === item.route ? 'page' : undefined} className={ui.route === item.route ? 'active' : ''} onClick={() => navigate(item.route)}><span>{item.icon}</span>{t(item.label)}{!routeAvailability(item.route).available && <small className="full-version-badge">{t('fullVersion')}</small>}</button>)}</nav>
      <div className="header-actions">
        {PRODUCT_PROFILE === 'preview' && <button className="preview-profile-button" onClick={availabilityActions.explain}>{t('previewVersion')}</button>}
        <button className="command-button" onClick={event => { event.currentTarget.focus(); setCommandOpen(true) }} aria-label={t('globalSearch')}><span aria-hidden="true">⌕</span><kbd>{commandShortcut}</kbd></button>
        <button className="dataset-pill" onClick={() => navigate('about')} aria-label={`${t('dataset')}: ${manifest?.version ?? t('noDataset')}`}><i className={manifest ? 'online' : ''} /><span>{manifest?.version ?? t('noDataset').toUpperCase()}</span><b>{PRODUCT_PROFILE === 'preview' ? t('previewSample') : (manifest?.datasetMode ?? datasetMode).toUpperCase()}</b></button>
        <button className="language-button" onClick={toggleLanguage} aria-label={language === 'zh' ? 'Switch to English' : '切换为中文'}>{language === 'zh' ? 'EN' : '中文'}</button>
      </div>
    </header>
    <div className="route-container" ref={routeContainerRef} tabIndex={-1} role={ui.route === 'explorer' || ui.route === 'home' ? undefined : 'main'}><AppRouteView route={ui.route} /></div>

    <nav className="mobile-navigation" aria-label={t('mobileNavigation')}>
      {MOBILE_PRIMARY.map((item) => <button key={item.route} {...availabilityProps(item.route)} aria-current={ui.route === item.route ? 'page' : undefined} className={ui.route === item.route ? 'active' : ''} onClick={() => navigate(item.route)}><span>{item.icon}</span><small>{item.route === 'stories' ? t('learn') : item.route === 'catalog' ? t('search') : t(item.label)}</small>{!routeAvailability(item.route).available && <small className="full-version-badge">{t('fullVersion')}</small>}</button>)}
      <button ref={mobileMoreButtonRef} aria-expanded={mobileMoreOpen} aria-controls="mobile-more-menu" className={mobileMoreOpen || MOBILE_MORE.some((item) => item.route === ui.route) || ui.route === 'home' ? 'active' : ''} onClick={() => setMobileMoreOpen((value) => !value)}><span aria-hidden="true">•••</span><small>{t('more')}</small></button>
    </nav>
    {mobileMoreOpen && <div id="mobile-more-menu" ref={mobileMoreRef} className="mobile-more-menu glass-panel" role="navigation" aria-label={t('more')}>
      {MOBILE_MORE.map((item) => <button key={item.route} {...availabilityProps(item.route)} className={ui.route === item.route ? 'active' : ''} onClick={() => navigate(item.route)}><span>{item.icon}</span>{t(item.label)}{!routeAvailability(item.route).available && <small className="full-version-badge">{t('fullVersion')}</small>}</button>)}
    </div>}

    {ui.route === 'explorer' && <FirstRunGuide />}
    <GuidedStoryOverlay key={`${ui.storyId}:${ui.storyGuideOpen ? 'open' : 'closed'}`} />
    {commandOpen && <CommandPalette onClose={closeCommand} />}
    {waitingWorker && <aside className="update-banner glass-panel" role="status">
      <div><strong>{t('updateAvailable')}</strong><span>{t('updateDescription')}</span></div>
      <button className="primary-button" onClick={activateUpdate}>{t('refreshNow')}</button>
    </aside>}
    {ui.toast && <div className="toast" role="status">{ui.toast}</div>}
    <PreviewAvailability />
  </div>
}
