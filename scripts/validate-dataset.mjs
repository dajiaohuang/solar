import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const root = resolve(process.env.MPCORB_OUTPUT_DIR ?? resolve(import.meta.dirname, '..', 'public', 'data', 'asteroids'))

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`Missing ${label}: ${path}`)
    }
    throw error
  }
}

const pointer = await readJson(
  resolve(root, 'dataset-version.json'),
  'dataset-version pointer; run npm run data:lite or fetch a published release',
)
if (typeof pointer.manifestPath !== 'string' || !pointer.manifestPath.endsWith('/manifest.json')) {
  throw new Error('Dataset pointer does not contain a valid manifestPath')
}
const manifestFile = resolve(root, pointer.manifestPath)
const manifestRelativeToRoot = relative(root, manifestFile)
if (manifestRelativeToRoot.startsWith('..') || isAbsolute(manifestRelativeToRoot)) {
  throw new Error('Dataset manifest resolves outside the configured data root')
}
const release = dirname(manifestFile)
const manifest = await readJson(manifestFile, 'dataset manifest')
const provenance = await readJson(resolve(release, 'provenance.json'), 'dataset provenance')
const report = await readJson(resolve(release, 'validation-report.json'), 'dataset validation report')
const checksums = await readJson(resolve(release, 'checksums.json'), 'dataset checksums')

if (manifest.schemaVersion !== 3 || !/^3\.\d+\.\d+$/.test(manifest.parserVersion ?? '')) {
  throw new Error(`Dataset must use schema v3 and a compatible parser 3.x; received schema ${manifest.schemaVersion} / parser ${manifest.parserVersion}`)
}

function idLookupBucket(id) {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).slice(-2).padStart(2, '0')
}

function permanentNumberBucket(permanentNumber) {
  const size = 10_000
  const start = Math.floor(permanentNumber / size) * size
  return `number-${String(start).padStart(6, '0')}-${String(start + size - 1).padStart(6, '0')}`
}

function expectedSearchBuckets(entry) {
  const buckets = new Set()
  for (const token of entry.searchKey.split(/\s+/).filter(Boolean)) {
    const firstAlphaOffset = token.search(/[a-z]/)
    if (firstAlphaOffset >= 0) {
      const prefix = token.slice(firstAlphaOffset, firstAlphaOffset + 2)
      buckets.add(prefix.length >= 2 ? `prefix-${prefix}` : prefix)
    }
    if (/^\d{4}$/.test(token) && Number(token) >= 1800 && Number(token) <= 2199) buckets.add(`year-${token}`)
  }
  if (Number.isSafeInteger(entry.permanentNumber)) buckets.add(permanentNumberBucket(entry.permanentNumber))
  if (entry.packedDesignation?.startsWith('~') && entry.packedDesignation.length >= 2) {
    buckets.add(`packed-tilde-${entry.packedDesignation[1].toLowerCase()}`)
  }
  if (!buckets.size) buckets.add('misc')
  return buckets
}
for (const capability of ['catalog-index-v1', 'catalog-locators-v1', 'precomputed-samples-v1', 'catalog-summary-v1', 'search-prefix-v2']) {
  if (!manifest.capabilities?.includes(capability)) throw new Error(`Dataset manifest omits required capability: ${capability}`)
}

