// Complete the four missing target crops from JPL's immutable SB441-N16
// source without rebuilding or replacing the already expanded manifests.
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { openSource, cropSpk, inspectSpk } from './crop-spk.mjs'

const SOURCE = 'https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/sb441-n16.bsp'
const SOURCE_IDENTITY = Object.freeze({ source: SOURCE, bytes: 645727232, etag: '"6064e842-267d0400"', lastModified: 'Wed, 31 Mar 2021 21:23:14 GMT' })
const TARGETS = Object.freeze([2000001, 2000002, 2000003, 2000004, 2000007, 2000010, 2000015, 2000016,
  2000031, 2000052, 2000065, 2000087, 2000088, 2000107, 2000511, 2000704])
const START_ET = 631108800 // 2020-01-01 TDB
const END_ET = 978264000 // 2031-01-01 TDB
const MANIFESTS = ['src/data/ephemeris-manifest.json', 'src/data/ephemeris-manifest-full.json']
const OUTPUT = 'public/data/ephemerides'
const PREFIX = 'sb441-n16-'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const idFor = target => `${PREFIX}${target}-2020-01-01-2031-01-01`

function coversWindow(segments) {
  let cursor = START_ET
  for (const segment of [...segments].sort((a, b) => a.startEt - b.startEt)) {
    if (segment.endEt < cursor) continue
    if (segment.startEt > cursor) return false
    cursor = Math.max(cursor, segment.endEt)
    if (cursor >= END_ET) return true
  }
  return false
}

function validateEntry(file, target) {
  if (file.id !== idFor(target) || file.path !== `${idFor(target)}.bsp` || file.targets.length !== 1 || file.targets[0] !== target ||
      file.startEt !== START_ET || file.endEt !== END_ET || file.source !== SOURCE || file.core !== false ||
      JSON.stringify(file.sourceIdentity) !== JSON.stringify(SOURCE_IDENTITY) ||
      !/^[0-9a-f]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) {
    throw new Error(`Existing SB441-N16 target ${target} does not match the pinned source/window contract`)
  }
}

async function writeManifest(path, manifest) {
  const temporary = `${path}.sb441-n16-${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  try { await rename(temporary, path) }
  catch (error) { await unlink(temporary).catch(() => {}); throw error }
}

const manifests = await Promise.all(MANIFESTS.map(async path => ({
  path, value: JSON.parse(await readFile(path, 'utf8')),
})))
const metadata = new Map()
for (const { value } of manifests) {
  const seen = new Set()
  for (const file of value.files.filter(candidate => candidate.id.startsWith(PREFIX))) {
    const target = file.targets?.length === 1 ? file.targets[0] : NaN
    if (!TARGETS.includes(target) || seen.has(target)) throw new Error('Unexpected or duplicate SB441-N16 target in manifest')
    validateEntry(file, target)
    seen.add(target)
    const prior = metadata.get(target)
    if (prior && JSON.stringify(prior) !== JSON.stringify(file)) throw new Error(`Pages/full SB441-N16 metadata diverges for target ${target}`)
    metadata.set(target, file)
  }
}

for (const [target, file] of metadata) {
  const bytes = await readFile(join(OUTPUT, file.path))
  if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error(`Existing SB441-N16 target ${target} fails its pinned file hash`)
}
const missing = TARGETS.filter(target => !metadata.has(target))
if (!missing.length) {
  console.log('SB441-N16 manifests already contain all 16 pinned targets')
} else {
  const source = await openSource(SOURCE)
  try {
    if (JSON.stringify(source.identity) !== JSON.stringify(SOURCE_IDENTITY)) throw new Error('JPL SB441-N16 source identity changed')
    const inventory = await inspectSpk(source)
    const generated = new Map()
    for (const target of missing) {
      const original = inventory.segments.filter(segment => segment.target === target)
      if (!original.length || original.some(segment => segment.center !== 10 || segment.frame !== 1 || segment.type !== 2) ||
          !coversWindow(original)) throw new Error(`JPL SB441-N16 target ${target} lacks the required heliocentric J2000 type-2 window`)
      const result = await cropSpk(source, { startEt: START_ET, endEt: END_ET, targets: [target] })
      if (!result.segments.length || result.segments.some(segment => segment.target !== target || segment.center !== 10 || segment.frame !== 1 || segment.type !== 2) ||
          !coversWindow(result.segments)) throw new Error(`Cropped SB441-N16 target ${target} failed its source/window contract`)
      const file = {
        id: idFor(target), path: `${idFor(target)}.bsp`, sha256: result.sha256,
        bytes: result.buffer.length, targets: [target], startEt: START_ET, endEt: END_ET,
        source: SOURCE, sourceIdentity: source.identity, core: false,
      }
      const destination = join(OUTPUT, file.path)
      try { await writeFile(destination, result.buffer, { flag: 'wx' }) }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        const existing = await readFile(destination)
        if (existing.length !== file.bytes || hash(existing) !== file.sha256) throw new Error(`Refusing to replace unrelated file ${destination}`)
      }
      generated.set(target, file)
      console.log(`${target}: ${file.bytes} bytes sha256=${file.sha256}`)
    }
    for (const { path, value } of manifests) {
      const present = new Set(value.files.filter(file => file.id.startsWith(PREFIX)).map(file => file.targets[0]))
      const additions = TARGETS.filter(target => !present.has(target)).map(target => generated.get(target) ?? metadata.get(target))
      const lastIndex = value.files.reduce((last, file, index) => file.id.startsWith(PREFIX) ? index : last, -1)
      value.files.splice(lastIndex + 1, 0, ...additions)
      const targets = value.files.filter(file => file.id.startsWith(PREFIX)).map(file => file.targets[0])
      if (new Set(targets).size !== TARGETS.length || TARGETS.some(target => !targets.includes(target))) {
        throw new Error(`${path} does not contain exactly the declared 16 SB441-N16 targets after integration`)
      }
      await writeManifest(path, value)
      console.log(`${path}: integrated ${additions.length} missing target entries`)
    }
  } finally { await source.close() }
}
