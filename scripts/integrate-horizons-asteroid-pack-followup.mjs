// Integrate a separately frozen, bounded NASA/JPL Horizons SPK pack.
// The cache is the release input: each response is retained locally with
// binary and raw-response hashes before publication.  The generated profiles
// keep the original type-21 records and never refit or extrapolate them.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cropSpk } from './crop-spk.mjs'

const cache = process.env.SOLAR_HORIZONS_ASTEROID_FOLLOWUP_CACHE ?? '.cache/horizons-asteroids-followup-20260909'
const output = 'public/data/ephemerides'
const batch = 'horizons-asteroids-followup-20260909'
const coreId = 'de440s-2000-01-01-2051-01-01'
const targets = [
  ['toutatis', 'Toutatis', 4179, 20004179],
  ['ganymed', 'Ganymed', 1036, 20001036],
  ['betulia', 'Betulia', 1580, 20001580],
  ['steins', 'Steins', 2867, 20002867],
  ['or2-1998', '1998 OR2', 52768, 20052768],
  ['da-1950', '1950 DA', 29075, 20029075],
  ['fo32-2001', '2001 FO32', 231937, 20231937],
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
    || source.from !== '2020-01-01' || source.to !== '2031-01-01' || source.timeScale !== 'TDB'
    || !source.responseSha256 || !source.retrievedAt) throw new Error(`Incomplete Horizons provenance for ${slug}`)
  if (bytes.length !== source.bytes || digest(bytes) !== source.sha256) throw new Error(`Horizons checksum mismatch for ${slug}`)

  for (const [profile, [from, to]] of Object.entries(profileWindows)) {
    const manifest = manifests[profile]
    if (manifest.files.some(file => file.targets?.includes(target))) throw new Error(`Target ${target} already exists in ${profile}`)
    const result = await cropSpk(sourceFor(bytes, evidence), { startEt: fromEt(from), endEt: fromEt(to), targets: [target] })
    const id = `${batch}-${slug}-${from}-${to}`
    const path = `${id}.bsp`
    await writeFile(join(output, path), result.buffer)
    manifest.files.push({
      id, path, sha256: result.sha256, bytes: result.buffer.length,
      targets: [...new Set(result.segments.map(segment => segment.target))],
      startEt: Math.min(...result.segments.map(segment => segment.startEt)),
      endEt: Math.max(...result.segments.map(segment => segment.endEt)),
      source: source.source, sourceIdentity: source, core: false,
      solution: 'HORIZONS type-21 heliocentric state', integrationBatch: batch,
      selectionEvidence: {
        sourceSelection: `${name} (${designation}) frozen from one NASA/JPL Horizons SPK response; original type-21 records retained, no refitting.`,
        sourceSnapshot: { responseSha256: source.responseSha256, binarySha256: source.sha256, retrievedAt: source.retrievedAt },
        windowPolicy: `${from} to ${to} TDB`,
      },
    })
    console.log(`${name}: ${profile} ${result.buffer.length} bytes`)
  }
}

for (const [profile, manifest] of Object.entries(manifests)) {
  const path = profile === 'pages' ? 'src/data/ephemeris-manifest.json' : 'src/data/ephemeris-manifest-full.json'
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`${profile}: ${manifest.files.length} files, ${manifest.files.reduce((sum, file) => sum + file.bytes, 0)} bytes`)
}