if (manifest.version !== pointer.activeVersion || report.datasetVersion !== pointer.activeVersion || provenance.datasetVersion !== pointer.activeVersion) {
  throw new Error('Dataset pointer, manifest, provenance, and validation report versions do not agree')
}
if (pointer.mode !== manifest.datasetMode || provenance.mode !== manifest.datasetMode) {
  throw new Error('Dataset pointer, manifest, and provenance modes do not agree')
}
function isCanonicalIsoTimestamp(value) {
  if (typeof value !== 'string') return false
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value
}
if (![pointer.generatedAt, manifest.generatedAt, provenance.generatedAt].every(isCanonicalIsoTimestamp)) {
  throw new Error('Dataset pointer, manifest, and provenance must contain canonical ISO generation timestamps')
}
if (pointer.generatedAt !== manifest.generatedAt || provenance.generatedAt !== manifest.generatedAt) {
  throw new Error('Dataset pointer, manifest, and provenance generation timestamps do not agree')
}
if (manifest.sourceLastModifiedAt !== undefined) {
  if (![pointer.sourceLastModifiedAt, manifest.sourceLastModifiedAt, provenance.sourceLastModifiedAt].every(isCanonicalIsoTimestamp)) {
    throw new Error('Dataset pointer, manifest, and provenance must contain canonical ISO source Last-Modified timestamps')
  }
  if (pointer.sourceLastModifiedAt !== manifest.sourceLastModifiedAt || provenance.sourceLastModifiedAt !== manifest.sourceLastModifiedAt) {
    throw new Error('Dataset pointer, manifest, and provenance source Last-Modified timestamps do not agree')
  }
}
if (!manifest.selectionPolicy?.type) throw new Error('Dataset manifest does not declare a selection policy')
if (!/^[a-f0-9]{64}$/.test(manifest.contentSha256 ?? '')) throw new Error('Dataset manifest does not contain a valid content SHA-256')
if (pointer.contentSha256 !== manifest.contentSha256 || report.contentSha256 !== manifest.contentSha256 || provenance.contentSha256 !== manifest.contentSha256) {
  throw new Error('Dataset pointer, manifest, provenance, and validation report content hashes do not agree')
}
if (!report.passed) throw new Error(`Dataset ${pointer.activeVersion} failed its validation report`)
if (!checksums.files || typeof checksums.files !== 'object' || Array.isArray(checksums.files)) {
  throw new Error('Dataset checksums file does not contain an artifact map')
}

for (const artifact of ['manifest.json', 'provenance.json', 'validation-report.json']) {
  if (!(artifact in checksums.files)) throw new Error(`Dataset checksums omit required artifact: ${artifact}`)
}

const metadataCounts = new Map()
const binarySizes = new Map()
const metadataById = new Map()
const indexArtifacts = []
let metadataTotal = 0

for (const [file, expected] of Object.entries(checksums.files)) {
  const artifact = resolve(release, file)
  const artifactRelativeToRelease = relative(release, artifact)
  if (artifactRelativeToRelease.startsWith('..') || isAbsolute(artifactRelativeToRelease)) {
    throw new Error(`Checksum entry resolves outside the dataset release: ${file}`)
  }
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`Invalid SHA-256 value for ${file}`)
  }
  const data = await readFile(artifact)
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== expected) throw new Error(`Checksum mismatch: ${file}`)

  const metadataMatch = file.match(/^meta\/(chunk-\d{4,})\.json$/)
  if (metadataMatch) {
    const entries = JSON.parse(data.toString('utf8'))
    if (!Array.isArray(entries)) throw new Error(`Metadata shard is not an array: ${file}`)
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string' || entry.chunkId !== metadataMatch[1]) {
        throw new Error(`Metadata shard contains an invalid entry: ${file}`)
      }
      if (metadataById.has(entry.id)) throw new Error(`Duplicate asteroid ID across metadata shards: ${entry.id}`)
      metadataById.set(entry.id, entry)
    }
    metadataCounts.set(metadataMatch[1], entries.length)
    metadataTotal += entries.length
  }

  const binaryMatch = file.match(/^binary\/(chunk-\d{4,})\.bin$/)
  if (binaryMatch) binarySizes.set(binaryMatch[1], data.byteLength)

  const indexMatch = file.match(/^(search|lookup)\/(.+)\.json$/)
  if (indexMatch) {
    indexArtifacts.push({ type: indexMatch[1], bucket: indexMatch[2], file })
  }
}

if (!Number.isSafeInteger(manifest.totalCount) || manifest.totalCount <= 0 ||
    !Number.isSafeInteger(manifest.chunkCount) || manifest.chunkCount <= 0 ||
    !Number.isSafeInteger(manifest.chunkSize) || manifest.chunkSize <= 0) {
  throw new Error('Dataset manifest contains invalid object or shard counts')
}
if (metadataCounts.size !== manifest.chunkCount || binarySizes.size !== manifest.chunkCount) {
  throw new Error(`Dataset declares ${manifest.chunkCount} shards but contains ${metadataCounts.size} metadata and ${binarySizes.size} binary shards`)
}
if (metadataTotal !== manifest.totalCount) {
  throw new Error(`Dataset metadata contains ${metadataTotal} objects; manifest declares ${manifest.totalCount}`)
}
if (report.validObjects !== manifest.totalCount || provenance.totalObjects !== manifest.totalCount) {
  throw new Error('Dataset manifest, provenance, and validation report object counts do not agree')
}
if (manifest.chunkCount !== Math.ceil(manifest.totalCount / manifest.chunkSize)) {
  throw new Error('Dataset chunkCount does not match totalCount and chunkSize')
}

