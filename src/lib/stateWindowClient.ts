import { assembleStateTiles, decodeStateTile, digestStateTileRequestIds, readStateTileJson, validateStateTileManifest, validateStateTilePlan, MAX_STATE_TILE_BYTES, type StateTile } from './stateTiles'
import type { AcquireStateTile } from './stateTileAdmission'

export const STATE_WINDOW_MEDIA_TYPE = 'application/vnd.solar.state-window+binary'

/** One time-grid request, incrementally verified. An epoch is usable only after
 * all its tiles pass existing source, ordinal, status and Float64 checks. A
 * complete history additionally requires the terminal count certificate. */
export async function* fetchStateWindow(params: {
  base: string; bodyIds: string[]; epochsTdbJd: readonly number[]; signal: AbortSignal
  fetcher?: typeof fetch; acquireTile?: AcquireStateTile
  expectedCatalogManifestSha256?: string; expectedInventoryManifestSha256?: string
}) {
  if (!params.bodyIds.length || params.bodyIds.length > 1024 || !params.epochsTdbJd.length || params.epochsTdbJd.length > 1024 || params.bodyIds.length * params.epochsTdbJd.length > 262144 ||
      params.epochsTdbJd.some((epoch, index) => !Number.isFinite(epoch) || index > 0 && epoch <= params.epochsTdbJd[index - 1])) throw new Error('Invalid state window budget or grid')
  const fetcher = params.fetcher ?? fetch
  const manifest = validateStateTileManifest(await readStateTileJson(await fetcher(`${params.base}/v1/catalog/manifest`, { signal: params.signal }), 'State catalog manifest'))
  if (params.expectedCatalogManifestSha256 && manifest.catalogManifestSha256 !== params.expectedCatalogManifestSha256 ||
      params.expectedInventoryManifestSha256 && manifest.inventoryManifestSha256 !== params.expectedInventoryManifestSha256) throw new Error('Backend trajectory source snapshot changed')
  const idsHash = await digestStateTileRequestIds(params.bodyIds)
  const release = await params.acquireTile?.(params.signal)
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const abort = () => { void reader?.cancel(params.signal.reason).catch(() => undefined) }
  params.signal.addEventListener('abort', abort, { once: true })
  try {
    params.signal.throwIfAborted()
    response = await fetcher(`${params.base}/v1/state/window`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: params.signal,
      body: JSON.stringify({ ids: params.bodyIds, epochsJd: params.epochsTdbJd, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', fieldMask: ['position', 'velocity'] }) })
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== STATE_WINDOW_MEDIA_TYPE || !response.body) throw new Error(`State window HTTP/protocol failure ${response.status}`)
    reader = response.body.getReader()
    let pending: Uint8Array = new Uint8Array(0), offset = 0
    const read = async (size: number) => {
      if (!Number.isInteger(size) || size < 1 || size > MAX_STATE_TILE_BYTES) throw new Error('State window frame exceeds byte limit')
      const output = new Uint8Array(size)
      let written = 0
      while (written < size) {
        params.signal.throwIfAborted()
        if (offset === pending.length) {
          const next = await reader!.read()
          params.signal.throwIfAborted()
          if (next.done) throw new Error('Truncated state window')
          pending = next.value; offset = 0
          if (!pending.length) continue
        }
        const count = Math.min(size - written, pending.length - offset)
        output.set(pending.subarray(offset, offset + count), written)
        offset += count; written += count
      }
      return output
    }
    const frame = async (limit = MAX_STATE_TILE_BYTES) => {
      const sizeBytes = await read(4)
      const size = new DataView(sizeBytes.buffer).getUint32(0, true)
      if (size > limit) throw new Error('State window metadata exceeds byte limit')
      return read(size)
    }
    const json = async (): Promise<Record<string, unknown>> => {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await frame(8 * 1024 * 1024)))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid state window metadata')
      return value as Record<string, unknown>
    }
    const header = await json()
    if (header.kind !== 'window' || header.version !== 1 || header.epochCount !== params.epochsTdbJd.length || header.bodyCount !== params.bodyIds.length || header.requestIdsSha256 !== idsHash || header.catalogManifestSha256 !== manifest.catalogManifestSha256) throw new Error('State window identity mismatch')
    let exact = 0, missing = 0
    for (let epochIndex = 0; epochIndex < params.epochsTdbJd.length; epochIndex++) {
      const entry = await json()
      if (entry.kind !== 'epoch' || entry.epochIndex !== epochIndex) throw new Error('State window epoch sequence mismatch')
      const plan = validateStateTilePlan(entry.plan, manifest, params.epochsTdbJd[epochIndex], params.bodyIds, idsHash)
      const tiles: StateTile[] = []
      for (const descriptor of plan.tiles) {
        tiles.push(await decodeStateTile(await frame(), { planHash: plan.planHash, catalogManifestSha256: plan.catalogManifestSha256,
          inventoryManifestSha256: plan.inventoryManifestSha256, sequence: descriptor.sequence, tileCount: plan.tileCount }))
      }
      const verified = assembleStateTiles(tiles, plan)
      exact += plan.exactCount; missing += plan.missingCount
      params.signal.throwIfAborted()
      yield { epochIndex, manifest, plan, tiles: verified }
    }
    const summary = await json()
    if (summary.kind !== 'complete' || summary.epochCount !== params.epochsTdbJd.length || summary.bodyCount !== params.bodyIds.length || summary.exactCount !== exact || summary.missingCount !== missing) throw new Error('State window completion mismatch')
    if (offset !== pending.length || !(await reader.read()).done) throw new Error('State window contains trailing data')
    params.signal.throwIfAborted()
  } finally {
    params.signal.removeEventListener('abort', abort)
    // Retain page-wide admission until the underlying stream has stopped.
    await reader?.cancel().catch(() => undefined)
    reader?.releaseLock()
    if (!reader) await response?.body?.cancel().catch(() => undefined)
    release?.()
  }
}
