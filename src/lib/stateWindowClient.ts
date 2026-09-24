import { assembleStateTiles, decodeStateTile, digestStateTileRequestIds, readStateTileJson, validateStateTileManifest, validateStateTilePlan, MAX_STATE_TILE_BYTES, type StateTile } from './stateTiles'
import type { AcquireStateTile } from './stateTileAdmission'

export const STATE_WINDOW_MEDIA_TYPE = 'application/vnd.solar.state-window+binary'

/** One time-grid request, incrementally verified. An epoch is usable only after
 * all its tiles pass existing source, ordinal, status and Float64 checks. A
 * complete history additionally requires the terminal count certificate. */
type StateWindowParams = {
  base: string; bodyIds: string[]; epochsTdbJd: readonly number[]; signal: AbortSignal
  fetcher?: typeof fetch; acquireTile?: AcquireStateTile
  expectedCatalogManifestSha256?: string; expectedInventoryManifestSha256?: string
}

export async function* fetchStateWindow(params: StateWindowParams) {
  const parent = params.signal, controller = new AbortController()
  const cancel = () => controller.abort(parent.reason)
  parent.addEventListener('abort', cancel, { once: true })
  if (parent.aborted) cancel()
  const setup = async <T,>(run: () => Promise<T>): Promise<T> => {
    const deadline = performance.now() + 30_000
    const timeout = () => controller.abort(new Error('State window setup deadline exceeded'))
    controller.signal.throwIfAborted()
    const timer = setTimeout(timeout, 30_000)
    try {
      const value = await run()
      if (performance.now() >= deadline) timeout()
      controller.signal.throwIfAborted()
      return value
    } finally { clearTimeout(timer) }
  }
  try {
    yield* fetchStateWindowWithSignal({ ...params, signal: controller.signal }, setup)
  } finally {
    controller.abort()
    parent.removeEventListener('abort', cancel)
  }
}

