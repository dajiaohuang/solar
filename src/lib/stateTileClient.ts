import { digestStateTileRequestIds, readStateTileJson, validateStateTileManifest, validateStateTilePlan, type StateTileManifest, type StateTilePlan } from './stateTiles'
import { ADVERTISED_QUEUE_RETRY, fetchRetryableResponse } from './retryableHttpResponse'

/** Shared wire client, usable in the UI and workers without importing React. */
export async function fetchStateTilePlan(params: { base: string; bodyIds: string[]; epochTdbJd: number; signal: AbortSignal; fetcher?: typeof fetch; manifest?: StateTileManifest }): Promise<{ manifest: StateTileManifest; plan: StateTilePlan }> {
  params.signal.throwIfAborted()
  // One owned request snapshot must drive both the wire payload and receipt
  // validation, even if the caller changes its selection while fetch yields.
  params = { ...params, bodyIds: [...params.bodyIds], manifest: params.manifest ? { ...params.manifest } : undefined }
  const fetcher = params.fetcher ?? fetch
  const manifest = params.manifest ?? validateStateTileManifest(await readStateTileJson(
    await fetchRetryableResponse(fetcher, `${params.base}/v1/catalog/manifest`, {}, params.signal, ADVERTISED_QUEUE_RETRY), 'State catalog manifest', undefined, params.signal))
  const request = { ids: [...params.bodyIds], epochJd: params.epochTdbJd, frame: 'ECLIPJ2000' as const, timeScale: 'TDB' as const, fieldMask: ['position', 'velocity'], precision: 'exact' as const }
  const requestBody = JSON.stringify(request)
  if (params.bodyIds.length > manifest.maxPlanIds || new TextEncoder().encode(requestBody).byteLength > manifest.maxPlanBytes) {
    throw new Error('State plan request exceeds the advertised ID or byte budget')
  }
  const response = await fetchRetryableResponse(fetcher, `${params.base}/v1/state/plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody,
  }, params.signal, ADVERTISED_QUEUE_RETRY)
  const plan = validateStateTilePlan(await readStateTileJson(response, 'State tile plan', undefined, params.signal), manifest, params.epochTdbJd, params.bodyIds, await digestStateTileRequestIds(params.bodyIds))
  params.signal.throwIfAborted()
  return { manifest, plan }
}