for (let index = 0; index < manifest.chunkCount; index += 1) {
  const chunkId = `chunk-${String(index).padStart(4, '0')}`
  const objectCount = metadataCounts.get(chunkId)
  const binarySize = binarySizes.get(chunkId)
  if (objectCount === undefined || binarySize === undefined) throw new Error(`Dataset is missing sequential shard ${chunkId}`)
  if (objectCount <= 0 || objectCount > manifest.chunkSize || (index < manifest.chunkCount - 1 && objectCount !== manifest.chunkSize)) {
    throw new Error(`Metadata shard ${chunkId} has invalid object count ${objectCount}`)
  }
  const expectedBinarySize = objectCount * 8 * Float64Array.BYTES_PER_ELEMENT
  if (binarySize !== expectedBinarySize) {
    throw new Error(`Binary shard ${chunkId} has ${binarySize} bytes; expected ${expectedBinarySize}`)
  }
}

for (const artifact of indexArtifacts) {
  const entries = await readJson(resolve(release, artifact.file), artifact.file)
  if (!Array.isArray(entries)) throw new Error(`Index artifact is not an array: ${artifact.file}`)
  const bucketIds = new Set()
  for (const entry of entries) {
    if (typeof entry?.id !== 'string' || bucketIds.has(entry.id)) {
      throw new Error(`Index artifact contains an invalid or duplicate ID: ${artifact.file}`)
    }
    bucketIds.add(entry.id)
    if (!Number.isSafeInteger(entry?.chunkIndex) || !Number.isSafeInteger(entry?.rowIndex) ||
        entry.chunkIndex < 0 || entry.chunkIndex >= manifest.chunkCount ||
        entry.rowIndex < 0 || entry.rowIndex >= manifest.chunkSize) {
      throw new Error(`Index artifact contains an invalid locator: ${artifact.file}`)
    }
    const source = metadataById.get(entry.id)
    if (!source || entry.chunkId !== source.chunkId || entry.chunkIndex !== source.chunkIndex || entry.rowIndex !== source.rowIndex ||
        entry.searchKey !== source.searchKey || entry.permanentNumber !== source.permanentNumber) {
      throw new Error(`Index entry disagrees with source metadata: ${artifact.file} / ${entry.id}`)
    }
    if (artifact.type === 'lookup') {
      if (artifact.bucket !== idLookupBucket(entry.id)) {
        throw new Error(`Lookup entry is stored in the wrong ID bucket: ${artifact.file} / ${entry.id}`)
      }
    } else if (!expectedSearchBuckets(source).has(artifact.bucket)) {
      throw new Error(`Search entry is stored in the wrong semantic bucket: ${artifact.file} / ${entry.id}`)
    }
  }
}

for (const featured of manifest.featured ?? []) {
  if (!featured?.id || !metadataById.has(featured.id)) {
    throw new Error(`Featured object is absent from metadata shards: ${featured?.id ?? 'unknown'}`)
  }
}

const compactIndex = manifest.compactIndex
if (!compactIndex || compactIndex.format !== 'catalog-index-v1' || compactIndex.count !== manifest.totalCount || compactIndex.strideBytes !== 24) {
  throw new Error('Dataset manifest does not declare a valid compact catalog index')
}
if (!(compactIndex.path in checksums.files)) throw new Error('Compact catalog index is not covered by checksums')
const compactIndexData = await readFile(resolve(release, compactIndex.path))
if (compactIndexData.byteLength !== compactIndex.count * compactIndex.strideBytes) {
  throw new Error(`Compact catalog index has ${compactIndexData.byteLength} bytes; expected ${compactIndex.count * compactIndex.strideBytes}`)
}

const compactView = new DataView(compactIndexData.buffer, compactIndexData.byteOffset, compactIndexData.byteLength)
const semanticCategoryCounts = {}
let semanticMagnitudeKnownCount = 0
const semanticRanges = {
  semiMajorAxisAU: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  eccentricity: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  inclinationDeg: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  epochJd: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
}

function updateRange(name, value) {
  semanticRanges[name][0] = Math.min(semanticRanges[name][0], value)
  semanticRanges[name][1] = Math.max(semanticRanges[name][1], value)
}

