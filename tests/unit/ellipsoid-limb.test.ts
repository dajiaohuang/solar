import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import reference from '../fixtures/pck-limb-reference.json'
import { loadPckOrientation } from '../../src/data/loaders/pckOrientation'
import { ellipsoidLimb } from '../../src/engine/events/ellipsoidLimb'

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]
it('matches independent CSPICE limb centers and invariant ellipse tensors for 42 finite-distance views', async () => {
  const bytes = await readFile('src/data/pck00011.tpc')
  const models = await loadPckOrientation(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  expect(reference.sourceSha256).toBe(models.source.sha256)
  expect(reference.generatorSha256).toBe(createHash('sha256').update(await readFile('scripts/reference-pck-limb.py')).digest('hex'))
  expect(reference.cases).toHaveLength(42)
  for (const sample of reference.cases) {
    const rotation = models.evaluate(sample.body, sample.epoch)!.j2000ToBodyFixed
    // Isolate the limb algorithm from the independently measured text-PCK
    // orientation roundoff, then check the composed implementation separately.
    const result = ellipsoidLimb(sample.axes as [number, number, number], sample.j2000ToBodyFixed, sample.observerJ2000Km as [number, number, number])
    const composed = ellipsoidLimb(sample.axes as [number, number, number], rotation, sample.observerJ2000Km as [number, number, number])
    const scale = Math.max(...sample.axes)
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(result.centerBodyFixedKm[i]-sample.centerBodyFixedKm[i])/scale).toBeLessThan(1e-12)
      expect(Math.abs(composed.centerBodyFixedKm[i]-sample.centerBodyFixedKm[i])/scale).toBeLessThan(2e-10)
      for (let j = 0; j < 3; j++) {
        const tensor = result.generatorsBodyFixedKm.reduce((sum, axis) => sum + axis[i]*axis[j], 0)
        expect(Math.abs(tensor-sample.shapeTensor[i][j])/(scale*scale)).toBeLessThan(1e-12)
        const composedTensor = composed.generatorsBodyFixedKm.reduce((sum, axis) => sum + axis[i]*axis[j], 0)
        expect(Math.abs(composedTensor-sample.shapeTensor[i][j])/(scale*scale)).toBeLessThan(2e-10)
      }
    }
    // Independently verify the surface equation and line-of-sight tangency,
    // including near-surface and very distant observers.
    for (let k = 0; k < 16; k++) {
      const angle = k*Math.PI/8
      const point = result.centerBodyFixedKm.map((value, i) => value + result.generatorsBodyFixedKm[0][i]*Math.cos(angle) + result.generatorsBodyFixedKm[1][i]*Math.sin(angle))
      expect(Math.abs(point.reduce((sum, value, i) => sum + (value/sample.axes[i])**2, 0)-1)).toBeLessThan(2e-12)
      const scaledLine = point.map((value, i) => (result.observerBodyFixedKm[i]-value)/sample.axes[i])
      const tangency = point.reduce((sum, value, i) => sum + value/sample.axes[i]*scaledLine[i], 0)/Math.hypot(...scaledLine)
      expect(Math.abs(tangency)).toBeLessThan(2e-12)
    }
  }
})

it('recovers the analytic finite-distance sphere and rotates its contour without changing the surface', () => {
  const result = ellipsoidLimb([2, 2, 2], identity, [10, 0, 0])
  expect(result.centerJ2000Km).toEqual([0.4, 0, 0])
  for (const generator of result.generatorsJ2000Km) expect(Math.hypot(...generator)).toBeCloseTo(2*Math.sqrt(0.96), 14)
  const rotated = ellipsoidLimb([2, 3, 4], [0, 1, 0, -1, 0, 0, 0, 0, 1], [0, 10, 0])
  expect(rotated.centerJ2000Km).toEqual([0, 0.4, 0])
  expect(rotated.physicalLimbUncertaintyKm).toBeNull()
})

it('rejects internal/surface observers, ill-conditioned axes and invalid rotations', () => {
  for (const observer of [[0, 0, 0], [1, 0, 0], [1+1e-11, 0, 0], [1e13, 0, 0], [Infinity, 0, 0]]) {
    expect(() => ellipsoidLimb([1, 1, 1], identity, observer as [number, number, number])).toThrow()
  }
  for (const axes of [[0, 1, 1], [-1, 1, 1], [1e-20, 1, 1]]) expect(() => ellipsoidLimb(axes as [number, number, number], identity, [10, 0, 0])).toThrow()
  for (const matrix of [[2, 0, 0, 0, 1, 0, 0, 0, 1], [-1, 0, 0, 0, 1, 0, 0, 0, 1], [1]]) expect(() => ellipsoidLimb([1, 1, 1], matrix, [10, 0, 0])).toThrow()
})
