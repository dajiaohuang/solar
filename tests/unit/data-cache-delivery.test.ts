import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })

describe('optional immutable persistence', () => {
  it('coalesces concurrent network loads but gives each consumer an independent transferable buffer', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
    vi.stubGlobal('fetch', fetcher)
    const { fetchImmutableArrayBuffer } = await import('../../src/data/cache/indexedDb')
    const [first, second] = await Promise.all([fetchImmutableArrayBuffer('/same.bin'), fetchImmutableArrayBuffer('/same.bin')])
    expect(fetcher).toHaveBeenCalledTimes(1)
    structuredClone(first, { transfer: [first] })
    expect(Array.from(new Uint8Array(second))).toEqual([1, 2, 3])
  })

  it('falls back to network when storage access throws and retries failed network requests', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('Storage unavailable', 'SecurityError') } })
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('recovered'))
    vi.stubGlobal('fetch', fetcher)
    const { fetchImmutableArrayBuffer } = await import('../../src/data/cache/indexedDb')
    await expect(fetchImmutableArrayBuffer('/retry.bin')).rejects.toThrow('offline')
    expect(new TextDecoder().decode(await fetchImmutableArrayBuffer('/retry.bin'))).toBe('recovered')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('closes connections that arrive after a blocked open has already fallen back', async () => {
    const close = vi.fn()
    const requests: Array<{ onblocked?: () => void; onsuccess?: () => void; result: { close: typeof close } }> = []
    vi.stubGlobal('indexedDB', { open: () => {
      const request = { result: { close } }
      requests.push(request)
      queueMicrotask(() => requests.at(-1)?.onblocked?.())
      return request
    } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
    const { fetchImmutableArrayBuffer } = await import('../../src/data/cache/indexedDb')
    await fetchImmutableArrayBuffer('/blocked.bin')
    for (const request of requests) request.onsuccess?.()
    expect(close.mock.calls.length).toBeGreaterThan(0)
  })
})
