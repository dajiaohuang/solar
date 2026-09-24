import { readBounded } from './stateTiles'
import columns from '../data/gaiaColumns.json'
import columnsV2 from '../data/gaiaColumnsV2.json'
import capacity from '../data/gaiaCapacity.json'
import type { GaiaSourceCache } from './gaiaCache'

export type GaiaChunkDescriptor = { path: string; sha256: string; bytes: number; rows: number; raRangeDeg: [number, number]; decRangeDeg: [number, number] }
export type GaiaManifest = { schemaVersion: 1 | 2; catalog: 'Gaia DR3'; frame: 'ICRS'; referenceEpochJulianYear: 2016; referenceEpochTimeScale: 'TCB'; rows: number; chunks: GaiaChunkDescriptor[]; catalogCompletenessCertified: false; queryCountMatched?: true; rowCountEvidence?: { method: 'top-plus-one-sentinel'; limit: number; returnedRows: number; overflow: false }; settings: { raDeg: number; decDeg: number; radiusDeg: number; maxMagnitude: number; maxRows: number } }
export type GaiaSkyRegion = { raStartDeg: number; raEndDeg: number; decMinDeg: number; decMaxDeg: number; epochJulianYear: 2016 }
export type GaiaSource = { source_id: string; ref_epoch: number; ra: number; dec: number; phot_g_mean_mag: number; [field: string]: string | number | null }
export type GaiaChunk = { descriptor: GaiaChunkDescriptor; sources: GaiaSource[]; directionsICRS: Float64Array }
const hashPattern = /^[a-f0-9]{64}$/
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid Gaia object'); return v as Record<string, unknown> }
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const integer = (v: unknown, min: number, max: number): v is number => number(v) && Number.isInteger(v) && v >= min && v <= max
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(number)
const cancelled = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Gaia loading cancelled', 'AbortError') }
/** Consumers may be waiting for a GPU acknowledgement that never arrives.
 * Observe their eventual settlement, but do not let them prevent cancellation. */
