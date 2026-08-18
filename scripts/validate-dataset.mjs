import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const root = resolve(process.env.MPCORB_OUTPUT_DIR ?? resolve(import.meta.dirname, '..', 'public', 'data', 'asteroids'))
const pointer = JSON.parse(await readFile(resolve(root, 'dataset-version.json'), 'utf8'))
if (typeof pointer.manifestPath !== 'string' || !pointer.manifestPath.endsWith('/manifest.json')) {
  throw new Error('Dataset pointer does not contain a valid manifestPath')
}
const manifestFile = resolve(root, pointer.manifestPath)
const manifestRelativeToRoot = relative(root, manifestFile)
if (manifestRelativeToRoot.startsWith('..') || isAbsolute(manifestRelativeToRoot)) {
  throw new Error('Dataset manifest resolves outside the configured data root')
}
const release = dirname(manifestFile)
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
const report = JSON.parse(await readFile(resolve(release, 'validation-report.json'), 'utf8'))
const checksums = JSON.parse(await readFile(resolve(release, 'checksums.json'), 'utf8'))
if (manifest.version !== pointer.activeVersion || report.datasetVersion !== pointer.activeVersion) {
  throw new Error('Dataset pointer, manifest, and validation report versions do not agree')
}
if (!report.passed) throw new Error(`Dataset ${pointer.activeVersion} failed its validation report`)
for (const [file, expected] of Object.entries(checksums.files)) {
  const artifact = resolve(release, file)
  const artifactRelativeToRelease = relative(release, artifact)
  if (artifactRelativeToRelease.startsWith('..') || isAbsolute(artifactRelativeToRelease)) {
    throw new Error(`Checksum entry resolves outside the dataset release: ${file}`)
  }
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`Invalid SHA-256 value for ${file}`)
  }
  const actual = createHash('sha256').update(await readFile(artifact)).digest('hex')
  if (actual !== expected) throw new Error(`Checksum mismatch: ${file}`)
}
console.log(`Validated dataset ${pointer.activeVersion}: ${report.validObjects.toLocaleString()} objects, ${Object.keys(checksums.files).length} artifacts`)
