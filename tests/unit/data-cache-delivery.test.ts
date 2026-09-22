import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })

describe('optional immutable persistence', () => {
  it('keeps a shared response available while another consumer is still validating it', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([8, 9])))
    vi.stubGlobal('fetch', fetcher)
    const { fetchImmutableArrayBuffer } = await import('../../src/data/cache/indexedDb')
    let finish!: () => void
    const pending = fetchImmutableArrayBuffer('/shared-validation.bin', () => new Promise<void>(resolve => { finish = resolve }))
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const second = await fetchImmutableArrayBuffer('/shared-validation.bin')
    structuredClone(second, { transfer: [second] })
    finish()
    expect(new Uint8Array(await pending)).toEqual(new Uint8Array([8, 9]))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('cancels one consumer promptly without aborting a sibling shared download', async () => {
    let finish!: (response: Response) => void
    let networkSignal!: AbortSignal
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      networkSignal = init.signal!
      return new Promise<Response>(resolve => { finish = resolve })
    })
    vi.stubGlobal('fetch', fetcher)
    const { fetchImmutableArrayBuffer } = await import('../../src/data/cache/indexedDb')
    const controller = new AbortController()
    const first = fetchImmutableArrayBuffer('/shared-cancel.bin', undefined, controller.signal)
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = fetchImmutableArrayBuffer('/shared-cancel.bin')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    controller.abort()
    await cancelled
    expect(networkSignal.aborted).toBe(false)
    finish(new Response(new Uint8Array([8, 9])))
    expect(new Uint8Array(await second)).toEqual(new Uint8Array([8, 9]))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('aborts the last consumer, cancels a stalled body and permits an immediate clean retry', async () => {
    const bodyCancelled = vi.fn()
    let signal!: AbortSignal
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal!
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])) }, cancel: bodyCancelled })))
    })
    vi.stubGlobal('fetch', fetcher)
    const { fetchImmutableArrayBuffer } = await import('../../src/data/cache/indexedDb')
    const controller = new AbortController(), validate = vi.fn()
    const result = fetchImmutableArrayBuffer('/last-consumer.bin', validate, controller.signal)
    const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    controller.abort()
    await cancelled
    expect(signal.aborted).toBe(true)
    expect(bodyCancelled).toHaveBeenCalledTimes(1)
    expect(validate).not.toHaveBeenCalled()
    fetcher.mockImplementation(async () => new Response(new Uint8Array([42])))
    expect(new Uint8Array(await fetchImmutableArrayBuffer('/last-consumer.bin'))).toEqual(new Uint8Array([42]))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not start an already cancelled consumer and rejects cancellation during async validation', async () => {
    const fetcher = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetcher)
    const { fetchImmutableArrayBuffer } = await import('../../src/data/cache/indexedDb')
    const controller = new AbortController()
    controller.abort()
    await expect(fetchImmutableArrayBuffer('/pre-abort.bin', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
    const next = new AbortController()
    let finish!: () => void
    const pending = fetchImmutableArrayBuffer('/validation-abort.bin', () => new Promise<void>(resolve => { finish = resolve }), next.signal)
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    next.abort()
    await cancelled
    finish()
  })

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