async function* fetchStateWindowWithSignal(params: StateWindowParams, setup: <T>(run: () => Promise<T>) => Promise<T>) {
  params = { ...params, bodyIds: [...params.bodyIds], epochsTdbJd: [...params.epochsTdbJd] }
  if (!params.bodyIds.length || params.bodyIds.length > 1024 || !params.epochsTdbJd.length || params.epochsTdbJd.length > 1024 || params.bodyIds.length * params.epochsTdbJd.length > 262144 ||
      params.epochsTdbJd.some((epoch, index) => !Number.isFinite(epoch) || index > 0 && epoch <= params.epochsTdbJd[index - 1])) throw new Error('Invalid state window budget or grid')
  const fetcher = params.fetcher ?? fetch
  const withTileAdmission = async <T,>(run: () => Promise<T>): Promise<T> => {
    const release = await params.acquireTile?.(params.signal, 'trajectory')
    try { params.signal.throwIfAborted(); return await run() }
    finally { release?.() }
  }
  const manifest = await setup(async () => validateStateTileManifest(await readStateTileJson(await fetcher(`${params.base}/v1/catalog/manifest`, { signal: params.signal }), 'State catalog manifest', undefined, params.signal)))
  if (params.expectedCatalogManifestSha256 && manifest.catalogManifestSha256 !== params.expectedCatalogManifestSha256 ||
      params.expectedInventoryManifestSha256 && manifest.inventoryManifestSha256 !== params.expectedInventoryManifestSha256) throw new Error('Backend trajectory source snapshot changed')
  const idsHash = await digestStateTileRequestIds(params.bodyIds)
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let cancellation: Promise<void> | undefined
  const cancelBody = (): Promise<void> => {
    const stream = reader ?? response?.body
    // Do not cache a no-op while fetch is still waiting for headers.
    if (!stream) return Promise.resolve()
    return cancellation ??= stream.cancel(params.signal.reason).catch(() => undefined)
  }
  const abort = () => { void cancelBody() }
  params.signal.addEventListener('abort', abort, { once: true })
  try {
    params.signal.throwIfAborted()
    response = await setup(() => withTileAdmission(async () => {
      const received = await fetcher(`${params.base}/v1/state/window`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: params.signal,
        body: JSON.stringify({ ids: params.bodyIds, epochsJd: params.epochsTdbJd, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', fieldMask: ['position', 'velocity'] }) })
      response = received // Retain cleanup ownership even if setup rejects late headers.
      return received
    }))
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== STATE_WINDOW_MEDIA_TYPE || !response.body) throw new Error(`State window HTTP/protocol failure ${response.status}`)
    reader = response.body.getReader()
    let pending: Uint8Array = new Uint8Array(0), offset = 0
    const checkReadDeadline = (deadline: number) => {
      params.signal.throwIfAborted()
      if (performance.now() >= deadline) throw new Error('State window frame read deadline exceeded')
    }
    const readNext = async (deadline: number) => {
      checkReadDeadline(deadline)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const next = await Promise.race([
          reader!.read(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('State window frame read deadline exceeded')), Math.max(0, deadline-performance.now()))
          }),
        ])
        checkReadDeadline(deadline)
        return next
      } finally { clearTimeout(timer) }
    }
    const read = async (size: number, deadline: number) => {
      checkReadDeadline(deadline)
      if (!Number.isInteger(size) || size < 1 || size > MAX_STATE_TILE_BYTES) throw new Error('State window frame exceeds byte limit')
      const output = new Uint8Array(size)
      let written = 0
      while (written < size) {
        checkReadDeadline(deadline)
        if (offset === pending.length) {
          const next = await readNext(deadline)
          if (next.done) throw new Error('Truncated state window')
          pending = next.value; offset = 0
          if (!pending.length) continue
        }
        const count = Math.min(size - written, pending.length - offset)
        output.set(pending.subarray(offset, offset + count), written)
        offset += count; written += count
      }
      checkReadDeadline(deadline)
      return output
    }
    const frame = async (limit = MAX_STATE_TILE_BYTES) => {
      // One deadline spans prefix and payload, including empty/slow chunks.
      // Consumer pauses between yielded epochs do not spend this allowance.
      const deadline = performance.now() + 30_000
      const sizeBytes = await read(4, deadline)
      const size = new DataView(sizeBytes.buffer).getUint32(0, true)
      if (size > limit) throw new Error('State window metadata exceeds byte limit')
      return read(size, deadline)
    }
    const json = async (): Promise<Record<string, unknown>> => {
      return withTileAdmission(async () => {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await frame(8 * 1024 * 1024)))
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid state window metadata')
        const entry = value as Record<string, unknown>
        if (entry.kind === 'error') {
          const code = typeof entry.code === 'string' && /^[a-z_]{1,64}$/.test(entry.code) ? entry.code : 'state_unavailable'
          const message = typeof entry.message === 'string' ? entry.message.slice(0, 4096) : 'State window failed'
          const status = typeof entry.status === 'number' && Number.isInteger(entry.status) && entry.status >= 400 && entry.status <= 599 ? ` (${entry.status})` : ''
          const epoch = typeof entry.epochIndex === 'number' && Number.isInteger(entry.epochIndex) && entry.epochIndex >= 0 && entry.epochIndex < params.epochsTdbJd.length ? ` at epoch ${entry.epochIndex}` : ''
          throw new Error(`State window ${code}${status}${epoch}: ${message}`)
        }
        return entry
      })
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
        tiles.push(await withTileAdmission(async () => decodeStateTile(await frame(), { planHash: plan.planHash, catalogManifestSha256: plan.catalogManifestSha256,
          inventoryManifestSha256: plan.inventoryManifestSha256, sequence: descriptor.sequence, tileCount: plan.tileCount })))
      }
      const verified = assembleStateTiles(tiles, plan)
      exact += plan.exactCount; missing += plan.missingCount
      params.signal.throwIfAborted()
      yield { epochIndex, manifest, plan, tiles: verified }
    }
    const summary = await json()
    if (summary.kind !== 'complete' || summary.epochCount !== params.epochsTdbJd.length || summary.bodyCount !== params.bodyIds.length || summary.exactCount !== exact || summary.missingCount !== missing) throw new Error('State window completion mismatch')
    const end = await withTileAdmission(() => readNext(performance.now()+30_000))
    if (offset !== pending.length || !end.done) throw new Error('State window contains trailing data')
    params.signal.throwIfAborted()
  } finally {
    params.signal.removeEventListener('abort', abort)
    // A second cancel on an already-closed stream need not wait for the
    // underlying source's first cancellation. Join the original operation.
    await cancelBody()
    reader?.releaseLock()
  }
}
