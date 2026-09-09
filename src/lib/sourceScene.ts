import type { CelestialBody } from '../types'
import type { SourceIdentityPage } from './sourceIdentityPage'

/** A directory snapshot pin, not evidence that any row has a physical state. */
export type SourceSceneIdentity = {
  catalogVersion: string
  catalogManifestSha256: string
  inventoryManifestSha256: string
  ids: string[]
}
export type SourceScenePin = Omit<SourceSceneIdentity, 'ids'> & { base: string }
export const MAX_SOURCE_SCENE_BYTES = 64 * 1024
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const hasControlCharacter = (value: string) => [...value].some(character => {
  const code = character.charCodeAt(0)
  return code < 0x20 || code === 0x7f
})
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0
  && new TextEncoder().encode(value).length <= max && !hasControlCharacter(value)

export function parseSourceScene(encoded: string): SourceSceneIdentity {
  if (new TextEncoder().encode(encoded).length > MAX_SOURCE_SCENE_BYTES) throw new Error('Source selection link exceeds its byte budget')
  const value: unknown = JSON.parse(encoded)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid source selection identity')
  const row = value as Record<string, unknown>
  if (!validText(row.catalogVersion, 512) || !sha256(row.catalogManifestSha256) || !sha256(row.inventoryManifestSha256)
    || !Array.isArray(row.ids) || !row.ids.length || row.ids.some(id => !validText(id, 512))
    || new Set(row.ids).size !== row.ids.length) throw new Error('Invalid source selection identity')
  return { catalogVersion: row.catalogVersion, catalogManifestSha256: row.catalogManifestSha256,
    inventoryManifestSha256: row.inventoryManifestSha256, ids: row.ids as string[] }
}

export function sourceSceneFromPage(page: SourceIdentityPage): SourceSceneIdentity {
  return parseSourceScene(JSON.stringify({ catalogVersion: page.manifest.catalogVersion,
    catalogManifestSha256: page.manifest.catalogManifestSha256, inventoryManifestSha256: page.manifest.inventoryManifestSha256,
    ids: page.items.map(row => row.id) }))
}

/** Display metadata only. Never infer a NAIF ID, conic, size or parent orbit. */
export function sourceRecordBody(id: string, row?: SourceIdentityPage['items'][number]): CelestialBody {
  if (!validText(id, 512) || row && row.id !== id) throw new Error('Invalid source display identity')
  return { id, name: row?.name || row?.designation || id, kind: 'sourceRecord', source: 'source-inventory',
    color: '#e3bb68', size: 1, ...(row ? { sourceIdentity: { ...row } } : {}) }
}

export function sourcePinFor(identity: SourceSceneIdentity, base: string): SourceScenePin {
  const normalized = base.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('Source selection requires a configured full backend')
  return { base: normalized, catalogVersion: identity.catalogVersion, catalogManifestSha256: identity.catalogManifestSha256,
    inventoryManifestSha256: identity.inventoryManifestSha256 }
}

export function requireSourcePin(pin: SourceScenePin, base: string, manifest: {
  catalogVersion: string; catalogManifestSha256: string; inventoryManifestSha256?: string
}) {
  if (base.trim().replace(/\/+$/, '') !== pin.base || manifest.catalogVersion !== pin.catalogVersion
    || manifest.catalogManifestSha256 !== pin.catalogManifestSha256 || manifest.inventoryManifestSha256 !== pin.inventoryManifestSha256)
    throw new Error('Source selection snapshot changed; browse and select the source page again')
}
