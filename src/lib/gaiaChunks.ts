import { readBounded } from './stateTiles'

export type GaiaChunkDescriptor = { path: string; sha256: string; bytes: number; rows: number; raRangeDeg: [number, number]; decRangeDeg: [number, number] }
export type GaiaManifest = { schemaVersion: 1; catalog: 'Gaia DR3'; frame: 'ICRS'; referenceEpochJulianYear: 2016; referenceEpochTimeScale: 'TCB'; rows: number; chunks: GaiaChunkDescriptor[]; catalogCompletenessCertified: false; settings: { raDeg: number; decDeg: number; radiusDeg: number; maxMagnitude: number; maxRows: number } }
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
    const abort = () => reject(new DOMException('Gaia loading cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { cancelled(signal); return consume() }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
export async function gaiaHash(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), v => v.toString(16).padStart(2, '0')).join('')
}
export function decodeGaiaManifest(bytes: Uint8Array): GaiaManifest {
  if (bytes.byteLength < 1 || bytes.byteLength > 1024*1024) throw new Error('Gaia manifest size exceeds budget')
  const m = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  const settings = object(m.settings)
  if (!number(settings.raDeg) || settings.raDeg < 0 || settings.raDeg >= 360 || !number(settings.decDeg) || Math.abs(settings.decDeg) > 90 || !number(settings.radiusDeg) || settings.radiusDeg <= 0 || settings.radiusDeg > 2
    || !number(settings.maxMagnitude) || !integer(settings.maxRows, 1, 10000)) throw new Error('Invalid Gaia cone selection')
  if (m.schemaVersion !== 1 || m.catalog !== 'Gaia DR3' || m.table !== 'gaiadr3.gaia_source' || m.frame !== 'ICRS' || m.referenceEpochJulianYear !== 2016 || m.referenceEpochTimeScale !== 'TCB'
    || m.catalogCompletenessCertified !== false || m.queryCountMatched !== true || !integer(m.rows, 0, 10000) || !Array.isArray(m.chunks) || m.chunks.length > 2592) throw new Error('Gaia source frame or manifest contract mismatch')
  const paths = new Set<string>(); let rows = 0
  for (const item of m.chunks) {
    const c = object(item), match = typeof c.path === 'string' && /^r(\d+)-d(\d+)\.json$/.exec(c.path)
    if (!match || paths.has(c.path as string) || !integer(c.bytes, 1, 8*1024*1024) || !integer(c.rows, 1, 10000) || typeof c.sha256 !== 'string' || !hashPattern.test(c.sha256)
      || !pair(c.raRangeDeg) || !pair(c.decRangeDeg)) throw new Error('Invalid Gaia chunk descriptor')
    const ra = Number(match[1]), dec = Number(match[2])
    if (ra > 71 || dec > 35 || c.raRangeDeg[0] !== ra*5 || c.raRangeDeg[1] !== (ra+1)*5 || c.decRangeDeg[0] !== dec*5-90 || c.decRangeDeg[1] !== (dec+1)*5-90) throw new Error('Gaia spatial bin mismatch')
    paths.add(c.path as string); rows += c.rows
  }
  if (rows !== m.rows) throw new Error('Gaia manifest row count mismatch')
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
async function decodeChunk(bytes: Uint8Array, descriptor: GaiaChunkDescriptor, signal: AbortSignal): Promise<GaiaChunk> {
  cancelled(signal)
  if (bytes.byteLength !== descriptor.bytes || await gaiaHash(bytes) !== descriptor.sha256) throw new Error('Gaia chunk source hash mismatch')
  cancelled(signal)
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
    if (Object.keys(row).length > 32) throw new Error('Gaia row exceeds field budget')
    for (const [key, value] of Object.entries(row)) {
      if (key === 'source_id' || value === null) continue
      if (!number(value) || key.endsWith('_error') && value < 0 || key.endsWith('_corr') && Math.abs(value) > 1) throw new Error('Invalid Gaia numeric field')
    }
    const ra = row.ra*Math.PI/180, dec = row.dec*Math.PI/180, cos = Math.cos(dec)
    directions[index*3] = cos*Math.cos(ra); directions[index*3+1] = cos*Math.sin(ra); directions[index*3+2] = Math.sin(dec)
  }
  cancelled(signal)
  return { descriptor, sources: data.sources as GaiaSource[], directionsICRS: directions }
}

