// Integrate a deliberately bounded, locally frozen NASA/JPL Horizons SPK pack.
// The API is a mutable service, so the cache is the release input: every
// source response must carry binary and response hashes before publication.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cropSpk } from './crop-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_CACHE ?? '.cache/horizons-asteroids-20260909'
const output = 'public/data/ephemerides'
const batch = 'horizons-asteroids-20260909'
const coreId = 'de440s-2000-01-01-2051-01-01'
const targets = [
  ['ida', 'Ida', 243, 20000243],
  ['eros', 'Eros', 433, 20000433],
  ['gaspra', 'Gaspra', 951, 20000951],
  ['itokawa', 'Itokawa', 25143, 20025143],
  ['apophis', 'Apophis', 99942, 20099942],
  ['ryugu', 'Ryugu', 162173, 20162173],
]
const fromEt = (date) => (Date.parse(`${date}T00:00:00Z`) / 86400000 + 2440587.5 - 2451545) * 86400
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sourceFor = (bytes, evidence) => ({
  size: bytes.length,
  identity: evidence.source,
  read: async (start, length) => bytes.subarray(start, start + length),
})
const profileWindows = {
  pages: ['2026-01-01', '2027-01-01'],
  full: ['2020-01-01', '2031-01-01'],
}
await mkdir(output, { recursive: true })

const manifests = {}
for (const profile of Object.keys(profileWindows)) {
  const path = profile === 'pages' ? 'src/data/ephemeris-manifest.json' : 'src/data/ephemeris-manifest-full.json'
  manifests[profile] = JSON.parse(await readFile(path, 'utf8'))
  if (!manifests[profile].files.some(file => file.id === coreId)) throw new Error(`Missing DE440 core in ${profile} manifest`)
}
for (const [slug, name, designation, target] of targets) {
  const bytes = await readFile(join(cache, `${slug}.bsp`))
  const evidence = JSON.parse(await readFile(join(cache, `${slug}.json`), 'utf8'))
  const source = evidence.source
  if (source.source?.startsWith('https://') !== true || source.target !== target || source.designation !== String(designation)
    || source.from !== '2020-01-01' || source.to !== '2031-01-01' || !source.responseSha256 || !source.retrievedAt) {
    throw new Error(`Incomplete Horizons provenance for ${slug}`)
  }
  if (bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw new Error(`Horizons checksum mismatch for ${slug}`)
  const entries = {}
  for (const [profile, [from, to]] of Object.entries(profileWindows)) {
    const manifest = manifests[profile]
    if (manifest.files.some(file => file.targets?.includes(target))) throw new Error(`Target ${target} already exists in ${profile}`)
    const result = await cropSpk(sourceFor(bytes, evidence), { startEt: fromEt(from), endEt: fromEt(to), targets: [target] })
    const id = `horizons-${slug}-${from}-${to}`
    const path = `${id}.bsp`
    await writeFile(join(output, path), result.buffer)
    entries[profile] = {
      id, path, sha256: result.sha256, bytes: result.buffer.length,
      targets: [...new Set(result.segments.map(segment => segment.target))],
      startEt: Math.min(...result.segments.map(segment => segment.startEt)),
      endEt: Math.max(...result.segments.map(segment => segment.endEt)),
      source: source.source, sourceIdentity: source, core: false,
      // These records are direct heliocentric states (center 10); they do not
      // need a second solution kernel in the dependency chain.
      solution: 'HORIZONS type-21 heliocentric state',
      integrationBatch: batch,
      selectionEvidence: {
        sourceSelection: `${name} (${designation}) frozen from one NASA/JPL Horizons SPK response; original type-21 records retained, no refitting.`,
        sourceSnapshot: { responseSha256: source.responseSha256, binarySha256: source.sha256, retrievedAt: source.retrievedAt },
        windowPolicy: `${from} to ${to} TDB`,
      },
    }
    manifest.files.push(entries[profile])
  }
  console.log(`${name}: pages ${entries.pages.bytes} bytes; full ${entries.full.bytes} bytes`)
}
for (const [profile, manifest] of Object.entries(manifests)) {
  const path = profile === 'pages' ? 'src/data/ephemeris-manifest.json' : 'src/data/ephemeris-manifest-full.json'
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`${profile}: ${manifest.files.length} files, ${manifest.files.reduce((sum, file) => sum + file.bytes, 0)} bytes`)
}