function consumeUntilAbort(consume: () => Promise<void>, signal: AbortSignal): Promise<void> {
  cancelled(signal)
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (failed: boolean, error?: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (failed) reject(error)
      else resolve()
    }
    const abort = () => finish(true, new DOMException('Gaia loading cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    Promise.resolve().then(() => { cancelled(signal); return consume() }).then(() => finish(false), error => finish(true, error))
  })
}
export async function gaiaHash(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), v => v.toString(16).padStart(2, '0')).join('')
}
export function decodeGaiaManifest(bytes: Uint8Array): GaiaManifest {
  if (bytes.byteLength < 1 || bytes.byteLength > capacity.maxManifestBytes) throw new Error('Gaia manifest size exceeds budget')
  const m = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  const settings = object(m.settings)
  if (!number(settings.raDeg) || settings.raDeg < 0 || settings.raDeg >= 360 || !number(settings.decDeg) || Math.abs(settings.decDeg) > 90 || !number(settings.radiusDeg) || settings.radiusDeg <= 0 || settings.radiusDeg > 2
    || !number(settings.maxMagnitude) || settings.maxMagnitude < 3 || settings.maxMagnitude > 20 || !integer(settings.maxRows, 1, capacity.maxCatalogRows)) throw new Error('Invalid Gaia cone selection')
  const rowCountEvidence = m.rowCountEvidence === undefined ? undefined : object(m.rowCountEvidence)
  const completeBySentinel = rowCountEvidence?.method === 'top-plus-one-sentinel' && rowCountEvidence.limit === settings.maxRows+1
    && rowCountEvidence.returnedRows === m.rows && rowCountEvidence.overflow === false
  const countMatched = m.queryCountMatched === true
  if ((m.schemaVersion !== 1 && m.schemaVersion !== 2) || m.catalog !== 'Gaia DR3' || m.table !== 'gaiadr3.gaia_source' || m.frame !== 'ICRS' || m.referenceEpochJulianYear !== 2016 || m.referenceEpochTimeScale !== 'TCB'
    || m.catalogCompletenessCertified !== false || !integer(m.rows, 0, capacity.maxCatalogRows) || (!countMatched && !completeBySentinel)
    || (m.rowCountEvidence !== undefined && !completeBySentinel) || !Array.isArray(m.chunks) || m.chunks.length > capacity.maxChunks) throw new Error('Gaia source frame or manifest contract mismatch')
  if (JSON.stringify(m.columns) !== JSON.stringify(m.schemaVersion === 2 ? columnsV2 : columns)) throw new Error('Gaia manifest columns mismatch')
  const paths = new Set<string>(); let rows = 0
  for (const item of m.chunks) {
    const c = object(item), match = typeof c.path === 'string' && /^r(\d+)-d(\d+)\.json$/.exec(c.path)
    if (!match || paths.has(c.path as string) || !integer(c.bytes, 1, capacity.maxChunkBytes) || !integer(c.rows, 1, capacity.maxChunkRows) || typeof c.sha256 !== 'string' || !hashPattern.test(c.sha256)
      || !pair(c.raRangeDeg) || !pair(c.decRangeDeg)) throw new Error('Invalid Gaia chunk descriptor')
    const ra = Number(match[1]), dec = Number(match[2])
    if (ra > 71 || dec > 35 || c.raRangeDeg[0] !== ra*5 || c.raRangeDeg[1] !== (ra+1)*5 || c.decRangeDeg[0] !== dec*5-90 || c.decRangeDeg[1] !== (dec+1)*5-90) throw new Error('Gaia spatial bin mismatch')
    paths.add(c.path as string); rows += c.rows
  }
  if (rows !== m.rows || rows > settings.maxRows) throw new Error('Gaia manifest row count mismatch')
  return m as unknown as GaiaManifest
}
/** Conservative rectangle filtering at the catalog epoch; wrapping RA is explicit. */
export function selectGaiaChunks(manifest: GaiaManifest, region: GaiaSkyRegion) {
  const { raStartDeg: a, raEndDeg: b, decMinDeg: lo, decMaxDeg: hi } = region
  if (![a,b,lo,hi].every(Number.isFinite) || a < 0 || a > 360 || b < 0 || b > 360 || lo < -90 || hi > 90 || lo > hi || region.epochJulianYear !== 2016) throw new Error('Gaia spatial bounds apply only at J2016.0')
  const intervals = a <= b ? [[a,b]] : [[a,360],[0,b]]
  const touchesSeam = intervals.some(([start,end]) => start === 0 || end === 360)
  return manifest.chunks.filter(c => c.decRangeDeg[0] <= hi && c.decRangeDeg[1] >= lo && (
    // At a pole all RA values denote the same direction. At the seam, 0 = 360.
    hi === 90 && c.decRangeDeg[1] === 90 || lo === -90 && c.decRangeDeg[0] === -90
    || touchesSeam && (c.raRangeDeg[0] === 0 || c.raRangeDeg[1] === 360)
    || intervals.some(([start,end]) => c.raRangeDeg[0] <= end && c.raRangeDeg[1] >= start)))
}
/** Private decode path: the scheduler checks the owned bytes against the
 * descriptor hash once before entering this parser, for cache and network alike. */
async function decodeVerifiedChunk(bytes: Uint8Array, descriptor: GaiaChunkDescriptor, settings: GaiaManifest['settings'], signal: AbortSignal, schemaVersion: 1 | 2): Promise<GaiaChunk> {
  const expectedColumns = schemaVersion === 2 ? columnsV2 : columns
  cancelled(signal)
  if (bytes.byteLength !== descriptor.bytes) throw new Error('Gaia chunk source size mismatch')
  const data = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (data.key !== descriptor.path.slice(0,-5) || JSON.stringify(data.raRangeDeg) !== JSON.stringify(descriptor.raRangeDeg) || JSON.stringify(data.decRangeDeg) !== JSON.stringify(descriptor.decRangeDeg)
    || !Array.isArray(data.sources) || data.sources.length !== descriptor.rows) throw new Error('Gaia chunk descriptor mismatch')
  const directions = new Float64Array(descriptor.rows*3); let previous = -1n
  for (let index = 0; index < data.sources.length; index++) {
    if (index && index%256 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); cancelled(signal) }
    const row = object(data.sources[index]), id = row.source_id
    if (typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n || BigInt(id) <= previous || row.ref_epoch !== 2016 || !number(row.ra) || row.ra < 0 || row.ra >= 360 || !number(row.dec) || Math.abs(row.dec) > 90 || !number(row.phot_g_mean_mag)
      || Math.floor(row.ra/5)*5 !== descriptor.raRangeDeg[0] || Math.min(35,Math.floor((row.dec+90)/5))*5-90 !== descriptor.decRangeDeg[0]) throw new Error('Invalid Gaia source identity or coordinates')
    previous = BigInt(id)
    if (Object.keys(row).length !== expectedColumns.length || expectedColumns.some(key => !Object.hasOwn(row,key))) throw new Error('Gaia source columns mismatch')
    for (const [key, value] of Object.entries(row)) {
      if (key === 'source_id' || value === null) continue
      if (!number(value) || key.endsWith('_error') && value < 0 || key.endsWith('_corr') && Math.abs(value) > 1) throw new Error('Invalid Gaia numeric field')
    }
    if (![3,31,95].includes(row.astrometric_params_solved as number) || row.phot_g_mean_mag > settings.maxMagnitude) throw new Error('Gaia source selection mismatch')
    const rad = Math.PI/180, center = settings.decDeg*rad, sourceDec = row.dec*rad
    const hav = Math.sin((sourceDec-center)/2)**2+Math.cos(sourceDec)*Math.cos(center)*Math.sin((row.ra-settings.raDeg)*rad/2)**2
    if (2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,hav))))/rad > settings.radiusDeg+1e-9) throw new Error('Gaia row outside requested cone')
    const ra = row.ra*Math.PI/180, dec = row.dec*Math.PI/180, cos = Math.cos(dec)
    directions[index*3] = cos*Math.cos(ra); directions[index*3+1] = cos*Math.sin(ra); directions[index*3+2] = Math.sin(dec)
  }
  cancelled(signal)
  // Consumers own this copy. Mutating callback metadata must not alter the
  // scheduler's reservation release, counts or the pinned manifest snapshot.
  return { descriptor: { ...descriptor, raRangeDeg: [...descriptor.raRangeDeg], decRangeDeg: [...descriptor.decRangeDeg] }, sources: data.sources as GaiaSource[], directionsICRS: directions }
}

