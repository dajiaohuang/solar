import { describe, expect, it } from 'vitest'
import { StratifiedCatalogSampler, catalogStratum } from '../../src/lib/catalogSampling'
import { elementPlotCoordinates } from '../../src/lib/elementPlot'
import type { AsteroidRecord } from '../../src/types'

function record(index: number, orbitClassCode = 'MBA'): AsteroidRecord {
  return {
    id: `asteroid:${index}`,
    label: `Object ${index}`,
    shortLabel: `${index}`,
    searchKey: `object ${index}`,
    chunkId: `chunk-${Math.floor(index / 10)}`,
    orbitClassCode,
    orbitClassName: orbitClassCode,
    absoluteMagnitude: index % 7 === 0 ? undefined : 8 + index % 20,
    isNeo: false,
    isPha: false,
    epochJd: 2_460_000.5,
    semiMajorAxisAU: orbitClassCode === 'TNO' ? 42 + index % 3 : 2 + (index % 10) / 10,
    eccentricity: (index % 8) / 10,
    inclinationDeg: index % 80,
    ascendingNodeDeg: 10,
    argPeriapsisDeg: 20,
    meanAnomalyDeg: 30,
    meanMotionDegPerDay: 0.25,
  }
}

describe('bounded catalog sampling', () => {
  it('is deterministic, bounded, and retains minority strata', () => {
    const records = [...Array.from({ length: 1_000 }, (_, index) => record(index)), record(2_000, 'TNO')]
    const run = () => {
      const sampler = new StratifiedCatalogSampler(60)
      records.forEach((item) => sampler.add(item))
      return sampler.values()
    }
    const first = run()
    expect(first).toHaveLength(60)
    expect(first.map((item) => item.id)).toEqual(run().map((item) => item.id))
    expect(first.some((item) => item.orbitClassCode === 'TNO')).toBe(true)
    expect(new Set(first.map(catalogStratum)).size).toBeGreaterThan(5)
  })

  it('does not invent H=30 for unknown magnitudes', () => {
    expect(elementPlotCoordinates(record(7), 'a-H')).toBeNull()
    expect(elementPlotCoordinates({ ...record(8), absoluteMagnitude: 13.5 }, 'a-H')).toEqual([2.8, 13.5])
  })

  it('keeps materialization bounded while scanning one million synthetic rows', () => {
    const sampler = new StratifiedCatalogSampler(30_000)
    let materialized = 0
    for (let index = 0; index < 1_000_000; index += 1) {
      const orbitClass = index % 97 === 0 ? 'TNO' : 'MBA'
      const semiMajorAxisAU = orbitClass === 'TNO' ? 42 + index % 3 : 2 + (index % 10) / 10
      const eccentricity = (index % 8) / 10
      const inclinationDeg = index % 80
      const absoluteMagnitude = index % 7 === 0 ? undefined : 8 + index % 20
      const decision = sampler.consider(
        `asteroid:${index}`, orbitClass, semiMajorAxisAU, eccentricity, inclinationDeg, absoluteMagnitude,
      )
      if (!decision) continue
      materialized += 1
      sampler.commit(decision, record(index, orbitClass))
    }
    expect(sampler.values()).toHaveLength(30_000)
    expect(materialized).toBeLessThan(200_000)
  }, 10_000)
})
