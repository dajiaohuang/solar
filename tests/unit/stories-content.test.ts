import { describe, expect, it } from 'vitest'
import storiesData from '../../src/content/stories/stories.json'
import type { Story } from '../../src/content/stories/types'

const stories = storiesData as Story[]

describe('guided story content', () => {
  it('keeps the geocentrism course as the single six-stage core entry point', () => {
    const coreStories = stories.filter((story) => story.core)
    expect(coreStories).toHaveLength(1)
    expect(stories[0].id).toBe('geocentric-model')
    expect(coreStories[0].steps.map((step) => step.stage)).toEqual([
      'question', 'observe', 'operate', 'explain', 'evidence', 'boundary',
    ])
    expect(coreStories[0].title.en).toBeTruthy()
    expect(coreStories[0].title.zh).toContain('地心说')
  })

  it('distinguishes a historical physical model from a modern coordinate frame', () => {
    const story = stories[0]
    expect(story.glossary?.map((entry) => entry.term.en)).toEqual(expect.arrayContaining([
      'Geocentric model', 'Geocentric frame',
    ]))
    expect(story.steps.map((step) => step.scene.referenceId)).toContain('earth')
    expect(story.steps.map((step) => step.scene.referenceId)).toContain('sun')
    expect(story.steps.some((step) => step.scene.comparisonEnabled)).toBe(true)
    expect(story.boundary.en).toContain('not evidence')
    expect(story.checkpoint?.choices.filter((choice) => choice.correct)).toHaveLength(1)
  })

  it('pins the IAU Resolution B1 evidence to the official IAU archive', () => {
    const story = stories.find((entry) => entry.id === 'geocentric-model')
    const resolution = story?.sources.find((source) => source.label.startsWith('IAU Resolution B1'))

    expect(resolution?.url).toBe('https://iauarchive.eso.org/static/resolutions/IAU2018_ResolB1_English.pdf')
    expect(stories.flatMap((entry) => entry.sources).map((source) => source.url)).not.toContain(
      'https://www.iau.org/static/resolutions/IAU2018_ResolB1_English.pdf',
    )
  })
})
