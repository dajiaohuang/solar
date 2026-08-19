import { useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/context'
import { catalogActions, catalogStore } from '../../state/catalog-store'
import { DEFAULT_FOCUSED_ID, DEFAULT_SELECTED_IDS, selectionActions } from '../../state/selection-store'
import { DEFAULT_SIMULATION_STATE, simulationActions } from '../../state/simulation-store'
import { uiActions } from '../../state/ui-store'

const FEATURED = ['Ceres', 'Bennu', 'Apophis']

export function WelcomeWorkspace() {
  const { t, language } = useI18n()
  const catalog = catalogStore.useStore()
  const [query, setQuery] = useState('')

  function openToday() {
    selectionActions.setSelectedIds(DEFAULT_SELECTED_IDS)
    selectionActions.focus(DEFAULT_FOCUSED_ID)
    simulationActions.patch({
      ...DEFAULT_SIMULATION_STATE,
      viewOffset: { ...DEFAULT_SIMULATION_STATE.viewOffset },
    })
    simulationActions.resetTime()
    uiActions.navigate('explorer')
  }

  function openStories() {
    uiActions.selectStory('retrograde-mars', 0)
    uiActions.navigate('stories')
  }

  function searchCatalog(searchText: string) {
    const normalized = searchText.trim()
    if (!normalized) return
    catalogActions.patchFilters({ query: normalized })
    uiActions.navigate('catalog')
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    searchCatalog(query)
  }

  return <main className="welcome-workspace">
    <section className="welcome-hero">
      <div className="welcome-orbits" aria-hidden="true">
        <i className="welcome-orbit orbit-a" /><i className="welcome-orbit orbit-b" /><i className="welcome-orbit orbit-c" />
        <b className="welcome-sun">☉</b><b className="welcome-earth" /><b className="welcome-mars" /><b className="welcome-jupiter" />
      </div>
      <div className="welcome-copy">
        <span className="eyebrow">{t('homeKicker')}</span>
        <h1>{t('homeTitle')}</h1>
        <p>{t('homeIntro')}</p>
        <div className="welcome-primary-actions">
          <button className="primary-button" onClick={openToday}>◉ {t('exploreNow')}</button>
          <button className="quiet-button" onClick={openStories}>◇ {t('learnPhenomenon')}</button>
        </div>
      </div>
      <div className="welcome-build-stamp">
        <span>{catalog.manifest?.datasetMode?.toUpperCase() ?? catalog.mode.toUpperCase()}</span>
        <strong>{catalog.manifest?.totalCount.toLocaleString() ?? '—'}</strong>
        <small>{t('objects')}</small>
      </div>
    </section>

    <section className="welcome-paths" aria-label={language === 'zh' ? '开始路径' : 'Starting paths'}>
      <button className="welcome-path glass-panel" onClick={openToday}>
        <em>01</em><span><strong>{t('exploreNow')}</strong><small>{t('exploreNowDesc')}</small></span><b>↗</b>
      </button>
      <button className="welcome-path glass-panel" onClick={openStories}>
        <em>02</em><span><strong>{t('learnPhenomenon')}</strong><small>{t('learnPhenomenonDesc')}</small></span><b>↗</b>
      </button>
      <div className="welcome-path welcome-research glass-panel">
        <em>03</em><span><strong>{t('researchObject')}</strong><small>{t('researchObjectDesc')}</small></span>
        <form onSubmit={submitSearch}>
          <label className="sr-only" htmlFor="welcome-search">{t('researchObject')}</label>
          <input id="welcome-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('researchPlaceholder')} />
          <button type="submit" disabled={!query.trim()} aria-label={t('researchAction')}>⌕</button>
        </form>
      </div>
    </section>

    <section className="welcome-lower-grid">
      <div className="welcome-featured glass-panel">
        <div className="module-heading"><span>{t('featuredObjects')}</span><em>CATALOG</em></div>
        <div>{FEATURED.map((name) => <button key={name} onClick={() => searchCatalog(name)}><span>{name}</span><b>↗</b></button>)}</div>
      </div>
      <div className="welcome-trust glass-panel">
        <article><i className={catalog.manifest ? 'online' : ''} /><span><strong>{t('trustData')}</strong><small>{catalog.manifest?.version ?? t('noDataset')}</small></span></article>
        <article><i /><span><strong>{t('trustModel')}</strong><small>{t('modelRange')}</small></span></article>
        <article><i /><span><strong>{t('trustBoundary')}</strong><small>{t('homeFootnote')}</small></span></article>
        <button onClick={() => uiActions.navigate('about')}>{t('openEvidence')} <b>↗</b></button>
      </div>
    </section>
  </main>
}
