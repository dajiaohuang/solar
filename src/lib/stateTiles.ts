import { AU_IN_KM } from '../engine/units'
import type { BackendFrame, StateTileAudit } from './backendFrames'
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

export type StateTile = {
  sequence: number
  tileCount: number
  ordinalStart: number
  recordCount: number
  stride: number
  fieldMask: number
  epochJd: number
  metadata: StateTileMetadata[]
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
  return { apiVersion: STATE_TILE_API_VERSION, catalogVersion: value.catalogVersion, planHash, requestIdsSha256: value.requestIdsSha256 as string, requestIds: [...requestIds], catalogManifestSha256: value.catalogManifestSha256, inventoryManifestSha256: value.inventoryManifestSha256 as string | undefined, epochJd: value.epochJd, timeScale: 'TDB', frame: 'ECLIPJ2000', stateOriginId: 'naif:0', stride: STATE_TILE_STRIDE, fieldMask: STATE_TILE_FIELD_MASK, tileCount, recordCount: bodyCount, tiles }
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
  const metadata: StateTileMetadata[] = []
  let cursor = metadataOffset
  for (let row = 0; row < recordCount; row += 1) {
    const end = bytes.indexOf(10, cursor)
    if (end <= cursor || end >= metadataEnd) fail('metadata row count is invalid')
    // Bound parsing by the declared count, without a full metadata String,
    // split array, or object allocation for undeclared rows.
    const item = JSON.parse(textDecoder.decode(bytes.subarray(cursor, end))) as StateTileMetadata
    if (!item || typeof item.id !== 'string' || !item.id) fail('metadata id is invalid')
    metadata.push(item)
    cursor = end + 1
  }
  if (cursor !== metadataEnd) fail('metadata row count is invalid')
  const exactBitmap = bytes.slice(exactBitmapOffset, exactBitmapOffset + bitmapLength); const approximateBitmap = bytes.slice(approximateBitmapOffset, approximateBitmapOffset + bitmapLength); const missingBitmap = bytes.slice(missingBitmapOffset, missingBitmapOffset + bitmapLength)
  const usedBits = recordCount & 7
  if (usedBits !== 0) {
    const unusedMask = (0xff << usedBits) & 0xff
    if ((exactBitmap[bitmapLength - 1] & unusedMask) !== 0 || (approximateBitmap[bitmapLength - 1] & unusedMask) !== 0 || (missingBitmap[bitmapLength - 1] & unusedMask) !== 0) fail('bitmap has nonzero unused bits')
  }
  if (approximateBitmap.some(Boolean)) fail('approximate state is not allowed')
  const epochEt = (epochJd - 2_451_545) * 86_400
  for (let index = 0; index < recordCount; index += 1) {
    const exact = hasBit(exactBitmap, index); const approximate = hasBit(approximateBitmap, index); const missing = hasBit(missingBitmap, index)
    if (Number(exact) + Number(approximate) + Number(missing) !== 1) fail('bitmap has non-exclusive state status')
    if (approximate) fail('approximate state is not allowed')
    const row = metadata[index]
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
  }
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
  ordered.forEach((tile, index) => { const descriptor = plan.tiles[index]; if (tile.ordinalStart !== descriptor.ordinalStart || tile.recordCount !== descriptor.recordCount || tile.epochJd !== plan.epochJd) fail('tile descriptor mismatch'); for (let row = 0; row < tile.recordCount; row += 1) if (tile.metadata[row]?.id !== plan.requestIds[tile.ordinalStart + row]) fail('tile metadata ordinal mismatch') })
  return ordered
}

