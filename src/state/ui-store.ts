import { createStore } from './createStore'

export type AppRoute = 'home' | 'explorer' | 'catalog' | 'elements' | 'events' | 'mission' | 'stories' | 'about'
export type Language = 'zh' | 'en'
export type ElementPlotMode = 'a-e' | 'a-i' | 'a-H' | 'q-Q' | 'a-period'

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem('solar-atlas-language')
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    // Ignore unavailable storage.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

type UiState = {
  route: AppRoute
  language: Language
  sidebarOpen: boolean
  toast: string | null
  elementPlot: ElementPlotMode
  storyId: string
  storyStep: number
  storyGuideOpen: boolean
}

const initialUiState: UiState = {
  route: 'home',
  language: typeof window === 'undefined' ? 'en' : initialLanguage(),
  sidebarOpen: true,
  toast: null,
  elementPlot: 'a-e',
  storyId: 'retrograde-mars',
  storyStep: 0,
  storyGuideOpen: false,
}

export const uiStore = createStore(initialUiState)

export const uiActions = {
  navigate(route: AppRoute) {
    uiStore.setState({ route })
  },
  setLanguage(language: Language) {
    try { localStorage.setItem('solar-atlas-language', language) } catch { /* optional */ }
    uiStore.setState({ language })
  },
  setElementPlot(elementPlot: ElementPlotMode) {
    uiStore.setState({ elementPlot })
  },
  selectStory(storyId: string, storyStep = 0) {
    uiStore.setState({ storyId, storyStep: Math.max(0, Math.floor(storyStep)) })
  },
  setStoryStep(storyStep: number) {
    uiStore.setState({ storyStep: Math.max(0, Math.floor(storyStep)) })
  },
  startStory(storyId: string, storyStep = 0) {
    uiStore.setState({ storyId, storyStep: Math.max(0, Math.floor(storyStep)), storyGuideOpen: true })
  },
  stopStory() {
    uiStore.setState({ storyGuideOpen: false })
  },
  toast(message: string) {
    uiStore.setState({ toast: message })
    window.setTimeout(() => {
      if (uiStore.getState().toast === message) uiStore.setState({ toast: null })
    }, 2400)
  },
}
