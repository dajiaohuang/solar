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

if (manifest.version !== pointer.activeVersion || report.datasetVersion !== pointer.activeVersion || provenance.datasetVersion !== pointer.activeVersion) {
  throw new Error('Dataset pointer, manifest, provenance, and validation report versions do not agree')
}
if (pointer.mode !== manifest.datasetMode || provenance.mode !== manifest.datasetMode) {
  throw new Error('Dataset pointer, manifest, and provenance modes do not agree')
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
const seenIds = new Set()
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
      if (seenIds.has(entry.id)) throw new Error(`Duplicate asteroid ID across metadata shards: ${entry.id}`)
      seenIds.add(entry.id)
    }
    metadataCounts.set(metadataMatch[1], entries.length)
    metadataTotal += entries.length
  }

  const binaryMatch = file.match(/^binary\/(chunk-\d{4,})\.bin$/)
  if (binaryMatch) binarySizes.set(binaryMatch[1], data.byteLength)
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

for (const featured of manifest.featured ?? []) {
  if (!featured?.id || !seenIds.has(featured.id)) {
    throw new Error(`Featured object is absent from metadata shards: ${featured?.id ?? 'unknown'}`)
  }
}

const compactIndex = manifest.compactIndex
if (!compactIndex || compactIndex.format !== 'catalog-index-v1' || compactIndex.count !== manifest.totalCount || compactIndex.strideBytes !== 24) {
  throw new Error('Dataset manifest does not declare a valid compact catalog index')
}
const compactIndexData = await readFile(resolve(release, compactIndex.path))
if (compactIndexData.byteLength !== compactIndex.count * compactIndex.strideBytes) {
  throw new Error(`Compact catalog index has ${compactIndexData.byteLength} bytes; expected ${compactIndex.count * compactIndex.strideBytes}`)
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
}

if (!manifest.summaryPath || !(manifest.summaryPath in checksums.files)) {
  throw new Error('Dataset manifest does not declare a checksummed catalog summary')
}

const contentFiles = Object.fromEntries(Object.entries(checksums.files)
  .filter(([file]) => /^(binary|meta|search|lookup)\//.test(file) || /^catalog-(index|sample|summary)/.test(file))
  .sort(([left], [right]) => left.localeCompare(right)))
const contentSha256 = createHash('sha256').update(JSON.stringify(contentFiles)).digest('hex')
if (contentSha256 !== manifest.contentSha256) throw new Error('Dataset content identity does not match its data artifacts')

console.log(`Validated dataset ${pointer.activeVersion}: ${report.validObjects.toLocaleString()} objects, ${Object.keys(checksums.files).length} artifacts`)
