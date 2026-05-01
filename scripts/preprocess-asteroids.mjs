import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const ROOT_DIR = resolve(import.meta.dirname, '..')
const RAW_DIR = resolve(ROOT_DIR, '.cache', 'asteroids')
const RAW_FILE = resolve(RAW_DIR, 'MPCORB.DAT.gz')
const OUTPUT_DIR = resolve(ROOT_DIR, 'public', 'data', 'asteroids')
const SOURCE_URL = 'https://www.minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz'
const CHUNK_SIZE = Number(process.env.MPCORB_CHUNK_SIZE ?? 5000)
const LIMIT = process.env.MPCORB_LIMIT ? Number(process.env.MPCORB_LIMIT) : Number.POSITIVE_INFINITY

const FEATURED_NAMES = [
  'vesta',
  'pallas',
  'juno',
  'hygiea',
  'eros',
  'psyche',
  'bennu',
  'apophis',
  'ida',
  'gaspra',
  'itokawa',
  'ryugu',
]

const SKIPPED_DWARF_IDS = new Set(['1', '134340', '136199', '136108', '136472'])
const MONTH_CODES = '123456789ABC'
const DAY_CODES = '123456789ABCDEFGHIJKLMNOPQRSTUV'

function normalizeSearchText(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim()
}

function stripNumberPrefix(label) {
  return label.replace(/^\(?\d+\)?\s*/, '').trim()
}

function gregorianToJulianDay(year, month, day) {
  const a = Math.floor((14 - month) / 12)
  const y = year + 4800 - a
  const m = month + 12 * a - 3

  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045 -
    0.5
  )
}

function decodePackedEpoch(packedDate) {
  if (!packedDate || packedDate.length < 5) {
    return null
  }

  const centuryCode = packedDate[0]
  const yearSuffix = Number(packedDate.slice(1, 3))
  const monthIndex = MONTH_CODES.indexOf(packedDate[3])
  const dayIndex = DAY_CODES.indexOf(packedDate[4])

  const centuryMap = {
    I: 1800,
    J: 1900,
    K: 2000,
    L: 2100,
  }

  if (monthIndex === -1 || dayIndex === -1 || !(centuryCode in centuryMap)) {
    return null
  }

  const year = centuryMap[centuryCode] + yearSuffix
  const month = monthIndex + 1
  const day = dayIndex + 1

  return gregorianToJulianDay(year, month, day)
}

