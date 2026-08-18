import { describe, expect, it } from 'vitest'
import { getSearchBucketKey } from '../../src/lib/catalogLoader'
import { filterCatalogRecords, type CatalogFilters } from '../../src/state/catalog-store'
import type { AsteroidRecord } from '../../src/types'

const filters: CatalogFilters = {
  query: '',
  orbitClass: 'all',
  semiMajorAxis: [0, 80],
  eccentricity: [0, 0.999],
  inclination: [0, 180],
  absoluteMagnitude: [-5, 40],
  perihelion: [0, 80],
}

const record: AsteroidRecord = {
  id: 'asteroid:mpc:00433',
  packedDesignation: '00433',
  permanentNumber: 433,
  label: '433 Á-New-Name',
  shortLabel: 'Á-New-Name',
  searchKey: 'a new name 433 a new name 00433',
  chunkId: 'chunk-0000',
  orbitClassCode: 'MBA',
  orbitClassName: 'Main-belt Asteroid',
  epochJd: 2_460_000.5,
  semiMajorAxisAU: 2.3,
  eccentricity: 0.1,
  inclinationDeg: 5,
  ascendingNodeDeg: 10,
  argPeriapsisDeg: 20,
  meanAnomalyDeg: 30,
  meanMotionDegPerDay: 0.25,
}

describe('catalog search sharding', () => {
  it('routes permanent numbers, provisional years, packed numbers, and token initials', () => {
    expect(getSearchBucketKey('433 Eros')).toBe('number-000000-009999')
    expect(getSearchBucketKey('101955')).toBe('number-100000-109999')
    expect(getSearchBucketKey('2024 YR4')).toBe('year-2024')
    expect(getSearchBucketKey('K24Y04R')).toBe('k')
    expect(getSearchBucketKey('~0000')).toBe('packed-tilde-0')
  })

  it('normalizes punctuation and diacritics consistently after loading a bucket', () => {
    expect(filterCatalogRecords([record], { ...filters, query: 'Á-New' })).toEqual([record])
  })
})
