import { digestStateTileRequestIds, readStateTileJson, validateStateTileManifest, validateStateTilePlan, type StateTileManifest, type StateTilePlan } from './stateTiles'

/** Shared wire client, usable in the UI and workers without importing React. */
export async function fetchStateTilePlan(params: { base: string; bodyIds: string[]; epochTdbJd: number; signal: AbortSignal; fetcher?: typeof fetch; manifest?: StateTileManifest }): Promise<{ manifest: StateTileManifest; plan: StateTilePlan }> {
  const fetcher = params.fetcher ?? fetch
  const manifest = params.manifest ?? validateStateTileManifest(await readStateTileJson(await fetcher(`${params.base}/v1/catalog/manifest`, { signal: params.signal }), 'State catalog manifest'))
  const request = { ids: [...params.bodyIds], epochJd: params.epochTdbJd, frame: 'ECLIPJ2000' as const, timeScale: 'TDB' as const, fieldMask: ['position', 'velocity'], precision: 'exact' as const }
  const response = await fetcher(`${params.base}/v1/state/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: params.signal })
  const plan = validateStateTilePlan(await readStateTileJson(response, 'State tile plan'), manifest, params.epochTdbJd, params.bodyIds, await digestStateTileRequestIds(params.bodyIds))
  return { manifest, plan }
}