function parseNumber(value) {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function parseFlags(flagText) {
  const normalized = flagText.trim()
  if (!normalized) {
    return 0
  }

  return Number.parseInt(normalized, 16)
}

function classifyOrbit(flags) {
  const orbitTypeCode = flags & 63

  const classMap = {
    1: ['ATI', 'Atira'],
    2: ['ATE', 'Aten'],
    3: ['APO', 'Apollo'],
    4: ['AMO', 'Amor'],
    6: ['HUN', 'Hungaria'],
    8: ['HIL', 'Hilda'],
    9: ['JTA', 'Jupiter Trojan'],
    10: ['TNO', 'Distant Object'],
  }

  const [orbitClassCode, orbitClassName] = classMap[orbitTypeCode] ?? ['MBA', 'Main-belt Asteroid']
  const isNeo = (flags & 2048) !== 0
  const isPha = (flags & 32768) !== 0

  return { orbitClassCode, orbitClassName, isNeo, isPha }
}

function getBucketKey(searchKey) {
  const firstAlphaCharacter = [...searchKey].find((character) => /[a-z]/.test(character))
  if (firstAlphaCharacter) {
    return firstAlphaCharacter
  }

  const firstCharacter = searchKey[0] ?? ''
  if (/[0-9]/.test(firstCharacter)) {
    return 'digit'
  }

  return 'misc'
}

function buildBodyId(packedDesignation, readableDesignation) {
  const key = readableDesignation || packedDesignation
  return `asteroid:${key.replace(/\s+/g, '_')}`
}

function isSkippedDwarf(readableDesignation, packedDesignation) {
  const normalizedLabel = normalizeSearchText(readableDesignation)
  const normalizedPacked = packedDesignation.trim()

  return (
    normalizedLabel.includes('ceres') ||
    normalizedLabel.includes('pluto') ||
    normalizedLabel.includes('eris') ||
    normalizedLabel.includes('haumea') ||
    normalizedLabel.includes('makemake') ||
    SKIPPED_DWARF_IDS.has(normalizedPacked)
  )
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, { headers: { 'User-Agent': 'solar-preprocessor/1.0' } })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`)
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await pipeline(response.body, createWriteStream(outputPath))
}

async function ensureRawCatalog() {
  if (existsSync(RAW_FILE)) {
    const info = await stat(RAW_FILE)
    if (info.size > 0) {
      return RAW_FILE
    }
  }

  console.log(`Downloading MPCORB catalog from ${SOURCE_URL}`)
  await downloadFile(SOURCE_URL, RAW_FILE)
  return RAW_FILE
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

async function main() {
  const rawFile = await ensureRawCatalog()
  await rm(OUTPUT_DIR, { recursive: true, force: true })
  await mkdir(resolve(OUTPUT_DIR, 'chunks'), { recursive: true })
  await mkdir(resolve(OUTPUT_DIR, 'search'), { recursive: true })

  const searchBuckets = new Map()
  const categoryCounts = {}
  const featured = []
  const featuredKeys = new Set()

  let parsing = false
  let totalCount = 0
  let chunkIndex = 0
  let chunkRecords = []
  let currentChunkId = 'chunk-0000'

  const flushChunk = async () => {
    if (!chunkRecords.length) {
      return
    }

    await writeJson(resolve(OUTPUT_DIR, 'chunks', `${currentChunkId}.json`), chunkRecords)
    chunkRecords = []
    chunkIndex += 1
    currentChunkId = `chunk-${String(chunkIndex).padStart(4, '0')}`
  }

  const stream = createReadStream(rawFile).pipe(createGunzip())
  const lineReader = createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of lineReader) {
    if (!parsing) {
      if (line.startsWith('-----')) {
        parsing = true
      }

      continue
    }

    if (!line.trim()) {
      continue
    }

    const packedDesignation = line.slice(0, 7).trim()
    const readableDesignation = line.slice(166, 194).trim() || packedDesignation
    if (!packedDesignation || isSkippedDwarf(readableDesignation, packedDesignation)) {
      continue
    }

    const epochJd = decodePackedEpoch(line.slice(20, 25).trim())
    const meanAnomalyDeg = parseNumber(line.slice(26, 35))
    const argPeriapsisDeg = parseNumber(line.slice(37, 46))
    const ascendingNodeDeg = parseNumber(line.slice(48, 57))
    const inclinationDeg = parseNumber(line.slice(59, 68))
    const eccentricity = parseNumber(line.slice(70, 79))
    const meanMotionDegPerDay = parseNumber(line.slice(80, 91))
    const semiMajorAxisAU = parseNumber(line.slice(92, 103))

    if (
      !epochJd ||
      meanAnomalyDeg === null ||
      argPeriapsisDeg === null ||
      ascendingNodeDeg === null ||
      inclinationDeg === null ||
      eccentricity === null ||
      meanMotionDegPerDay === null ||
      semiMajorAxisAU === null
    ) {
      continue
    }

    const absoluteMagnitude = parseNumber(line.slice(8, 13)) ?? undefined
    const flags = parseFlags(line.slice(161, 165))
    const { orbitClassCode, orbitClassName, isNeo, isPha } = classifyOrbit(flags)
    const shortLabel = stripNumberPrefix(readableDesignation) || readableDesignation
    const shortSearchKey = normalizeSearchText(shortLabel)
    const searchKey = [shortSearchKey, normalizeSearchText(readableDesignation)].filter(Boolean).join(' ')
    const chunkId = currentChunkId
    const id = buildBodyId(packedDesignation, readableDesignation)

    const indexEntry = {
      id,
      label: readableDesignation,
      shortLabel,
      searchKey,
      chunkId,
      orbitClassCode,
      orbitClassName,
      absoluteMagnitude,
      isNeo,
      isPha,
    }

    const bucketKeys = new Set([getBucketKey(shortSearchKey || searchKey)])
    if (/^\d/.test(normalizeSearchText(readableDesignation))) {
      bucketKeys.add('digit')
    }

    for (const bucketKey of bucketKeys) {
      const bucket = searchBuckets.get(bucketKey) ?? []
      bucket.push(indexEntry)
      searchBuckets.set(bucketKey, bucket)
    }

    const categoryKey = orbitClassCode || 'other'
    categoryCounts[categoryKey] = (categoryCounts[categoryKey] ?? 0) + 1

    if (FEATURED_NAMES.includes(shortSearchKey) && !featuredKeys.has(shortLabel)) {
      featured.push(indexEntry)
      featuredKeys.add(shortLabel)
    }

    chunkRecords.push({
      ...indexEntry,
      epochJd,
      semiMajorAxisAU,
      eccentricity,
      inclinationDeg,
      ascendingNodeDeg,
      argPeriapsisDeg,
      meanAnomalyDeg,
      meanMotionDegPerDay,
    })

    totalCount += 1

    if (totalCount % 50000 === 0) {
      console.log(`Processed ${totalCount.toLocaleString()} asteroids`)
    }

    if (chunkRecords.length >= CHUNK_SIZE) {
      await flushChunk()
    }

    if (totalCount >= LIMIT) {
      console.log(`Stopping early at limit ${LIMIT}`)
      break
    }
  }

  await flushChunk()

  for (const [bucketKey, entries] of searchBuckets.entries()) {
    await writeJson(resolve(OUTPUT_DIR, 'search', `${bucketKey}.json`), entries)
  }

  const manifest = {
    version: '1.0.0',
    source: SOURCE_URL,
    generatedAt: new Date().toISOString(),
    totalCount,
    chunkCount: chunkIndex,
    chunkSize: CHUNK_SIZE,
    bucketCounts: Object.fromEntries(
      [...searchBuckets.entries()].map(([bucketKey, entries]) => [bucketKey, entries.length]),
    ),
    categoryCounts,
    featured,
  }

  await writeJson(resolve(OUTPUT_DIR, 'manifest.json'), manifest)
  console.log(`Finished writing ${totalCount.toLocaleString()} asteroid records`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
