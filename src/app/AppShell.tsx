import { useEffect, useRef, useState } from 'react'
import storiesData from '../content/stories/stories.json'
import { useI18n } from '../i18n/context'
import { bodyDisplayName } from '../lib/bodyNames'
import { catalogStore } from '../state/catalog-store'
import { selectionStore } from '../state/selection-store'
import { uiActions, uiStore, type AppRoute } from '../state/ui-store'
import { missionStore } from '../state/mission-store'
import { FirstRunGuide } from '../features/home/FirstRunGuide'
import { useBodyRegistry } from './bodyRegistry'
import { AppRouteView } from './routes'

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
  const selection = selectionStore.useStore()
  const mission = missionStore.useStore()
  const catalog = catalogStore.useStore()
  const { bodiesById } = useBodyRegistry()
  const { t, language, toggleLanguage } = useI18n()
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const routeContainerRef = useRef<HTMLDivElement | null>(null)
  const previousRouteRef = useRef(ui.route)

  useEffect(() => { document.documentElement.lang = language }, [language])

  useEffect(() => {
    const productName = language === 'zh' ? '太阳系图谱' : 'Solar Atlas'
    let context = t(ui.route === 'home' ? 'home' : ui.route)
    if (ui.route === 'explorer' && selection.focusedId) {
      const body = bodiesById.get(selection.focusedId)
      context = body ? bodyDisplayName(body, language) : selection.focusedId
    } else if (ui.route === 'stories') {
      const story = (storiesData as StorySummary[]).find((item) => item.id === ui.storyId)
      if (story) context = story.title[language]
    } else if (ui.route === 'mission') {
      const departure = bodiesById.get(mission.departureId)
      const arrival = bodiesById.get(mission.arrivalId)
      context = `${departure ? bodyDisplayName(departure, language) : mission.departureId} → ${arrival ? bodyDisplayName(arrival, language) : mission.arrivalId}`
    }
    document.title = ui.route === 'home' ? `${productName} — ${t('tagline')}` : `${context} — ${productName}`
  }, [bodiesById, language, mission.arrivalId, mission.departureId, selection.focusedId, t, ui.route, ui.storyId])

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

  function navigate(route: AppRoute) {
    uiActions.navigate(route)
    setMobileMoreOpen(false)
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
      <button className="brand-lockup" onClick={() => navigate('home')} aria-label={`${t('brand')} · ${t('home')}`}>
        <span className="brand-mark"><i /><b>☉</b></span>
        <span><strong>{t('brand')}</strong><small>{t('tagline')}</small></span>
      </button>
      <nav className="primary-navigation" aria-label={t('primaryNavigation')}>{NAVIGATION.map((item) => <button key={item.route} aria-current={ui.route === item.route ? 'page' : undefined} className={ui.route === item.route ? 'active' : ''} onClick={() => navigate(item.route)}><span>{item.icon}</span>{t(item.label)}</button>)}</nav>
      <div className="header-actions">
        <button className="dataset-pill" onClick={() => navigate('about')} aria-label={`${t('dataset')}: ${catalog.manifest?.version ?? t('noDataset')}`}><i className={catalog.manifest ? 'online' : ''} /><span>{catalog.manifest?.version ?? t('noDataset').toUpperCase()}</span><b>{(catalog.manifest?.datasetMode ?? catalog.mode).toUpperCase()}</b></button>
        <button className="language-button" onClick={toggleLanguage} aria-label={language === 'zh' ? 'Switch to English' : '切换为中文'}>{language === 'zh' ? 'EN' : '中文'}</button>
      </div>
    </header>
    <div className="route-container" ref={routeContainerRef} tabIndex={-1}><AppRouteView route={ui.route} /></div>

    <nav className="mobile-navigation" aria-label={t('mobileNavigation')}>
      {MOBILE_PRIMARY.map((item) => <button key={item.route} aria-current={ui.route === item.route ? 'page' : undefined} className={ui.route === item.route ? 'active' : ''} onClick={() => navigate(item.route)}><span>{item.icon}</span><small>{item.route === 'stories' ? t('learn') : item.route === 'catalog' ? t('search') : t(item.label)}</small></button>)}
      <button aria-expanded={mobileMoreOpen} className={mobileMoreOpen || MOBILE_MORE.some((item) => item.route === ui.route) || ui.route === 'home' ? 'active' : ''} onClick={() => setMobileMoreOpen((value) => !value)}><span>•••</span><small>{t('more')}</small></button>
    </nav>
    {mobileMoreOpen && <div className="mobile-more-menu glass-panel">
      <button className={ui.route === 'home' ? 'active' : ''} onClick={() => navigate('home')}><span>☉</span>{t('home')}</button>
      {MOBILE_MORE.map((item) => <button key={item.route} className={ui.route === item.route ? 'active' : ''} onClick={() => navigate(item.route)}><span>{item.icon}</span>{t(item.label)}</button>)}
    </div>}

    {ui.route === 'explorer' && <FirstRunGuide />}
    {waitingWorker && <aside className="update-banner glass-panel" role="status">
      <div><strong>{t('updateAvailable')}</strong><span>{t('updateDescription')}</span></div>
      <button className="primary-button" onClick={activateUpdate}>{t('refreshNow')}</button>
    </aside>}
    {ui.toast && <div className="toast" role="status">{ui.toast}</div>}
  </div>
}
