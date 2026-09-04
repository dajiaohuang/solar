const PARENTS = new Map([
  ['mars', { id: 'mars', naif: 499 }],
  ['jupiter', { id: 'jupiter', naif: 599 }],
  ['saturn', { id: 'saturn', naif: 699 }],
  ['uranus', { id: 'uranus', naif: 799 }],
  ['neptune', { id: 'neptune', naif: 899 }],
  ['pluto', { id: 'pluto', naif: 999 }],
])

const decode = (value) => String(value ?? '')
  .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))

const text = (html) => decode(String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
const cells = (row) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1])
const firstHref = (html) => {
  const match = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(String(html ?? ''))
  return match?.[1] ?? match?.[2]
}
const normalize = (value) => {
  const valueText = text(value).toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/_/g, '/').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').replace(/\.$/, '').trim()
  // JPL embedded tables use S2003_j_2 and S2023_s01 as well as S/2003 J2.
  // Only normalize the explicit designation syntax, never infer a NAIF ID.
  const provisional = /^s\/?(\d{4})\/?\s*([a-z])\/?\s*(\d+)$/i.exec(valueText)
  return provisional ? `s/${provisional[1]} ${provisional[2]}${provisional[3].replace(/^0+(?=\d)/, '')}` : valueText
}

function modalSources(html) {
  const sources = new Map()
  const starts = [...html.matchAll(/<div\b[^>]*\bid\s*=\s*(?:"([A-Za-z]+\d+)"|'([A-Za-z]+\d+)')[^>]*>/gi)]
  for (let i = 0; i < starts.length; i++) {
    const id = starts[i][1] ?? starts[i][2]
    if (sources.has(id)) throw new Error(`Duplicate satellite ephemeris source ${id}`)
    const body = html.slice(starts[i].index, starts[i + 1]?.index ?? html.length)
    const field = (label) => {
      const entry = [...body.matchAll(/<(?:li|p)\b[^>]*>([\s\S]*?)<\/(?:li|p)>/gi)]
        .map(match => text(match[1])).find(value => new RegExp(`^${label}\\s*:`, 'i').test(value))
      return entry ? entry.replace(new RegExp(`^${label}\\s*:\\s*`, 'i'), '').trim() : null
    }
    const data = /Data\s*File/i.test(body) ? (firstHref(body.match(/Data\s*File[\s\S]{0,500}/i)?.[0] ?? '') ?? field('Data\\s*File')) : null
    const reference = field('Reference')
    const from = field('Start'), to = field('Stop')
    const validDate = value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
      const ms = Date.parse(`${value}T00:00:00Z`)
      return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
    }
    if (!validDate(from) || !validDate(to) || from >= to) throw new Error(`Invalid bounds for satellite ephemeris ${id}`)
    sources.set(id, { id, url: data, from, to, reference })
  }
  return sources
}

/** Parse the bounded JPL satellite ephemeris table and its linked modal evidence. */
export function parseSatelliteEphemerisIndex(html) {
  if (typeof html !== 'string') throw new TypeError('Satellite ephemeris HTML must be a string')
  const table = /<table\b[^>]*\bid\s*=\s*(?:"sat_ephem"|'sat_ephem')[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1]
  if (!table) throw new Error('Missing JPL sat_ephem table')
  const heading = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => normalize(m[1]))
  const required = ['planet', 'satellite', 'code', 'ephemeris', 'ref']
  if (!required.every((key) => heading.includes(key))) throw new Error('Invalid satellite ephemeris table header')
  const index = Object.fromEntries(required.map((key) => [key, heading.indexOf(key)]))
  const sourcesById = modalSources(html)
  const bodies = []
  for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const raw = cells(rowMatch[1])
    if (!raw.length || raw.some((cell) => /<th\b/i.test(cell))) continue
    if (raw.length !== heading.length) throw new Error('Invalid satellite ephemeris row')
    const parentName = text(raw[index.planet]).toLowerCase()
    const parent = PARENTS.get(parentName)
    if (!parent) throw new Error(`Unsupported satellite parent: ${text(raw[index.planet])}`)
    const codeText = text(raw[index.code])
    if (!/^[1-9]\d*$/.test(codeText)) throw new Error(`Invalid NAIF satellite code: ${codeText}`)
    const naifId = Number(codeText)
    const name = text(raw[index.satellite])
    if (!name) throw new Error('Missing satellite name')
    const link = firstHref(raw[index.ephemeris])
    const target = link?.match(/#([^#/?]+)$/)?.[1] ?? text(raw[index.ephemeris]).match(/^[A-Za-z]+\d+$/)?.[0]
    if (!target || !sourcesById.has(target)) throw new Error(`Unlinked satellite ephemeris for ${name}`)
    if (!Number.isSafeInteger(naifId)) throw new Error(`Duplicate or unsafe NAIF satellite code: ${codeText}`)
    const family = naifId < 1000 ? Math.floor(naifId / 100) : Math.floor(naifId / 10000)
    if (family !== Math.floor(parent.naif / 100) || naifId === parent.naif) throw new Error(`Satellite code/parent mismatch: ${codeText}`)
    const assignment = { ephemeris: target, reference: text(raw[index.ref]) || null }
    const prior = bodies.find((body) => body.naifId === naifId)
    if (prior) {
      if (prior.parentNaifId !== parent.naif || normalize(prior.name) !== normalize(name)) throw new Error(`Duplicate NAIF satellite code with conflicting identity: ${codeText}`)
      // A body can be present in several source solutions (e.g. Puck). Keep
      // every assignment; row order is NOT an ephemeris precedence policy.
      prior.sourceAssignments ??= [{ ephemeris: prior.ephemeris, reference: prior.reference }]
      if (!prior.sourceAssignments.some(item => item.ephemeris === assignment.ephemeris && item.reference === assignment.reference)) prior.sourceAssignments.push(assignment)
      continue
    }
    bodies.push({ naifId, name, parentId: parent.id, parentNaifId: parent.naif, ...assignment })
  }
  if (!bodies.length) throw new Error('Satellite ephemeris table has no rows')
  return { bodies, sources: [...sourcesById.values()] }
}

