import type { AsteroidManifest, CatalogSummary } from '../types'

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Structural and declared-metadata consistency; does not rescan source rows. */
export function bindCatalogSummary(summary: CatalogSummary, manifest: AsteroidManifest): CatalogSummary {
  if (!record(summary) || ![1, 2].includes(summary.schemaVersion) || !count(summary.totalCount) ||
      summary.totalCount !== manifest.totalCount || !['lite', 'full'].includes(summary.datasetMode) ||
      manifest.datasetMode !== undefined && summary.datasetMode !== manifest.datasetMode ||
      typeof summary.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(summary.sourceSha256) ||
      manifest.sourceSha256 !== undefined && summary.sourceSha256 !== manifest.sourceSha256) {
    throw new Error('Catalog summary identity/count/mode does not match its manifest')
  }
  if (!record(summary.categoryCounts) || !record(manifest.categoryCounts)) throw new Error('Invalid catalog category counts')
  let total = 0
  const categories = Object.keys(summary.categoryCounts)
  if (categories.length !== Object.keys(manifest.categoryCounts).length) throw new Error('Catalog summary categories differ from manifest')
  for (const category of categories) {
    const value = summary.categoryCounts[category]
    if (!count(value) || !Object.hasOwn(manifest.categoryCounts, category) || value !== manifest.categoryCounts[category] ||
        value > summary.totalCount-total) throw new Error('Catalog summary category count mismatch')
    total += value
  }
  if (total !== summary.totalCount) throw new Error('Catalog summary category counts do not sum to total')
  const known = summary.magnitudeKnownCount, unknown = summary.magnitudeUnknownCount
  if (summary.schemaVersion === 2 || known !== undefined || unknown !== undefined) {
    if (!count(known) || !count(unknown) || known > summary.totalCount || unknown !== summary.totalCount-known) {
      throw new Error('Catalog magnitude coverage does not partition the total')
    }
  }
  if (!record(summary.numericRanges)) throw new Error('Invalid catalog summary ranges')
  for (const range of Object.values(summary.numericRanges)) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(value => typeof value === 'number' && Number.isFinite(value)) || range[0] > range[1]) {
      throw new Error('Catalog summary range is non-finite or reversed')
    }
  }
  if (summary.totalCount > 0) {
    const { semiMajorAxisAU: a, eccentricity: e, inclinationDeg: i, epochJd: epoch } = summary.numericRanges
    if (!a || !e || !i || !epoch || a[0] <= 0 || e[0] < 0 || e[1] >= 1 || i[0] < 0 || i[1] > 180) {
      throw new Error('Catalog summary lacks valid elliptic-element ranges')
    }
  } else if (Object.keys(summary.numericRanges).length) throw new Error('An empty catalog cannot declare measured numeric ranges')
  // Retain only validated fields, with owned nested containers. Unknown source
  // extensions must not keep arbitrary object graphs in the summary cache.
  return {
    schemaVersion: summary.schemaVersion, datasetMode: summary.datasetMode,
    totalCount: summary.totalCount, sourceSha256: summary.sourceSha256,
    categoryCounts: { ...summary.categoryCounts },
    numericRanges: Object.fromEntries(Object.entries(summary.numericRanges).map(([key, range]) => [key, [range[0], range[1]] as [number, number]])),
    ...(known !== undefined ? { magnitudeKnownCount: known } : {}),
    ...(unknown !== undefined ? { magnitudeUnknownCount: unknown } : {}),
  }
}
