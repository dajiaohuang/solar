import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { IS_NATIVE_APP } from './lib/platform'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (IS_NATIVE_APP) {
  document.documentElement.classList.add('native-app')
  void import('./lib/nativeRuntime').then(({ initializeNativeRuntime }) => initializeNativeRuntime())
}

if (!IS_NATIVE_APP && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).then((registration) => {
      const announceWaiting = () => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent('solar-atlas-update', { detail: registration }))
        }
      }
      announceWaiting()
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') announceWaiting()
        })
      })
      void registration.update()
    })
  })
}
