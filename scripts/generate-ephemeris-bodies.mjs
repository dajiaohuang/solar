#!/usr/bin/env node
/* Generate optional satellite fallback bodies from the checked-in SPK manifest.
 * The ellipse is an instantaneous diagnostic at --epoch-jd, not a propagated
 * ephemeris. GM values must come from NAIF's gm_de440.tpc; missing GM skips a
 * body rather than inventing a value. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'

const AU_KM = 149597870.7
const DAY_SECONDS = 86400
const DEFAULT_EPOCH_ISO = '2026-09-04T00:00:00Z'
const GM_URL = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc'
const NAMES = {
  401: 'Phobos', 402: 'Deimos', 501: 'Io', 502: 'Europa', 503: 'Ganymede', 504: 'Callisto',
  505: 'Amalthea', 514: 'Thebe', 515: 'Adrastea', 516: 'Metis', 601: 'Mimas', 602: 'Enceladus',
  603: 'Tethys', 604: 'Dione', 605: 'Rhea', 606: 'Titan', 607: 'Hyperion', 608: 'Iapetus',
  609: 'Phoebe', 612: 'Helene', 613: 'Telesto', 614: 'Calypso', 632: 'Methone', 634: 'Polydeuces',
  701: 'Ariel', 702: 'Umbriel', 703: 'Titania', 704: 'Oberon', 705: 'Miranda',
  801: 'Triton', 802: 'Nereid', 901: 'Charon', 902: 'Nix', 903: 'Hydra', 904: 'Kerberos', 905: 'Styx',
}
// Bodies already represented by majorBodies are intentionally not duplicated.
const MAJOR = new Set([10, 199, 299, 399, 301, 499, 599, 699, 799, 899, 999, 501, 502, 503, 504, 606, 920136199, 920136108])

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const root = path.resolve(arg('--root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')))
const sourceRoot = path.resolve(arg('--source-root', root))
const manifestPath = path.resolve(arg('--manifest', path.join(sourceRoot, 'src/data/ephemeris-manifest.json')))
const gmPath = arg('--gm', path.join(sourceRoot, 'src/data/gm_de440.tpc'))
const outputPath = path.resolve(arg('--output', path.join(root, 'src/data/ephemerisBodies.json')))
const epochIso = arg('--epoch-iso', DEFAULT_EPOCH_ISO)
const epochJd = Number(arg('--epoch-jd', 2451545 + (Date.parse(epochIso) - Date.parse('2000-01-01T12:00:00Z')) / 86400000))
if (!Number.isFinite(epochJd)) throw new Error('--epoch-jd must be finite')
if (!fs.existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`)
if (!fs.existsSync(gmPath)) throw new Error(`NAIF GM kernel not found: ${gmPath}; download ${GM_URL}`)
const majorSourcePath = path.join(sourceRoot, 'src/data/majorBodies.ts')
if (fs.existsSync(majorSourcePath)) {
  const majorSource = fs.readFileSync(majorSourcePath, 'utf8')
  for (const [name, naif] of [['ceres', 2000001], ['pallas', 2000002], ['vesta', 2000004]]) if (new RegExp(`id:\\s*'${name}'`).test(majorSource)) MAJOR.add(naif)
}

function readGm(file) {
  const text = fs.readFileSync(file, 'utf8')
  const gm = new Map()
  for (const m of text.matchAll(/BODY(\d+)_GM\s*=\s*\(\s*([+\-0-9.EDed]+)\s*\)/g)) gm.set(Number(m[1]), Number(m[2].replace(/[dD]/g, 'E')))
  return gm
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const gm = readGm(gmPath)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = fs.readFileSync(manifestPath)
const gmBytes = fs.readFileSync(gmPath)
const kernels = manifest.files.map((file) => {
  const filePath = path.resolve(sourceRoot, 'public/data/ephemerides', file.path)
  if (!fs.existsSync(filePath)) throw new Error(`Kernel missing: ${filePath}`)
  const bytes = fs.readFileSync(filePath)
  if (file.sha256 && sha256(bytes) !== file.sha256) throw new Error(`SHA-256 mismatch: ${file.path}`)
  return { id: file.id, source: file.source, targets: file.targets, solutionKernelIds: file.solutionKernelIds, dependencyOnly: file.dependencyOnly, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
})
const [kernelPoolModule, osculatingModule] = await Promise.all([
  import(pathToFileURL(path.join(sourceRoot, 'src/engine/ephemeris/kernelPool.ts')).href),
  import(pathToFileURL(path.join(sourceRoot, 'src/engine/ephemeris/osculating.ts')).href),
])
const et = (epochJd - 2451545) * DAY_SECONDS
const resolver = kernelPoolModule.createKernelResolver(kernels, et)
const parentFor = (target) => target >= 2000000 ? 10 : target >= 601 && target < 700 ? 699 : target >= 701 && target < 800 ? 799 : target >= 801 && target < 900 ? 899 : target >= 901 ? 999 : target >= 501 && target < 600 ? 599 : target >= 401 && target < 500 ? 499 : 10
const bodies = []
for (const target of [...new Set(manifest.files.flatMap((f) => f.targets))].sort((a, b) => a - b)) {
  if (MAJOR.has(target)) continue
  // This generator only knows legacy numbered-asteroid IDs. New system,
  // primary and component IDs require explicit mappings; never invent an
  // "Asteroid 18136199" from an Eris system barycenter.
  if (target >= 3000000) continue
  const name = NAMES[target] ?? (target >= 2000000 ? `Asteroid ${target - 2000000}` : null)
  if (!name) continue
  let state, source
  for (let i = kernels.length - 1; i >= 0 && !state; i--) {
    if (kernels[i].dependencyOnly || !kernels[i].targets.includes(target)) continue
    const found = kernels[i].kernel.evaluate(target, et)
    if (found) { state = found; source = kernels[i] }
  }
  const parentNaifId = parentFor(target)
  const relative = resolver.relative(target, parentNaifId)
  if (!state || !relative || !gm.has(parentNaifId)) continue
  const satelliteGm = gm.get(target)
  const gmUsed = gm.get(parentNaifId) + (satelliteGm ?? 0)
  const position = { x: relative.position.x / AU_KM, y: relative.position.y / AU_KM, z: relative.position.z / AU_KM }
  const velocity = { x: relative.velocity.x * DAY_SECONDS / AU_KM, y: relative.velocity.y * DAY_SECONDS / AU_KM, z: relative.velocity.z * DAY_SECONDS / AU_KM }
  const orbit = osculatingModule.stateToOsculatingElements(position, velocity, gmUsed * DAY_SECONDS ** 2 / AU_KM ** 3)
  if (!orbit) continue
  const parentNames = { 10: 'sun', 199: 'mercury', 299: 'venus', 399: 'earth', 499: 'mars', 599: 'jupiter', 699: 'saturn', 799: 'uranus', 899: 'neptune', 999: 'pluto' }
  const parentId = parentNames[parentNaifId] ?? `naif:${parentNaifId}`
  bodies.push({ id: target >= 2000000 ? `asteroid:${target - 2000000}` : `naif:${target}`, name, shortName: name, kind: target >= 2000000 ? 'asteroid' : 'moon', naifId: target,
    parentId, source: 'jpl-spk-osculating-fallback',
    orbit: { model: 'keplerian', epochJd, ...orbit },
    parentRelativeStateKm: relative,
    fallback: { label: 'instantaneous two-body osculating ellipse; not an operational ephemeris', gmKm3S2: gmUsed, gmApproximation: satelliteGm == null ? 'parent-only (satellite GM unavailable)' : 'parent-plus-satellite', centerNaifId: parentNaifId },
    sourceUrl: source.source, sourceKernelId: source.id })
}
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), epochJd, epochTimeScale: 'TDB', source: {
  manifestPath: 'src/data/ephemeris-manifest.json', manifestId: manifest.id, manifestSha256: sha256(manifestBytes), gmUrl: GM_URL, gmFile: 'src/data/gm_de440.tpc', gmSha256: sha256(gmBytes), gmKm3S2: Object.fromEntries(gm),
  kernelContract: manifest.contract }, bodies }
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(`Wrote ${bodies.length} optional ephemeris bodies to ${outputPath}`)
