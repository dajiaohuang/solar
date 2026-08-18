import { useEffect } from 'react'
import { useI18n } from '../i18n/context'
import { catalogStore } from '../state/catalog-store'
import { uiActions, uiStore, type AppRoute } from '../state/ui-store'
import { AppRouteView } from './routes'

const NAVIGATION: Array<{ route: AppRoute; icon: string; label: 'explorer' | 'catalog' | 'elements' | 'events' | 'mission' | 'stories' | 'about' }> = [
  { route: 'explorer', icon: '◉', label: 'explorer' },
  { route: 'catalog', icon: '⌘', label: 'catalog' },
  { route: 'elements', icon: '∷', label: 'elements' },
  { route: 'events', icon: '⌁', label: 'events' },
  { route: 'mission', icon: '↗', label: 'mission' },
  { route: 'stories', icon: '◇', label: 'stories' },
  { route: 'about', icon: 'ⓘ', label: 'about' },
]

export function AppShell() {
  const ui = uiStore.useStore()
  const catalog = catalogStore.useStore()
  const { t, language, toggleLanguage } = useI18n()
  useEffect(() => { document.documentElement.lang = language }, [language])
  return <div className="atlas-app">
    <header className="app-header">
      <button className="brand-lockup" onClick={() => uiActions.navigate('explorer')} aria-label={t('brand')}>
        <span className="brand-mark"><i /><b>☉</b></span>
        <span><strong>{t('brand')}</strong><small>{t('tagline')}</small></span>
      </button>
      <nav className="primary-navigation" aria-label="Primary navigation">{NAVIGATION.map((item) => <button key={item.route} className={ui.route === item.route ? 'active' : ''} onClick={() => uiActions.navigate(item.route)}><span>{item.icon}</span>{t(item.label)}</button>)}</nav>
      <div className="header-actions">
        <button className="dataset-pill" onClick={() => uiActions.navigate('about')}><i className={catalog.manifest ? 'online' : ''} /><span>{catalog.manifest?.version ?? 'NO DATASET'}</span><b>{(catalog.manifest?.datasetMode ?? catalog.mode).toUpperCase()}</b></button>
        <button className="language-button" onClick={toggleLanguage}>{language === 'zh' ? 'EN' : '中文'}</button>
      </div>
    </header>
    <div className="route-container"><AppRouteView route={ui.route} /></div>
    <nav className="mobile-navigation" aria-label="Mobile navigation">{NAVIGATION.map((item) => <button key={item.route} className={ui.route === item.route ? 'active' : ''} onClick={() => uiActions.navigate(item.route)}><span>{item.icon}</span><small>{t(item.label)}</small></button>)}</nav>
    {ui.toast && <div className="toast" role="status">{ui.toast}</div>}
  </div>
}
