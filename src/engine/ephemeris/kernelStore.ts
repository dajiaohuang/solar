import manifestData from '../../data/ephemeris-manifest.json'
import { bodyNaifId } from '../../data/ephemerisTargets'
import { SpkKernel } from './spk'
import { createKernelResolver, kernelsCoveringInterval, type LoadedKernel } from './kernelPool'
import { utcJulianDayToEt } from './timeScales'

export type KernelFile = {
  id: string; path: string; sha256: string; bytes: number; targets: number[];
  startEt: number; endEt: number; source: string; sourceIdentity?: unknown;
  core?: boolean;
}
export const EPHEMERIS_MANIFEST = manifestData as { schemaVersion: number; id: string; files: KernelFile[] }
const installed = new Map<string, LoadedKernel>()
const pending = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let snapshot = { revision: 0, loading: 0, error: null as string | null }
const publish = (patch: Partial<typeof snapshot>) => {
  snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 }
  listeners.forEach((listener) => listener())
}
export const subscribeEphemerides = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getEphemerisSnapshot = () => snapshot
export const loadedKernelIds = () => EPHEMERIS_MANIFEST.files.filter((file) => installed.has(file.id)).map((file) => file.id)
export const loadedKernels = () => loadedKernelIds().map((id) => installed.get(id)!)
export function kernelsForWindow(startUtcJd: number, endUtcJd: number, ids = loadedKernelIds()) {
  try {
    return kernelsCoveringInterval(loadedKernels().filter((kernel) => ids.includes(kernel.id)), utcJulianDayToEt(startUtcJd), utcJulianDayToEt(endUtcJd))
  } catch { return [] }
}

export function installKernel(id: string, buffer: ArrayBuffer) {
  const kernel = new SpkKernel(buffer)
  installed.set(id, { id, kernel })
  publish({ error: null })
}

async function loadFile(file: KernelFile) {
  const response = await fetch(`${import.meta.env.BASE_URL}data/ephemerides/${file.path}`, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Ephemeris ${file.id}: HTTP ${response.status}`)
  if (file.bytes <= 0 || file.bytes > 128 * 1024 * 1024 || !Number.isSafeInteger(file.bytes)) throw new Error('Invalid ephemeris size limit')
  const reader = response.body?.getReader()
  if (!reader) throw new Error(`Ephemeris ${file.id}: response body unavailable`)
  const bytes = new Uint8Array(file.bytes)
  let offset = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (offset + chunk.value.length > bytes.length) throw new Error(`Ephemeris ${file.id}: oversized response`)
      bytes.set(chunk.value, offset)
      offset += chunk.value.length
    }
  } catch (error) { await reader.cancel(); throw error }
  if (offset !== bytes.length) throw new Error(`Ephemeris ${file.id}: truncated response`)
  const buffer = bytes.buffer
  if (buffer.byteLength !== file.bytes || buffer.byteLength > 128 * 1024 * 1024) throw new Error(`Ephemeris ${file.id}: unexpected size`)
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== file.sha256) throw new Error(`Ephemeris ${file.id}: checksum mismatch`)
  installKernel(file.id, buffer)
}

/** Exact file set is sent to workers: no hidden high/low precision divergence. */
export async function ensureKernelFiles(ids: string[]) {
  for (const id of ids) {
    const file = EPHEMERIS_MANIFEST.files.find((item) => item.id === id)
    if (!file) throw new Error(`Unknown ephemeris file ${id}`)
    if (installed.has(id)) continue
    let promise = pending.get(id)
    if (!promise) {
      publish({ loading: snapshot.loading + 1 })
      promise = loadFile(file).catch((error: unknown) => {
        publish({ error: error instanceof Error ? error.message : String(error) })
        throw error
      }).finally(() => { pending.delete(id); publish({ loading: snapshot.loading - 1 }) })
      pending.set(id, promise)
    }
    await promise
  }
}

export function kernelFilesForBodies(bodies: { id: string; naifId?: number }[]) {
  const targets = new Set(bodies.map(bodyNaifId).filter((id) => id !== undefined))
  return EPHEMERIS_MANIFEST.files.filter((file) => file.core || file.targets.some((target) => targets.has(target))).map((file) => file.id)
}

export function kernelStateForBody(body: { id: string; naifId?: number }, utcJd: number) {
  const target = bodyNaifId(body)
  if (target === undefined || !installed.size) return null
  // The civil-time conversion declares its supported historical boundary.
  // Older scenes retain their documented approximate model, never fake UTC.
  let et: number
  try { et = utcJulianDayToEt(utcJd) } catch { return null }
  return createKernelResolver(loadedKernels(), et).relative(target, 10)
}

export function kernelCoverage(body: { id: string; naifId?: number }, utcJd: number) {
  const target = bodyNaifId(body)
  const state = kernelStateForBody(body, utcJd)
  return { target, model: state ? 'jpl-spk' : 'approximate-fallback', kernelIds: loadedKernelIds(), manifestId: EPHEMERIS_MANIFEST.id }
}
