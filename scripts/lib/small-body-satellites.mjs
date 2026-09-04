// Explicitly reviewed source identities. Never derive a component/primary ID
// from a decimal prefix or promote a system barycenter to a named body.
export const SMALL_BODY_SATELLITE_SOURCES = [
  { id: 'tnosat_v001_20136199_jpl080_20220908', parentId: 'eris', parentName: 'Eris', primary: 920136199, system: 20136199,
    moons: [{ target: 120136199, sourceName: 'Dysnomia', name: 'Dysnomia', aliases: [] }] },
  { id: 'tnosat_v001b_20136108_jpl110_20221014', parentId: 'haumea', parentName: 'Haumea', primary: 920136108, system: 20136108,
    moons: [{ target: 120136108, sourceName: 'Hiiaka', name: 'Hiʻiaka', aliases: ['Hiiaka', "Hi'iaka"] }, { target: 220136108, sourceName: 'Namaka', name: 'Namaka', aliases: [] }] },
  { id: 'tnosat_v001_20050000_jpl043_20220908', parentId: 'quaoar', parentName: 'Quaoar', primary: 920050000, system: 20050000,
    designation: '50000', horizonsName: '50000 Quaoar (2002 LM60)', inventoryId: 'sb:asteroid:50000',
    moons: [{ target: 120050000, sourceName: 'Weywot', name: 'Weywot', aliases: [] }] },
  { id: 'tnosat_v001_20090482_jpl043_20220908', parentId: 'orcus', parentName: 'Orcus', primary: 920090482, system: 20090482,
    designation: '90482', horizonsName: '90482 Orcus (2004 DW)', inventoryId: 'sb:asteroid:90482',
    moons: [{ target: 120090482, sourceName: 'Vanth', name: 'Vanth', aliases: [] }] },
  { id: 'tnosat_v001_20120347_jpl025_20220908', parentId: 'salacia', parentName: 'Salacia', primary: 920120347, system: 20120347,
    designation: '120347', horizonsName: '120347 Salacia (2004 SB60)', inventoryId: 'sb:asteroid:120347',
    moons: [{ target: 120120347, sourceName: 'Actaea', name: 'Actaea', aliases: [] }] },
  { id: 'tnosat_v001_53031823_jpl010_20220908', parentId: '1998ww31', parentName: '1998ww31', primary: 953031823, system: 53031823,
    designation: '1998 WW31', horizonsName: '(1998 WW31)', inventoryId: 'sb:asteroid:1998 WW31', displayName: '1998 WW31',
    moons: [{ target: 153031823, sourceName: 'Sat1', name: '1998 WW31 · Sat1', aliases: [] }] },
  { id: 'tnosat_v001_53092511_jpl005_20220908', parentId: '2001qw322', parentName: '2001qw322', primary: 953092511, system: 53092511,
    designation: '2001 QW322', horizonsName: '(2001 QW322)', inventoryId: 'sb:asteroid:2001 QW322', displayName: '2001 QW322',
    moons: [{ target: 153092511, sourceName: 'Sat1', name: '2001 QW322 · Sat1', aliases: [] }] },
]

export function smallBodySatelliteIdentities(selection, record, sourceSha256) {
  const url = `https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/${selection.id}.bsp`
  if (record.source?.source !== url || !/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error('Small-body satellite source identity mismatch')
  const requireSegments = (target, center, type) => {
    const segments = record.segments.filter(segment => segment.target === target)
    if (!segments.length || segments.some(segment => segment.center !== center || segment.type !== type || segment.frame !== 1)) throw new Error('Small-body satellite center chain mismatch')
  }
  const requireName = (name, target) => {
    if (!/^[A-Za-z0-9]+$/.test(name) || !Number.isSafeInteger(target)) throw new Error('Invalid explicit component identity')
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

export function smallBodyPrimaryIdentity(selection, record, sourceSha256) {
  // Apply the same source/comment/descriptor checks to both sides of the pair.
  smallBodySatelliteIdentities(selection, record, sourceSha256)
  if (!selection.designation) return null // Existing curated Eris/Haumea IDs.
  const targetNames = [...record.comments.matchAll(/^Target body\s*:\s*(.*?)\s+\{source:/gm)].map(match => match[1])
  if (!targetNames.includes(selection.horizonsName)) throw new Error('Missing original primary designation evidence')
  return { id: selection.parentId, naifId: selection.primary, systemNaifId: selection.system,
    name: selection.displayName ?? selection.parentName, designation: selection.designation, inventoryId: selection.inventoryId,
    sourceUrl: record.source.source, sourceSha256, sourceEphemeris: selection.id,
    meaning: 'Named primary from original component offsets, not its system barycenter; no invented orbit or physical properties.' }
}
