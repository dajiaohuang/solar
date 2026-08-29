import { simulationClock } from '../engine/clock/SimulationClock'
import { dispatchNativeBack } from './nativeBack'
import { publishNativeSceneLocation, resolveNativeSceneLocation } from './nativeUrl'

export async function initializeNativeRuntime() {
  const [{ App }, { Browser }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/browser'),
  ])
  let resumePlayback = false

  function handleIncomingUrl(url: string) {
    const location = resolveNativeSceneLocation(url, window.location.pathname)
    if (location) publishNativeSceneLocation(location)
  }

  await App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) {
      resumePlayback = simulationClock.getSnapshot().isPlaying
      simulationClock.pause()
    } else if (resumePlayback) {
      resumePlayback = false
      simulationClock.play()
    }
  })

  await App.addListener('backButton', async ({ canGoBack }) => {
    const guide = document.querySelector('.first-run-guide')
    if (guide) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      return
    }
    if (!dispatchNativeBack(canGoBack)) return
    if (canGoBack) window.history.back()
    else await App.minimizeApp()
  })

  await App.addListener('appUrlOpen', ({ url }) => {
    handleIncomingUrl(url)
  })

  const launch = await App.getLaunchUrl()
  if (launch?.url) handleIncomingUrl(launch.url)

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (!target || target.download || target.target !== '_blank' || !/^https?:$/.test(target.protocol)) return
    event.preventDefault()
    void Browser.open({ url: target.href })
  })
}
