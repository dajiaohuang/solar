const parentIds = new Map([['naif:499', 'mars'], ['naif:599', 'jupiter'], ['naif:699', 'saturn'], ['naif:799', 'uranus'], ['naif:899', 'neptune'], ['sb:asteroid:134340', 'pluto']])

/** Identity coverage is independent of current positional coverage. Include
 * unmapped discovery entries, but do not manufacture a NAIF ID or orbit. */
export function makeSatelliteCatalog(report) {
  if (!report.resolvedIdentities || !report.registry) throw new Error('Independently corroborated satellite identity report is required')
  const entries = []
  for (const record of report.resolvedIdentities.records) {
    const parentId = parentIds.get(record.discovery.parentId)
    if (!parentId) throw new Error(`Unknown discovery parent ${record.discovery.parentId}`)
    const naifId = record.status === 'matched' ? record.body.naifId : undefined
    if (naifId !== undefined && (!Number.isSafeInteger(naifId) || naifId <= 0)) throw new Error('Invalid resolved satellite number')
    entries.push({ id: naifId === undefined ? record.discovery.id : `naif:${naifId}`,
      ...(naifId === undefined ? {} : { naifId }), name: record.discovery.name, parentId,
      aliases: record.discovery.aliases ?? [], discoveryId: record.discovery.id,
      identityStatus: record.status, identityResolution: record.resolution,
      sourceEphemerides: [...new Set((record.sourceMatches ?? []).flatMap(body => body.sourceAssignments?.map(source => source.ephemeris) ?? [body.ephemeris]))].sort(),
      provenance: 'JPL discovery identity; explicit source target; NAIF registry corroboration where available',
    })
  }
  // A published kernel may contain an explicitly named object absent from the
  // discovery page snapshot. Preserve it as source-identified, not confirmed.
  for (const body of report.commentBodies) {
    const expectedParent = body.parentNaifId === 999 ? 'pluto' : parentIds.get(`naif:${body.parentNaifId}`)
    if (!expectedParent || expectedParent !== body.parentId) throw new Error('Unknown or inconsistent SPK identity parent')
    if (!Number.isSafeInteger(body.naifId) || body.naifId <= 0 || !body.name || !body.ephemeris) throw new Error('Incomplete SPK identity claim')
    const existing = entries.find(entry => entry.naifId === body.naifId)
    if (existing) {
      if (existing.parentId !== body.parentId) throw new Error('Conflicting SPK identity parent requires reconciliation')
      // Preserve every raw claim, including misspellings/conflicting names.
      // They are evidence, never silently promoted to search aliases.
      existing.sourceEphemerides = [...new Set([...existing.sourceEphemerides, body.ephemeris])].sort()
      continue
    }
    entries.push({ id: `naif:${body.naifId}`, naifId: body.naifId, name: body.name, parentId: body.parentId,
      aliases: [], identityStatus: 'source-identified-not-in-discovery-snapshot',
      identityResolution: body.identityEvidence, sourceEphemerides: [body.ephemeris],
      provenance: 'Explicit original SPK comment name/number corroborated by segment descriptor; not an IAU confirmation claim',
    })
  }
  for (const entry of entries) {
    const claims = (report.commentBodies ?? []).filter(body => body.naifId === entry.naifId)
      .map(body => ({ name: body.name, parentNaifId: body.parentNaifId, ephemeris: body.ephemeris, evidence: body.identityEvidence }))
    entry.sourceClaims = [...new Map(claims.map(claim => [JSON.stringify(claim), claim])).values()]
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))
    if (!entry.discoveryId && new Set(claims.map(claim => claim.name.toLowerCase())).size > 1) {
      // No independent discovery identity is available to adjudicate a name.
      // Keep the explicit target, not a first-source-wins display name.
      entry.name = `NAIF ${entry.naifId}`
      entry.identityResolution = 'conflicting-source-names-retained-unresolved'
    }
  }
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate satellite identity requires explicit reconciliation')
  if (entries.some(entry => !entry.id || !entry.name)) throw new Error('Incomplete satellite identity')
  return entries.sort((a, b) => a.parentId.localeCompare(b.parentId, 'en') || (a.naifId ?? Infinity) - (b.naifId ?? Infinity) || a.id.localeCompare(b.id, 'en'))
}
