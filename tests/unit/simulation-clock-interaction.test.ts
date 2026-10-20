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

it('publishes exact frame epochs independently of the throttled UI and stops on pause', () => {
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const clock = new SimulationClock(125), epochs: number[] = [], ui = vi.fn()
  const unsubscribe = clock.subscribeFrames(epoch => epochs.push(epoch))
  clock.subscribe(ui)
  clock.seek(2460000.5); clock.setRate(-30); clock.play(); ui.mockClear()
  for (const t of [1000, 1016, 1032, 1048, 1064]) frame(t)
  expect(epochs).toHaveLength(5)
  expect(epochs.at(-1)).toBe(clock.getJulianDay())
  expect(epochs.at(-1)).toBeLessThan(epochs[0])
  expect(ui.mock.calls.length).toBeLessThan(epochs.length)
  unsubscribe(); frame(1080); expect(epochs).toHaveLength(5)
  clock.pause(); frame(1096); expect(epochs).toHaveLength(5)
  clock.dispose()
})
