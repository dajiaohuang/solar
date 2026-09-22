import { describe, expect, it, vi } from 'vitest'
import { SharedCatalogCache } from '../../src/data/cache/sharedCatalogCache'

describe('decoded catalog ownership', () => {
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
