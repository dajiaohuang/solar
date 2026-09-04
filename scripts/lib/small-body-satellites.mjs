// Explicitly reviewed source identities. Never derive a component/primary ID
// from a decimal prefix or promote a system barycenter to a named body.
export const SMALL_BODY_SATELLITE_SOURCES = [
  { id: 'tnosat_v001_20136199_jpl080_20220908', parentId: 'eris', parentName: 'Eris', primary: 920136199, system: 20136199,
    moons: [{ target: 120136199, sourceName: 'Dysnomia', name: 'Dysnomia', aliases: [] }] },
  { id: 'tnosat_v001b_20136108_jpl110_20221014', parentId: 'haumea', parentName: 'Haumea', primary: 920136108, system: 20136108,
    moons: [{ target: 120136108, sourceName: 'Hiiaka', name: 'Hiʻiaka', aliases: ['Hiiaka', "Hi'iaka"] }, { target: 220136108, sourceName: 'Namaka', name: 'Namaka', aliases: [] }] },
]

export function smallBodySatelliteIdentities(selection, record, sourceSha256) {
  const url = `https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/${selection.id}.bsp`
  if (record.source?.source !== url || !/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error('Small-body satellite source identity mismatch')
  const requireSegments = (target, center, type) => {
    const segments = record.segments.filter(segment => segment.target === target)
    if (!segments.length || segments.some(segment => segment.center !== center || segment.type !== type || segment.frame !== 1)) throw new Error('Small-body satellite center chain mismatch')
  }
  const requireName = (name, target) => {
    if (!/^[A-Za-z]+$/.test(name) || !Number.isSafeInteger(target)) throw new Error('Invalid explicit component identity')
    const lines = record.comments.split(/\r?\n/).filter(line => new RegExp(`^\\s*${name}\\s+${target}\\s+[-+0-9.Ee]+\\s+\\d+\\s+\\d+\\s+SATORBINT\\s*$`).test(line))
    if (!lines.length) throw new Error('Missing original component name/number evidence')
  }
  requireName(selection.parentName, selection.primary)
  requireSegments(selection.primary, selection.system, 2)
  requireSegments(selection.system, 10, 21)
  if (new Set([selection.primary, selection.system, ...selection.moons.map(moon => moon.target)]).size !== selection.moons.length + 2) throw new Error('Duplicate component identity')
  return selection.moons.map(moon => {
    requireName(moon.sourceName, moon.target)
    requireSegments(moon.target, selection.system, 2)
    return {
      id: `naif:${moon.target}`, naifId: moon.target, name: moon.name, parentId: selection.parentId,
      aliases: moon.aliases, identityStatus: 'source-identified-not-in-discovery-snapshot',
      identityResolution: 'original-comment-name-number-and-system-primary-descriptors',
      sourceEphemerides: [selection.id], sourceUrl: url, sourceSha256,
      primaryNaifId: selection.primary, systemNaifId: selection.system,
      provenance: 'Published component relative to its system barycenter; named parent uses the distinct original primary offset. Source GM is not asserted measured mass.',
      sourceClaims: [{ name: moon.sourceName, parentNaifId: selection.primary, systemNaifId: selection.system, ephemeris: selection.id, evidence: 'original-comment-name-number-and-system-primary-descriptors' }],
    }
  })
}
