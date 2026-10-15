import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function SceneTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const place = () => {
      const element = ref.current
      if (!element) return
      // offsetWidth/Height round fractional text dimensions and can place the
      // border outside the viewport margin. Round the clamped position inward.
      const bounds = element.getBoundingClientRect()
      element.style.left = `${Math.floor(Math.max(8, Math.min(x + 14, window.innerWidth - bounds.width - 8)))}px`
      element.style.top = `${Math.floor(Math.max(8, Math.min(y + 12, window.innerHeight - bounds.height - 8)))}px`
    }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [x, y, children])
  return <div ref={ref} className="atlas-tooltip" style={{ left: x + 14, top: y + 12,
    maxWidth: 'min(230px, calc(100vw - 16px))', overflowWrap: 'anywhere' }}>{children}</div>
}
