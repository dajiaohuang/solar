import { expect, it } from 'vitest'
import { createPointPickGesture } from '../../src/lib/pointPickGesture'

const pointer = (id = 1, x = 10, y = 10, pointerType = 'mouse', button = 0) => ({ pointerId: id, clientX: x, clientY: y, pointerType, button })

it('allows a stationary primary click and blocks selection while pressed', () => {
  const gesture = createPointPickGesture()
  gesture.start(pointer()); expect(gesture.allowClick()).toBe(false)
  gesture.end(pointer()); expect(gesture.allowClick()).toBe(true)
})
it.each(['mouse', 'touch', 'pen'])('blocks a %s drag and permits the next independent click', type => {
  const gesture = createPointPickGesture()
  gesture.start(pointer(1, 10, 10, type)); gesture.move(pointer(1, 40, 10, type)); gesture.end(pointer(1, 10, 10, type))
  expect(gesture.allowClick()).toBe(false)
  gesture.start(pointer(1, 10, 10, type)); gesture.end(pointer(1, 10, 10, type))
  expect(gesture.allowClick()).toBe(true)
})
it('blocks pinch, cancellation and secondary clicks even if the camera returns to its starting position', () => {
  const gesture = createPointPickGesture()
  gesture.start(pointer(1)); gesture.start(pointer(2)); gesture.end(pointer(2)); gesture.end(pointer(1))
  expect(gesture.allowClick()).toBe(false)
  gesture.start(pointer()); gesture.cancel(pointer()); expect(gesture.allowClick()).toBe(false)
  gesture.start(pointer(1, 10, 10, 'mouse', 2)); gesture.end(pointer()); expect(gesture.allowClick()).toBe(false)
})
it('recovers after an outside release or window blur without retaining an active pointer', () => {
  const gesture = createPointPickGesture()
  gesture.start(pointer()); gesture.end(pointer(1, 1000, 1000)); expect(gesture.isInteracting()).toBe(false)
  gesture.start(pointer()); gesture.reset(); expect(gesture.isInteracting()).toBe(false)
  gesture.start(pointer()); gesture.end(pointer()); expect(gesture.allowClick()).toBe(true)
})
