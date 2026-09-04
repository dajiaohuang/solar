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
const attrs = (html) => Object.fromEntries([...String(html).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), decode(m[2] ?? m[3])]))
const cells = (row) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1])
const firstHref = (html) => {
  const match = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(String(html ?? ''))
  return match?.[1] ?? match?.[2]
}
const normalize = (value) => {
  const valueText = text(value).toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/_/g, '/').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').replace(/\.$/, '').trim()
  const provisional = /^([a-z])\/?(\d{4})\/?\s*([a-z])\s*(\d+)$/i.exec(valueText)
  return provisional ? `${provisional[1]}/${provisional[2]} ${provisional[3]}${provisional[4]}` : valueText
}

function modalSources(html) {
  const sources = new Map()
  const starts = [...html.matchAll(/<div\b[^>]*\bid\s*=\s*(?:"([A-Za-z]+\d+)"|'([A-Za-z]+\d+)')[^>]*>/gi)]
  for (let i = 0; i < starts.length; i++) {
    const id = starts[i][1] ?? starts[i][2]
    const body = html.slice(starts[i].index, starts[i + 1]?.index ?? html.length)
    const field = (label) => {
      const found = new RegExp(`${label}\\s*:?\\s*(?:<[^>]*>\\s*)?([^<]+)`, 'i').exec(body)
      return found ? text(found[1]) : null
    }
    const data = /Data\s*File/i.test(body) ? (firstHref(body.match(/Data\s*File[\s\S]{0,500}/i)?.[0] ?? '') ?? field('Data\\s*File')) : null
    const reference = field('Reference')
    const from = field('Start'), to = field('Stop')
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error(`Invalid bounds for satellite ephemeris ${id}`)
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
    if (raw.length <= Math.max(...Object.values(index))) throw new Error('Invalid satellite ephemeris row')
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
    const prior = bodies.find((body) => body.naifId === naifId)
    if (prior) {
      if (prior.parentNaifId !== parent.naif || normalize(prior.name) !== normalize(name)) throw new Error(`Duplicate NAIF satellite code with conflicting identity: ${codeText}`)
      continue
    }
    bodies.push({ naifId, name, parentId: parent.id, parentNaifId: parent.naif, ephemeris: target, reference: text(raw[index.ref]) || null })
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
    if (candidates.length === 1) return { discovery, body: candidates[0], status: 'matched', reason: null }
    if (candidates.length > 1) return { discovery, body: null, status: 'ambiguous', reason: 'Multiple exact name matches under the same parent' }
    return { discovery, body: null, status: 'unmatched', reason: 'No exact normalized name and parent match' }
  })
  return { records: entries, matched: entries.filter((e) => e.status === 'matched'), unmatched: entries.filter((e) => e.status === 'unmatched'), ambiguous: entries.filter((e) => e.status === 'ambiguous') }
}
