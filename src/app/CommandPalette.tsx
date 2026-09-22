import { useEffect, useMemo, useRef, useState } from 'react'
import storiesData from '../content/stories/stories.json'
import type { Story } from '../content/stories/types'
import { majorBodies } from '../data/majorBodies'
import { satelliteSearchTerms } from '../data/satelliteIdentities'
import { useI18n } from '../i18n/context'
import { bodyDisplayName } from '../lib/bodyNames'
import { catalogActions, catalogStore } from '../state/catalog-store'
import { selectionActions } from '../state/selection-store'
import { uiActions, type AppRoute } from '../state/ui-store'
import { availabilityAttributes, bodyAvailability, routeAvailability, storyAvailability, type Availability } from '../lib/productAvailability'
import { availabilityActions } from '../state/availability-store'

type SearchResult = {
  id: string
  icon: string
  label: string
  detail: string
  keywords: string
  availability: Availability
  action: () => void
}

const stories = storiesData as Story[]

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { language, t } = useI18n()
  const featuredEntries = catalogStore.useStore(state => state.manifest?.featured)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [onClose])

  const allResults = useMemo<SearchResult[]>(() => {
    const routeSpecs: Array<[AppRoute, string, string, string]> = [
      ['home', '☉', t('home'), t('homeIntro')], ['explorer', '◉', t('explorer'), t('searchExplorerDescription')],
      ['catalog', '⌘', t('catalog'), t('searchCatalogDescription')], ['elements', '∷', t('elements'), t('searchElementsDescription')],
      ['events', '⌁', t('events'), t('searchEventsDescription')], ['mission', '↗', t('mission'), t('searchMissionDescription')],
      ['stories', '◇', t('stories'), t('storiesDescription')], ['about', 'ⓘ', t('about'), t('searchEvidenceDescription')],
    ]
    const routes = routeSpecs.map(([route, icon, label, detail]) => ({
      id: `route:${route}`, icon, label, detail, keywords: `${route} ${label} ${detail}`.toLowerCase(),
      availability: routeAvailability(route),
      action: () => uiActions.navigate(route),
    }))
    const bodies = majorBodies.map((body) => ({
      id: `body:${body.id}`, icon: '●', label: bodyDisplayName(body, language), detail: `${t('objectResult')} · ${body.kind}`,
      keywords: `${body.id} ${body.name} ${bodyDisplayName(body, 'en')} ${body.kind} ${satelliteSearchTerms(body)}`.toLowerCase(),
      availability: bodyAvailability(body.id),
      action: () => {
        selectionActions.setSelectedIds([...new Set([...majorBodies.filter((item) => item.id !== 'sun' && ['earth', 'mars'].includes(item.id)).map((item) => item.id), body.id])].filter((id) => id !== 'sun'))
        selectionActions.focus(body.id)
        uiActions.navigate('explorer')
      },
    }))
    const storyResults = stories.map((story) => ({
      id: `story:${story.id}`, icon: '◇', label: story.title[language], detail: `${t('storyResult')} · ${story.summary[language]}`,
      keywords: `${story.id} ${story.title.en} ${story.title.zh} ${story.summary.en} ${story.summary.zh}`.toLowerCase(),
      availability: storyAvailability(story.id),
      action: () => { uiActions.selectStory(story.id, 0); uiActions.navigate('stories') },
    }))
    const glossary = stories.flatMap((story) => (story.glossary ?? []).map((entry) => ({
      id: `term:${story.id}:${entry.term.en}`, icon: '≡', label: entry.term[language], detail: `${t('termResult')} · ${entry.definition[language]}`,
      keywords: `${entry.term.en} ${entry.term.zh} ${entry.definition.en} ${entry.definition.zh}`.toLowerCase(),
      availability: storyAvailability(story.id),
      action: () => { uiActions.selectStory(story.id, 0); uiActions.navigate('stories') },
    })))
    const featured = (featuredEntries ?? []).map((entry) => ({
      id: `catalog:${entry.id}`, icon: '◆', label: entry.label, detail: `${t('catalogResult')} · ${entry.orbitClassCode}`,
      keywords: `${entry.label} ${entry.shortLabel} ${entry.searchKey} ${entry.permanentNumber ?? ''} ${entry.orbitClassCode}`.toLowerCase(),
      availability: routeAvailability('catalog'),
      action: () => { catalogActions.patchFilters({ query: entry.permanentNumber ? String(entry.permanentNumber) : entry.label }); uiActions.navigate('catalog') },
    }))
    return [...routes, ...storyResults, ...bodies, ...featured, ...glossary]
  }, [featuredEntries, language, t])

  const normalized = query.trim().toLowerCase()
  const results = normalized
    ? allResults.filter((result) => result.keywords.includes(normalized) || result.label.toLowerCase().includes(normalized)).slice(0, 12)
    : allResults.filter((result) => (result.id.startsWith('route:') && result.id !== 'route:home') || result.id.startsWith('story:')).slice(0, 12)
  const visibleResults: SearchResult[] = normalized ? [...results, {
    id: 'action:catalog-search', icon: '⌘', label: `${t('searchCatalogFor')} “${query.trim()}”`,
    detail: t('searchCatalogDescription'), keywords: '', availability: routeAvailability('catalog'),
    action: () => { catalogActions.patchFilters({ query: query.trim() }); uiActions.navigate('catalog') },
  }] : results
  const activeIndex = visibleResults.findIndex(result => result.id === activeId)

  useEffect(() => {
    if (activeIndex >= 0) resultsRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
    else if (resultsRef.current) resultsRef.current.scrollTop = 0
  }, [activeIndex, normalized])

  function choose(result: SearchResult) {
    onClose()
    if (availabilityActions.require(result.availability)) result.action()
  }

  function openResultFromInput(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
    if (!visibleResults.length) return
    event.preventDefault()
    if (event.key === 'Enter') choose(visibleResults[Math.max(0, activeIndex)])
    else {
      const nextIndex = activeIndex < 0 ? (event.key === 'ArrowUp' ? visibleResults.length - 1 : 0)
        : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + visibleResults.length) % visibleResults.length
      setActiveId(visibleResults[nextIndex].id)
    }
  }

  return <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="command-palette glass-panel" role="dialog" aria-modal="true" aria-labelledby="command-title">
      <header><span id="command-title">{t('globalSearch')}</span><div><kbd>Esc</kbd><button aria-label={t('dismiss')} onClick={onClose}>×</button></div></header>
      <label><span className="sr-only">{t('globalSearch')}</span><i aria-hidden="true">⌕</i><input ref={inputRef} type="search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" aria-activedescendant={activeIndex < 0 ? undefined : `command-result-${activeIndex}`} value={query} onChange={(event) => { setQuery(event.target.value); setActiveId(null) }} onKeyDown={openResultFromInput} placeholder={t('globalSearchPlaceholder')} /></label>
      <div id="command-results" ref={resultsRef} className="command-results" role="listbox" aria-label={t('searchResults')}>
        {visibleResults.map((result, index) => <button id={`command-result-${index}`} role="option" tabIndex={-1} aria-selected={index === activeIndex} {...availabilityAttributes(result.availability)} className={result.id === 'action:catalog-search' ? 'command-catalog-fallback' : undefined} key={result.id} onMouseDown={event => event.preventDefault()} onClick={() => choose(result)}><em aria-hidden="true">{result.icon}</em><span><strong>{result.label}{!result.availability.available && <small className="full-version-badge">{t('fullVersion')}</small>}</strong><small>{result.detail}</small></span><b aria-hidden="true">↗</b></button>)}
      </div>
      <footer>{t('searchKeyboardHint')}</footer>
    </section>
  </div>
}
