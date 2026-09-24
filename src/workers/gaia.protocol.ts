import type { GaiaManifest, GaiaSource, streamGaiaChunks } from '../lib/gaiaChunks'
import capacity from '../data/gaiaCapacity.json'

export type GaiaLoadRequest = { files: File[]; manifestUrl?: never } | { manifestUrl: string; files?: never }

/** Validate before file-name indexing or posting a potentially large selection. */
export function validateGaiaLoadRequest(value: unknown): GaiaLoadRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) throw new Error('Invalid Gaia load request')
  const request = value as Record<string, unknown>
  if (Object.hasOwn(request, 'files')) {
    const files = request.files
    if (!Array.isArray(files) || files.length < 1 || files.length > 2593) throw new Error('Select one manifest.json and its bounded chunk JSON files')
    const names = new Set<string>()
    let hasManifest = false
    for (const file of files) {
      if (!(file instanceof File) || names.has(file.name) || file.size < 1 || file.size > capacity.maxChunkBytes) throw new Error('Invalid, duplicate or oversized Gaia source file')
      names.add(file.name)
      if (file.name === 'manifest.json') {
        if (file.size > capacity.maxManifestBytes) throw new Error('Gaia manifest size exceeds budget')
        hasManifest = true
      }
    }
    if (!hasManifest) throw new Error('Select one manifest.json and its bounded chunk JSON files')
    return { files: [...files] }
  }
  if (typeof request.manifestUrl !== 'string' || !request.manifestUrl.trim()) throw new Error('Invalid Gaia manifest URL')
  const url = new URL(request.manifestUrl)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid Gaia manifest URL')
  return { manifestUrl: url.href }
}
export type GaiaWorkerResponse =
  | { type: 'manifest'; manifest: GaiaManifest; manifestSha256: string; originalManifestJson: string; manifestBytes: number }
  | { type: 'chunk'; sequence: number; path: string; sources: GaiaSource[]; display: Float32Array<ArrayBuffer> }
  | { type: 'done'; summary: Awaited<ReturnType<typeof streamGaiaChunks>> }
  | { type: 'error'; error: string }
