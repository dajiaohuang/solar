import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { createGunzip } from 'node:zlib'

const ROOT_DIR = resolve(import.meta.dirname, '..')
const CACHE_DIR = resolve(ROOT_DIR, '.cache', 'asteroids')
const DEFAULT_RAW_FILE = resolve(CACHE_DIR, 'MPCORB.DAT.gz')
const OUTPUT_ROOT = resolve(process.env.MPCORB_OUTPUT_DIR ?? resolve(ROOT_DIR, 'public', 'data', 'asteroids'))
const SOURCE_URL = process.env.MPCORB_SOURCE_URL ?? 'https://www.minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz'
const CHUNK_SIZE = Number(process.env.MPCORB_CHUNK_SIZE ?? 5000)
const LEGACY_LITE_LIMIT = process.env.MPCORB_LIMIT
const LITE_MAX_PERMANENT_NUMBER = Number(process.env.MPCORB_LITE_MAX_NUMBER ?? LEGACY_LITE_LIMIT ?? 30_000)
const DATASET_MODE = process.env.MPCORB_MODE === 'lite' || LEGACY_LITE_LIMIT ? 'lite' : 'full'
const REQUIRE_FEATURED = process.env.MPCORB_REQUIRE_FEATURED !== '0'
const PARSER_VERSION = '2.1.0'
const PERMANENT_NUMBER_BUCKET_SIZE = 10_000
const MONTH_CODES = '123456789ABC'
const DAY_CODES = '123456789ABCDEFGHIJKLMNOPQRSTUV'
const SKIPPED_DWARF_IDS = new Set(['1', '134340', '136199', '136108', '136472'])
const FEATURED_NAMES = new Set(['vesta', 'pallas', 'juno', 'hygiea', 'eros', 'psyche', 'bennu', 'apophis', 'ida', 'gaspra', 'itokawa', 'ryugu'])

export function findMissingFeatured(shortLabels) {
  const present = new Set(shortLabels.map(normalizeSearchText))
  return [...FEATURED_NAMES].filter((name) => !present.has(name))
}

export function idLookupBucket(id) {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).slice(-2).padStart(2, '0')
}

function assertSafeOutputPath(path) {
  const pathRelativeToRoot = relative(ROOT_DIR, path)
  if (pathRelativeToRoot.startsWith('..') || isAbsolute(pathRelativeToRoot) || path === ROOT_DIR) {
    throw new Error(`Refusing to write dataset outside the repository: ${path}`)
  }
}

export function normalizeSearchText(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim()
}

function gregorianToJulianDay(year, month, day) {
  const a = Math.floor((14 - month) / 12)
  const y = year + 4800 - a
  const m = month + 12 * a - 3
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) -
    Math.floor(y / 100) + Math.floor(y / 400) - 32045 - 0.5
}

export function decodePackedEpoch(packedDate) {
  if (!packedDate || packedDate.length < 5) return null
  const centuryMap = { I: 1800, J: 1900, K: 2000, L: 2100 }
  const century = centuryMap[packedDate[0]]
  const yearSuffix = Number(packedDate.slice(1, 3))
  const monthIndex = MONTH_CODES.indexOf(packedDate[3])
  const dayIndex = DAY_CODES.indexOf(packedDate[4])
  if (!century || !Number.isFinite(yearSuffix) || monthIndex < 0 || dayIndex < 0) return null
  return gregorianToJulianDay(century + yearSuffix, monthIndex + 1, dayIndex + 1)
}

