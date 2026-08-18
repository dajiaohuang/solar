import { useMemo, type ReactNode } from 'react'
import { uiActions, uiStore } from '../state/ui-store'
import { en } from './en'
import { zh } from './zh'
import { I18nContext, type I18nValue } from './context'

export function I18nProvider({ children }: { children: ReactNode }) {
  const { language } = uiStore.useStore()
  const value = useMemo<I18nValue>(() => ({
    language,
    t: (key) => language === 'zh' ? zh[key] : en[key],
    toggleLanguage: () => uiActions.setLanguage(language === 'zh' ? 'en' : 'zh'),
  }), [language])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