/** Bounded parallel waves. Awaiting the consumer is the decode/upload backpressure
 * boundary; retained consumer/GPU storage is outside these in-flight budgets. */
export async function streamGaiaChunks(options: {
  manifest: GaiaManifest; region: GaiaSkyRegion; baseUrl: string; signal: AbortSignal
  onChunk: (chunk: GaiaChunk) => Promise<void>; fetcher?: typeof fetch
  concurrency?: number; maxInFlightBytes?: number; maxInFlightRows?: number; maxTotalBytes?: number
}) {
  const { region, signal, onChunk, fetcher = fetch, concurrency = 2, maxInFlightBytes = 16*1024*1024, maxInFlightRows = 20000, maxTotalBytes = 64*1024*1024 } = options
  // Own one validated snapshot so caller edits cannot change in-flight paths or budgets.
  const manifest = decodeGaiaManifest(new TextEncoder().encode(JSON.stringify(options.manifest)))
  if (!integer(concurrency, 1, 8) || !integer(maxInFlightBytes, 1, 64*1024*1024) || !integer(maxInFlightRows, 1, 100000) || !integer(maxTotalBytes, 1, 1024*1024*1024)) throw new Error('Invalid Gaia loading budget')
  const base = new URL(options.baseUrl)
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) throw new Error('Invalid Gaia chunk base URL')
  const selected = selectGaiaChunks(manifest, region), totalBytes = selected.reduce((sum,c) => sum+c.bytes, 0)
  if (totalBytes > maxTotalBytes || selected.some(c => c.bytes > maxInFlightBytes || c.rows > maxInFlightRows)) throw new Error('Selected Gaia data exceeds loading budget')
  const controller = new AbortController(), abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
  let verifiedRows = 0, verifiedChunks = 0, peakReservedBytes = 0, peakReservedRows = 0
  try {
    let offset = 0
    while (offset < selected.length) {
      cancelled(controller.signal)
      const wave: GaiaChunkDescriptor[] = []; let bytes = 0, rows = 0
      while (offset < selected.length && wave.length < concurrency) {
        const next = selected[offset]
        if (bytes+next.bytes > maxInFlightBytes || rows+next.rows > maxInFlightRows) break
        wave.push(next); offset++; bytes += next.bytes; rows += next.rows
      }
      peakReservedBytes = Math.max(peakReservedBytes, bytes); peakReservedRows = Math.max(peakReservedRows, rows)
      let consume = Promise.resolve()
      const jobs = wave.map(async descriptor => {
        const timeout = setTimeout(abort, 30000)
        try {
          const response = await fetcher(new URL(descriptor.path, base), { signal: controller.signal, redirect: 'error' })
          if (!response.ok) throw new Error(`Gaia chunk HTTP ${response.status}`)
          const bytes = new Uint8Array(await readBounded(response, 'application/json', descriptor.bytes))
          const chunk = await decodeChunk(bytes, descriptor, controller.signal)
          consume = consume.then(async () => { cancelled(controller.signal); await consumeUntilAbort(() => onChunk(chunk), controller.signal); cancelled(controller.signal); verifiedRows += descriptor.rows; verifiedChunks++ })
          await consume
        } finally { clearTimeout(timeout) }
      })
      try { await Promise.all(jobs) } catch (error) { abort(); await Promise.allSettled(jobs); throw error }
    }
    cancelled(controller.signal)
    return { selectedChunks: selected.length, verifiedChunks, verifiedRows, totalBytes, peakReservedBytes, peakReservedRows, epochJulianYear: 2016 as const, catalogCompletenessCertified: false as const }
  } finally { signal.removeEventListener('abort', abort) }
}
