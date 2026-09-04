import { inspectSpk } from '../crop-spk.mjs'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Metadata only. Reading an SPK descriptor does NOT validate its states. */
export async function surveySpkSource(source, onRead = async () => {}) {
  const reads = []
  const archivedSource = {
    size: source.size,
    async read(start, length) {
      const bytes = await source.read(start, length)
      reads.push({ start, length, sha256: createHash('sha256').update(bytes).digest('hex') })
      await onRead(start, bytes)
      return bytes
    },
  }
  const inspected = await inspectSpk(archivedSource)
  const firstSummary = inspected.little ? inspected.header.readInt32LE(76) : inspected.header.readInt32BE(76)
  const commentBytes = (firstSummary - 2) * 1024
  if (commentBytes < 0 || commentBytes > 8 * 1024 * 1024) throw new Error('SPK comment area exceeds survey safety limit')
  const comments = commentBytes ? decodeDafComments(await archivedSource.read(1024, commentBytes)) : ''
  return {
    source: source.identity,
    reads,
    segments: inspected.segments,
    targets: [...new Set(inspected.segments.map(segment => segment.target))].sort((a, b) => a - b),
    comments,
    stateValidation: 'not-evaluated; descriptors only',
  }
}

/** N0067 DAFEC: 1000 comment characters per 1024-byte physical record, NUL
 * terminates a line, ASCII 4 ends comments. Skip physical padding, not text.
 * https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/dafec_c.html */
export function decodeDafComments(bytes) {
  if (bytes.length % 1024) throw new Error('Incomplete DAF comment record')
  const chunks = []
  for (let offset = 0; offset < bytes.length; offset += 1024) chunks.push(bytes.subarray(offset, offset + 1000))
  const characters = Buffer.concat(chunks)
  const end = characters.indexOf(4)
  if (end < 0) {
    if (characters.every(byte => byte === 0)) return ''
    throw new Error('Missing DAF end-of-comments marker')
  }
  const text = characters.subarray(0, end)
  if (text.some(byte => byte !== 0 && (byte < 32 || byte > 126))) throw new Error('Invalid DAF comment character')
  return text.toString('ascii').replaceAll('\0', '\n')
}

/** Preserve the page's original link and show any verified directory repair. */
export function locateSatelliteSource(url, directoryUrls) {
  const root = 'https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/'
  let parsed
  try { parsed = new URL(url) } catch { return { declaredUrl: url, url: null, reason: 'invalid-source-url' } }
  if (parsed.origin !== 'https://ssd.jpl.nasa.gov') return { declaredUrl: url, url: null, reason: 'unexpected-source-origin' }
  const file = parsed.pathname.split('/').at(-1)
  if (!/^[\w.-]+\.bsp$/.test(file ?? '')) return { declaredUrl: url, url: null, reason: 'invalid-source-filename' }
  const candidate = `${root}${file}`
  if (!directoryUrls.includes(candidate)) return { declaredUrl: url, url: null, reason: 'not-in-public-directory' }
  return { declaredUrl: url, url: candidate, reason: candidate === url ? 'published-link' : 'same-filename-in-verified-public-directory' }
}

/** Link names are evidence, not authorization to fetch arbitrary locations. */
export function satelliteDirectoryUrls(html) {
  const root = 'https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/'
  const files = new Set()
  for (const match of html.matchAll(/href="([\w.-]+\.bsp)"/g)) files.add(new URL(match[1], root).href)
  if (!files.size) throw new Error('No SPK files in satellite source directory')
  return [...files].sort()
}

/** Report each requested identity separately, including real time/format gaps. */
export function classifySatelliteSource(body, survey, startEt, endEt) {
  if (!Number.isFinite(startEt) || !Number.isFinite(endEt) || startEt > endEt) throw new Error('Invalid survey time window')
  const segments = survey.segments.filter(segment => segment.target === body.naifId)
  if (!segments.length) return { ...body, status: 'target-absent', segments: [] }
  // Adjacent descriptors can cover the interval. This only proves their time
  // union, not continuity, center-chain consistency or numerical accuracy.
  const overlaps = segments.filter(segment => segment.startEt <= endEt && segment.endEt >= startEt)
  const supported = overlaps.filter(segment => [2, 3, 17, 21].includes(segment.type) && [1, 17].includes(segment.frame))
  let status = 'outside-requested-window'
  if (overlaps.length) status = supported.length === overlaps.length ? 'partial-window-descriptors' : 'unsupported-format-in-window'
  let coveredUntil = startEt
  for (const segment of [...supported].sort((a, b) => a.startEt - b.startEt)) {
    if (segment.startEt > coveredUntil) break
    coveredUntil = Math.max(coveredUntil, segment.endEt)
  }
  if (supported.length && supported.length === overlaps.length && coveredUntil >= endEt) status = 'supported-window-descriptors'
  return { ...body, status, segments, stateValidation: 'not-evaluated; no center-chain or numerical-accuracy claim' }
}

/** Multiple published solutions are alternatives, not a first-row priority. */
export function classifySatelliteAssignments(body, surveys, startEt, endEt) {
  const assignments = body.sourceAssignments ?? [{ ephemeris: body.ephemeris, reference: body.reference }]
  const classifications = assignments.map(assignment => {
    const candidate = { ...body, ...assignment }
    delete candidate.sourceAssignments
    const survey = surveys.get(assignment.ephemeris)
    return survey ? classifySatelliteSource(candidate, survey, startEt, endEt) : { ...candidate, status: 'source-unavailable' }
  })
  if (classifications.length === 1) return classifications[0]
  // No single chosen ephemeris/reference leaks out of this aggregate result.
  const identity = { ...body }
  delete identity.ephemeris
  delete identity.reference
  return { ...identity, status: 'source-selection-required', classifications }
}

/** Reparse only retained header/summary byte ranges, with no network access. */
export async function replaySpkSurvey(directory, id, record) {
  if (!/^[\w.-]+$/.test(id)) throw new Error('Unsafe survey identifier')
  const source = {
    identity: record.source, size: record.source.bytes,
    async read(start, length) {
      const expected = record.reads.find(read => read.start === start && read.length === length)
      if (!expected) throw new Error('Missing archived descriptor range')
      const bytes = await readFile(join(directory, `${id}-range-${start}.bin`))
      if (bytes.length !== length || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('Archived descriptor integrity mismatch')
      return bytes
    },
  }
  const replay = await surveySpkSource(source)
  for (const field of ['reads', 'segments', 'targets', 'comments']) {
    if (JSON.stringify(replay[field]) !== JSON.stringify(record[field])) throw new Error(`Archived SPK ${field} replay mismatch`)
  }
  return replay
}
