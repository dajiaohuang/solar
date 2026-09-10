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
  506: 'Himalia', 507: 'Elara', 508: 'Pasiphae', 509: 'Sinope', 510: 'Lysithea', 511: 'Carme',
  512: 'Ananke', 513: 'Leda', 517: 'Callirrhoe', 518: 'Themisto', 519: 'Megaclite', 520: 'Taygete',
  521: 'Chaldene', 522: 'Harpalyke', 523: 'Kalyke', 524: 'Iocaste', 525: 'Erinome', 526: 'Isonoe', 527: 'Praxidike', 528: 'Autonoe',
  529: 'Thyone', 530: 'Hermippe', 531: 'Aitne', 532: 'Eurydome', 533: 'Euanthe', 534: 'Euporie', 535: 'Orthosie', 536: 'Sponde', 537: 'Kale', 538: 'Pasithee', 539: 'Hegemone', 540: 'Mneme', 541: 'Aoede', 542: 'Thelxinoe', 543: 'Arche', 544: 'Kallichore', 545: 'Helike', 546: 'Carpo', 547: 'Eukelade', 548: 'Cyllene',
  505: 'Amalthea', 514: 'Thebe', 515: 'Adrastea', 516: 'Metis', 601: 'Mimas', 602: 'Enceladus',
  603: 'Tethys', 604: 'Dione', 605: 'Rhea', 606: 'Titan', 607: 'Hyperion', 608: 'Iapetus',
  609: 'Phoebe', 612: 'Helene', 613: 'Telesto', 614: 'Calypso', 632: 'Methone', 634: 'Polydeuces',
  701: 'Ariel', 702: 'Umbriel', 703: 'Titania', 704: 'Oberon', 705: 'Miranda',
  801: 'Triton', 802: 'Nereid', 901: 'Charon', 902: 'Nix', 903: 'Hydra', 904: 'Kerberos', 905: 'Styx',
  20000243: 'Ida', 20000433: 'Eros', 20000951: 'Gaspra', 20025143: 'Itokawa',
  20099942: 'Apophis', 20162173: 'Ryugu', 20003200: 'Phaethon',
  20003122: 'Florence', 20065803: 'Didymos',
  20004179: 'Toutatis', 20001036: 'Ganymed', 20001580: 'Betulia',
  20002867: 'Steins', 20052768: '1998 OR2', 20029075: '1950 DA', 20231937: '2001 FO32',
  20486958: 'Arrokoth', 20132524: 'APL', 20152830: 'Dinkinesh', 20341843: '2008 EV5',
  20469219: 'Kamoʻoalewa', 20162421: '2000 ET70',
  20153591: '2001 SN263', 20308635: '2005 YU55', 20163899: '2003 SD220',
  20357439: '2004 BL86', 20367943: 'Duende',
  20003753: 'Cruithne', 20006489: 'Golevka', 20006178: '1986 DA', 20046610: 'Besixdouze', 20098943: 'Torifune',
  20000006: 'Hebe', 20000009: 'Metis', 20000014: 'Irene', 20000018: 'Melpomene',
  20000019: 'Fortuna', 20000090: 'Antiope', 20000216: 'Kleopatra',
  20000011: 'Parthenope', 20000013: 'Egeria', 20000021: 'Lutetia', 20000024: 'Themis',
  20000029: 'Amphitrite', 20000039: 'Laetitia', 20000044: 'Nysa',
  20000005: 'Astraea', 20000008: 'Flora', 20000012: 'Victoria', 20000020: 'Massalia', 20000040: 'Harmonia',
  20000022: 'Kalliope', 20000045: 'Eugenia', 20000093: 'Minerva', 20000121: 'Hermione', 20000130: 'Elektra',
  20000003: 'Juno', 20000007: 'Iris', 20000031: 'Euphrosyne', 20000052: 'Europa', 20000065: 'Cybele',
  20000025: 'Phocaea', 20000027: 'Euterpe', 20000030: 'Urania', 20000034: 'Circe', 20000037: 'Fides',
  20000087: 'Sylvia', 20000107: 'Camilla', 20000511: 'Davida', 20000704: 'Interamnia',
  20000017: 'Thetis', 20000023: 'Thalia', 20000026: 'Proserpina', 20000028: 'Bellona', 20000032: 'Pomona',
  20000051: 'Nemausa', 20002060: 'Chiron', 20005145: 'Pholus', 20010199: 'Chariklo', 20020000: 'Varuna',
  20000015: 'Eunomia', 20000088: 'Thisbe', 20000624: 'Hektor', 20000911: 'Agamemnon',
  20000033: 'Polyhymnia', 20000035: 'Leukothea', 20000036: 'Atalante', 20000038: 'Leda',
  20000041: 'Daphne', 20000046: 'Hestia', 20000048: 'Doris', 20000049: 'Pales',
  20000002: 'Pallas', 20000004: 'Vesta', 20000010: 'Hygiea', 20000016: 'Psyche',
}
// Bodies already represented by majorBodies are intentionally not duplicated.
const MAJOR = new Set([10, 199, 299, 399, 301, 499, 599, 699, 799, 899, 999, 501, 502, 503, 504, 606, 920136199, 920136108])
const HELIOCENTRIC_ASTEROIDS = new Set([20000243, 20000433, 20000951, 20025143, 20099942, 20162173, 20003200, 20003122, 20065803, 20004179, 20001036, 20001580, 20002867, 20052768, 20029075, 20231937, 20486958, 20132524, 20152830, 20341843, 20469219, 20162421, 20153591, 20308635, 20163899, 20357439, 20367943, 20003753, 20006489, 20006178, 20046610, 20098943, 20000006, 20000009, 20000014, 20000018, 20000019, 20000090, 20000216, 20000011, 20000013, 20000021, 20000024, 20000029, 20000039, 20000044, 20000005, 20000008, 20000012, 20000020, 20000040, 20000022, 20000045, 20000093, 20000121, 20000130, 20000003, 20000007, 20000031, 20000052, 20000065, 20000025, 20000027, 20000030, 20000034, 20000037, 20000087, 20000107, 20000511, 20000704, 20000017, 20000023, 20000026, 20000028, 20000032, 20000051, 20002060, 20005145, 20010199, 20020000, 20000015, 20000088, 20000624, 20000911, 20000033, 20000035, 20000036, 20000038, 20000041, 20000046, 20000048, 20000049, 20000002, 20000004, 20000010, 20000016])
const DESIGNATIONS = { 20000243: '243', 20000433: '433', 20000951: '951', 20025143: '25143', 20099942: '99942', 20162173: '162173', 20003200: '3200', 20003122: '3122', 20065803: '65803', 20004179: '4179', 20001036: '1036', 20001580: '1580', 20002867: '2867', 20052768: '52768', 20029075: '29075', 20231937: '231937', 20486958: '486958', 20132524: '132524', 20152830: '152830', 20341843: '341843', 20469219: '469219', 20162421: '162421', 20153591: '153591', 20308635: '308635', 20163899: '163899', 20357439: '357439', 20367943: '367943', 20003753: '3753', 20006489: '6489', 20006178: '6178', 20046610: '46610', 20098943: '98943', 20000006: '6', 20000009: '9', 20000014: '14', 20000018: '18', 20000019: '19', 20000090: '90', 20000216: '216', 20000011: '11', 20000013: '13', 20000021: '21', 20000024: '24', 20000029: '29', 20000039: '39', 20000044: '44', 20000005: '5', 20000008: '8', 20000012: '12', 20000020: '20', 20000040: '40', 20000022: '22', 20000045: '45', 20000093: '93', 20000121: '121', 20000130: '130', 20000003: '3', 20000007: '7', 20000031: '31', 20000052: '52', 20000065: '65', 20000025: '25', 20000027: '27', 20000030: '30', 20000037: '37', 20000087: '87', 20000107: '107', 20000511: '511', 20000704: '704', 20000017: '17', 20000023: '23', 20000026: '26', 20000028: '28', 20000032: '32', 20000051: '51', 20002060: '2060', 20005145: '5145', 20010199: '10199', 20020000: '20000', 20000015: '15', 20000088: '88', 20000624: '624', 20000911: '911', 20000033: '33', 20000035: '35', 20000036: '36', 20000038: '38', 20000041: '41', 20000046: '46', 20000048: '48', 20000049: '49', 20000002: '2', 20000004: '4', 20000010: '10', 20000016: '16' }
DESIGNATIONS[20000034] = '34'

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
const previousBodies = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')).bodies ?? [] : []
const previousById = new Map(previousBodies.map((body) => [body.id, body]))
const bodyIndexById = new Map()
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
  if (target >= 3000000 && !HELIOCENTRIC_ASTEROIDS.has(target)) continue
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
  const generated = { id: target >= 2000000 ? `asteroid:${DESIGNATIONS[target] ?? target - 2000000}` : `naif:${target}`, name, shortName: name, kind: target >= 2000000 ? 'asteroid' : 'moon', naifId: target,
    parentId, source: 'jpl-spk-osculating-fallback',
    orbit: { model: 'keplerian', epochJd, ...orbit },
    parentRelativeStateKm: relative,
    fallback: { label: 'instantaneous two-body osculating ellipse; not an operational ephemeris', gmKm3S2: gmUsed, gmApproximation: satelliteGm == null ? 'parent-only (satellite GM unavailable)' : 'parent-plus-satellite', centerNaifId: parentNaifId },
    sourceUrl: source.source, sourceKernelId: source.id }
  // Existing fallback seeds are stable only while they represent the same
  // target. When an exact numbered-body kernel arrives with a distinct NAIF
  // target but the same human-facing designation, replace the fallback rather
  // than preserving a stale SB441 state under the shared asteroid:<n> ID.
  const previous = previousById.get(generated.id)
  const replacesFallback = generated.sourceKernelId?.startsWith('horizons-asteroids-') === true
    && previous?.sourceKernelId?.startsWith('sb441-') === true
  const selected = previous?.naifId === generated.naifId && !replacesFallback ? previous : generated
  const existingIndex = bodyIndexById.get(selected.id)
  if (existingIndex === undefined) {
    bodyIndexById.set(selected.id, bodies.length)
    bodies.push(selected)
    continue
  }
  const existing = bodies[existingIndex]
  const exactHorizons = selected.sourceKernelId?.startsWith('horizons-asteroids-') === true
  if (exactHorizons && existing.sourceKernelId?.startsWith('sb441-') === true) bodies[existingIndex] = selected
}
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), epochJd, epochTimeScale: 'TDB', source: {
  manifestPath: 'src/data/ephemeris-manifest.json', manifestId: manifest.id, manifestSha256: sha256(manifestBytes), gmUrl: GM_URL, gmFile: 'src/data/gm_de440.tpc', gmSha256: sha256(gmBytes), gmKm3S2: Object.fromEntries(gm),
  kernelContract: manifest.contract }, bodies }
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(`Wrote ${bodies.length} optional ephemeris bodies to ${outputPath}`)
