import type { AppRoute, ElementPlotMode } from '../../state/ui-store'

export type LocalizedText = { en: string; zh: string }

export type StoryHighlight = 'scene' | 'frame' | 'time' | 'layers' | 'catalog' | 'elements' | 'events' | 'mission'

export type StoryScene = {
  date: string
  referenceId: string
  comparisonReferenceId?: string
  comparisonEnabled?: boolean
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

export type StoryStep = {
  stage: string
  title: LocalizedText
  prompt: LocalizedText
  body: LocalizedText
  scene: StoryScene
  highlight?: StoryHighlight
}

export type StoryCheckpoint = {
  question: LocalizedText
  choices: Array<{ text: LocalizedText; correct: boolean }>
  explanation: LocalizedText
}

export type Story = {
  id: string
  title: LocalizedText
  summary: LocalizedText
  boundary: LocalizedText
  sources: Array<{ label: string; url: string }>
  glossary?: Array<{ term: LocalizedText; definition: LocalizedText }>
  checkpoint?: StoryCheckpoint
  steps: StoryStep[]
}
