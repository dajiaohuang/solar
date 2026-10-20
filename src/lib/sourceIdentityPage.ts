import { fetchStateTilePlan } from './stateTileClient'
import { assembleStateTiles, fetchStateTiles, readStateTileJson, validateStateTileManifest, type StateTileManifest } from './stateTiles'
import { ADVERTISED_QUEUE_RETRY, fetchRetryableResponse } from './retryableHttpResponse'

export const SOURCE_PAGE_SIZE = 50
const MAX_PAGE_BYTES = 256 * 1024
type ObjectValue = Record<string, unknown>
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid identity object')
  return value as ObjectValue
}
function text(value: unknown, optional = false, max = 512): string {
  if (optional && value === undefined) return ''
  if (typeof value !== 'string' || (!optional && !value) || value.length > max || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Invalid identity text')
  return value
}
export function validateSourceIdentityPage(raw: unknown, manifest: StateTileManifest) {
  const value = object(raw)
  if (value.apiVersion !== manifest.apiVersion || value.catalogVersion !== manifest.catalogVersion || !manifest.inventoryManifestSha256
    || value.inventoryManifestSha256 !== manifest.inventoryManifestSha256 || value.sourceRecords !== true
    || value.identityAssertions !== true || value.uniqueBodySemantics !== 'not-deduplicated') throw new Error('Identity inventory mismatch')
  if (!Number.isSafeInteger(value.totalRecords) || (value.totalRecords as number) < 0 || value.limit !== SOURCE_PAGE_SIZE
    || !Array.isArray(value.items) || value.items.length > SOURCE_PAGE_SIZE || value.items.length > (value.totalRecords as number)) throw new Error('Invalid identity page bounds')
  const ids = new Set<string>()
  const items = value.items.map(raw => {
    const row = object(raw), id = text(row.id)
    if (ids.has(id) || !Number.isSafeInteger(row.sourceRow) || (row.sourceRow as number) < 0) throw new Error('Invalid source identity')
    ids.add(id)
    const optionalList = (value: unknown, maxItems = 32) => {
      if (value === undefined) return [] as string[]
      if (!Array.isArray(value) || value.length > maxItems) throw new Error('Invalid source identity list')
      return value.map(item => text(item, false, 512))
    }
    const optionalInteger = (value: unknown) => {
      if (value === undefined) return undefined
      if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid source identity target')
      return value as number
    }
    const naifId = optionalInteger(row.naifId)
    return { id, name: text(row.name, true), designation: text(row.designation, true), category: text(row.category),
      source: text(row.source), sourceRow: row.sourceRow as number, identityStatus: text(row.identityStatus),
      ephemerisStatus: text(row.ephemerisStatus), parentId: text(row.parentId, true), parentResolution: text(row.parentResolution, true),
      centerId: text(row.centerId, true), centerResolution: text(row.centerResolution, true), confirmation: text(row.confirmation, true),
      geometryStatus: text(row.geometryStatus, true), naifId, aliases: optionalList(row.aliases), identityEvidence: optionalList(row.identityEvidence) }
  })
  const nextPageToken = text(value.nextPageToken, true, 4096)
  if (nextPageToken && items.length !== SOURCE_PAGE_SIZE) throw new Error('A continuing identity page must fill its requested limit')
  return { items, nextPageToken, totalRecords: value.totalRecords as number, manifest }
}
export type SourceIdentityPage = ReturnType<typeof validateSourceIdentityPage> & { query: string; base: string }
type Request = { base: string | null; profile: 'full' | 'preview'; signal: AbortSignal; fetcher?: typeof fetch }
function endpoint(params: Request) {
  if (params.profile !== 'full' || !params.base?.trim()) throw new Error('Source inventory requires a configured full backend')
  params.signal.throwIfAborted()
  return params.base.trim().replace(/\/+$/, '')
}
async function manifestFor(params: Request, base: string) {
  return validateStateTileManifest(await readStateTileJson(await fetchRetryableResponse(params.fetcher ?? fetch, `${base}/v1/catalog/manifest`, { signal: params.signal, cache: 'no-store' }, params.signal, ADVERTISED_QUEUE_RETRY), 'Identity manifest', undefined, params.signal))
}
function sameInventory(a: StateTileManifest, b: StateTileManifest) {
  if (a.catalogVersion !== b.catalogVersion || a.catalogManifestSha256 !== b.catalogManifestSha256 || a.inventoryManifestSha256 !== b.inventoryManifestSha256) throw new Error('Source inventory changed; restart browsing')
}
export async function loadSourceIdentityPage(params: Request & { query: string; previous?: SourceIdentityPage }) {
  params = { ...params }
  const base = endpoint(params), query = text(params.query, true, 256)
  // Only continuation identity is needed; avoid copying the previous page's
  // source rows while keeping its cursor and inventory stable across awaits.
  const previous = params.previous ? { query: params.previous.query, base: params.previous.base,
    nextPageToken: text(params.previous.nextPageToken, true, 4096), manifest: { ...params.previous.manifest },
    totalRecords: params.previous.totalRecords, ids: new Set(params.previous.items.map(row => row.id)) } : undefined
  if (previous && previous.query !== query) throw new Error('Source cursor belongs to another query')
  if (previous && previous.base !== base) throw new Error('Source cursor belongs to another backend')
  if (previous && !previous.nextPageToken) throw new Error('No next source page')
  const manifest = await manifestFor(params, base)
  if (previous) sameInventory(previous.manifest, manifest)
  const search = new URLSearchParams({ q: query, limit: String(SOURCE_PAGE_SIZE) })
  if (previous) search.set('pageToken', previous.nextPageToken)
  const response = await fetchRetryableResponse(params.fetcher ?? fetch, `${base}/v1/identities?${search}`, { signal: params.signal, cache: 'no-store' }, params.signal, ADVERTISED_QUEUE_RETRY)
  const size = Number(response.headers.get('content-length'))
  if (!response.headers.has('content-length') || !Number.isSafeInteger(size) || size < 1 || size > MAX_PAGE_BYTES) {
    await response.body?.cancel(); throw new Error('Identity page exceeds byte budget')
  }
  const page = validateSourceIdentityPage(await readStateTileJson(response, 'Source identities', MAX_PAGE_BYTES, params.signal), manifest)
  if (previous && page.nextPageToken && page.nextPageToken === previous.nextPageToken) throw new Error('Source cursor did not advance')
  if (previous && (page.totalRecords !== previous.totalRecords || !page.items.length || page.items.some(row => previous.ids.has(row.id)))) {
    throw new Error('Source continuation changed its inventory count or repeated the previous page')
  }
  params.signal.throwIfAborted()
  return { ...page, query, base }
}

/** Bounded inspection of this page, not an all-source state or display count. */
export async function inspectSourceIdentityPage(params: Request & { page: SourceIdentityPage; epochTdbJd: number }) {
  params = { ...params }
  const base = endpoint(params)
  if (params.page.base !== base) throw new Error('Source page belongs to another backend')
  if (!Number.isFinite(params.epochTdbJd) || params.page.items.length < 1 || params.page.items.length > SOURCE_PAGE_SIZE) throw new Error('Invalid source inspection')
  const expectedManifest = { ...params.page.manifest }, bodyIds = params.page.items.map(row => row.id)
  const manifest = await manifestFor(params, base)
  sameInventory(expectedManifest, manifest)
  // Use original source IDs, never replace an alias with an inferred NAIF ID.
  const { plan } = await fetchStateTilePlan({ ...params, base, manifest, bodyIds })
  const tiles = assembleStateTiles(await fetchStateTiles({ ...params, base, plan }), plan)
  params.signal.throwIfAborted()
  return { plan, tiles }
}
