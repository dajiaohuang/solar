import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

it('invalidates cached manifest order on install and replacement without exposing mutable shared lists', async () => {
  vi.resetModules()
  const store = await import('../../src/engine/ephemeris/kernelStore')
  const files = [...store.EPHEMERIS_MANIFEST.files].sort((a, b) => a.bytes - b.bytes).slice(0, 2)
  const install = (file: typeof files[number]) => {
    const bytes = readFileSync(`public/data/ephemerides/${file.path}`)
    store.installKernel(file.id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }
  expect(store.loadedKernelIds()).toEqual([])
  install(files[1])
  const oldCoverage = store.kernelCoverage({ id: 'sun' }, 2461287.5)
  expect(Object.isFrozen(oldCoverage.kernelIds)).toBe(true)
  expect(oldCoverage.kernelIds).toEqual([files[1].id])
  install(files[0])
  const order = store.EPHEMERIS_MANIFEST.files.filter(file => files.some(selected => selected.id === file.id)).map(file => file.id)
  expect(store.loadedKernelIds()).toEqual(order)
  expect(oldCoverage.kernelIds).toEqual([files[1].id])
  const exposedIds = store.loadedKernelIds()
  const exposedKernels = store.loadedKernels()
  const previousKernel = exposedKernels.find(kernel => kernel.id === files[0].id)!.kernel
  exposedIds.length = 0
  exposedKernels.length = 0
  expect(store.loadedKernelIds()).toEqual(order)
  expect(store.loadedKernels().map(kernel => kernel.id)).toEqual(order)
  install(files[0])
  expect(store.loadedKernelIds()).toEqual(order)
  expect(store.loadedKernels().find(kernel => kernel.id === files[0].id)!.kernel).not.toBe(previousKernel)
})

it('bounds concurrent loads across overlapping requests and reuses verified files', async () => {
  vi.resetModules()
  const store = await import('../../src/engine/ephemeris/kernelStore')
  const files = [...store.EPHEMERIS_MANIFEST.files].sort((a, b) => a.bytes - b.bytes).slice(0, 12)
  const bytes = new Map(files.map(file => [file.path, readFileSync(`public/data/ephemerides/${file.path}`)]))
  let release = false
  let active = 0
  let maximum = 0
  const revisions: number[] = []
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
  const unsubscribe = store.subscribeEphemerides(() => revisions.push(store.getEphemerisSnapshot().revision))
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
    expect(store.getEphemerisSnapshot().revision).toBeGreaterThan(0)
    expect(revisions.length).toBeLessThanOrEqual(6)
    const revisionAtCompletion = store.getEphemerisSnapshot().revision
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(store.getEphemerisSnapshot().revision).toBe(revisionAtCompletion)
    await store.ensureKernelFiles(files.map(file => file.id))
    expect(fetchMock).toHaveBeenCalledTimes(12)
    await expect(store.ensureKernelFiles(['unknown-kernel'])).rejects.toThrow('Unknown')
    expect(fetchMock).toHaveBeenCalledTimes(12)
  } finally { unsubscribe(); vi.unstubAllGlobals() }
})

it('retains failed dependency errors across peer successes and clears only successful retries', async () => {
  vi.resetModules()
  const store = await import('../../src/engine/ephemeris/kernelStore')
  const files = [...store.EPHEMERIS_MANIFEST.files].sort((a, b) => a.bytes - b.bytes).slice(0, 3)
  const failing = new Set(files.slice(0, 2).map(file => file.path))
  let releasePeer!: () => void
  const peerGate = new Promise<void>(resolve => { releasePeer = resolve })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('/').at(-1)!
    if (failing.has(path)) return new Response('unavailable', { status: 503 })
    if (path === files[2].path) await peerGate
    return new Response(new Uint8Array(readFileSync(`public/data/ephemerides/${path}`)))
  }))
  try {
    await expect(store.ensureKernelFiles(files.map(file => file.id))).rejects.toThrow('HTTP 503')
    await vi.waitFor(() => expect(store.getEphemerisSnapshot().loading).toBeGreaterThan(0))
    releasePeer()
    await vi.waitFor(() => expect(store.getEphemerisSnapshot().loading).toBe(0))
    expect(store.loadedKernelIds()).toContain(files[2].id)
    for (const file of files.slice(0, 2)) expect(store.getEphemerisSnapshot().error).toContain(file.id)
    failing.delete(files[0].path)
    await store.ensureKernelFiles([files[0].id])
    expect(store.getEphemerisSnapshot().error).not.toContain(files[0].id)
    expect(store.getEphemerisSnapshot().error).toContain(files[1].id)
    failing.delete(files[1].path)
    await store.ensureKernelFiles([files[1].id])
    expect(store.getEphemerisSnapshot().error).toBeNull()
  } finally { releasePeer(); vi.unstubAllGlobals() }
})
