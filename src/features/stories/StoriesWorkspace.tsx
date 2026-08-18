import { useState } from 'react'
import storiesData from '../../content/stories/stories.json'
import { dateToJulianDay } from '../../lib/julianDate'
import { selectionActions } from '../../state/selection-store'
import { simulationActions } from '../../state/simulation-store'
import { uiActions, type AppRoute } from '../../state/ui-store'
import { useI18n } from '../../i18n/context'

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
}
type Story = {
  id: string
  title: Localized
  summary: Localized
  steps: Array<{ title: Localized; body: Localized; scene: StoryScene }>
}
const stories = storiesData as Story[]

export function StoriesWorkspace() {
  const { t, language } = useI18n()
  const [activeStoryId, setActiveStoryId] = useState(stories[0].id)
  const [stepIndex, setStepIndex] = useState(0)
  const story = stories.find((item) => item.id === activeStoryId) ?? stories[0]
  const step = story.steps[Math.min(stepIndex, story.steps.length - 1)]

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
    simulationActions.seek(dateToJulianDay(new Date(`${scene.date}T12:00:00Z`)))
    uiActions.navigate(scene.route ?? 'explorer')
  }

  return <div className="workspace-page stories-workspace">
    <header className="page-heading"><div><span className="eyebrow">REPRODUCIBLE JSON SCENES / GUIDED LEARNING</span><h1>{t('stories')}</h1><p>{language === 'zh' ? '从坐标系、共振与任务轨迹理解太阳系，而不只观看动画。' : 'Understand frames, resonances, and mission paths—not just an animation.'}</p></div></header>
    <div className="stories-layout">
      <aside className="story-index glass-panel">{stories.map((item, index) => <button className={item.id === story.id ? 'active' : ''} key={item.id} onClick={() => { setActiveStoryId(item.id); setStepIndex(0) }}><em>{String(index + 1).padStart(2, '0')}</em><span><strong>{item.title[language]}</strong><small>{item.summary[language]}</small></span></button>)}</aside>
      <section className={`story-hero story-${story.id} glass-panel`}>
        <div className="story-orbit-art" aria-hidden="true"><i className="orbit orbit-one" /><i className="orbit orbit-two" /><i className="orbit orbit-three" /><b className="story-sun">☉</b><b className="story-body-one" /><b className="story-body-two" /></div>
        <div className="story-copy"><span className="eyebrow">{story.id.replaceAll('-', ' ').toUpperCase()} · {stepIndex + 1}/{story.steps.length}</span><h2>{story.title[language]}</h2><h3>{step.title[language]}</h3><p>{step.body[language]}</p><dl><div><dt>DATE</dt><dd>{step.scene.date}</dd></div><div><dt>FRAME</dt><dd>{step.scene.referenceId}</dd></div><div><dt>WINDOW</dt><dd>{step.scene.historyDays.toLocaleString()} d</dd></div></dl><button className="primary-button" onClick={() => applyScene(step.scene)}>↗ {t('applyStoryStep')}</button></div>
      </section>
      <footer className="story-pagination glass-panel"><button disabled={stepIndex === 0} onClick={() => setStepIndex((value) => value - 1)}>← {t('previous')}</button><div>{story.steps.map((_, index) => <i className={index === stepIndex ? 'active' : ''} key={index} />)}</div><button disabled={stepIndex >= story.steps.length - 1} onClick={() => setStepIndex((value) => value + 1)}>{t('next')} →</button></footer>
    </div>
  </div>
}
