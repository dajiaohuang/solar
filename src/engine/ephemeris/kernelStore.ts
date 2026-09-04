import { selectedEphemerisManifest as manifestData } from '../../data/selectedEphemerisManifest'
import { bodyNaifId } from '../../data/ephemerisTargets'
import { SpkKernel } from './spk'
import { createKernelResolver, kernelsCoveringInterval, type LoadedKernel } from './kernelPool'
import { utcJulianDayToEt } from './timeScales'
import type { CelestialBody } from '../../types'

export type KernelFile = {
  id: string; path: string; sha256: string; bytes: number; targets: number[];
  startEt: number; endEt: number; source: string; sourceIdentity?: unknown;
  core?: boolean;
  solutionKernelIds?: string[];
  dependencyOnly?: boolean;
  solution?: string;
}
export const EPHEMERIS_MANIFEST = manifestData as { schemaVersion: number; id: string; profile?: string; files: KernelFile[] }
const installed = new Map<string, LoadedKernel>()
// The status panel asks for many bodies at the same epoch. Share the immutable
// pool snapshot and center cache rather than rebuilding them for every row.
let currentResolver: { et: number; resolver: ReturnType<typeof createKernelResolver> } | null = null
const pending = new Map<string, Promise<void>>()
const failures = new Map<string, string>()
const failureMessage = () => [...failures.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, message]) => message).join('\n') || null
let activeLoads = 0
const loadWaiters: Array<() => void> = []
async function withLoadSlot(load: () => Promise<void>) {
  if (activeLoads < 4) activeLoads++
  else await new Promise<void>(resolve => loadWaiters.push(resolve))
  try { await load() }
  finally {
    const next = loadWaiters.shift()
    if (next) next()
    else activeLoads--
  }
}
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
  const file = EPHEMERIS_MANIFEST.files.find(file => file.id === id)
  installed.set(id, { id, kernel, solutionKernelIds: file?.solutionKernelIds, dependencyOnly: file?.dependencyOnly })
  currentResolver = null
  // A different successful file must not hide a still-missing dependency.
  failures.delete(id)
  publish({ error: failureMessage() })
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
  const files = [...new Set(ids)].map(id => {
    const file = EPHEMERIS_MANIFEST.files.find((item) => item.id === id)
    if (!file) throw new Error(`Unknown ephemeris file ${id}`)
    return file
  })
  let cursor = 0
  let failed = false
  // Bound transient read/hash buffers. Hundreds of small per-body files should
  // not pay a complete serial network round trip each, nor all load at once.
  const consume = async () => {
    while (!failed && cursor < files.length) {
      const file = files[cursor++]
      const id = file.id
      if (installed.has(id)) continue
      let promise = pending.get(id)
      if (!promise) {
        publish({ loading: snapshot.loading + 1 })
        promise = withLoadSlot(() => loadFile(file)).catch((error: unknown) => {
          failures.set(id, error instanceof Error ? error.message : String(error))
          publish({ error: failureMessage() })
          throw error
        }).finally(() => { pending.delete(id); publish({ loading: snapshot.loading - 1 }) })
        pending.set(id, promise)
      }
      try { await promise } catch (error) { failed = true; throw error }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, consume))
}

export function kernelFilesForBodies(bodies: { id: string; naifId?: number }[]) {
  const targets = new Set(bodies.map(bodyNaifId).filter((id) => id !== undefined))
  const wanted = new Set(EPHEMERIS_MANIFEST.files.filter((file) => !file.dependencyOnly && (file.core || file.targets.some((target) => targets.has(target)))).map(file => file.id))
  const byId = new Map(EPHEMERIS_MANIFEST.files.map(file => [file.id, file]))
  for (const id of wanted) {
    for (const dependency of byId.get(id)?.solutionKernelIds ?? []) {
      if (!byId.has(dependency)) throw new Error(`Missing declared ephemeris dependency ${dependency}`)
      wanted.add(dependency)
    }
  }
  return EPHEMERIS_MANIFEST.files.filter(file => wanted.has(file.id)).map(file => file.id)
}

export function kernelStateForBody(body: { id: string; naifId?: number }, utcJd: number) {
  const target = bodyNaifId(body)
  if (target === undefined || !installed.size) return null
  // The civil-time conversion declares its supported historical boundary.
  // Older scenes retain their documented approximate model, never fake UTC.
  let et: number
  try { et = utcJulianDayToEt(utcJd) } catch { return null }
  if (!currentResolver || currentResolver.et !== et) currentResolver = { et, resolver: createKernelResolver(loadedKernels(), et) }
  return currentResolver.resolver.relative(target, 10)
}

export function kernelCoverage(body: Pick<CelestialBody, 'id' | 'naifId' | 'orbit'>, utcJd: number) {
  const target = bodyNaifId(body)
  const state = kernelStateForBody(body, utcJd)
  return { target, model: state ? 'jpl-spk' : body.id === 'sun' ? 'heliocentric-origin' : body.orbit ? 'approximate-fallback' : 'unavailable', kernelIds: loadedKernelIds(), manifestId: EPHEMERIS_MANIFEST.id }
}
