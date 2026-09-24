import { describe, expect, it, vi } from 'vitest'
import { catalogForEachBounded, SharedCatalogCache } from '../../src/data/cache/sharedCatalogCache'

describe('decoded catalog ownership', () => {
  it('evicts by retained weight and does not retain oversized values', async () => {
    const budget = { maximumWeight: 6, weigh: (value: string) => value.length }
    const prepare = vi.fn((value: string) => value)
    const cache = new SharedCatalogCache<string>(4, prepare, budget)
    budget.maximumWeight = 100 // Configuration ownership stays with the cache.
    const load = vi.fn(async () => 'aaa')
    await cache.get('a', load)
    await cache.get('b', load)
    await cache.get('a', load) // Refresh a; b is now oldest.
    await cache.get('c', load)
    await cache.get('a', load)
    expect(load).toHaveBeenCalledTimes(3)
    await cache.get('b', load)
    expect(load).toHaveBeenCalledTimes(4)
    const large = vi.fn(async () => 'oversized')
    expect(await cache.get('large', large)).toBe('oversized')
    await cache.get('large', large)
    expect(large).toHaveBeenCalledTimes(2)
    expect(prepare).toHaveBeenCalledTimes(6)
    cache.clear()
    await cache.get('a', load)
    expect(load).toHaveBeenCalledTimes(5)
  })

  it('waits for active consumer cleanup after failure without starting queued work', async () => {
    const failure = new Error('source validation failed')
    let fail!: (reason: Error) => void, release!: () => void
    const failed = new Promise<void>((_, reject) => { fail = reject })
    const held = new Promise<void>(resolve => { release = resolve })
    const started: number[] = [], signals: AbortSignal[] = []
    let settled = false
    const batch = catalogForEachBounded([0, 1, 2, 3, 4, 5], undefined, async (item, signal) => {
      started.push(item); signals.push(signal)
      await (item === 0 ? failed : held)
    })
    const outcome = batch.then(() => { settled = true; return null }, error => { settled = true; return error })
    expect(started).toEqual([0, 1, 2, 3])
    fail(failure)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(signals.every(signal => signal.aborted)).toBe(true)
    const settledBeforeCleanup = settled
    release()
    expect(await outcome).toBe(failure)
    expect(settledBeforeCleanup).toBe(false)
    expect(started).toEqual([0, 1, 2, 3])
  })

  it('cancels callers independently and retries immediately after the final owner leaves', async () => {
    const cache = new SharedCatalogCache<number>(2)
    const calls: Array<{ signal: AbortSignal; resolve: (value: number) => void }> = []
    const load = vi.fn((signal: AbortSignal) => new Promise<number>(resolve => calls.push({ signal, resolve })))
    const a = new AbortController(), b = new AbortController()
    const first = cache.get('x', load, a.signal), second = cache.get('x', load, b.signal)
    const firstError = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const secondError = expect(second).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    a.abort()
    await firstError
    expect(calls[0].signal.aborted).toBe(false)
    b.abort()
    await secondError
    expect(calls[0].signal.aborted).toBe(true)
    const replacement = cache.get('x', load)
    await Promise.resolve()
    calls[0].resolve(1) // An abort-ignoring old producer may still finish.
    calls[1].resolve(2)
    expect(await replacement).toBe(2)
    expect(await cache.get('x', load)).toBe(2)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('retains active ownership independently of completed-value eviction and clears pending callers', async () => {
    const cache = new SharedCatalogCache<number>(1)
    let finish!: (value: number) => void
    const slow = vi.fn(() => new Promise<number>(resolve => { finish = resolve }))
    const first = cache.get('pending', slow)
    await cache.get('a', async () => 1)
    await cache.get('b', async () => 2)
    const second = cache.get('pending', slow)
    const rejected = [expect(first).rejects.toMatchObject({ name: 'AbortError' }), expect(second).rejects.toMatchObject({ name: 'AbortError' })]
    cache.clear()
    await Promise.all(rejected)
    finish(3)
    expect(await cache.get('pending', async () => 4)).toBe(4)
    expect(slow).toHaveBeenCalledTimes(1)
  })
})
