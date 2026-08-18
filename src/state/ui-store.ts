import { createStore } from './createStore'

export type AppRoute = 'explorer' | 'catalog' | 'elements' | 'events' | 'mission' | 'stories' | 'about'
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
}

const initialUiState: UiState = {
  route: 'explorer',
  language: typeof window === 'undefined' ? 'en' : initialLanguage(),
  sidebarOpen: true,
  toast: null,
  elementPlot: 'a-e',
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
  toast(message: string) {
    uiStore.setState({ toast: message })
    window.setTimeout(() => {
      if (uiStore.getState().toast === message) uiStore.setState({ toast: null })
    }, 2400)
  },
}
