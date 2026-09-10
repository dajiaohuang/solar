import { describe, expect, it } from 'vitest'
import { createFrameInvalidator } from '../../src/lib/frameInvalidation'
import { ScreenPointIndex } from '../../src/lib/screenPointIndex'

describe('render scheduling and indexed pixel picking', () => {
  it('coalesces scene changes, flushes captures and cancels disposed draws', () => {
    const callbacks = new Map<number, FrameRequestCallback>(); let next = 0, draws = 0
    const renderer = createFrameInvalidator(() => draws++, callback => { callbacks.set(++next, callback); return next }, id => { callbacks.delete(id) })
    for (let n = 0; n < 100; n++) renderer.invalidate()
    expect(callbacks.size).toBe(1)
    const callback = callbacks.get(next)!; callbacks.delete(next); callback(0)
    expect(draws).toBe(1)
    renderer.invalidate(); renderer.flush()
    expect(draws).toBe(2); expect(callbacks.size).toBe(0)
    renderer.invalidate(); renderer.dispose(); renderer.invalidate()
    expect(callbacks.size).toBe(0); expect(draws).toBe(2)
  })
  it('matches a brute-force nearest point including cell edges and overlaps', () => {
    const points = Array.from({ length: 10000 }, (_, n) => [((n * 7919) % 1040) - 10, ((n * 3571) % 800) - 10])
    points[1] = points[0]
    const index = new ScreenPointIndex(1024, 768, points.length)
    points.forEach(([x, y], n) => index.add(n, x, y))
    for (let n = 0; n < 250; n++) {
      const x = (n * 113) % 1024, y = (n * 193) % 768
      let expected = -1, distance = 81
      points.forEach(([px, py], ordinal) => { const d = (px - x) ** 2 + (py - y) ** 2; if (d < distance) { distance = d; expected = ordinal } })
      expect(index.nearest(x, y)).toBe(expected)
    }
  })
})
