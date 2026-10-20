import capacity from '../data/gaiaCapacity.json'
import { decodeGaiaManifest, type GaiaManifest } from './gaiaChunks'

export type GaiaTangentProjection = { centerRaDeg: number; centerDecDeg: number; radiusDeg: number }
export type GaiaCollectionPlan = {
  manifests: GaiaManifest[]
  declaredRows: number
  selectedBytes: number
  chunkCount: number
  projection: GaiaTangentProjection
}

const radiansToDegrees = 180 / Math.PI

/** Validate aggregate admission before any source chunks are requested. */
export function planGaiaCollection(input: readonly GaiaManifest[]): GaiaCollectionPlan {
  if (!Array.isArray(input) || input.length < 1 || input.length > capacity.maxCatalogsPerChart) {
    throw new Error(`A Gaia chart accepts 1 to ${capacity.maxCatalogsPerChart} region manifests`)
  }
  const manifests = input.map(manifest => {
    if (!manifest || typeof manifest !== 'object') throw new Error('Invalid Gaia region manifest')
    return decodeGaiaManifest(new TextEncoder().encode(JSON.stringify(manifest)))
  })
  const schemaVersion = manifests[0].schemaVersion
  if (manifests.some(manifest => manifest.schemaVersion !== schemaVersion)) throw new Error('Combined Gaia regions must use the same source-column schema')

  let declaredRows = 0, selectedBytes = 0, chunkCount = 0
  let x = 0, y = 0, z = 0
  for (const manifest of manifests) {
    declaredRows += manifest.rows
    selectedBytes += manifest.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)
    chunkCount += manifest.chunks.length
    const ra = manifest.settings.raDeg / radiansToDegrees, dec = manifest.settings.decDeg / radiansToDegrees
    const cosDec = Math.cos(dec)
    x += cosDec * Math.cos(ra); y += cosDec * Math.sin(ra); z += Math.sin(dec)
  }
  if (declaredRows > capacity.maxChartRows || selectedBytes > capacity.maxSelectedBytes || chunkCount > capacity.maxChunks) {
    throw new Error('Combined Gaia regions exceed the aggregate row, byte or chunk budget')
  }
  const centerLength = Math.hypot(x, y, z)
  if (!Number.isFinite(centerLength) || centerLength <= manifests.length * 1e-10) {
    throw new Error('Combined Gaia regions do not define one stable tangent-plane center')
  }
  x /= centerLength; y /= centerLength; z /= centerLength
  const centerRaDeg = Math.hypot(x, y) <= 1e-12 ? manifests[0].settings.raDeg : (Math.atan2(y, x) * radiansToDegrees + 360) % 360
  const centerDecDeg = Math.asin(Math.max(-1, Math.min(1, z))) * radiansToDegrees
  let radiusDeg = 0
  for (const manifest of manifests) {
    const ra = manifest.settings.raDeg / radiansToDegrees, dec = manifest.settings.decDeg / radiansToDegrees
    const cosDec = Math.cos(dec), cx = cosDec * Math.cos(ra), cy = cosDec * Math.sin(ra), cz = Math.sin(dec)
    const angularDistance = Math.atan2(Math.hypot(y * cz - z * cy, z * cx - x * cz, x * cy - y * cx), Math.max(-1, Math.min(1, x * cx + y * cy + z * cz))) * radiansToDegrees
    // The triangle inequality makes this a conservative cap for every source
    // in the catalog cone, independent of its 5-degree storage bins.
    radiusDeg = Math.max(radiusDeg, angularDistance + manifest.settings.radiusDeg)
  }
  if (!Number.isFinite(radiusDeg) || radiusDeg <= 0 || radiusDeg > capacity.maxProjectionRadiusDegrees) {
    throw new Error(`Combined Gaia regions exceed the ${capacity.maxProjectionRadiusDegrees}° tangent-plane field; split them into separate views`)
  }
  return { manifests, declaredRows, selectedBytes, chunkCount, projection: { centerRaDeg, centerDecDeg, radiusDeg } }
}
