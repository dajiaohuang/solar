/** A click may follow a completed drag or pinch even when camera controls
 * consumed the pointer events. Keep that click from changing selection. */
export function createPointPickGesture() {
  const pointers = new Map<number, { x: number; y: number; threshold: number }>()
  let blocked = false
  return {
    start(event: { pointerId: number; clientX: number; clientY: number; pointerType: string; button: number }) {
      if (!pointers.size) blocked = event.button !== 0
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, threshold: event.pointerType === 'touch' ? 12 : 6 })
      if (pointers.size > 1) blocked = true
    },
    move(event: { pointerId: number; clientX: number; clientY: number }) {
      const start = pointers.get(event.pointerId)
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > start.threshold) blocked = true
    },
    end(event: { pointerId: number; clientX: number; clientY: number }) {
      this.move(event); pointers.delete(event.pointerId)
    },
    cancel(event: { pointerId: number }) { pointers.delete(event.pointerId); blocked = true },
    reset() { pointers.clear(); blocked = true },
    isInteracting() { return pointers.size > 0 },
    allowClick() { return !blocked && pointers.size === 0 },
  }
}