/** Rolling bounded admission. Awaiting the consumer is the decode/upload backpressure
 * boundary; retained consumer/GPU storage is outside these in-flight budgets.
 * Consumers receive the batch signal so pending uploads can release their own
 * callbacks immediately when another chunk fails or reaches its deadline. */
export async function streamGaiaChunks(options: {
  manifest: GaiaManifest; region: GaiaSkyRegion; baseUrl: string; signal: AbortSignal
  onChunk: (chunk: GaiaChunk, signal: AbortSignal) => Promise<void>; fetcher?: typeof fetch
  /** Return owned bytes that will not be mutated after resolution. Called only
   * after reserving the descriptor budget; must honor the supplied signal. */
  readChunk?: (path: string, expectedBytes: number, signal: AbortSignal) => Promise<Uint8Array>
  cache?: GaiaSourceCache
  concurrency?: number; maxInFlightBytes?: number; maxInFlightRows?: number; maxTotalBytes?: number
}) {
  // Let small shards overlap more; encoded-byte and row reservations still cap total in-flight work.
  const { signal, onChunk, cache, readChunk, fetcher = fetch, concurrency = 4, maxInFlightBytes = capacity.defaultInFlightBytes, maxInFlightRows = capacity.defaultInFlightRows, maxTotalBytes = capacity.maxSelectedBytes } = options
  cancelled(signal)
  if (readChunk && options.fetcher) throw new Error('Choose one Gaia chunk source reader')
  const region: GaiaSkyRegion = { ...options.region }
  // Own one validated snapshot so caller edits cannot change in-flight paths or budgets.
  const manifest = decodeGaiaManifest(new TextEncoder().encode(JSON.stringify(options.manifest)))
  if (!integer(concurrency, 1, 8) || !integer(maxInFlightBytes, 1, 64*1024*1024) || !integer(maxInFlightRows, 1, 100000) || !integer(maxTotalBytes, 1, 1024*1024*1024)) throw new Error('Invalid Gaia loading budget')
  const base = new URL(options.baseUrl)
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) throw new Error('Invalid Gaia chunk base URL')
  const selected = selectGaiaChunks(manifest, region), totalBytes = selected.reduce((sum,c) => sum+c.bytes, 0)
  if (totalBytes > maxTotalBytes || selected.some(c => c.bytes > maxInFlightBytes || c.rows > maxInFlightRows)) throw new Error('Selected Gaia data exceeds loading budget')
  const controller = new AbortController(), abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
  let verifiedRows = 0, verifiedChunks = 0, peakReservedBytes = 0, peakReservedRows = 0, cacheHits = 0
  let cacheHitBytes = 0, sourceReadChunks = 0, sourceReadBytes = 0
  const sourceIds = new Set<string>()
  const active = new Set<Promise<void>>()
  let reservedBytes = 0, reservedRows = 0, peakActiveChunks = 0
  let failed = false, failure: unknown
  let consume = Promise.resolve()
  const launch = (descriptor: GaiaChunkDescriptor) => {
    reservedBytes += descriptor.bytes; reservedRows += descriptor.rows
    peakReservedBytes = Math.max(peakReservedBytes, reservedBytes)
    peakReservedRows = Math.max(peakReservedRows, reservedRows)
    const job = (async () => {
      const deadline = performance.now() + 30000
      const check = () => {
        if (performance.now() >= deadline) {
          const error = new Error('Gaia chunk deadline exceeded')
          controller.abort(error)
          throw error
        }
        cancelled(controller.signal)
      }
      const timeout = setTimeout(abort, 30000)
      try {
        check()
        let bytes = cache?.get(descriptor.sha256, descriptor.bytes)
        if (bytes && (bytes.byteLength !== descriptor.bytes || await gaiaHash(bytes) !== descriptor.sha256)) { cache?.delete(descriptor.sha256); bytes = undefined }
        check()
        const cached = Boolean(bytes)
        if (!bytes) {
          if (readChunk) {
            bytes = await readChunk(descriptor.path, descriptor.bytes, controller.signal)
          } else {
            const response = await fetcher(new URL(descriptor.path, base), { signal: controller.signal, redirect: 'error' })
            try { check() } catch (error) { await response.body?.cancel().catch(() => undefined); throw error }
            if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`Gaia chunk HTTP ${response.status}`) }
            bytes = await readBounded(response, 'application/json', descriptor.bytes, controller.signal)
          }
          check()
          if (!(bytes instanceof Uint8Array) || bytes.byteLength !== descriptor.bytes || await gaiaHash(bytes) !== descriptor.sha256) throw new Error('Gaia chunk source hash mismatch')
        }
        check()
        const chunk = await decodeVerifiedChunk(bytes, descriptor, manifest.settings, controller.signal, manifest.schemaVersion)
        check()
        for (const source of chunk.sources) {
          if (sourceIds.has(source.source_id)) throw new Error('Duplicate Gaia source across chunks')
          sourceIds.add(source.source_id)
        }
        check()
        if (cached) { cacheHits++; cacheHitBytes += descriptor.bytes }
        else { sourceReadChunks++; sourceReadBytes += descriptor.bytes; cache?.put(descriptor.sha256,bytes) }
        consume = consume.then(async () => { check(); await consumeUntilAbort(() => { check(); return onChunk(chunk, controller.signal) }, controller.signal); check(); verifiedRows += descriptor.rows; verifiedChunks++ })
        await consume
      } finally { clearTimeout(timeout) }
    })().catch(error => {
      if (!failed) { failed = true; failure = error }
      abort()
    }).finally(() => {
      reservedBytes -= descriptor.bytes; reservedRows -= descriptor.rows
      active.delete(job)
    })
    active.add(job)
    peakActiveChunks = Math.max(peakActiveChunks, active.size)
  }
  try {
    let offset = 0
    while (offset < selected.length || active.size) {
      if (failed) throw failure
      cancelled(controller.signal)
      while (offset < selected.length && active.size < concurrency) {
        const next = selected[offset]
        if (reservedBytes+next.bytes > maxInFlightBytes || reservedRows+next.rows > maxInFlightRows) break
        launch(next); offset++
      }
      // Each descriptor fits an empty budget. Keep its reservation through
      // decoding and serial consumption, releasing it only when the job ends.
      if (active.size) await Promise.race(active)
    }
    if (failed) throw failure
    cancelled(controller.signal)
    return {
      selection: {
        method: 'conservative-closed-spatial-bin-intersection' as const,
        region, frame: 'ICRS' as const, epochTimeScale: 'TCB' as const,
        rowFilterApplied: false as const,
        selectedPaths: selected.map(chunk => chunk.path),
        omittedManifestChunks: manifest.chunks.length-selected.length,
        allManifestChunksVerified: verifiedChunks === manifest.chunks.length,
        limitation: 'Entire intersecting bins are retained; rows may lie outside the requested rectangle. Omitted bins are not inspected. Loading all manifest chunks does not establish sky or catalog completeness.',
      },
      selectedChunks: selected.length, verifiedChunks, verifiedRows, totalBytes,
      peakReservedBytes, peakReservedRows, peakActiveChunks,
      loadingBudget: { concurrency, maxInFlightBytes, maxInFlightRows, maxTotalBytes },
      cacheHits, cacheHitBytes, sourceReadChunks, sourceReadBytes,
      sourceReadSemantics: 'verified-chunk-source-bytes-excluding-manifest-and-transport-overhead' as const,
      cacheRetainedBytes: cache?.retainedBytes ?? 0,
      epochJulianYear: 2016 as const, catalogCompletenessCertified: false as const,
    }
  } finally { abort(); await Promise.all(active); signal.removeEventListener('abort', abort) }
}
