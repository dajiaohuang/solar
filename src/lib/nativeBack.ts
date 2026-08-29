const BACK_EVENT = 'solar-atlas-native-back'

export type NativeBackEvent = CustomEvent<{ canGoBack: boolean }>

export function dispatchNativeBack(canGoBack: boolean) {
  return window.dispatchEvent(new CustomEvent(BACK_EVENT, {
    cancelable: true,
    detail: { canGoBack },
  }))
}

export function onNativeBack(callback: (event: NativeBackEvent) => void) {
  const listener = callback as EventListener
  window.addEventListener(BACK_EVENT, listener)
  return () => window.removeEventListener(BACK_EVENT, listener)
}
