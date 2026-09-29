import type { GaiaManifest, streamGaiaChunks } from '../lib/gaiaChunks'
import type { GaiaPackedSourceBatch } from '../lib/gaiaPackedSources'
import type { GaiaTangentProjection } from '../lib/gaiaCollection'
import capacity from '../data/gaiaCapacity.json'

/** Upload slots share the loader's maximum chunk concurrency. The independent
 * row window below prevents smaller chunks from increasing retained payload. */
export const GAIA_UPLOAD_SLOTS = capacity.maxParallelChunks
export const GAIA_UPLOAD_MAX_ROWS = capacity.defaultInFlightRows

export type GaiaLoadRequest = { files: File[]; manifestUrl?: never; manifestUrls?: never }
  | { manifestUrl: string; files?: never; manifestUrls?: never }
  | { manifestUrls: string[]; files?: never; manifestUrl?: never }

/** Validate before file-name indexing or posting a potentially large selection. */
export function validateGaiaLoadRequest(value: unknown): GaiaLoadRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) throw new Error('Invalid Gaia load request')
  const request = value as Record<string, unknown>
  if (Object.hasOwn(request, 'files')) {
    const files = request.files
    if (!Array.isArray(files) || files.length < 1 || files.length > capacity.maxChunks+1) throw new Error('Select one manifest.json and its bounded chunk JSON files')
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
  if (Object.hasOwn(request, 'manifestUrls')) {
    const values = request.manifestUrls
    if (!Array.isArray(values) || values.length < 2 || values.length > capacity.maxCatalogsPerChart) throw new Error(`Select 2 to ${capacity.maxCatalogsPerChart} Gaia manifest URLs`)
    const urls = values.map(value => {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid Gaia manifest URL')
      const url = new URL(value)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.href.length > 2048) throw new Error('Invalid Gaia manifest URL')
      return url.href
    })
    if (new Set(urls).size !== urls.length) throw new Error('Duplicate Gaia manifest URL')
    return { manifestUrls: urls }
  }
  if (typeof request.manifestUrl !== 'string' || !request.manifestUrl.trim()) throw new Error('Invalid Gaia manifest URL')
  const url = new URL(request.manifestUrl)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.href.length > 2048) throw new Error('Invalid Gaia manifest URL')
  return { manifestUrl: url.href }
}
export type GaiaWorkerResponse =
  | { type: 'manifest'; regions: { manifest: GaiaManifest; manifestSha256: string; originalManifestJson: string; manifestBytes: number;
      source: { kind: 'remote-url'; url: string } | { kind: 'local-files'; files: string[] } }[];
      declaredRows: number; selectedBytes: number; chunkCount: number; totalManifestBytes: number; projection: GaiaTangentProjection }
  | { type: 'chunk'; catalogIndex: number; sequence: number; path: string; inputRows: number; duplicateRows: number; sources: GaiaPackedSourceBatch; display: Float32Array<ArrayBuffer> }
  | { type: 'done'; summary: Awaited<ReturnType<typeof streamGaiaChunks>> & {
      manifestCount: number; uniqueRows: number; duplicateRows: number; deduplication: 'first-manifest-order-by-gaia-source-id';
      sourceReadWindow: { maxConcurrentManifests: number; peakConcurrentManifests: number };
      uploadWindow: { maxPendingChunks: number; maxInputRows: number; peakPendingChunks: number; peakPendingInputRows: number } } }
  | { type: 'error'; error: string }
