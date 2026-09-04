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

type SearchResult = {
  id: string
  icon: string
  label: string
  detail: string
  keywords: string
  action: () => void
}

const stories = storiesData as Story[]

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { language, t } = useI18n()
  const catalog = catalogStore.useStore()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [onClose])

  const allResults = useMemo<SearchResult[]>(() => {
    const routeSpecs: Array<[AppRoute, string, string, string]> = [
      ['home', '☉', t('home'), t('homeIntro')], ['explorer', '◉', t('explorer'), t('interactive2d')],
      ['catalog', '⌘', t('catalog'), t('catalogKicker')], ['elements', '∷', t('elements'), t('elementsKicker')],
      ['events', '⌁', t('events'), t('eventsKicker')], ['mission', '↗', t('mission'), t('missionKicker')],
      ['stories', '◇', t('stories'), t('storiesDescription')], ['about', 'ⓘ', t('about'), t('evidenceKicker')],
    ]
    const routes = routeSpecs.map(([route, icon, label, detail]) => ({
      id: `route:${route}`, icon, label, detail, keywords: `${route} ${label} ${detail}`.toLowerCase(),
      action: () => uiActions.navigate(route),
    }))
    const bodies = majorBodies.map((body) => ({
      id: `body:${body.id}`, icon: '●', label: bodyDisplayName(body, language), detail: `${t('objectResult')} · ${body.kind}`,
      keywords: `${body.id} ${body.name} ${bodyDisplayName(body, 'en')} ${body.kind} ${satelliteSearchTerms(body)}`.toLowerCase(),
      action: () => {
        selectionActions.setSelectedIds([...new Set([...majorBodies.filter((item) => item.id !== 'sun' && ['earth', 'mars'].includes(item.id)).map((item) => item.id), body.id])].filter((id) => id !== 'sun'))
        selectionActions.focus(body.id)
        uiActions.navigate('explorer')
      },
    }))
    const storyResults = stories.map((story) => ({
      id: `story:${story.id}`, icon: '◇', label: story.title[language], detail: `${t('storyResult')} · ${story.summary[language]}`,
      keywords: `${story.id} ${story.title.en} ${story.title.zh} ${story.summary.en} ${story.summary.zh}`.toLowerCase(),
      action: () => { uiActions.selectStory(story.id, 0); uiActions.navigate('stories') },
    }))
    const glossary = stories.flatMap((story) => (story.glossary ?? []).map((entry) => ({
      id: `term:${story.id}:${entry.term.en}`, icon: '≡', label: entry.term[language], detail: `${t('termResult')} · ${entry.definition[language]}`,
      keywords: `${entry.term.en} ${entry.term.zh} ${entry.definition.en} ${entry.definition.zh}`.toLowerCase(),
      action: () => { uiActions.selectStory(story.id, 0); uiActions.navigate('stories') },
    })))
    const featured = (catalog.manifest?.featured ?? []).map((entry) => ({
      id: `catalog:${entry.id}`, icon: '◆', label: entry.label, detail: `${t('catalogResult')} · ${entry.orbitClassCode}`,
      keywords: `${entry.label} ${entry.shortLabel} ${entry.searchKey} ${entry.permanentNumber ?? ''} ${entry.orbitClassCode}`.toLowerCase(),
      action: () => { catalogActions.patchFilters({ query: entry.permanentNumber ? String(entry.permanentNumber) : entry.label }); uiActions.navigate('catalog') },
    }))
    return [...routes, ...storyResults, ...bodies, ...featured, ...glossary]
  }, [catalog.manifest?.featured, language, t])

  const normalized = query.trim().toLowerCase()
  const results = normalized
    ? allResults.filter((result) => result.keywords.includes(normalized) || result.label.toLowerCase().includes(normalized)).slice(0, 12)
    : allResults.filter((result) => result.id.startsWith('route:') || result.id.startsWith('story:')).slice(0, 12)

  function choose(result: SearchResult) {
    result.action()
    onClose()
  }

  function moveResultFocus(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...(resultsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const index = buttons.indexOf(event.currentTarget)
    if (index < 0 || !buttons.length) return
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }

  function openResultFromInput(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
    const buttons = [...(resultsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    if (!buttons.length) return
    event.preventDefault()
    const target = event.key === 'ArrowUp' ? buttons[buttons.length - 1] : buttons[0]
    if (event.key === 'Enter') target.click()
    else target.focus()
  }

  return <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="command-palette glass-panel" role="dialog" aria-modal="true" aria-labelledby="command-title">
      <header><span id="command-title">{t('globalSearch')}</span><div><kbd>Esc</kbd><button aria-label={t('dismiss')} onClick={onClose}>×</button></div></header>
      <label><span className="sr-only">{t('globalSearch')}</span><i aria-hidden="true">⌕</i><input ref={inputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={openResultFromInput} placeholder={t('globalSearchPlaceholder')} /></label>
      <div ref={resultsRef} className="command-results" role="listbox" aria-label={t('searchResults')}>
        {results.map((result) => <button role="option" aria-selected={false} key={result.id} onClick={() => choose(result)} onKeyDown={moveResultFocus}><em>{result.icon}</em><span><strong>{result.label}</strong><small>{result.detail}</small></span><b>↗</b></button>)}
        {normalized && <button role="option" aria-selected={false} className="command-catalog-fallback" onKeyDown={moveResultFocus} onClick={() => {
          catalogActions.patchFilters({ query: query.trim() })
          uiActions.navigate('catalog')
          onClose()
        }}><em>⌘</em><span><strong>{t('searchCatalogFor')} “{query.trim()}”</strong><small>{t('searchCatalogDescription')}</small></span><b>↗</b></button>}
      </div>
      <footer>{t('searchKeyboardHint')}</footer>
    </section>
  </div>
}
