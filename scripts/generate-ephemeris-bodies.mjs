#!/usr/bin/env node
/* Generate optional satellite fallback bodies from the checked-in SPK manifest.
 * The ellipse is an instantaneous diagnostic at --epoch-jd, not a propagated
 * ephemeris. GM values must come from NAIF's gm_de440.tpc; missing GM skips a
 * body rather than inventing a value. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SpkKernel } from '../src/engine/ephemeris/spk.ts'

const AU_KM = 149597870.7
const DAY_SECONDS = 86400
const DEFAULT_EPOCH_JD = 2461290.5 // 2026-09-04T00:00:00 TDB-labelled sample
const GM_URL = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc'
const NAMES = {
  401: 'Phobos', 402: 'Deimos', 501: 'Io', 502: 'Europa', 503: 'Ganymede', 504: 'Callisto',
  505: 'Amalthea', 514: 'Thebe', 515: 'Adrastea', 516: 'Metis', 601: 'Mimas', 602: 'Enceladus',
  603: 'Tethys', 604: 'Dione', 605: 'Rhea', 606: 'Titan', 607: 'Hyperion', 608: 'Iapetus',
  609: 'Phoebe', 612: 'Helene', 613: 'Telesto', 614: 'Calypso', 632: 'Daphnis', 634: 'Aegaeon',
  701: 'Ariel', 702: 'Umbriel', 703: 'Titania', 704: 'Oberon', 705: 'Miranda',
  801: 'Triton', 802: 'Nereid', 901: 'Charon', 902: 'Nix', 903: 'Hydra', 904: 'Kerberos', 905: 'Styx',
}
// Bodies already represented by majorBodies are intentionally not duplicated.
const MAJOR = new Set([10, 199, 299, 399, 301, 499, 599, 699, 799, 899, 999, 501, 502, 503, 504, 606])

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const root = path.resolve(arg('--root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')))
const sourceRoot = path.resolve(arg('--source-root', root))
const manifestPath = path.resolve(arg('--manifest', path.join(sourceRoot, 'src/data/ephemeris-manifest.json')))
const gmPath = arg('--gm', path.join(sourceRoot, 'public/data/ephemerides/gm_de440.tpc'))
const outputPath = path.resolve(arg('--output', path.join(root, 'src/data/ephemerisBodies.json')))
const epochJd = Number(arg('--epoch-jd', DEFAULT_EPOCH_JD))
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
function vecMag(v) { return Math.hypot(v.x, v.y, v.z) }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z }
function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x } }
function elements(positionKm, velocityKmS, gmKm3S2) {
  const r = vecMag(positionKm), speed2 = dot(velocityKmS, velocityKmS), h = cross(positionKm, velocityKmS)
  const hMag = Math.hypot(h.x, h.y, h.z)
  if (!(r > 0) || !(hMag > 0)) return null
  const energy = speed2 / 2 - gmKm3S2 / r
  if (!(energy < 0)) return null
  const a = -gmKm3S2 / (2 * energy)
  const ev = { x: ((speed2 - gmKm3S2 / r) * positionKm.x - dot(positionKm, velocityKmS) * velocityKmS.x) / gmKm3S2,
    y: ((speed2 - gmKm3S2 / r) * positionKm.y - dot(positionKm, velocityKmS) * velocityKmS.y) / gmKm3S2,
    z: ((speed2 - gmKm3S2 / r) * positionKm.z - dot(positionKm, velocityKmS) * velocityKmS.z) / gmKm3S2 }
  const e = vecMag(ev)
  if (!(e >= 0 && e < 1)) return null
  const i = Math.atan2(Math.hypot(h.x, h.y), h.z)
  const node = { x: -h.y, y: h.x, z: 0 }, nodeMag = Math.hypot(node.x, node.y)
  const angle = (x) => (x % 360 + 360) % 360
  const omega = e > 1e-12 ? Math.atan2(dot(cross(node, ev), h) / hMag, dot(node, ev)) : 0
  const trueAnomaly = e > 1e-12 ? Math.atan2(dot(cross(ev, positionKm), h) / (hMag * e * r), dot(ev, positionKm) / (e * r)) : 0
  const eccAnomaly = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(trueAnomaly / 2), Math.sqrt(1 + e) * Math.cos(trueAnomaly / 2))
  const meanAnomaly = e > 1e-12 ? eccAnomaly - e * Math.sin(eccAnomaly) : trueAnomaly
  return { semiMajorAxisAU: a / AU_KM, eccentricity: e, inclinationDeg: i * 180 / Math.PI,
    ascendingNodeDeg: nodeMag > 1e-12 ? angle(Math.atan2(node.y, node.x) * 180 / Math.PI) : 0,
    argPeriapsisDeg: angle(omega * 180 / Math.PI), meanAnomalyDeg: angle(meanAnomaly * 180 / Math.PI),
    meanMotionDegPerDay: Math.sqrt(gmKm3S2 / a ** 3) * DAY_SECONDS * 180 / Math.PI }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const gm = readGm(gmPath)
const kernels = manifest.files.map((file) => {
  const filePath = path.resolve(sourceRoot, 'public/data/ephemerides', file.path)
  if (!fs.existsSync(filePath)) throw new Error(`Kernel missing: ${filePath}`)
  const bytes = fs.readFileSync(filePath)
  return { id: file.id, source: file.source, targets: file.targets, kernel: new SpkKernel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
})
const et = (epochJd - 2451545) * DAY_SECONDS
const bodies = []
for (const target of [...new Set(manifest.files.flatMap((f) => f.targets))].sort((a, b) => a - b)) {
  if (MAJOR.has(target)) continue
  const name = NAMES[target] ?? (target >= 2000000 ? `Asteroid ${target - 2000000}` : null)
  if (!name) continue
  let state, source
  for (let i = kernels.length - 1; i >= 0 && !state; i--) {
    if (!kernels[i].targets.includes(target)) continue
    const found = kernels[i].kernel.evaluate(target, et)
    if (found) { state = found; source = kernels[i] }
  }
  if (!state || !gm.has(state.center)) continue
  const orbit = elements(state.position, state.velocity, gm.get(state.center))
  if (!orbit) continue
  const parentNames = { 10: 'sun', 199: 'mercury', 299: 'venus', 399: 'earth', 499: 'mars', 599: 'jupiter', 699: 'saturn', 799: 'uranus', 899: 'neptune', 999: 'pluto' }
  const parentId = parentNames[state.center] ?? `naif:${state.center}`
  bodies.push({ id: target >= 2000000 ? `asteroid:${target - 2000000}` : `naif:${target}`, name, shortName: name, kind: target >= 2000000 ? 'asteroid' : 'moon', naifId: target,
    parentId, source: 'jpl-spk-osculating-fallback',
    orbit: { model: 'keplerian', epochJd, ...orbit },
    parentRelativeStateKm: { position: state.position, velocity: state.velocity },
    fallback: { label: 'instantaneous two-body osculating ellipse; not an operational ephemeris', gmKm3S2: gm.get(state.center), centerNaifId: state.center },
    sourceUrl: source.source, sourceKernelId: source.id })
}
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), epochJd, epochTimeScale: 'TDB', source: {
  manifestPath: 'src/data/ephemeris-manifest.json', manifestId: manifest.id, gmUrl: GM_URL, gmFile: 'gm_de440.tpc',
  kernelContract: manifest.contract }, bodies }
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(`Wrote ${bodies.length} optional ephemeris bodies to ${outputPath}`)
