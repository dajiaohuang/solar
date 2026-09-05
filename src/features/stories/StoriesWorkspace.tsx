import { useState } from 'react'
import storiesData from '../../content/stories/stories.json'
import type { Story, StoryScene } from '../../content/stories/types'
import { useI18n } from '../../i18n/context'
import { encodeCurrentScene } from '../../lib/shareScene'
import { shareSceneUrl } from '../../lib/platform'
import { applyStoryScene } from '../../lib/storyScene'
import { uiActions, uiStore } from '../../state/ui-store'
import { StoryCheckpoint } from './StoryCheckpoint'
import { availabilityAttributes, storyAvailability } from '../../lib/productAvailability'
import { availabilityActions } from '../../state/availability-store'
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
    if (!availabilityActions.require(storyAvailability(story.id))) return
    if (applyStoryScene(scene)) uiActions.startStory(story.id, stepIndex)
  }

  async function copyStepLink() {
    try {
      await shareSceneUrl(encodeCurrentScene(), story.title[language])
      uiActions.toast(t('storyLinkCopied'))
    } catch (error) {
      uiActions.toast(error instanceof Error ? error.message : String(error))
    }
  }

  function selectStory(id: string) {
    uiActions.selectStory(id, 0)
  }

  function setStep(index: number) {
    uiActions.setStoryStep(Math.max(0, Math.min(story.steps.length - 1, index)))
  }

  return <div className="workspace-page stories-workspace">
    <div className="page-heading"><div><span className="eyebrow">{t('storiesKicker')}</span><h1>{t('stories')}</h1><p>{t('storiesDescription')}</p></div><button className="quiet-button" onClick={() => void copyStepLink()}>↗ {t('copyStoryLink')}</button></div>
    <div className="stories-layout">
      <aside className="story-index glass-panel" aria-label={t('stories')}>{stories.map((item, index) => <button {...availabilityAttributes(storyAvailability(item.id))} aria-current={item.id === story.id ? 'true' : undefined} className={`${item.id === story.id ? 'active' : ''}${item.core ? ' core' : ''}`} key={item.id} onClick={() => selectStory(item.id)}><em>{String(index + 1).padStart(2, '0')}</em><span><strong>{item.title[language]}{item.core && <i className="story-core-badge">{t('coreCourse')}</i>}{!storyAvailability(item.id).available && <small className="full-version-badge">{t('fullVersion')}</small>}</strong><small>{item.summary[language]}</small></span></button>)}</aside>
      <section className={`story-hero story-${story.id} glass-panel`}>
        <div className="story-orbit-art" aria-hidden="true"><i className="orbit orbit-one" /><i className="orbit orbit-two" /><i className="orbit orbit-three" /><b className="story-sun">☉</b><b className="story-body-one" /><b className="story-body-two" /></div>
        <div className="story-copy">
          <span className="eyebrow">{step.stage.toUpperCase()} · {stepIndex + 1}/{story.steps.length}</span>
          {story.core && <span className="story-core-label">{t('coreCourse')}</span>}<h2>{story.title[language]}</h2><h3>{step.title[language]}</h3>
          <div className="story-observation"><strong>{t('storyQuestion')}</strong><p>{step.prompt[language]}</p></div>
          <button className="story-reveal" aria-expanded={explanationOpen} onClick={() => setRevealedStep(explanationOpen ? null : stepKey)}>{explanationOpen ? t('hideExplanation') : t('revealExplanation')} <span>{explanationOpen ? '−' : '+'}</span></button>
          {explanationOpen && <p className="story-explanation">{step.body[language]}</p>}
          <dl><div><dt>{t('dateLabel')}</dt><dd>{step.scene.date}</dd></div><div><dt>{t('frameLabel')}</dt><dd>{step.scene.referenceId}</dd></div><div><dt>{t('windowLabel')}</dt><dd>{step.scene.historyDays.toLocaleString()} {t('days')}</dd></div></dl>
          <button className="primary-button" onClick={() => applyScene(step.scene)}>↗ {t('applyStoryStep')}</button>
        </div>
      </section>
      <aside className="story-evidence glass-panel">
        <div><span className="section-kicker">{t('storyBoundary')}</span><p>{story.boundary[language]}</p></div>
        {story.glossary?.length ? <div><span className="section-kicker">{t('storyGlossary')}</span>{story.glossary.map((item) => <p key={item.term.en}><strong>{item.term[language]}</strong><br />{item.definition[language]}</p>)}</div> : null}
        <div><span className="section-kicker">{t('storySources')}</span>{story.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label}<b>↗</b></a>)}</div>
      </aside>
      {stepIndex === story.steps.length - 1 && story.checkpoint && <StoryCheckpoint key={story.id} checkpoint={story.checkpoint} />}
      <footer className="story-pagination glass-panel"><button disabled={stepIndex === 0} onClick={() => setStep(stepIndex - 1)}>← {t('previous')}</button><div>{story.steps.map((_, index) => <button aria-label={`${index + 1}`} className={index === stepIndex ? 'active' : ''} onClick={() => setStep(index)} key={index} />)}</div><button disabled={stepIndex >= story.steps.length - 1} onClick={() => setStep(stepIndex + 1)}>{t('next')} →</button></footer>
    </div>
  </div>
}
