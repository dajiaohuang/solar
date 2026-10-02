import { afterEach, expect, it, vi } from 'vitest'
import { SimulationClock } from '../../src/engine/clock/SimulationClock'
afterEach(() => vi.unstubAllGlobals())

it('does not apply elapsed time before a seek to the newly selected date', () => {
  let frame: FrameRequestCallback = () => {}, handle = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return ++handle })
  const cancel = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancel)
  const clock = new SimulationClock()
  clock.setRate(3650); clock.play(); frame(1000)
  clock.seek(2460000.5); frame(1240)
  expect(clock.getJulianDay()).toBe(2460000.5)
  frame(1490)
  expect(clock.getJulianDay()).toBe(2460000.5 + 3650 * .25)
  const snapshot = clock.getSnapshot()
  clock.seek(NaN); expect(clock.getSnapshot()).toBe(snapshot)
  clock.pause(); expect(cancel).toHaveBeenCalled()
  expect(clock.getSnapshot().isPlaying).toBe(false)
  clock.dispose()
})