export function finiteNumberOrNull(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function classifyOrbit(flags) {
  const classMap = {
    0: ['MBA', 'Main-belt Asteroid'], 1: ['ATI', 'Atira'], 2: ['ATE', 'Aten'], 3: ['APO', 'Apollo'], 4: ['AMO', 'Amor'],
    5: ['MCR', 'Object with q < 1.665 AU'],
    6: ['HUN', 'Hungaria'], 8: ['HIL', 'Hilda'], 9: ['JTA', 'Jupiter Trojan'], 10: ['TNO', 'Distant Object'],
  }
  const validFlags = Number.isInteger(flags) && flags >= 0 ? flags : null
  const [orbitClassCode, orbitClassName] = classMap[validFlags === null ? -1 : validFlags & 63] ?? ['OTHER', 'Other or unknown orbit type']
  return {
    orbitClassCode,
    orbitClassName,
    isNeo: validFlags !== null && (validFlags & 2048) !== 0,
    isPha: validFlags !== null && (validFlags & 32768) !== 0,
  }
}

export function getPermanentNumberBucketKey(permanentNumber) {
  if (!Number.isSafeInteger(permanentNumber) || permanentNumber < 0) return 'number-misc'
  const start = Math.floor(permanentNumber / PERMANENT_NUMBER_BUCKET_SIZE) * PERMANENT_NUMBER_BUCKET_SIZE
  const end = start + PERMANENT_NUMBER_BUCKET_SIZE - 1
  return `number-${String(start).padStart(6, '0')}-${String(end).padStart(6, '0')}`
}

/**
 * Index every word initial so searches by a later name/designation token still
 * work, while permanent numbers stay in bounded 10,000-object range shards.
 */
export function getSearchBucketKeys(indexEntry) {
  const keys = new Set()
  for (const token of indexEntry.searchKey.split(/\s+/).filter(Boolean)) {
    const firstAlpha = token.match(/[a-z]/)?.[0]
    if (firstAlpha) keys.add(firstAlpha)
    if (/^\d{4}$/.test(token)) {
      const possibleYear = Number(token)
      if (possibleYear >= 1800 && possibleYear <= 2199) keys.add(`year-${token}`)
    }
  }
  if (indexEntry.permanentNumber !== undefined) {
    keys.add(getPermanentNumberBucketKey(indexEntry.permanentNumber))
  }
  if (indexEntry.packedDesignation?.startsWith('~') && indexEntry.packedDesignation.length >= 2) {
    keys.add(`packed-tilde-${indexEntry.packedDesignation[1].toLowerCase()}`)
  }
  if (!keys.size) keys.add('misc')
  return keys
}

export function decodePackedPermanentNumber(packedDesignation) {
  const packed = packedDesignation.trim()
  if (/^\d+$/.test(packed)) return Number(packed)
  const base62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  if (/^[A-Za-z]\d{4}$/.test(packed)) {
    const high = base62.indexOf(packed[0])
    return high >= 10 ? high * 10_000 + Number(packed.slice(1)) : null
  }
  if (/^~[0-9A-Za-z]{4}$/.test(packed)) {
    let suffix = 0
    for (const character of packed.slice(1)) suffix = suffix * 62 + base62.indexOf(character)
    return 620_000 + suffix
  }
  return null
}

export function buildBodyId(packedDesignation) {
  return `asteroid:mpc:${packedDesignation.trim()}`
}

function isSkippedDwarf(readableDesignation, packedDesignation) {
  const normalized = normalizeSearchText(readableDesignation)
  return ['ceres', 'pluto', 'eris', 'haumea', 'makemake'].some((name) => normalized.includes(name)) ||
    SKIPPED_DWARF_IDS.has(packedDesignation.trim())
}

export function parseMpcorbLine(line, chunkId = 'chunk-0000') {
  if (line.length < 165) return { error: 'short-line' }
  const packedDesignation = line.slice(0, 7).trim()
  const readableDesignation = line.slice(166, 194).trim() || packedDesignation
  if (!packedDesignation || isSkippedDwarf(readableDesignation, packedDesignation)) return { skip: true }
  const numeric = {
    epochJd: decodePackedEpoch(line.slice(20, 25).trim()),
    meanAnomalyDeg: finiteNumberOrNull(line.slice(26, 35)),
    argPeriapsisDeg: finiteNumberOrNull(line.slice(37, 46)),
    ascendingNodeDeg: finiteNumberOrNull(line.slice(48, 57)),
    inclinationDeg: finiteNumberOrNull(line.slice(59, 68)),
    eccentricity: finiteNumberOrNull(line.slice(70, 79)),
    meanMotionDegPerDay: finiteNumberOrNull(line.slice(80, 91)),
    semiMajorAxisAU: finiteNumberOrNull(line.slice(92, 103)),
  }
  if (Object.values(numeric).some((value) => value === null)) return { error: 'missing-element' }
  if (numeric.eccentricity < 0 || numeric.eccentricity >= 1) return { error: 'non-elliptic' }
  if (numeric.semiMajorAxisAU <= 0 || numeric.meanMotionDegPerDay <= 0) return { error: 'non-positive-orbit' }
  if (numeric.inclinationDeg < 0 || numeric.inclinationDeg > 180) return { error: 'inclination-range' }

  const absoluteMagnitude = finiteNumberOrNull(line.slice(8, 13)) ?? undefined
  const flagsText = line.slice(161, 165).trim()
  const flags = flagsText ? Number.parseInt(flagsText, 16) : 0
  const classification = classifyOrbit(flags)
  const shortLabel = readableDesignation.replace(/^\(?\d+\)?\s*/, '').trim() || readableDesignation
  const shortSearchKey = normalizeSearchText(shortLabel)
  const searchKey = [shortSearchKey, normalizeSearchText(readableDesignation), normalizeSearchText(packedDesignation)]
    .filter(Boolean).join(' ')
  const indexEntry = {
    id: buildBodyId(packedDesignation),
    packedDesignation,
    permanentNumber: decodePackedPermanentNumber(packedDesignation) ?? undefined,
    label: readableDesignation,
    shortLabel,
    searchKey,
    chunkId,
    ...classification,
    absoluteMagnitude,
  }
  return { record: { ...indexEntry, ...numeric }, indexEntry }
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, { headers: { 'User-Agent': 'solar-atlas-data-pipeline/2.0' } })
  if (!response.ok || !response.body) throw new Error(`Failed to download ${url}: ${response.status}`)
  await mkdir(dirname(outputPath), { recursive: true })
  await pipeline(response.body, createWriteStream(outputPath))
}

