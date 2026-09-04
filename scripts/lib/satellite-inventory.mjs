import { createHash } from 'node:crypto'

const PARENTS = { Mars: 'naif:499', Jupiter: 'naif:599', Saturn: 'naif:699', Uranus: 'naif:799', Neptune: 'naif:899', Pluto: 'sb:asteroid:134340' }
const clean = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim()

/** Strictly parse the one documented JPL discovery table, not arbitrary HTML. */
export function parsePlanetarySatellites(html) {
  const expected = Number(/A total of\s+(\d+)\s+planetary satellites/.exec(html)?.[1])
  const table = /<table\b[^>]*class="sat-discovery\s[^\"]*"[^>]*>([\s\S]*?)<\/table>/.exec(html)?.[1]
  if (!table || !Number.isSafeInteger(expected) || expected < 1) throw new Error('Unrecognized JPL satellite discovery table')
  const rows = [], groups = []
  let group
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(m[1]))
    if (!cells.length) continue
    if (cells.length === 1) {
      const heading = /^Satellites of (?:Dwarf Planet )?(\w+): (\d+)$/.exec(cells[0])
      if (!heading || !PARENTS[heading[1]] || groups.some((g) => g.name === heading[1])) throw new Error(`Invalid satellite group: ${cells[0]}`)
      group = { name: heading[1], expected: Number(heading[2]), count: 0 }; groups.push(group)
      continue
    }
    if (!group || cells.length !== 6) throw new Error('Invalid satellite discovery row')
    const [iauNumber, name, provisional, year, discoverers, reference] = cells
    const key = iauNumber || provisional
    if (!key || (iauNumber && !/^[IVXLCDM]+$/.test(iauNumber))) throw new Error('Missing or invalid satellite identity')
    rows.push({ id: `sat:planet:${group.name.toLowerCase()}:${iauNumber ? 'iau' : 'provisional'}:${key}`,
      designation: `${group.name} ${key}`, name: name || provisional, category: 'moon',
      parentId: PARENTS[group.name], confirmation: 'confirmed', identityStatus: 'source-designation',
      aliases: [name, provisional].filter(Boolean), geometryStatus: 'missing-elements',
      reason: 'Discovery table supplies identity, not orbital elements',
      sourceRef: { iauNumber, provisional, year, discoverers, reference } })
    group.count++
  }
  if (rows.length !== expected || groups.some((g) => g.count !== g.expected)) throw new Error('Satellite discovery count mismatch')
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error('Duplicate planetary satellite identity')
  return { records: rows, expected, groups }
}

/** Missing fields and approximate strings remain upstream evidence, not numbers. */
export function parseSmallBodySatellites(payload) {
  if (payload.signature?.version !== '1.0' || payload.signature?.source !== 'NASA/JPL Small-Body Satellites API') throw new Error('Unsupported small-body satellite API signature')
  const count = Number(payload.count)
  if (!Number.isSafeInteger(count) || count < 0 || !Array.isArray(payload.data) || payload.data.length !== count) throw new Error('Small-body satellite count mismatch')
  const records = payload.data.map((record, sourceRow) => {
    const sat = record.sat
    if (!sat || !['Y', 'N'].includes(sat.confirmed) || !['an', 'au', 'cn', 'cu'].includes(sat.kind) || !clean(sat.pdes)) throw new Error('Invalid small-body satellite identity')
    const parentId = `sb:${sat.kind.startsWith('a') ? 'asteroid' : 'comet'}:${clean(sat.pdes)}`
    const positive = (value) => /^[1-9]\d*$/.test(String(value ?? ''))
    let component, identityStatus = 'source-designation'
    if (positive(sat.iau_num)) component = `iau:${sat.iau_num}`
    else if (positive(sat.prov_year) && positive(sat.prov_num)) component = `provisional:${sat.prov_year}:${sat.prov_num}`
    else {
      // A record digest is not an asserted astronomical identity. Never combine
      // two unnamed components merely because their missing IDs are both null.
      identityStatus = 'unresolved-component'
      component = `record:${createHash('sha256').update(JSON.stringify([sat.pdes, sat.prov_year, sat.prov_num, sat.iau_num, sat.iau_name, sat.sat_fullname, sat.ref, sat.notes])).digest('hex')}:${sourceRow}`
    }
    return { id: `sat:${parentId}:${component}`, parentId,
      designation: clean(sat.sat_fullname) || null, name: clean(sat.iau_name) || clean(sat.sat_fullname) || null,
      category: 'small-body-moon', confirmation: sat.confirmed === 'Y' ? 'confirmed' : 'candidate', identityStatus,
      geometryStatus: record.orbit ? 'unvalidated-satellite-elements' : 'missing-elements',
      reason: record.orbit ? 'Raw source elements may be incomplete; frame, epoch and phase are not yet validated for propagation' : 'No orbit supplied by source',
      sourceRow, sourceRef: sat, orbitEvidence: record.orbit ?? null, physicalEvidence: record.phys_par ?? null }
  })
  if (new Set(records.map((r) => r.id)).size !== records.length) throw new Error('Duplicate small-body satellite identity; reconciliation required')
  return records
}
