import { AU_IN_KM } from '../engine/units'
import type { BackendFrame, BackendStateEvidence, StateTileAudit } from './backendFrames'
import type { BodyId, CelestialBody, RenderedBodyPosition, Vector3 } from '../types'

export const STATE_TILE_MAGIC = Uint8Array.from([0x53, 0x4c, 0x52, 0x54, 0x49, 0x4c, 0x45, 0x00])
export const STATE_TILE_VERSION = 1
export const STATE_TILE_HEADER_BYTES = 200
export const STATE_TILE_STRIDE = 6
export const STATE_TILE_FIELD_MASK = 3
export const STATE_TILE_CONCURRENCY = 2
export const STATE_TILE_API_VERSION = 'solar.api/v1'
export const MAX_STATE_PLAN_BODIES = 32_768
export const MAX_STATE_PLAN_TILES = 32_768
export const MAX_STATE_TILE_BYTES = 64 * 1024 * 1024
export const STATE_TILE_MEDIA_TYPE = 'application/vnd.solar.state-tile+binary'
const SHA256 = /^[a-f0-9]{64}$/

export type StateTileMetadata = {
  id: string
  backendId?: string
  availability?: string
  precision?: string
  source: string
  datasetVersion: string
  datasetSha256?: string
  kernelSha256?: string
  model: string
  centerId: string
  validityStartEt?: number
  validityEndEt?: number
  validityPresent?: boolean
  stateEvidence?: string
  evidenceWindowStartEt?: number
  evidenceWindowEndEt?: number
  evidenceWindowPresent?: boolean
  missingReason?: string
  identityStatus?: string
  sourceRecord?: boolean
}

const EVIDENCE_STRINGS = ['id', 'source', 'datasetVersion', 'datasetSha256', 'kernelSha256', 'model', 'centerId', 'stateEvidence', 'missingReason', 'identityStatus'] as const
const EVIDENCE_NUMBERS = ['validityStartEt', 'validityEndEt', 'evidenceWindowStartEt', 'evidenceWindowEndEt'] as const

/** Immutable, column-packed evidence for a verified tile. Decoding validates
 * each wire row before packing; no parsed row objects survive here.
 * Only an explicitly requested row is materialized, without an object cache. */
class StateTileEvidence {
  readonly length: number
  readonly #strings: string[] = []
  readonly #stringIndexes: Uint32Array
  readonly #numbers: Float64Array
  readonly #flags: Uint8Array

