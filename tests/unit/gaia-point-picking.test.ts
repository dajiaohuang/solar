import { expect, it } from 'vitest'
import { buildGaiaScreenPointIndex } from '../../src/lib/gaiaPointPicking'

it('matches brute-force visible nearest-star selection across batches, zoom and cell edges', () => {
  const batches = [
    new Float32Array([0, 0, 10, .02, .01, 12, -.4, .1, 15]),
    new Float32Array([.8, .7, 18, -.01, .01, 13, .99, 0, 14]),
  ]
  const points = batches.flatMap(batch => Array.from({ length: batch.length / 3 }, (_, i) => batch.slice(i * 3, i * 3 + 3)))
  for (const zoom of [1, 2, 8]) {
    const width = 480, height = 360
    const index = buildGaiaScreenPointIndex(batches, width, height, zoom, points.length)
    for (const [clickX, clickY] of [[240, 180], [250, 175], [12, 180], [479, 180], [80, 170]]) {
      let expected = -1, distance = 12 ** 2
      points.forEach(([baseX, baseY], row) => {
        const x = Math.fround(baseX * zoom), y = Math.fround(baseY * zoom)
        if (Math.abs(x) > 1 || Math.abs(y) > 1) return
        const candidate = ((x + 1) * width / 2 - clickX) ** 2 + ((1 - y) * height / 2 - clickY) ** 2
        if (candidate < distance) { distance = candidate; expected = row }
      })
      expect(index.nearest(clickX, clickY, 12)).toBe(expected)
    }
  }
})

it('rejects incomplete, excessive and nonfinite Gaia picking snapshots', () => {
  expect(() => buildGaiaScreenPointIndex([new Float32Array([0, 0, 1])], 10, 10, 1, 0)).toThrow('uploaded row count')
  expect(() => buildGaiaScreenPointIndex([new Float32Array([0, 0, 1, 0])], 10, 10, 1, 1)).toThrow('batch')
  expect(() => buildGaiaScreenPointIndex([new Float32Array([NaN, 0, 1])], 10, 10, 1, 1)).toThrow('Nonfinite')
  expect(() => buildGaiaScreenPointIndex([], 10, 10, 1, 1)).toThrow('uploaded row count')
})
