import { reconcileSatelliteIdentities } from './satellite-ephemeris-index.mjs'

const REGISTRY_URL = 'https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/naif_ids.html'
const parents = new Map([[4, 'mars'], [5, 'jupiter'], [6, 'saturn'], [7, 'uranus'], [8, 'neptune'], [9, 'pluto']])

/** Read explicit NAIF assignments, not IAU ordinal-to-code guesses. The
 * documented three-digit planetary ID family supplies the registry's parent. */
export function parseNaifSatelliteRegistry(html) {
  const blocks = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)].map(match => match[1].replace(/<[^>]+>/g, ''))
  const records = []
  for (const block of blocks) {
    for (const match of block.matchAll(/^\s*(\d{3})\s+'([^']+)'[^\n]*$/gm)) {
      const naifId = Number(match[1]), family = Math.floor(naifId / 100)
      if (!parents.has(family) || naifId % 100 === 99 || naifId % 100 === 0) continue
      const name = match[2].trim()
      if (!records.some(record => record.naifId === naifId && record.name === name)) records.push({
        naifId, name, parentId: parents.get(family), parentNaifId: family * 100 + 99,
        source: REGISTRY_URL, identityEvidence: 'explicit-NAIF-name-number-registry',
      })
    }
  }
  if (!records.length) throw new Error('No planetary satellite NAIF registry assignments found')
  return records
}

/** Keep the conflicting raw claims. The independent ID registry may resolve a
 * name only when that exact target also occurs in an inspected original SPK. */
export function resolveSatelliteRegistryClaims(discovery, raw, commentBodies, registry) {
  const registryMatches = reconcileSatelliteIdentities(discovery, registry).records
  const records = raw.records.map((record, index) => {
    const match = registryMatches[index]
    if (match.status !== 'matched') return { ...record, resolution: 'unchanged-no-unique-registry-match' }
    const sources = commentBodies.filter(body => body.naifId === match.body.naifId && body.parentNaifId === match.body.parentNaifId)
    if (!sources.length) return { ...record, registryClaim: match.body, resolution: 'unchanged-no-corroborating-spk-identity' }
    const sourceMatches = sources.map(body => ({ ...body, name: record.discovery.name, rawSourceName: body.name, registryClaim: match.body }))
    return { ...record, status: 'matched', reason: null, body: sourceMatches[0], sourceMatches,
      originalStatus: record.status, originalClaims: record.sourceMatches ?? [],
      registryClaim: match.body, resolution: 'NAIF-registry-number-corroborated-by-SPK-descriptor' }
  })
  return { records, matched: records.filter(record => record.status === 'matched'),
    unmatched: records.filter(record => record.status === 'unmatched'), ambiguous: records.filter(record => record.status === 'ambiguous') }
}