async function resolveRawCatalog() {
  const supplied = process.env.MPCORB_SOURCE_FILE
  if (supplied) {
    const resolved = resolve(supplied)
    if (!existsSync(resolved)) throw new Error(`MPCORB_SOURCE_FILE does not exist: ${resolved}`)
    return resolved
  }
  if (!existsSync(DEFAULT_RAW_FILE) || (await stat(DEFAULT_RAW_FILE)).size === 0 || process.env.MPCORB_REFRESH === '1') {
    console.log(`Downloading immutable source snapshot from ${SOURCE_URL}`)
    await downloadFile(SOURCE_URL, DEFAULT_RAW_FILE)
  }
  return DEFAULT_RAW_FILE
}

function createInputStream(rawPath) {
  const stream = createReadStream(rawPath)
  return extname(rawPath).toLowerCase() === '.gz' ? stream.pipe(createGunzip()) : stream
}

function serializeJson(value) {
  return Buffer.from(JSON.stringify(value))
}

async function main() {
  assertSafeOutputPath(OUTPUT_ROOT)
  if (!Number.isInteger(CHUNK_SIZE) || CHUNK_SIZE <= 0) throw new Error('MPCORB_CHUNK_SIZE must be a positive integer')
  if (DATASET_MODE === 'lite' && (!Number.isInteger(LITE_MAX_PERMANENT_NUMBER) || LITE_MAX_PERMANENT_NUMBER <= 0)) {
    throw new Error('MPCORB_LITE_MAX_NUMBER must be a positive integer')
  }
  const rawFile = await resolveRawCatalog()
  const sourceSha256 = await sha256File(rawFile)
  const sourceInfo = await stat(rawFile)
  const generatedAt = new Date().toISOString()
  const releasesRoot = resolve(OUTPUT_ROOT, 'releases')
  const stagingDir = resolve(releasesRoot, `.staging-${process.pid}-${Date.now()}`)
  const parserCommit = process.env.MPCORB_PARSER_COMMIT ?? process.env.GITHUB_SHA ?? 'working-tree'
  const selectionPolicy = DATASET_MODE === 'full'
    ? { type: 'all-valid-elliptic', requiredFeaturedNames: [...FEATURED_NAMES].sort() }
    : {
        type: 'permanent-number-through-plus-featured',
        maxPermanentNumber: LITE_MAX_PERMANENT_NUMBER,
        requiredFeaturedNames: [...FEATURED_NAMES].sort(),
      }
  assertSafeOutputPath(stagingDir)
  if (existsSync(stagingDir)) throw new Error(`Dataset staging directory already exists: ${stagingDir}`)
  await Promise.all(['binary', 'meta', 'search', 'lookup'].map((directory) => mkdir(resolve(stagingDir, directory), { recursive: true })))

  try {
  const checksums = {}
  async function writeArtifact(relativePath, value) {
    const path = resolve(stagingDir, relativePath)
    const data = Buffer.isBuffer(value) ? value : serializeJson(value)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
    checksums[relativePath.replaceAll('\\', '/')] = createHash('sha256').update(data).digest('hex')
  }

  const searchBuckets = new Map()
  const lookupBuckets = new Map()
  const categoryCounts = {}
  const featured = []
  const featuredKeys = new Set()
  const invalidReasons = {}
  const invalidExamples = []
  const ranges = {
    semiMajorAxisAU: [Number.POSITIVE_INFINITY, 0], eccentricity: [Number.POSITIVE_INFINITY, 0],
    inclinationDeg: [Number.POSITIVE_INFINITY, 0], epochJd: [Number.POSITIVE_INFINITY, 0],
  }
  let parsing = false
  let totalCount = 0
  let parsedSourceCount = 0
  let invalidCount = 0
  let chunkIndex = 0
  let chunkRecords = []

  const flushChunk = async () => {
    if (!chunkRecords.length) return
    const chunkId = `chunk-${String(chunkIndex).padStart(4, '0')}`
    const metadata = chunkRecords.map((record) => ({
      id: record.id,
      packedDesignation: record.packedDesignation,
      permanentNumber: record.permanentNumber,
      label: record.label,
      shortLabel: record.shortLabel,
      searchKey: record.searchKey,
      chunkId: record.chunkId,
      orbitClassCode: record.orbitClassCode,
      orbitClassName: record.orbitClassName,
      absoluteMagnitude: record.absoluteMagnitude,
      isNeo: record.isNeo,
      isPha: record.isPha,
    }))
    const numeric = new Float64Array(chunkRecords.length * 8)
    for (let index = 0; index < chunkRecords.length; index += 1) {
      const record = chunkRecords[index]
      numeric.set([
        record.epochJd, record.semiMajorAxisAU, record.eccentricity, record.inclinationDeg,
        record.ascendingNodeDeg, record.argPeriapsisDeg, record.meanAnomalyDeg, record.meanMotionDegPerDay,
      ], index * 8)
    }
    await Promise.all([
      writeArtifact(`meta/${chunkId}.json`, metadata),
      writeArtifact(`binary/${chunkId}.bin`, Buffer.from(numeric.buffer)),
    ])
    chunkRecords = []
    chunkIndex += 1
  }

  const lineReader = createInterface({ input: createInputStream(rawFile), crlfDelay: Infinity })
  for await (const line of lineReader) {
    if (!parsing) {
      if (line.startsWith('-----')) parsing = true
      continue
    }
    if (!line.trim()) continue
    const chunkId = `chunk-${String(chunkIndex).padStart(4, '0')}`
    const parsed = parseMpcorbLine(line, chunkId)
    if (parsed.skip) continue
    if (parsed.error) {
      invalidCount += 1
      invalidReasons[parsed.error] = (invalidReasons[parsed.error] ?? 0) + 1
      if (invalidExamples.length < 20) invalidExamples.push({ reason: parsed.error, designation: line.slice(0, 7).trim() })
      continue
    }
    const { record, indexEntry } = parsed
    parsedSourceCount += 1
    const featuredName = normalizeSearchText(indexEntry.shortLabel)
    const isFeatured = FEATURED_NAMES.has(featuredName)
    const selectedForDataset = DATASET_MODE === 'full' || isFeatured ||
      (indexEntry.permanentNumber !== undefined && indexEntry.permanentNumber <= LITE_MAX_PERMANENT_NUMBER)
    if (!selectedForDataset) continue
    chunkRecords.push(record)
    totalCount += 1
    categoryCounts[record.orbitClassCode] = (categoryCounts[record.orbitClassCode] ?? 0) + 1
    for (const [name, value] of Object.entries({
      semiMajorAxisAU: record.semiMajorAxisAU,
      eccentricity: record.eccentricity,
      inclinationDeg: record.inclinationDeg,
      epochJd: record.epochJd,
    })) {
      ranges[name][0] = Math.min(ranges[name][0], value)
      ranges[name][1] = Math.max(ranges[name][1], value)
    }
    for (const key of getSearchBucketKeys(indexEntry)) {
      const entries = searchBuckets.get(key) ?? []
      entries.push(indexEntry)
      searchBuckets.set(key, entries)
    }
    const lookupKey = idLookupBucket(indexEntry.id)
    const lookupEntries = lookupBuckets.get(lookupKey) ?? []
    lookupEntries.push(indexEntry)
    lookupBuckets.set(lookupKey, lookupEntries)
    if (isFeatured && !featuredKeys.has(indexEntry.id)) {
      featured.push(indexEntry)
      featuredKeys.add(indexEntry.id)
    }
    if (chunkRecords.length >= CHUNK_SIZE) await flushChunk()
    if (totalCount % 50_000 === 0) console.log(`Validated ${totalCount.toLocaleString()} elliptic objects`)
  }
  await flushChunk()
  for (const [bucket, entries] of searchBuckets) await writeArtifact(`search/${bucket}.json`, entries)
  for (const [bucket, entries] of lookupBuckets) await writeArtifact(`lookup/${bucket}.json`, entries)

  const missingFeatured = findMissingFeatured(featured.map((entry) => entry.shortLabel))
  if (REQUIRE_FEATURED && missingFeatured.length) {
    throw new Error(`Missing required featured bodies: ${missingFeatured.join(', ')}`)
  }
  const contentDescriptor = Object.fromEntries(Object.entries(checksums).sort(([left], [right]) => left.localeCompare(right)))
  const contentSha256 = createHash('sha256').update(JSON.stringify(contentDescriptor)).digest('hex')
  const version = process.env.MPCORB_DATASET_VERSION ?? `mpcorb-${contentSha256.slice(0, 16)}-${DATASET_MODE}`
  const releaseDir = resolve(releasesRoot, version)
  assertSafeOutputPath(releaseDir)
  if (!releaseDir.startsWith(`${releasesRoot}\\`) && !releaseDir.startsWith(`${releasesRoot}/`)) {
    throw new Error(`Unsafe release path: ${releaseDir}`)
  }
  if (existsSync(releaseDir)) throw new Error(`Immutable dataset release already exists: ${releaseDir}`)

  const manifest = {
    schemaVersion: 2,
    version,
    datasetMode: DATASET_MODE,
    source: SOURCE_URL,
    sourceDownloadedAt: sourceInfo.mtime.toISOString(),
    generatedAt,
    sourceSha256,
    contentSha256,
    parserVersion: PARSER_VERSION,
    parserCommit,
    selectionPolicy,
    orbitModel: 'elliptic two-body propagation of MPCORB osculating elements',
    precision: 'MPCORB fixed-width source precision; Float64 binary shards',
    totalCount,
    chunkCount: chunkIndex,
    chunkSize: CHUNK_SIZE,
    format: 'binary-v1',
    searchIndex: {
      permanentNumberBucketSize: PERMANENT_NUMBER_BUCKET_SIZE,
      provisionalYearBuckets: true,
      tokenInitialBuckets: true,
    },
    lookupBucketCount: lookupBuckets.size,
    bucketCounts: Object.fromEntries([...searchBuckets].map(([key, entries]) => [key, entries.length])),
    categoryCounts,
    featured,
  }
  const provenance = {
    datasetVersion: version,
    source: SOURCE_URL,
    downloadedAt: sourceInfo.mtime.toISOString(),
    generatedAt,
    sourceSha256,
    contentSha256,
    parserVersion: PARSER_VERSION,
    parserCommit,
    selectionPolicy,
    totalObjects: totalCount,
    mode: DATASET_MODE,
    orbitModel: manifest.orbitModel,
    precision: manifest.precision,
  }
  const rejectedFraction = invalidCount / Math.max(parsedSourceCount + invalidCount, 1)
  const validation = {
    schemaVersion: 1,
    datasetVersion: version,
    passed: totalCount > 0 && rejectedFraction < 0.05,
    validObjects: totalCount,
    parsedSourceObjects: parsedSourceCount,
    rejectedObjects: invalidCount,
    rejectedFraction,
    rejectionReasons: invalidReasons,
    rejectionExamples: invalidExamples,
    missingFeatured,
    contentSha256,
    numericRanges: ranges,
    categoryCounts,
    invariants: {
      allElliptic: true,
      positiveSemiMajorAxis: true,
      positiveMeanMotion: true,
      inclinationWithin180Deg: true,
      featuredComplete: missingFeatured.length === 0,
      stablePackedDesignationIds: true,
      shardedNumericSearch: true,
      permanentNumberBucketSize: PERMANENT_NUMBER_BUCKET_SIZE,
      provisionalYearSearch: true,
      tokenInitialSearch: true,
      binaryStride: 8,
    },
  }
  await Promise.all([
    writeArtifact('manifest.json', manifest),
    writeArtifact('provenance.json', provenance),
    writeArtifact('validation-report.json', validation),
  ])
  await writeArtifact('checksums.json', { schemaVersion: 1, algorithm: 'sha256', files: checksums })
  if (!validation.passed) throw new Error(`Dataset validation rejected ${(validation.rejectedFraction * 100).toFixed(2)}% of records`)

  await rename(stagingDir, releaseDir)
  await mkdir(OUTPUT_ROOT, { recursive: true })
  const versionPointer = {
    schemaVersion: 1,
    activeVersion: version,
    mode: DATASET_MODE,
    manifestPath: `releases/${version}/manifest.json`,
    generatedAt,
    sourceSha256,
    contentSha256,
    selectionPolicy,
  }
  const pointerPath = resolve(OUTPUT_ROOT, 'dataset-version.json')
  const temporaryPointerPath = resolve(OUTPUT_ROOT, `.dataset-version-${process.pid}.tmp`)
  await writeFile(temporaryPointerPath, JSON.stringify(versionPointer, null, 2))
  await rename(temporaryPointerPath, pointerPath)
  console.log(`Published ${totalCount.toLocaleString()} objects as immutable dataset ${version}`)
  console.log(`Release directory: ${releaseDir}`)
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    throw error
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}

export { main }
