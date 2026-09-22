import { afterEach, describe, expect, it } from 'vitest'
import { catalogActions, catalogStore } from '../../src/state/catalog-store'

const original = catalogStore.getState()
afterEach(() => catalogActions.patch(original))

describe('late base-sample publication', () => {
  it('does not change a concurrent search loading state, error or completeness label', () => {
    catalogActions.patchFilters({ query: 'Eros' })
    catalogActions.patch({ isLoading: true, error: 'search-owned error', recordsSampled: false })
    catalogActions.setBaseSample('desktop', 'test-sample', [], null)
    expect(catalogStore.getState()).toMatchObject({ baseSampleKey: 'test-sample', isLoading: true,
      error: 'search-owned error', recordsSampled: false })
  })

  it('does not relabel an already complete exact result as sampled', () => {
    catalogActions.setExactResult('exact-scan', [], 0, false)
    catalogActions.setBaseSample('desktop', 'test-sample', [], null)
    expect(catalogStore.getState()).toMatchObject({ activeResultScanKey: 'exact-scan',
      exactFilteredTotal: 0, exactHydrationHasMore: false, recordsSampled: false })
  })
})
