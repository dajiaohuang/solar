import { expect, it } from 'vitest'
import { createCatalogTransferWindow } from '../../src/lib/catalogTransferWindow'

it('holds the fourth publication until a real acknowledgement and drains the final partial window', async () => {
  const window = createCatalogTransferWindow(new AbortController().signal), ids: number[] = []
  for (let i = 0; i < 3; i++) await window.publish(id => ids.push(id))
  let fourthFinished = false, drained = false
  const fourth = window.publish(id => ids.push(id)).then(() => { fourthFinished = true })
  await Promise.resolve()
  expect(ids).toEqual([1, 2, 3, 4]); expect(fourthFinished).toBe(false)
  window.acknowledge(100)
  await Promise.resolve(); expect(fourthFinished).toBe(false)
  window.acknowledge(2); await fourth
  window.acknowledge(2) // Duplicate acknowledgements cannot mint credits.
  const fifth = window.publish(id => ids.push(id))
  window.acknowledge(1); await fifth
  const drain = window.drain().then(() => { drained = true })
  window.acknowledge(3); window.acknowledge(4)
  await Promise.resolve(); expect(drained).toBe(false)
  window.acknowledge(5); await drain
  expect(ids).toEqual([1, 2, 3, 4, 5])
  window.dispose()
})

it('does not oversubscribe even when multiple producers attempt publication concurrently', async () => {
  const window = createCatalogTransferWindow(new AbortController().signal), ids: number[] = []
  const work = Array.from({ length: 8 }, () => window.publish(id => ids.push(id)))
  await Promise.resolve(); expect(ids).toHaveLength(4)
  for (let i = 0; i < 8; i++) {
    window.acknowledge(i + 1)
    // Let a waiting producer claim this one returned credit.
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    expect(ids.length - i - 1).toBeLessThanOrEqual(4)
  }
  await Promise.all(work); await window.drain()
  expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  window.dispose()
})

it('cancels publications and completion waiting on acknowledgements without leaking credits', async () => {
  const controller = new AbortController(), window = createCatalogTransferWindow(controller.signal)
  await window.publish(() => {})
  await window.publish(() => {})
  await window.publish(() => {})
  const fourth = expect(window.publish(() => {})).rejects.toMatchObject({ name: 'AbortError' })
  const drain = expect(window.drain()).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await Promise.all([fourth, drain])
  await expect(window.publish(() => { throw new Error('must not send') })).rejects.toMatchObject({ name: 'AbortError' })
  window.dispose()
})

it('returns a failed send credit and rejects disposed or invalid windows', async () => {
  const signal = new AbortController().signal, window = createCatalogTransferWindow(signal, 1)
  await expect(window.publish(() => { throw new Error('transfer failed') })).rejects.toThrow('transfer failed')
  await window.drain()
  const published = window.publish(id => window.acknowledge(id))
  await published
  window.dispose(); window.dispose()
  await expect(window.publish(() => {})).rejects.toThrow('closed')
  expect(() => createCatalogTransferWindow(signal, 0)).toThrow('Invalid')
})