const parentKey = (record) => {
  const byNaif = (value) => [...PARENTS.entries()].find(([, parent]) => parent.naif === Number(value))?.[0]
  if (Number.isSafeInteger(record?.parentNaifId)) return byNaif(record.parentNaifId) ?? `naif:${record.parentNaifId}`
  const value = String(record?.parentId ?? '').toLowerCase().replace(/^naif:/, '')
  if (value === 'sb:asteroid:134340') return 'pluto'
  if (/^\d+$/.test(value)) return byNaif(value) ?? `naif:${value}`
  return PARENTS.get(value)?.id ?? value
}

/** Reconcile discovery identities only on exact normalized name/designation and parent. */
export function reconcileSatelliteIdentities(discoveryRecords, indexBodies) {
  if (!Array.isArray(discoveryRecords) || !Array.isArray(indexBodies)) throw new TypeError('Discovery records and index bodies must be arrays')
  const entries = discoveryRecords.map((discovery) => {
    const names = [discovery.name, discovery.designation, ...(Array.isArray(discovery.aliases) ? discovery.aliases : [])].filter(Boolean).map(normalize)
    const parent = parentKey(discovery)
    const candidates = indexBodies.filter((body) => parentKey(body) === parent && names.includes(normalize(body.name)))
    const identities = new Set(candidates.map((body, i) => Number.isSafeInteger(body.naifId) ? body.naifId : `unidentified:${i}`))
    if (identities.size === 1) return { discovery, body: candidates[0], sourceMatches: candidates, status: 'matched', reason: null }
    if (identities.size > 1) return { discovery, body: null, sourceMatches: candidates, status: 'ambiguous', reason: 'Multiple distinct target IDs match the exact name under the same parent' }
    return { discovery, body: null, status: 'unmatched', reason: 'No exact normalized name and parent match' }
  })
  return { records: entries, matched: entries.filter((e) => e.status === 'matched'), unmatched: entries.filter((e) => e.status === 'unmatched'), ambiguous: entries.filter((e) => e.status === 'ambiguous') }
}

/** Read explicit body names/numbers from JPL's embedded SATEPHGEN tables.
 * Numbers must also occur in actual SPK descriptors. Never infer missing IDs
 * from Roman numerals, provisional designations, or the ordering of rows. */
export function parseSatelliteKernelIdentities(comments, segments, ephemeris) {
  const targets = new Set(segments.map(segment => segment.target))
  const bodies = []
  let parent, inTable = false
  for (const line of comments.split('\n')) {
    const planet = /^Planet Name:\s*(\w+)\s*$/.exec(line)
    if (planet) { parent = PARENTS.get(planet[1].toLowerCase()); inTable = false; continue }
    if (/^Bodies on the File:/.test(line)) { inTable = true; continue }
    if (/^Additional Constants|^\*{5}/.test(line)) { inTable = false; continue }
    if (!inTable || !parent) continue
    const row = /^\s*(\S+)\s+(\d+)\s+([+\-\d.DEde]+)\s+\d+\s+\d+\s+\S+\s*$/.exec(line)
    if (!row) continue
    const naifId = Number(row[2])
    if (!targets.has(naifId) || naifId === parent.naif) continue
    const family = naifId < 1000 ? Math.floor(naifId / 100) : Math.floor(naifId / 10000)
    if (family !== Math.floor(parent.naif / 100)) throw new Error('SPK comment identity/parent conflict')
    // Separate source solutions may use older names. Preserve distinct aliases
    // with the same explicit number instead of dropping or guessing identities.
    if (bodies.some(body => body.naifId === naifId && body.name === row[1])) continue
    bodies.push({ naifId, name: row[1], parentId: parent.id, parentNaifId: parent.naif,
      ephemeris, reference: 'JPL SPK embedded Bodies on the File table',
      identityEvidence: 'source-comment-name-number-matched-to-descriptor',
      sourceModelGmKm3S2: row[3], sourceModelGmBoundary: 'Upstream dynamical-model parameter, not asserted measured physical mass.' })
  }
  return bodies
}
