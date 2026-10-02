import { useEffect, useState } from 'react'
import { createPointPickGesture } from '../lib/pointPickGesture'

export function usePointPickGesture() {
  const [gesture] = useState(createPointPickGesture)
  useEffect(() => {
    const move = (event: PointerEvent) => gesture.move(event)
    const end = (event: PointerEvent) => gesture.end(event)
    const cancel = (event: PointerEvent) => gesture.cancel(event)
    const blur = () => gesture.reset()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', blur)
    }
  }, [gesture])
  return gesture
}
