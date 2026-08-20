import { useEffect, useMemo, useState } from 'react'
import storiesData from '../../content/stories/stories.json'
import type { Story, StoryHighlight } from '../../content/stories/types'
import { useI18n } from '../../i18n/context'
import { exportAnnotatedScenePng } from '../../lib/sceneExport'
import { encodeCurrentScene } from '../../lib/shareScene'
import { applyStoryScene } from '../../lib/storyScene'
import { uiActions, uiStore } from '../../state/ui-store'
import { StoryCheckpoint } from './StoryCheckpoint'

const stories = storiesData as Story[]

function stageLabel(stage: string, language: 'en' | 'zh') {
  const labels: Record<string, { en: string; zh: string }> = {
    question: { en: 'Question', zh: '问题' }, observe: { en: 'Observe', zh: '观察' }, operate: { en: 'Operate', zh: '操作' },
    explain: { en: 'Explain', zh: '解释' }, evidence: { en: 'Evidence', zh: '证据' }, boundary: { en: 'Boundary', zh: '边界' }, continue: { en: 'Continue', zh: '继续研究' },
  }
  return labels[stage]?.[language] ?? stage
}

function defaultHighlight(route?: string): StoryHighlight {
  if (route === 'catalog') return 'catalog'
  if (route === 'elements') return 'elements'
  if (route === 'events') return 'events'
  if (route === 'mission') return 'mission'
  return 'scene'
}

export function GuidedStoryOverlay() {
  const ui = uiStore.useStore()
  const { language, t } = useI18n()
  const [minimized, setMinimized] = useState(false)
  const [revealedStep, setRevealedStep] = useState<string | null>(null)
  const story = useMemo(() => stories.find((item) => item.id === ui.storyId) ?? stories[0], [ui.storyId])
  const stepIndex = Math.min(ui.storyStep, story.steps.length - 1)
  const step = story.steps[stepIndex]
  const stepKey = `${story.id}:${stepIndex}`
  const explanationOpen = revealedStep === stepKey

  useEffect(() => {
    if (!ui.storyGuideOpen) return
    const selector = `[data-story-target="${step.highlight ?? defaultHighlight(step.scene.route)}"]`
    const target = document.querySelector<HTMLElement>(selector)
    target?.classList.add('story-highlight-target')
    return () => target?.classList.remove('story-highlight-target')
  }, [step.highlight, step.scene.route, ui.route, ui.storyGuideOpen])

  if (!ui.storyGuideOpen) return null
  if (minimized) return <button className="story-guide-return" onClick={() => setMinimized(false)}><span>◇</span><strong>{story.title[language]}</strong><small>{stepIndex + 1}/{story.steps.length}</small></button>

  function move(delta: number) {
    const nextIndex = Math.max(0, Math.min(story.steps.length - 1, stepIndex + delta))
    uiActions.setStoryStep(nextIndex)
    applyStoryScene(story.steps[nextIndex].scene)
  }

  async function copyLink() {
    await navigator.clipboard.writeText(encodeCurrentScene())
    uiActions.toast(t('storyLinkCopied'))
  }

  return <aside className="guided-story-overlay glass-panel" role="dialog" aria-labelledby="guided-story-title">
    <header>
      <div><span className="eyebrow">{stageLabel(step.stage, language)} · {stepIndex + 1}/{story.steps.length}</span><strong id="guided-story-title">{story.title[language]}</strong></div>
      <div><button aria-label={t('minimizeGuide')} onClick={() => setMinimized(true)}>—</button><button aria-label={t('closeGuide')} onClick={uiActions.stopStory}>×</button></div>
    </header>
    <div className="story-guide-progress" aria-hidden="true"><i style={{ width: `${(stepIndex + 1) / story.steps.length * 100}%` }} /></div>
    <h2>{step.title[language]}</h2>
    <div className="story-observation"><strong>{t('storyQuestion')}</strong><p>{step.prompt[language]}</p></div>
    <button className="story-reveal" aria-expanded={explanationOpen} onClick={() => setRevealedStep(explanationOpen ? null : stepKey)}>{explanationOpen ? t('hideExplanation') : t('revealExplanation')} <span>{explanationOpen ? '−' : '+'}</span></button>
    {explanationOpen && <p className="story-explanation">{step.body[language]}</p>}
    <div className="story-guide-actions">
      <button disabled={stepIndex === 0} onClick={() => move(-1)}>← {t('previous')}</button>
      <button className="primary-button" onClick={() => applyStoryScene(step.scene)}>{t('resetStoryScene')}</button>
      <button disabled={stepIndex === story.steps.length - 1} onClick={() => move(1)}>{t('next')} →</button>
    </div>
    {stepIndex === story.steps.length - 1 && story.checkpoint && <StoryCheckpoint key={story.id} checkpoint={story.checkpoint} compact />}
    <details className="story-guide-evidence"><summary>{t('storyEvidenceAndTerms')}</summary><p><strong>{t('storyBoundary')}:</strong> {story.boundary[language]}</p>{story.glossary?.map((item) => <p key={item.term.en}><strong>{item.term[language]}</strong> — {item.definition[language]}</p>)}{story.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label} ↗</a>)}</details>
    <footer><button onClick={() => void copyLink()}>↗ {t('copyStoryLink')}</button><button onClick={() => void exportAnnotatedScenePng(language).catch((error: unknown) => uiActions.toast(error instanceof Error ? error.message : String(error)))}>▣ {t('exportPng')}</button><button onClick={() => { uiActions.stopStory(); uiActions.navigate('stories') }}>{t('finishStory')}</button></footer>
  </aside>
}