export async function fetchStateTiles(params: { base: string; plan: StateTilePlan; signal: AbortSignal; fetcher?: typeof fetch }): Promise<StateTile[]> {
  const fetcher = params.fetcher ?? fetch; const results = new Map<number, StateTile>(); let cursor = 0; let firstError: unknown
  const worker = async () => { while (firstError === undefined) { const descriptor = params.plan.tiles[cursor++]; if (!descriptor) return; let reason: unknown; for (let attempt = 0; attempt < 2; attempt += 1) { if (params.signal.aborted) throw new DOMException('Aborted', 'AbortError'); try { const response = await fetcher(descriptor.url ?? `${params.base}/v1/state/tiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: params.plan.planHash, sequence: descriptor.sequence }), signal: params.signal }); if (!response.ok) { const error = new StateTileRetryableError(`State tile HTTP ${response.status}`); if (!retryableStatus(response.status)) throw new StateTileProtocolError(error.message); throw error } const body = await readBounded(response, STATE_TILE_MEDIA_TYPE, MAX_STATE_TILE_BYTES); let tile: StateTile; try { tile = await decodeStateTile(body, { planHash: params.plan.planHash, catalogManifestSha256: params.plan.catalogManifestSha256, inventoryManifestSha256: params.plan.inventoryManifestSha256, sequence: descriptor.sequence, tileCount: params.plan.tileCount }) } catch (error) { throw new StateTileProtocolError(error instanceof Error ? error.message : String(error)) } const etag = response.headers.get('etag')?.trim().replace(/^"|"$/g, ''); if (!etag || etag !== tile.payloadSha256) throw new StateTileProtocolError('State tile ETag does not match payload checksum'); const previous = results.get(tile.sequence); if (previous && previous.payloadSha256 !== tile.payloadSha256) fail('conflicting duplicate tile'); results.set(tile.sequence, tile); reason = undefined; break } catch (error) { reason = error; if (params.signal.aborted) throw new DOMException('Aborted', 'AbortError'); if (error instanceof StateTileProtocolError || !(error instanceof StateTileRetryableError) && attempt === 1) break } } if (reason !== undefined) { firstError = reason; throw reason } } }
  await Promise.all(Array.from({ length: Math.min(STATE_TILE_CONCURRENCY, params.plan.tiles.length) }, () => worker())); return assembleStateTiles([...results.values()], params.plan)
}

function subtract(a: Vector3, b: Vector3): Vector3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }

type ResolvedState = { backendId: string; position?: Vector3; audit: StateTileAudit }

export function collectResolvedStateTiles(tiles: readonly StateTile[]): Map<string, ResolvedState> {
  const states = new Map<string, ResolvedState>()
  for (const tile of tiles) tile.metadata.forEach((metadata, index) => {
    const exact = hasBit(tile.exactBitmap, index)
    const approximate = hasBit(tile.approximateBitmap, index)
    // Assembly binds id to the requested ordinal; extension fields cannot
    // rename a state or override the validated availability bitmaps.
    const backendId = metadata.id
    if (states.has(backendId)) fail('duplicate resolved identity')
    states.set(backendId, {
      backendId,
      audit: {
        bodyId: '', backendId,
        availability: exact ? 'operational' : approximate ? 'approximate' : 'missing',
        precision: exact ? 'exact' : approximate ? 'approximate' : 'unavailable',
        source: metadata.source, datasetVersion: metadata.datasetVersion,
        datasetSha256: metadata.datasetSha256, kernelSha256: metadata.kernelSha256,
        model: metadata.model, centerId: metadata.centerId,
        validityStartEt: metadata.validityStartEt, validityEndEt: metadata.validityEndEt,
        validityPresent: metadata.validityPresent,
        evidenceWindowStartEt: metadata.evidenceWindowStartEt,
        evidenceWindowEndEt: metadata.evidenceWindowEndEt,
        evidenceWindowPresent: metadata.evidenceWindowPresent,
        identityStatus: metadata.identityStatus, sourceRecord: metadata.sourceRecord,
        stateEvidence: metadata.stateEvidence || '',
        missingReason: metadata.missingReason || (approximate ? 'approximate-state-not-allowed' : ''),
      },
      ...(exact ? { position: { x: tile.states[index * 6] / AU_IN_KM, y: tile.states[index * 6 + 1] / AU_IN_KM, z: tile.states[index * 6 + 2] / AU_IN_KM } } : {}),
    })
  })
  return states
}

function buildBackendFrameFromResolved(params: { bodies: CelestialBody[]; referenceId: BodyId; requestedIds: Map<BodyId, string>; states: ReadonlyMap<string, ResolvedState>; catalogManifestSha256: string; inventoryManifestSha256?: string; epochJd: number }): BackendFrame {
  const absolute = new Map<string, Vector3>(); const audit = new Map<string, StateTileAudit>()
  for (const [bodyId, backendId] of params.requestedIds) { const state = params.states.get(backendId); if (!state) continue; audit.set(bodyId, { ...state.audit, bodyId }); if (state.position) absolute.set(backendId, state.position) }
  const bodyAbsolute = new Map<BodyId, Vector3>(); for (const [bodyId, backendId] of params.requestedIds) { const position = absolute.get(backendId); if (position) bodyAbsolute.set(bodyId, position) }
  const reference = absolute.get(params.requestedIds.get(params.referenceId) ?? ''); const currentPositions: RenderedBodyPosition[] = []; const missingBodyIds: BodyId[] = []
  for (const body of params.bodies) { const position = absolute.get(params.requestedIds.get(body.id) ?? ''); if (!position || !reference) { missingBodyIds.push(body.id); continue } const relative = subtract(position, reference); currentPositions.push({ body, planarPosition: { x: relative.x, y: relative.y }, position3D: relative, distance: Math.hypot(relative.x, relative.y, relative.z) }) }
  return { currentPositions, missingBodyIds, maxDistance: currentPositions.reduce((max, item) => Math.max(max, item.distance), 0), catalogManifestSha256: params.catalogManifestSha256, inventoryManifestSha256: params.inventoryManifestSha256, epochJd: params.epochJd, epochTdbJd: params.epochJd, audit: [...audit.values()], absolutePositions: bodyAbsolute }
}

export function buildBackendFrameFromStateTiles(params: { bodies: CelestialBody[]; referenceId: BodyId; requestedIds: Map<BodyId, string>; tiles: readonly StateTile[] }): BackendFrame {
  const states = collectResolvedStateTiles(params.tiles)
  const first = params.tiles[0]
  return buildBackendFrameFromResolved({ ...params, states, catalogManifestSha256: first?.catalogManifestSha256 ?? '', inventoryManifestSha256: first?.inventoryManifestSha256, epochJd: first?.epochJd ?? NaN })
}

export type { ResolvedState }
export { buildBackendFrameFromResolved }
