import { createContext, useContext } from 'react'
import { en, type TranslationKey } from './en'

export type I18nValue = {
  language: 'zh' | 'en'
  t: (key: TranslationKey) => string
  toggleLanguage: () => void
}
export const I18nContext = createContext<I18nValue>({
  language: 'en',
  t: (key) => en[key],
  toggleLanguage: () => undefined,
})

export function useI18n() {
  return useContext(I18nContext)
}