for (let chunkIndex = 0; chunkIndex < manifest.chunkCount; chunkIndex += 1) {
  const chunkId = `chunk-${String(chunkIndex).padStart(4, '0')}`
  const metadata = await readJson(resolve(release, `meta/${chunkId}.json`), `${chunkId} metadata`)
  const binary = await readFile(resolve(release, `binary/${chunkId}.bin`))
  const binaryView = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  for (let rowIndex = 0; rowIndex < metadata.length; rowIndex += 1) {
    const entry = metadata[rowIndex]
    if (entry.chunkIndex !== chunkIndex || entry.rowIndex !== rowIndex) {
      throw new Error(`Metadata locator mismatch at ${chunkId}:${rowIndex}`)
    }
    const compactOffset = (chunkIndex * manifest.chunkSize + rowIndex) * compactIndex.strideBytes
    const numericOffset = rowIndex * 8 * Float64Array.BYTES_PER_ELEMENT
    const epochJd = binaryView.getFloat64(numericOffset, true)
    const semiMajorAxisAU = binaryView.getFloat64(numericOffset + 8, true)
    const eccentricity = binaryView.getFloat64(numericOffset + 16, true)
    const inclinationDeg = binaryView.getFloat64(numericOffset + 24, true)
    const classIndex = compactView.getUint8(compactOffset + 18)
    const compactMagnitude = compactView.getInt16(compactOffset + 16, true)
    const compactFlags = compactView.getUint8(compactOffset + 19)
    if (compactView.getUint16(compactOffset + 20, true) !== chunkIndex ||
        compactView.getUint16(compactOffset + 22, true) !== rowIndex) {
      throw new Error(`Compact locator mismatch at ${chunkId}:${rowIndex}`)
    }
    if (compactView.getFloat64(compactOffset, true) !== semiMajorAxisAU ||
        compactView.getUint32(compactOffset + 8, true) !== Math.round(eccentricity * 1_000_000_000) ||
        compactView.getUint32(compactOffset + 12, true) !== Math.round(inclinationDeg * 1_000_000)) {
      throw new Error(`Compact numeric values disagree with binary shard at ${chunkId}:${rowIndex}`)
    }
    const expectedMagnitude = entry.absoluteMagnitude === undefined ? 0x7fff : Math.round(entry.absoluteMagnitude * 100)
    if (compactMagnitude !== expectedMagnitude) throw new Error(`Compact H disagrees with metadata at ${chunkId}:${rowIndex}`)
    if (compactIndex.classCodes[classIndex] !== entry.orbitClassCode) throw new Error(`Compact class disagrees with metadata at ${chunkId}:${rowIndex}`)
    if (Boolean(compactFlags & 1) !== Boolean(entry.isNeo) || Boolean(compactFlags & 2) !== Boolean(entry.isPha) ||
        Boolean(compactFlags & 4) !== (entry.absoluteMagnitude !== undefined)) {
      throw new Error(`Compact flags disagree with metadata at ${chunkId}:${rowIndex}`)
    }
    semanticCategoryCounts[entry.orbitClassCode] = (semanticCategoryCounts[entry.orbitClassCode] ?? 0) + 1
    if (entry.absoluteMagnitude !== undefined) semanticMagnitudeKnownCount += 1
    updateRange('epochJd', epochJd)
    updateRange('semiMajorAxisAU', semiMajorAxisAU)
    updateRange('eccentricity', eccentricity)
    updateRange('inclinationDeg', inclinationDeg)
  }
}

