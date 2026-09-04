import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

it('bounds concurrent loads across overlapping requests and reuses verified files', async () => {
  vi.resetModules()
  const store = await import('../../src/engine/ephemeris/kernelStore')
  const files = [...store.EPHEMERIS_MANIFEST.files].sort((a, b) => a.bytes - b.bytes).slice(0, 12)
  const bytes = new Map(files.map(file => [file.path, readFileSync(`public/data/ephemerides/${file.path}`)]))
  let release = false
  let active = 0
  let maximum = 0
  const gates: Array<() => void> = []
  const fetchMock = vi.fn(async (url: string) => {
    active++
    maximum = Math.max(maximum, active)
    if (!release) await new Promise<void>(resolve => gates.push(resolve))
    const content = bytes.get(url.split('/').at(-1)!)!
    active--
    return new Response(new Uint8Array(content))
  })
  vi.stubGlobal('fetch', fetchMock)
  try {
    const first = store.ensureKernelFiles(files.slice(0, 8).map(file => file.id))
    const second = store.ensureKernelFiles(files.slice(4).map(file => file.id))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    release = true
    gates.splice(0).forEach(resolve => resolve())
    await Promise.all([first, second])
    expect(maximum).toBeLessThanOrEqual(4)
    expect(fetchMock).toHaveBeenCalledTimes(12)
    expect(store.getEphemerisSnapshot().loading).toBe(0)
    await store.ensureKernelFiles(files.map(file => file.id))
    expect(fetchMock).toHaveBeenCalledTimes(12)
    await expect(store.ensureKernelFiles(['unknown-kernel'])).rejects.toThrow('Unknown')
    expect(fetchMock).toHaveBeenCalledTimes(12)
  } finally { vi.unstubAllGlobals() }
})
