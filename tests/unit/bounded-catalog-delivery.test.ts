import { afterEach, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { MAX_CATALOG_ARTIFACT_BYTES, readBoundedStream } from '../../src/data/cache/boundedStream'
import { fetchImmutableArrayBuffer, parseMaybeGzipJson } from '../../src/data/cache/indexedDb'

afterEach(() => vi.unstubAllGlobals())

it('interrupts a stalled stream read, discards its partial bytes and releases the lock', async () => {
  const cancelled = vi.fn(), controller = new AbortController()
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2])) }, cancel: cancelled })
  const result = readBoundedStream(stream, 16, controller.signal)
  const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await rejection
  expect(cancelled).toHaveBeenCalledTimes(1)
  expect(stream.locked).toBe(false)
})

it('counts actual streamed bytes, cancels overflow, and releases the reader', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(9)) },
    cancel() { cancelled = true },
  })
  await expect(readBoundedStream(stream, 16)).rejects.toThrow('exceeds 16')
  expect(cancelled).toBe(true)
  expect(stream.locked).toBe(false)
  const exact = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(0)); c.enqueue(new Uint8Array([1, 2])); c.close() } })
  expect(new Uint8Array(await readBoundedStream(exact, 2))).toEqual(new Uint8Array([1, 2]))
})

it('rejects oversized declared responses before consumption and permits a later retry', async () => {
  let cancelled = false
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-length': String(MAX_CATALOG_ARTIFACT_BYTES + 1) } }))
    .mockResolvedValueOnce(new Response(new Uint8Array([42]))))
  await expect(fetchImmutableArrayBuffer('/bounded-retry.bin')).rejects.toThrow('exceeds')
  expect(cancelled).toBe(true)
  expect(new Uint8Array(await fetchImmutableArrayBuffer('/bounded-retry.bin'))).toEqual(new Uint8Array([42]))
})

it('bounds decompressed bytes and rejects malformed UTF-8 in plain and gzip JSON', async () => {
  const expanded = gzipSync(JSON.stringify('a'.repeat(4096)))
  await expect(parseMaybeGzipJson(new Uint8Array(expanded).buffer, 256)).rejects.toThrow('exceeds 256')
  const invalid = new Uint8Array([34, 0xff, 34])
  await expect(parseMaybeGzipJson(invalid.buffer)).rejects.toThrow()
  await expect(parseMaybeGzipJson(new Uint8Array(gzipSync(invalid)).buffer)).rejects.toThrow()
  const valid = new TextEncoder().encode(JSON.stringify({ name: '冥王星' }))
  await expect(parseMaybeGzipJson(new Uint8Array(gzipSync(valid)).buffer)).resolves.toEqual({ name: '冥王星' })
})