for (const size of ['desktop', 'mobile']) {
  const sample = manifest.precomputedSamples?.[size]
  if (!sample || !Number.isSafeInteger(sample.count) || sample.count <= 0) {
    throw new Error(`Dataset manifest does not declare a valid ${size} sample`)
  }
  const metadata = await readJson(resolve(release, sample.metadataPath), `${size} sample metadata`)
  const binary = await readFile(resolve(release, sample.binaryPath))
  if (!Array.isArray(metadata) || metadata.length !== sample.count || binary.byteLength !== sample.count * 8 * Float64Array.BYTES_PER_ELEMENT) {
    throw new Error(`Precomputed ${size} sample does not match its manifest count`)
  }
  if (sample.count > (size === 'desktop' ? 30_000 : 8_000)) throw new Error(`Precomputed ${size} sample exceeds its display budget`)
  const firstScreenBytes = Buffer.byteLength(JSON.stringify(metadata)) + binary.byteLength
  const byteBudget = size === 'desktop' ? 15 * 1024 * 1024 : 5 * 1024 * 1024
  if (firstScreenBytes > byteBudget) {
    throw new Error(`Precomputed ${size} sample uses ${firstScreenBytes} bytes; budget is ${byteBudget}`)
  }
  if (!(sample.metadataPath in checksums.files) || !(sample.binaryPath in checksums.files)) {
    throw new Error(`Precomputed ${size} sample is not covered by checksums`)
  }
  const sampleIds = new Set()
  const sampleView = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  const grouped = new Map()
  metadata.forEach((entry, sampleIndex) => {
    if (sampleIds.has(entry.id)) throw new Error(`Precomputed ${size} sample contains duplicate ID: ${entry.id}`)
    sampleIds.add(entry.id)
    if (!metadataById.has(entry.id)) throw new Error(`Precomputed ${size} sample ID is absent from full metadata: ${entry.id}`)
    if (!Number.isSafeInteger(entry.chunkIndex) || !Number.isSafeInteger(entry.rowIndex)) {
      throw new Error(`Precomputed ${size} sample omits locator for ${entry.id}`)
    }
    grouped.set(entry.chunkIndex, [...(grouped.get(entry.chunkIndex) ?? []), { entry, sampleIndex }])
  })
  for (const [chunkIndex, rows] of grouped) {
    const chunkId = `chunk-${String(chunkIndex).padStart(4, '0')}`
    const sourceMetadata = await readJson(resolve(release, `meta/${chunkId}.json`), `${chunkId} metadata`)
    const sourceBinary = await readFile(resolve(release, `binary/${chunkId}.bin`))
    const sourceView = new DataView(sourceBinary.buffer, sourceBinary.byteOffset, sourceBinary.byteLength)
    for (const { entry, sampleIndex } of rows) {
      const sourceEntry = sourceMetadata[entry.rowIndex]
      if (!sourceEntry || sourceEntry.id !== entry.id || sourceEntry.orbitClassCode !== entry.orbitClassCode ||
          sourceEntry.absoluteMagnitude !== entry.absoluteMagnitude) {
        throw new Error(`Precomputed ${size} sample metadata disagrees with source at ${chunkId}:${entry.rowIndex}`)
      }
      for (let field = 0; field < 8; field += 1) {
        const sampleValue = sampleView.getFloat64((sampleIndex * 8 + field) * 8, true)
        const sourceValue = sourceView.getFloat64((entry.rowIndex * 8 + field) * 8, true)
        if (sampleValue !== sourceValue) throw new Error(`Precomputed ${size} sample numeric data disagrees with source for ${entry.id}`)
      }
    }
  }
}

if (!manifest.summaryPath || !(manifest.summaryPath in checksums.files)) {
  throw new Error('Dataset manifest does not declare a checksummed catalog summary')
}
const summary = await readJson(resolve(release, manifest.summaryPath), 'catalog summary')
if (summary.totalCount !== manifest.totalCount || summary.datasetMode !== manifest.datasetMode ||
    summary.sourceSha256 !== manifest.sourceSha256 ||
    JSON.stringify(summary.categoryCounts) !== JSON.stringify(manifest.categoryCounts) ||
    JSON.stringify(summary.categoryCounts) !== JSON.stringify(semanticCategoryCounts) ||
    summary.magnitudeKnownCount !== semanticMagnitudeKnownCount ||
    summary.magnitudeUnknownCount !== manifest.totalCount - semanticMagnitudeKnownCount ||
    JSON.stringify(summary.numericRanges) !== JSON.stringify(semanticRanges)) {
  throw new Error('Catalog summary is not semantically consistent with manifest and source shards')
}

const contentFiles = Object.fromEntries(Object.entries(checksums.files)
  .filter(([file]) => /^(binary|meta|search|lookup)\//.test(file) || /^catalog-(index|sample|summary)/.test(file))
  .sort(([left], [right]) => left.localeCompare(right)))
const contentSha256 = createHash('sha256').update(JSON.stringify(contentFiles)).digest('hex')
if (contentSha256 !== manifest.contentSha256) throw new Error('Dataset content identity does not match its data artifacts')

console.log(`Validated dataset ${pointer.activeVersion}: ${report.validObjects.toLocaleString()} objects, ${Object.keys(checksums.files).length} artifacts`)
