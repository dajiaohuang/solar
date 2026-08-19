import { useState } from 'react'
import storiesData from '../../content/stories/stories.json'
import { useI18n } from '../../i18n/context'
import { dateToJulianDay } from '../../lib/julianDate'
import { encodeCurrentScene } from '../../lib/shareScene'
import { catalogActions } from '../../state/catalog-store'
import { selectionActions } from '../../state/selection-store'
import { simulationActions } from '../../state/simulation-store'
import { uiActions, uiStore, type AppRoute, type ElementPlotMode } from '../../state/ui-store'

type Localized = { en: string; zh: string }
type StoryScene = {
  date: string
  referenceId: string
  bodies: string[]
  historyDays: number
  view: '2d' | '3d'
  route?: AppRoute
  showLagrange?: boolean
  showSpacecraft?: boolean
  filter?: string
  plot?: ElementPlotMode
  aRange?: [number, number]
  eRange?: [number, number]
  qRange?: [number, number]
}
type StoryStep = { stage: string; title: Localized; prompt: Localized; body: Localized; scene: StoryScene }
type Story = {
  id: string
  title: Localized
  summary: Localized
  boundary: Localized
  sources: Array<{ label: string; url: string }>
  steps: StoryStep[]
}
const stories = storiesData as Story[]

export function StoriesWorkspace() {
  const { t, language } = useI18n()
  const ui = uiStore.useStore()
  const [revealedStep, setRevealedStep] = useState<string | null>(null)
  const story = stories.find((item) => item.id === ui.storyId) ?? stories[0]
  const stepIndex = Math.min(ui.storyStep, story.steps.length - 1)
  const step = story.steps[stepIndex]
  const stepKey = `${story.id}:${stepIndex}`
  const explanationOpen = revealedStep === stepKey

  function applyScene(scene: StoryScene) {
    const selectedIds = scene.bodies.filter((id) => id !== 'sun')
    selectionActions.setSelectedIds(selectedIds)
    selectionActions.focus(scene.referenceId !== 'sun' ? scene.referenceId : selectedIds[0] ?? 'sun')
    simulationActions.patch({
      referenceId: scene.referenceId,
      comparisonEnabled: false,
      historyDays: scene.historyDays,
      viewMode: scene.view,
      viewOffset: { x: 0, y: 0 },
      zoom: 1,
      showEcliptic: true,
      showOrbits: false,
      showHillSphere: false,
      showLaplaceSoi: false,
      showLagrange: scene.showLagrange ?? false,
      showSpacecraft: scene.showSpacecraft ?? false,
    })
    if (scene.filter || scene.aRange || scene.eRange || scene.qRange) {
      catalogActions.patchFilters({
        ...(scene.filter ? { orbitClass: scene.filter } : {}),
        ...(scene.aRange ? { semiMajorAxis: scene.aRange } : {}),
        ...(scene.eRange ? { eccentricity: scene.eRange } : {}),
        ...(scene.qRange ? { perihelion: scene.qRange } : {}),
      })
    }
    if (scene.plot) uiActions.setElementPlot(scene.plot)
    simulationActions.seek(dateToJulianDay(new Date(`${scene.date}T12:00:00Z`)))
    uiActions.navigate(scene.route ?? 'explorer')
  }

  async function copyStepLink() {
    await navigator.clipboard.writeText(encodeCurrentScene())
    uiActions.toast(t('storyLinkCopied'))
  }

  function selectStory(id: string) {
    uiActions.selectStory(id, 0)
  }

  function setStep(index: number) {
    uiActions.setStoryStep(Math.max(0, Math.min(story.steps.length - 1, index)))
  }

  return <div className="workspace-page stories-workspace">
    <header className="page-heading"><div><span className="eyebrow">{t('storiesKicker')}</span><h1>{t('stories')}</h1><p>{t('storiesDescription')}</p></div><button className="quiet-button" onClick={copyStepLink}>↗ {t('copyStoryLink')}</button></header>
    <div className="stories-layout">
      <aside className="story-index glass-panel" aria-label={t('stories')}>{stories.map((item, index) => <button aria-current={item.id === story.id ? 'true' : undefined} className={item.id === story.id ? 'active' : ''} key={item.id} onClick={() => selectStory(item.id)}><em>{String(index + 1).padStart(2, '0')}</em><span><strong>{item.title[language]}</strong><small>{item.summary[language]}</small></span></button>)}</aside>
      <section className={`story-hero story-${story.id} glass-panel`}>
        <div className="story-orbit-art" aria-hidden="true"><i className="orbit orbit-one" /><i className="orbit orbit-two" /><i className="orbit orbit-three" /><b className="story-sun">☉</b><b className="story-body-one" /><b className="story-body-two" /></div>
        <div className="story-copy">
          <span className="eyebrow">{step.stage.toUpperCase()} · {stepIndex + 1}/{story.steps.length}</span>
          <h2>{story.title[language]}</h2><h3>{step.title[language]}</h3>
          <div className="story-observation"><strong>{t('storyQuestion')}</strong><p>{step.prompt[language]}</p></div>
          <button className="story-reveal" aria-expanded={explanationOpen} onClick={() => setRevealedStep(explanationOpen ? null : stepKey)}>{explanationOpen ? t('hideExplanation') : t('revealExplanation')} <span>{explanationOpen ? '−' : '+'}</span></button>
          {explanationOpen && <p className="story-explanation">{step.body[language]}</p>}
          <dl><div><dt>{t('dateLabel')}</dt><dd>{step.scene.date}</dd></div><div><dt>{t('frameLabel')}</dt><dd>{step.scene.referenceId}</dd></div><div><dt>{t('windowLabel')}</dt><dd>{step.scene.historyDays.toLocaleString()} {t('days')}</dd></div></dl>
          <button className="primary-button" onClick={() => applyScene(step.scene)}>↗ {t('applyStoryStep')}</button>
        </div>
      </section>
      <aside className="story-evidence glass-panel">
        <div><span className="section-kicker">{t('storyBoundary')}</span><p>{story.boundary[language]}</p></div>
        <div><span className="section-kicker">{t('storySources')}</span>{story.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label}<b>↗</b></a>)}</div>
      </aside>
      <footer className="story-pagination glass-panel"><button disabled={stepIndex === 0} onClick={() => setStep(stepIndex - 1)}>← {t('previous')}</button><div>{story.steps.map((_, index) => <button aria-label={`${index + 1}`} className={index === stepIndex ? 'active' : ''} onClick={() => setStep(index)} key={index} />)}</div><button disabled={stepIndex >= story.steps.length - 1} onClick={() => setStep(stepIndex + 1)}>{t('next')} →</button></footer>
    </div>
  </div>
}
