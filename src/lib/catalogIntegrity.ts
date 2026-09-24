import type { AsteroidManifest } from '../types'

export type CatalogChecksums = ((path: string) => string) & { has: (path: string) => boolean; readonly retainedWeight: number }

export async function catalogSha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Bind checksum declarations to the same content descriptor as the producer.
 * The manifest remains the trust anchor; this is not a digital signature. */
export async function bindCatalogChecksums(value: unknown, manifest: AsteroidManifest, signal: AbortSignal) {
  signal.throwIfAborted()
  const report = value as { schemaVersion?: unknown; algorithm?: unknown; files?: unknown } | null
  if (!report || report.schemaVersion !== 1 || report.algorithm !== 'sha256' || !report.files ||
      typeof report.files !== 'object' || Array.isArray(report.files) || !/^[a-f0-9]{64}$/.test(manifest.contentSha256 ?? '')) throw new Error('Invalid catalog checksum contract')
  const entries = Object.entries(report.files)
  if (entries.length > 100000 || entries.some(([path, hash]) => !path || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid catalog checksum entries')
  const content = Object.fromEntries(entries.filter(([path]) => /^(binary|meta|search|lookup)\//.test(path) || /^catalog-(index|sample|summary)/.test(path))
    .sort(([left], [right]) => left.localeCompare(right))) as Record<string, string>
  const hash = await catalogSha256(new TextEncoder().encode(JSON.stringify(content)).buffer)
  signal.throwIfAborted()
  if (hash !== manifest.contentSha256) throw new Error('Catalog checksum map does not match manifest content identity')
  const resolve = (path: string) => {
    if (!Object.hasOwn(content, path)) throw new Error(`Missing content-bound catalog checksum: ${path}`)
    return content[path]
  }
  // Deterministic retention estimate for the closure's scalar map, not heap RSS.
  let retainedWeight = 64
  for (const [path, checksum] of Object.entries(content)) retainedWeight += 64 + 2 * (path.length + checksum.length)
  return Object.freeze(Object.assign(resolve, { has: (path: string) => Object.hasOwn(content, path), retainedWeight }))
}