  constructor(length: number, readValidatedRow: (index: number) => StateTileMetadata) {
    this.length = length
    this.#stringIndexes = new Uint32Array(length * EVIDENCE_STRINGS.length)
    this.#numbers = new Float64Array(length * EVIDENCE_NUMBERS.length)
    this.#flags = new Uint8Array(length)
    // The interning Map is construction-only; frames retain just the table.
    const dictionary = new Map<string, number>()
    for (let index = 0; index < length; index++) {
      const row = readValidatedRow(index)
      for (let column = 0; column < EVIDENCE_STRINGS.length; column++) {
        const value = row[EVIDENCE_STRINGS[column]]!
        let ordinal = dictionary.get(value)
        if (ordinal === undefined) { ordinal = this.#strings.length; this.#strings.push(value); dictionary.set(value, ordinal) }
        this.#stringIndexes[column * length + index] = ordinal
      }
      for (let column = 0; column < EVIDENCE_NUMBERS.length; column++) this.#numbers[column * length + index] = row[EVIDENCE_NUMBERS[column]]!
      this.#flags[index] = Number(row.validityPresent) | (Number(row.evidenceWindowPresent) << 1) | (Number(row.sourceRecord) << 2)
    }
  }

  /** Typed-column bytes only, not a JavaScript heap/RSS estimate. */
  get numericByteLength() { return this.#stringIndexes.byteLength + this.#numbers.byteLength + this.#flags.byteLength }
  get internedStringCount() { return this.#strings.length }

  #check(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError('State tile evidence ordinal is out of range')
  }

  idAt(index: number): string {
    this.#check(index)
    return this.#strings[this.#stringIndexes[index]]
  }

  missingReasonAt(index: number): string {
    this.#check(index)
    return this.#strings[this.#stringIndexes[8 * this.length + index]]
  }

  rowAt(index: number): StateTileMetadata {
    this.#check(index)
    const row: Record<string, string | number | boolean> = {}
    for (let column = 0; column < EVIDENCE_STRINGS.length; column++) row[EVIDENCE_STRINGS[column]] = this.#strings[this.#stringIndexes[column * this.length + index]]
    for (let column = 0; column < EVIDENCE_NUMBERS.length; column++) row[EVIDENCE_NUMBERS[column]] = this.#numbers[column * this.length + index]
    row.validityPresent = Boolean(this.#flags[index] & 1)
    row.evidenceWindowPresent = Boolean(this.#flags[index] & 2)
    row.sourceRecord = Boolean(this.#flags[index] & 4)
    return row as StateTileMetadata
  }
}

export type StateTile = {
  sequence: number
  tileCount: number
  ordinalStart: number
  recordCount: number
  stride: number
  fieldMask: number
  epochJd: number
  metadata: StateTileEvidence
  exactBitmap: Uint8Array
  approximateBitmap: Uint8Array
  missingBitmap: Uint8Array
  states: Float64Array
  planHash: string
  catalogManifestSha256: string
  inventoryManifestSha256?: string
  payloadSha256: string
}

export type StateTileDescriptor = { sequence: number; ordinalStart: number; recordCount: number; url?: string }

export type StateTileManifest = {
  apiVersion: string
  catalogVersion: string
  catalogManifestSha256: string
  inventoryManifestSha256?: string
  planPath?: string
  tilePath?: string
}

export type StateTilePlan = {
  apiVersion: string
  catalogVersion: string
  planHash: string
  requestIdsSha256: string
  requestIds: string[]
  catalogManifestSha256: string
  inventoryManifestSha256?: string
  epochJd: number
  timeScale: 'TDB'
  frame: 'ECLIPJ2000'
  stateOriginId: 'naif:0'
  stride: number
  fieldMask: number
  tileCount: number
  recordCount: number
  exactCount: number
  approximateCount: number
  missingCount: number
  tiles: StateTileDescriptor[]
}

export type StateTileRequest = {
  bodyIds: string[]
  epochJd: number
  frame: 'ECLIPJ2000'
  timeScale: 'TDB'
  fieldMask: string[]
  precision: 'exact'
}

function fail(message: string): never { throw new Error(`State tile ${message}`) }
function isSha(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value) }
function hex(bytes: Uint8Array) { return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') }
function bytesFromHex(value: string) {
  if (!isSha(value)) fail('hash is not lowercase sha256')
  const bytes = new Uint8Array(32)
  for (let index = 0; index < 32; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return bytes
}
function digest(bytes: Uint8Array) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return Promise.reject(new Error('State tile SHA-256 is unavailable'))
  const stable = new Uint8Array(bytes.byteLength); stable.set(bytes)
  return crypto.subtle.digest('SHA-256', stable.buffer).then(value => hex(new Uint8Array(value)))
}
export async function digestStateTileRequestIds(ids: readonly string[]) {
  const encoded = ids.map(id => new TextEncoder().encode(id))
  const total = encoded.reduce((sum, value) => sum + 4 + value.byteLength, 0)
  const bytes = new Uint8Array(total); const view = new DataView(bytes.buffer); let offset = 0
  for (const value of encoded) { view.setUint32(offset, value.byteLength, true); offset += 4; bytes.set(value, offset); offset += value.byteLength }
  return digest(bytes)
}
function asBytes(value: ArrayBuffer | Uint8Array) { return value instanceof Uint8Array ? value : new Uint8Array(value) }
function bitmapBytes(recordCount: number) { return Math.ceil(recordCount / 8) }
function hasBit(bitmap: Uint8Array, index: number) { return (bitmap[index >> 3] & (1 << (index & 7))) !== 0 }
function setBit(bitmap: Uint8Array, index: number) { bitmap[index >> 3] |= 1 << (index & 7) }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }

/** Stable deduplication and protocol-sized partitioning without dropping IDs. */
export function chunkStatePlanIds(bodyIds: readonly string[], maxIds = MAX_STATE_PLAN_BODIES): string[][] {
  if (!Number.isSafeInteger(maxIds) || maxIds < 1 || maxIds > MAX_STATE_PLAN_BODIES) fail('plan chunk size is invalid')
  const unique: string[] = []
  const seen = new Set<string>()
  for (const rawId of bodyIds) {
    const id = rawId.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  const chunks: string[][] = []
  for (let start = 0; start < unique.length; start += maxIds) chunks.push(unique.slice(start, start + maxIds))
  return chunks
}

export function validateStateTileManifest(raw: unknown): StateTileManifest {
  if (!raw || typeof raw !== 'object') fail('manifest is not an object')
  const value = raw as Record<string, unknown>
  if (value.apiVersion !== STATE_TILE_API_VERSION) fail('manifest api version is invalid')
  if (typeof value.catalogVersion !== 'string' || !value.catalogVersion) fail('manifest catalog version is invalid')
  if (!isSha(value.catalogManifestSha256)) fail('manifest catalog hash is invalid')
  if (value.inventoryManifestSha256 !== undefined && !isSha(value.inventoryManifestSha256)) fail('manifest inventory hash is invalid')
  return { apiVersion: STATE_TILE_API_VERSION, catalogVersion: value.catalogVersion, catalogManifestSha256: value.catalogManifestSha256, inventoryManifestSha256: value.inventoryManifestSha256 as string | undefined, planPath: value.planPath as string | undefined, tilePath: value.tilePath as string | undefined }
}

class StateTileProtocolError extends Error {}
class StateTileRetryableError extends Error {}

function retryableStatus(status: number) { return status === 408 || status === 429 || status >= 500 }
function normalizedContentType(response: Response) { return (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase() }
function contentLength(response: Response, limit: number) {
  const raw = response.headers.get('content-length')
  const value = raw === null ? NaN : Number(raw)
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new StateTileProtocolError('State tile content length is invalid')
  return value
}

async function readBounded(response: Response, expectedType: string, limit: number) {
  if (normalizedContentType(response) !== expectedType) throw new StateTileProtocolError('State tile content type is invalid')
  const expectedLength = contentLength(response, limit)
  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength !== expectedLength) throw new StateTileProtocolError('State tile content length mismatch')
    return body
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!next.value) throw new StateTileProtocolError('State tile body has no chunk')
      total += next.value.byteLength
      if (total > limit || total > expectedLength) throw new StateTileProtocolError('State tile body exceeds declared size')
      chunks.push(next.value)
    }
    if (total !== expectedLength) throw new StateTileProtocolError('State tile content length mismatch')
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
  const body = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}

export async function readStateTileJson(response: Response, name: string) {
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}`)
  if (normalizedContentType(response) !== 'application/json') throw new StateTileProtocolError(`${name} content type is invalid`)
  const length = contentLength(response, 4 * 1024 * 1024)
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength !== length) throw new StateTileProtocolError(`${name} content length mismatch`)
    return JSON.parse(text) as unknown
  }
  const bytes = await readBounded(response, 'application/json', 4 * 1024 * 1024)
  if (bytes.byteLength !== length) throw new StateTileProtocolError(`${name} content length mismatch`)
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export function validateStateTilePlan(raw: unknown, manifest: StateTileManifest, epochJd: number, requestIds: readonly string[], expectedRequestIdsSha256: string): StateTilePlan {
  if (!raw || typeof raw !== 'object') fail('plan is not an object')
  const value = raw as Record<string, unknown>
  const planHash = value.planHash ?? value.planId
  if (value.apiVersion !== STATE_TILE_API_VERSION || typeof value.catalogVersion !== 'string' || value.catalogVersion !== manifest.catalogVersion || !isSha(planHash) || !isSha(value.requestIdsSha256) || !isSha(value.catalogManifestSha256) || value.catalogManifestSha256 !== manifest.catalogManifestSha256) fail('plan/catalog identity mismatch')
  if (value.inventoryManifestSha256 !== manifest.inventoryManifestSha256) fail('plan/inventory identity mismatch')
  if (typeof value.epochJd !== 'number' || !Number.isFinite(value.epochJd) || Math.abs(value.epochJd - epochJd) > 1e-9) fail('plan epoch mismatch')
  if (value.timeScale !== 'TDB' || value.frame !== 'ECLIPJ2000' || value.precision !== 'exact' || value.stateOriginId !== 'naif:0' || value.distanceUnit !== 'km' || value.velocityUnit !== 'km/s' || value.stride !== STATE_TILE_STRIDE || !Array.isArray(value.fieldMask) || value.fieldMask.length !== 2 || value.fieldMask[0] !== 'position' || value.fieldMask[1] !== 'velocity') fail('plan numeric contract mismatch')
  const tileCount = value.tileCount; const bodyCount = value.bodyCount
  const exactCount = value.exactCount; const approximateCount = value.approximateCount; const missingCount = value.missingCount
  if (typeof tileCount !== 'number' || typeof bodyCount !== 'number' || typeof exactCount !== 'number' || typeof approximateCount !== 'number' || typeof missingCount !== 'number' || !Number.isSafeInteger(tileCount) || !Number.isSafeInteger(bodyCount) || !Number.isSafeInteger(exactCount) || !Number.isSafeInteger(approximateCount) || !Number.isSafeInteger(missingCount) || tileCount < 1 || tileCount > MAX_STATE_PLAN_TILES || bodyCount < 1 || bodyCount > MAX_STATE_PLAN_BODIES || exactCount < 0 || approximateCount !== 0 || missingCount < 0 || exactCount + approximateCount + missingCount !== bodyCount || !Array.isArray(value.tiles) || value.tiles.length !== tileCount) fail('plan tile inventory is invalid')
  const tiles = value.tiles.map((rawTile, index) => {
    if (!rawTile || typeof rawTile !== 'object') fail('plan tile descriptor is invalid')
    const tile = rawTile as Record<string, unknown>
    const ordinalStart = tile.ordinalStart; const ordinalCount = tile.ordinalCount
    if (tile.sequence !== index || typeof ordinalStart !== 'number' || typeof ordinalCount !== 'number' || !Number.isSafeInteger(ordinalStart) || !Number.isSafeInteger(ordinalCount) || ordinalCount < 1) fail('plan tile ordering is invalid')
    return { sequence: index, ordinalStart, recordCount: ordinalCount, url: typeof tile.url === 'string' ? tile.url : undefined }
  })
  if (tiles[0]?.ordinalStart !== 0 || tiles.some((tile, index) => index > 0 && tile.ordinalStart !== tiles[index - 1].ordinalStart + tiles[index - 1].recordCount) || tiles.reduce((sum, tile) => sum + tile.recordCount, 0) !== bodyCount) fail('plan record count or ordinal continuity mismatch')
  if (requestIds.length !== bodyCount || !isSha(expectedRequestIdsSha256) || value.requestIdsSha256 !== expectedRequestIdsSha256) fail('plan request identity mismatch')
  return { apiVersion: STATE_TILE_API_VERSION, catalogVersion: value.catalogVersion, planHash, requestIdsSha256: value.requestIdsSha256 as string, requestIds: [...requestIds], catalogManifestSha256: value.catalogManifestSha256, inventoryManifestSha256: value.inventoryManifestSha256 as string | undefined, epochJd: value.epochJd, timeScale: 'TDB', frame: 'ECLIPJ2000', stateOriginId: 'naif:0', stride: STATE_TILE_STRIDE, fieldMask: STATE_TILE_FIELD_MASK, tileCount, recordCount: bodyCount, exactCount, approximateCount, missingCount, tiles }
}

export async function decodeStateTile(input: ArrayBuffer | Uint8Array, expected: { planHash: string; catalogManifestSha256: string; inventoryManifestSha256?: string; sequence?: number; tileCount?: number }): Promise<StateTile> {
  const bytes = asBytes(input)
  if (bytes.byteLength > MAX_STATE_TILE_BYTES) fail('exceeds the 64 MiB limit')
  if (bytes.byteLength < STATE_TILE_HEADER_BYTES) fail('is shorter than its header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let index = 0; index < STATE_TILE_MAGIC.length; index += 1) if (view.getUint8(index) !== STATE_TILE_MAGIC[index]) fail('magic mismatch')
  if (view.getUint16(8, true) !== STATE_TILE_VERSION || view.getUint16(10, true) !== STATE_TILE_HEADER_BYTES) fail('version/header length mismatch')
  const sequence = view.getUint32(12, true)
  const tileCount = view.getUint32(16, true)
  const ordinalStart = view.getUint32(20, true)
  const recordCount = view.getUint32(24, true)
  const stride = view.getUint16(28, true)
  const fieldMask = view.getUint16(30, true)
  const epochJd = view.getFloat64(32, true)
  const metadataOffset = view.getUint32(40, true)
  const metadataLength = view.getUint32(44, true)
  const exactBitmapOffset = view.getUint32(48, true)
  const bitmapLength = view.getUint32(52, true)
  const approximateBitmapOffset = view.getUint32(56, true)
  const missingBitmapOffset = view.getUint32(60, true)
  const statesOffset = view.getUint32(64, true)
  const statesLength = view.getUint32(68, true)
  if (stride !== STATE_TILE_STRIDE || fieldMask !== STATE_TILE_FIELD_MASK || !Number.isFinite(epochJd) || recordCount < 1 || recordCount > MAX_STATE_PLAN_BODIES || tileCount < 1 || tileCount > MAX_STATE_PLAN_TILES || sequence >= tileCount) fail('numeric fields are invalid')
  if (expected.sequence !== undefined && sequence !== expected.sequence) fail('sequence mismatch')
  if (expected.tileCount !== undefined && tileCount !== expected.tileCount) fail('tile count mismatch')
  const planHash = hex(bytes.slice(72, 104)); const catalogHash = hex(bytes.slice(104, 136)); const inventoryBytes = bytes.slice(136, 168); const payloadHash = hex(bytes.slice(168, 200))
  const inventoryHash = inventoryBytes.some(Boolean) ? hex(inventoryBytes) : undefined
  if (planHash !== expected.planHash || catalogHash !== expected.catalogManifestSha256 || inventoryHash !== expected.inventoryManifestSha256 || !isSha(payloadHash)) fail('header identity mismatch')
  const bitmapLengthExpected = bitmapBytes(recordCount)
  if (metadataOffset !== STATE_TILE_HEADER_BYTES || metadataLength < 1 || metadataOffset + metadataLength > bytes.byteLength || exactBitmapOffset !== metadataOffset + metadataLength || bitmapLength !== bitmapLengthExpected || approximateBitmapOffset !== exactBitmapOffset + bitmapLength || missingBitmapOffset !== approximateBitmapOffset + bitmapLength || missingBitmapOffset + bitmapLength > bytes.byteLength || statesOffset !== Math.ceil((missingBitmapOffset + bitmapLength) / 8) * 8 || statesOffset % 8 !== 0 || statesLength !== recordCount * stride * 8 || statesOffset + statesLength !== bytes.byteLength) fail('section offsets are invalid')
  const payload = bytes.subarray(STATE_TILE_HEADER_BYTES)
  if (await digest(payload) !== payloadHash) fail('payload checksum mismatch')
  const metadataEnd = metadataOffset + metadataLength
  if (bytes[metadataEnd - 1] !== 10) fail('metadata is not canonical NDJSON')
  const textDecoder = new TextDecoder('utf-8', { fatal: true })
  const exactBitmap = bytes.slice(exactBitmapOffset, exactBitmapOffset + bitmapLength); const approximateBitmap = bytes.slice(approximateBitmapOffset, approximateBitmapOffset + bitmapLength); const missingBitmap = bytes.slice(missingBitmapOffset, missingBitmapOffset + bitmapLength)
  const usedBits = recordCount & 7
  if (usedBits !== 0) {
    const unusedMask = (0xff << usedBits) & 0xff
    if ((exactBitmap[bitmapLength - 1] & unusedMask) !== 0 || (approximateBitmap[bitmapLength - 1] & unusedMask) !== 0 || (missingBitmap[bitmapLength - 1] & unusedMask) !== 0) fail('bitmap has nonzero unused bits')
  }
  if (approximateBitmap.some(Boolean)) fail('approximate state is not allowed')
  const epochEt = (epochJd - 2_451_545) * 86_400
  let cursor = metadataOffset
  const metadata = new StateTileEvidence(recordCount, index => {
    const end = bytes.indexOf(10, cursor)
    if (end <= cursor || end >= metadataEnd) fail('metadata row count is invalid')
    // Parse, validate and pack one declared row at a time. Neither a complete
    // metadata String nor an array of parsed row objects is retained.
    const row = JSON.parse(textDecoder.decode(bytes.subarray(cursor, end))) as StateTileMetadata
    if (!row || typeof row.id !== 'string' || !row.id) fail('metadata id is invalid')
    const exact = hasBit(exactBitmap, index); const approximate = hasBit(approximateBitmap, index); const missing = hasBit(missingBitmap, index)
    if (Number(exact) + Number(approximate) + Number(missing) !== 1) fail('bitmap has non-exclusive state status')
    if (approximate) fail('approximate state is not allowed')
    if (typeof row.source !== 'string' || typeof row.datasetVersion !== 'string' || typeof row.datasetSha256 !== 'string' || typeof row.kernelSha256 !== 'string' || typeof row.model !== 'string' || typeof row.centerId !== 'string' || typeof row.validityStartEt !== 'number' || !Number.isFinite(row.validityStartEt) || typeof row.validityEndEt !== 'number' || !Number.isFinite(row.validityEndEt) || typeof row.validityPresent !== 'boolean' || typeof row.stateEvidence !== 'string' || typeof row.evidenceWindowStartEt !== 'number' || !Number.isFinite(row.evidenceWindowStartEt) || typeof row.evidenceWindowEndEt !== 'number' || !Number.isFinite(row.evidenceWindowEndEt) || typeof row.evidenceWindowPresent !== 'boolean' || typeof row.missingReason !== 'string' || typeof row.identityStatus !== 'string' || typeof row.sourceRecord !== 'boolean') fail('metadata fields are incomplete')
    if (exact) {
      const expectedDatasetHash = row.sourceRecord ? expected.inventoryManifestSha256 : expected.catalogManifestSha256
      if (!expectedDatasetHash || !isNonEmptyString(row.source) || !isNonEmptyString(row.datasetVersion) || row.datasetSha256 !== expectedDatasetHash || !isNonEmptyString(row.model) || !['spk-original', 'source-kernel-state-at-audit-epoch'].includes(row.model) || !isNonEmptyString(row.stateEvidence) || !isNonEmptyString(row.centerId)) fail('exact metadata is missing provenance')
      if (row.model === 'spk-original' && !isSha(row.kernelSha256)) fail('exact kernel provenance is invalid')
      if (row.model === 'source-kernel-state-at-audit-epoch' && (!row.sourceRecord || !isNonEmptyString(row.identityStatus) || !isSha(row.kernelSha256))) fail('snapshot provenance is invalid')
      if (isNonEmptyString(row.missingReason)) fail('exact metadata has a missing reason')
      if (row.validityPresent && (row.validityStartEt > row.validityEndEt || !Number.isFinite(epochEt) || epochEt < row.validityStartEt - 0.0001 || epochEt > row.validityEndEt + 0.0001)) fail('state outside validity')
      if (row.evidenceWindowPresent && (row.evidenceWindowStartEt > row.evidenceWindowEndEt || !Number.isFinite(epochEt) || epochEt < row.evidenceWindowStartEt - 0.0001 || epochEt > row.evidenceWindowEndEt + 0.0001)) fail('state outside evidence window')
    } else if (!isNonEmptyString(row.missingReason)) fail('missing metadata is missing a reason')
    cursor = end + 1
    return row
  })
  if (cursor !== metadataEnd) fail('metadata row count is invalid')
  if (statesOffset + statesLength > bytes.byteLength) fail('state section is out of range')
  const states = new Float64Array(recordCount * stride)
  for (let index = 0; index < states.length; index += 1) {
    const value = view.getFloat64(statesOffset + index * 8, true)
    if (!Number.isFinite(value)) fail('state contains a non-finite value')
    if (hasBit(missingBitmap, Math.floor(index / stride)) && value !== 0) fail('missing state must be all zero')
    states[index] = value
  }
  return { sequence, tileCount, ordinalStart, recordCount, stride, fieldMask, epochJd, metadata, exactBitmap, approximateBitmap, missingBitmap, states, planHash, catalogManifestSha256: catalogHash, inventoryManifestSha256: inventoryHash, payloadSha256: payloadHash }
}

export async function encodeStateTile(input: { sequence: number; tileCount: number; ordinalStart: number; epochJd: number; metadata: StateTileMetadata[]; exact?: readonly number[]; approximate?: readonly number[]; states: Float64Array; planHash: string; catalogManifestSha256: string; inventoryManifestSha256?: string }): Promise<ArrayBuffer> {
  const recordCount = input.metadata.length
  if (!Number.isSafeInteger(recordCount) || recordCount < 1 || input.states.length !== recordCount * STATE_TILE_STRIDE) fail('encode input has mismatched state length')
  const bitmapSize = bitmapBytes(recordCount); const exact = new Uint8Array(bitmapSize); const approximate = new Uint8Array(bitmapSize); const missing = new Uint8Array(bitmapSize)
  const exactRows = new Set(input.exact ?? Array.from({ length: recordCount }, (_, index) => index)); const approximateRows = new Set(input.approximate ?? [])
  for (let index = 0; index < recordCount; index += 1) { if (exactRows.has(index)) setBit(exact, index); else if (approximateRows.has(index)) setBit(approximate, index); else setBit(missing, index) }
  const metadataBytes = new TextEncoder().encode(input.metadata.map(row => JSON.stringify(row)).join('\n') + '\n')
  const metadataOffset = STATE_TILE_HEADER_BYTES; const exactOffset = metadataOffset + metadataBytes.length; const approximateOffset = exactOffset + bitmapSize; const missingOffset = approximateOffset + bitmapSize; const statesOffset = Math.ceil((missingOffset + bitmapSize) / 8) * 8; const statesBytes = new Uint8Array(input.states.length * 8); const statesView = new DataView(statesBytes.buffer); for (let index = 0; index < input.states.length; index += 1) statesView.setFloat64(index * 8, input.states[index], true)
  const total = statesOffset + statesBytes.length; const output = new Uint8Array(total); output.set(metadataBytes, metadataOffset); output.set(exact, exactOffset); output.set(approximate, approximateOffset); output.set(missing, missingOffset); output.set(statesBytes, statesOffset)
  const payloadHash = await digest(output.slice(STATE_TILE_HEADER_BYTES)); const view = new DataView(output.buffer); output.set(STATE_TILE_MAGIC, 0); view.setUint16(8, STATE_TILE_VERSION, true); view.setUint16(10, STATE_TILE_HEADER_BYTES, true); view.setUint32(12, input.sequence, true); view.setUint32(16, input.tileCount, true); view.setUint32(20, input.ordinalStart, true); view.setUint32(24, recordCount, true); view.setUint16(28, STATE_TILE_STRIDE, true); view.setUint16(30, STATE_TILE_FIELD_MASK, true); view.setFloat64(32, input.epochJd, true); view.setUint32(40, metadataOffset, true); view.setUint32(44, metadataBytes.length, true); view.setUint32(48, exactOffset, true); view.setUint32(52, bitmapSize, true); view.setUint32(56, approximateOffset, true); view.setUint32(60, missingOffset, true); view.setUint32(64, statesOffset, true); view.setUint32(68, statesBytes.length, true); output.set(bytesFromHex(input.planHash), 72); output.set(bytesFromHex(input.catalogManifestSha256), 104); if (input.inventoryManifestSha256) output.set(bytesFromHex(input.inventoryManifestSha256), 136); output.set(bytesFromHex(payloadHash), 168)
  return output.buffer
}

export function assembleStateTiles(tiles: readonly StateTile[], plan: StateTilePlan): StateTile[] {
  const bySequence = new Map<number, StateTile>()
  for (const tile of tiles) { if (tile.tileCount !== plan.tileCount || tile.planHash !== plan.planHash || tile.catalogManifestSha256 !== plan.catalogManifestSha256 || tile.inventoryManifestSha256 !== plan.inventoryManifestSha256) fail('tile does not belong to plan'); const previous = bySequence.get(tile.sequence); if (previous && previous.payloadSha256 !== tile.payloadSha256) fail('conflicting duplicate tile'); bySequence.set(tile.sequence, tile) }
  if (bySequence.size !== plan.tileCount || plan.tiles.some(descriptor => !bySequence.has(descriptor.sequence))) fail('tile set is incomplete')
  const ordered = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence)
  let exactCount = 0, approximateCount = 0, missingCount = 0
  ordered.forEach((tile, index) => {
    const descriptor = plan.tiles[index]
    if (tile.ordinalStart !== descriptor.ordinalStart || tile.recordCount !== descriptor.recordCount || tile.epochJd !== plan.epochJd) fail('tile descriptor mismatch')
    // Count each verified row once, after duplicate tiles have been reconciled.
    // Plan totals are scientific coverage claims, not optional display hints.
    for (let row = 0; row < tile.recordCount; row += 1) {
      if (tile.metadata.idAt(row) !== plan.requestIds[tile.ordinalStart + row]) fail('tile metadata ordinal mismatch')
      const byte = row >> 3, bit = 1 << (row % 8)
      if (tile.exactBitmap[byte] & bit) exactCount++
      if (tile.approximateBitmap[byte] & bit) approximateCount++
      if (tile.missingBitmap[byte] & bit) missingCount++
    }
  })
  if (exactCount !== plan.exactCount || approximateCount !== plan.approximateCount || missingCount !== plan.missingCount) fail('plan precision count mismatch')
  return ordered
}

export async function fetchStateTiles(params: { base: string; plan: StateTilePlan; signal: AbortSignal; fetcher?: typeof fetch }): Promise<StateTile[]> {
  const fetcher = params.fetcher ?? fetch
  const results = new Map<number, StateTile>()
  const controller = new AbortController()
  const cancel = () => controller.abort()
  params.signal.addEventListener('abort', cancel, { once: true })
  if (params.signal.aborted) cancel()
  const signal = controller.signal
  let cursor = 0
  let firstError: unknown
  const checkCancellation = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError') }
  const worker = async () => {
    while (firstError === undefined) {
      checkCancellation()
      const descriptor = params.plan.tiles[cursor++]
      if (!descriptor) return
      let reason: unknown
      for (let attempt = 0; attempt < 2; attempt += 1) {
        checkCancellation()
        try {
          const response = await fetcher(descriptor.url ?? `${params.base}/v1/state/tiles`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ planId: params.plan.planHash, sequence: descriptor.sequence }), signal,
          })
          if (!response.ok) {
            void response.body?.cancel().catch(() => undefined)
            const error = new StateTileRetryableError(`State tile HTTP ${response.status}`)
            if (!retryableStatus(response.status)) throw new StateTileProtocolError(error.message)
            throw error
          }
          const body = await readBounded(response, STATE_TILE_MEDIA_TYPE, MAX_STATE_TILE_BYTES)
          checkCancellation()
          let tile: StateTile
          try {
            tile = await decodeStateTile(body, { planHash: params.plan.planHash, catalogManifestSha256: params.plan.catalogManifestSha256, inventoryManifestSha256: params.plan.inventoryManifestSha256, sequence: descriptor.sequence, tileCount: params.plan.tileCount })
          } catch (error) {
            throw new StateTileProtocolError(error instanceof Error ? error.message : String(error))
          }
          checkCancellation()
          const etag = response.headers.get('etag')?.trim().replace(/^"|"$/g, '')
          if (!etag || etag !== tile.payloadSha256) throw new StateTileProtocolError('State tile ETag does not match payload checksum')
          const previous = results.get(tile.sequence)
          if (previous && previous.payloadSha256 !== tile.payloadSha256) fail('conflicting duplicate tile')
          results.set(tile.sequence, tile)
          reason = undefined
          break
        } catch (error) {
          reason = error
          checkCancellation()
          if (error instanceof StateTileProtocolError || !(error instanceof StateTileRetryableError) && attempt === 1) break
        }
      }
      if (reason !== undefined) { firstError = reason; throw reason }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(STATE_TILE_CONCURRENCY, params.plan.tiles.length) }, () => worker()))
    checkCancellation()
    return assembleStateTiles([...results.values()], params.plan)
  } catch (error) {
    // A failed plan cannot publish a partial frame. Stop the other transfers
    // and release retained tiles, without cancelling the caller's controller.
    cancel()
    results.clear()
    throw error
  } finally {
    params.signal.removeEventListener('abort', cancel)
  }
}

function subtract(a: Vector3, b: Vector3): Vector3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }

/** All reference views share the verified tile buffers and compact evidence.
 * Only identity-to-ordinal bindings survive assembly, not resolved-state,
 * absolute-position or audit objects for every received source record. */
export class StateTileSnapshot implements BackendStateEvidence {
  readonly #tiles: readonly StateTile[]
  readonly #bodyIds: string[] = []
  readonly #byBody = new Map<BodyId, number>()
  readonly #tileIndexes: Uint32Array
  readonly #rowIndexes: Uint32Array
  readonly catalogManifestSha256: string
  readonly inventoryManifestSha256?: string
  readonly epochJd: number

  constructor(tiles: readonly StateTile[], requestedIds: ReadonlyMap<BodyId, string>) {
    this.#tiles = [...tiles]
    this.catalogManifestSha256 = tiles[0]?.catalogManifestSha256 ?? ''
    this.inventoryManifestSha256 = tiles[0]?.inventoryManifestSha256
    this.epochJd = tiles[0]?.epochJd ?? NaN
    // A single construction-only identity index binds aliases without
    // duplicating their six-vectors. Tile/row columns refer to source storage.
    const sourceOrdinals = new Map<string, number>()
    let count = 0
    for (const tile of tiles) {
      if (tile.catalogManifestSha256 !== this.catalogManifestSha256 || tile.inventoryManifestSha256 !== this.inventoryManifestSha256 || tile.epochJd !== this.epochJd) fail('snapshot identity or epoch mismatch')
      for (let row = 0; row < tile.recordCount; row++) {
        const id = tile.metadata.idAt(row)
        if (sourceOrdinals.has(id)) fail('duplicate resolved identity')
        sourceOrdinals.set(id, count++)
      }
    }
    const tileForSource = new Uint32Array(count), rowForSource = new Uint32Array(count)
    let offset = 0
    for (let tileIndex = 0; tileIndex < tiles.length; tileIndex++) {
      for (let row = 0; row < tiles[tileIndex].recordCount; row++, offset++) {
        tileForSource[offset] = tileIndex; rowForSource[offset] = row
      }
    }
    let received = 0
    for (const backendId of requestedIds.values()) if (sourceOrdinals.has(backendId)) received++
    this.#tileIndexes = new Uint32Array(received)
    this.#rowIndexes = new Uint32Array(received)
    for (const [bodyId, backendId] of requestedIds) {
      const ordinal = sourceOrdinals.get(backendId)
      if (ordinal === undefined) continue
      const index = this.#bodyIds.length
      this.#bodyIds.push(bodyId); this.#byBody.set(bodyId, index)
      this.#tileIndexes[index] = tileForSource[ordinal]
      this.#rowIndexes[index] = rowForSource[ordinal]
    }
  }

  get length() { return this.#bodyIds.length }
  get bindingByteLength() { return this.#tileIndexes.byteLength + this.#rowIndexes.byteLength }
  #check(index: number) { if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError('Snapshot evidence ordinal is out of range') }
  bodyIdAt(index: number) { this.#check(index); return this.#bodyIds[index] }
  backendIdAt(index: number) { this.#check(index); return this.#tiles[this.#tileIndexes[index]].metadata.idAt(this.#rowIndexes[index]) }
  statusAt(index: number): 'exact' | 'approximate' | 'missing' {
    this.#check(index)
    const tile = this.#tiles[this.#tileIndexes[index]], row = this.#rowIndexes[index]
    return hasBit(tile.exactBitmap, row) ? 'exact' : hasBit(tile.approximateBitmap, row) ? 'approximate' : 'missing'
  }
  missingReasonAt(index: number) {
    this.#check(index)
    return this.#tiles[this.#tileIndexes[index]].metadata.missingReasonAt(this.#rowIndexes[index])
  }
  stateValueAt(index: number, component: number): number {
    this.#check(index)
    if (!Number.isInteger(component) || component < 0 || component >= STATE_TILE_STRIDE) throw new RangeError('Snapshot state component is out of range')
    return this.#tiles[this.#tileIndexes[index]].states[this.#rowIndexes[index] * STATE_TILE_STRIDE + component]
  }
  rowAt(index: number): StateTileAudit {
    this.#check(index)
    const metadata = this.#tiles[this.#tileIndexes[index]].metadata.rowAt(this.#rowIndexes[index])
    const status = this.statusAt(index)
    return { ...metadata, bodyId: this.#bodyIds[index], backendId: metadata.id,
      availability: status === 'exact' ? 'operational' : status,
      precision: status === 'missing' ? 'unavailable' : status,
      stateEvidence: metadata.stateEvidence || '',
      missingReason: metadata.missingReason || (status === 'approximate' ? 'approximate-state-not-allowed' : '') }
  }
  hasPosition(bodyId: BodyId) { const index = this.#byBody.get(bodyId); return index !== undefined && this.statusAt(index) === 'exact' }
  positionAu(bodyId: BodyId): Vector3 | undefined {
    const index = this.#byBody.get(bodyId)
    if (index === undefined || this.statusAt(index) !== 'exact') return undefined
    const tile = this.#tiles[this.#tileIndexes[index]], row = this.#rowIndexes[index]
    return { x: tile.states[row * 6] / AU_IN_KM, y: tile.states[row * 6 + 1] / AU_IN_KM, z: tile.states[row * 6 + 2] / AU_IN_KM }
  }
}

export function buildBackendFrame(params: { bodies: CelestialBody[]; referenceId: BodyId; evidence: StateTileSnapshot }): BackendFrame {
  const { evidence } = params
  const reference = evidence.positionAu(params.referenceId)
  const currentPositions: RenderedBodyPosition[] = [], missingBodyIds: BodyId[] = []
  let maxDistance = 0
  for (const body of params.bodies) {
    const position = reference ? evidence.positionAu(body.id) : undefined
    if (!position || !reference) { missingBodyIds.push(body.id); continue }
    const relative = subtract(position, reference), distance = Math.hypot(relative.x, relative.y, relative.z)
    currentPositions.push({ body, planarPosition: { x: relative.x, y: relative.y }, position3D: relative, distance })
    maxDistance = Math.max(maxDistance, distance)
  }
  return { currentPositions, missingBodyIds, maxDistance, evidence, catalogManifestSha256: evidence.catalogManifestSha256,
    inventoryManifestSha256: evidence.inventoryManifestSha256, epochJd: evidence.epochJd, epochTdbJd: evidence.epochJd }
}
