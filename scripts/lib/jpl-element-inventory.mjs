const MJD0 = 2_400_000.5

const KINDS = new Set(['numbered-asteroid', 'unnumbered-asteroid', 'comet'])

function field(line, start, end) { return line.slice(start, end).trim() }

function numberField(line, start, end, label, { required = false } = {}) {
  const text = field(line, start, end)
  if (!text) {
    if (required) throw new Error(`Missing ${label}`)
    return undefined
  }
  const value = Number(text)
  if (!Number.isFinite(value)) throw new Error(`Malformed ${label}: ${text}`)
  return value
}

function status(orbit, kind) {
  const required = kind === 'comet' ? ['epochJd', 'perihelionAU', 'eccentricity', 'inclinationDeg', 'ascendingNodeDeg', 'argPeriapsisDeg', 'perihelionTimeRaw'] : ['epochJd', 'semiMajorAxisAU', 'eccentricity', 'inclinationDeg', 'ascendingNodeDeg', 'argPeriapsisDeg', 'meanAnomalyDeg']
  if (required.some((key) => orbit[key] === undefined)) return 'missing-elements'
  const invalidAxis = kind === 'comet' ? orbit.perihelionAU <= 0 : (orbit.semiMajorAxisAU === 0 || (orbit.semiMajorAxisAU < 0 && orbit.eccentricity < 1))
  if (orbit.eccentricity < 0 || orbit.inclinationDeg < 0 || orbit.inclinationDeg > 180 || invalidAxis) return 'missing-elements'
  return orbit.eccentricity >= 1 ? 'open-conic-elements' : 'elliptic-elements'
}

function cometTail(line) {
  const columns = line.slice(46).trim().split(/\s+/)
  if (columns.length < 7 || columns.slice(0, 6).some((value) => !Number.isFinite(Number(value)))) throw new Error('Malformed comet numeric columns')
  const values = columns.slice(0, 6).map(Number)
  const perihelionTimeRaw = columns[6]
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(perihelionTimeRaw)) throw new Error(`Malformed perihelion time: ${perihelionTimeRaw}`)
  return { epochMjd: values[0], perihelionAU: values[1], eccentricity: values[2], inclinationDeg: values[3], argPeriapsisDeg: values[4], ascendingNodeDeg: values[5], perihelionTimeRaw, sourceRef: columns.slice(7).join(' ') }
}

export function parseElementLine(line, kind) {
  if (!KINDS.has(kind)) throw new Error(`Unknown element kind: ${kind}`)
  if (typeof line !== 'string') throw new TypeError('Element line must be a string')
  if (!line.trim() || /^\s*(?:Num|Designation)\b/.test(line) || /^\s*-{5,}/.test(line)) return null

  const comet = kind === 'comet'
  const idText = field(line, 0, comet ? 46 : kind === 'unnumbered-asteroid' ? 14 : 7)
  if (!idText) throw new Error('Missing designation')
  const designation = comet ? (idText.match(/^(?:\d+[PDI](?:-[A-Z]+)?|[A-Z]\/\d{4}\s+[A-Z0-9]+(?:\s+\d+)?(?:-[A-Z]+)?)/)?.[0] ?? idText) : idText
  const name = comet || kind === 'unnumbered-asteroid' ? idText : field(line, 7, 25)
  const starts = comet ? [46, 53, 64, 74, 84, 95, 105, 120, 120] : kind === 'unnumbered-asteroid' ? [14, 21, 32, 44, 53, 63, 74, 84, 95] : [25, 31, 42, 52, 63, 73, 83, 96, 111]
  const [epochStart, aStart, eStart, iStart, wStart, nodeStart, sixthStart, seventhStart, refStart] = starts
  const cometFallback = comet && !Number.isFinite(Number(field(line, epochStart, aStart))) ? cometTail(line) : undefined
  const epochMjd = cometFallback?.epochMjd ?? numberField(line, epochStart, aStart, 'epoch')
  const orbit = {
    ...(epochMjd === undefined ? {} : { epochJd: epochMjd + MJD0 }),
    timeScale: 'TDB', frame: 'ECLIPJ2000', center: 'naif:10',
    ...(comet ? {
      perihelionAU: cometFallback?.perihelionAU ?? numberField(line, aStart, eStart, 'perihelion distance'),
      eccentricity: cometFallback?.eccentricity ?? numberField(line, eStart, iStart, 'eccentricity'),
      inclinationDeg: cometFallback?.inclinationDeg ?? numberField(line, iStart, wStart, 'inclination'),
      argPeriapsisDeg: cometFallback?.argPeriapsisDeg ?? numberField(line, wStart, nodeStart, 'argument of periapsis'),
      ascendingNodeDeg: cometFallback?.ascendingNodeDeg ?? numberField(line, nodeStart, sixthStart, 'ascending node'),
      perihelionTimeRaw: cometFallback?.perihelionTimeRaw ?? field(line, sixthStart, seventhStart),
    } : {
      semiMajorAxisAU: numberField(line, aStart, eStart, 'semi-major axis'),
      eccentricity: numberField(line, eStart, iStart, 'eccentricity'),
      inclinationDeg: numberField(line, iStart, wStart, 'inclination'),
      argPeriapsisDeg: numberField(line, wStart, nodeStart, 'argument of periapsis'),
      ascendingNodeDeg: numberField(line, nodeStart, sixthStart, 'ascending node'),
      meanAnomalyDeg: numberField(line, sixthStart, seventhStart, 'mean anomaly'),
    }),
  }
  if (comet && !orbit.perihelionTimeRaw) orbit.perihelionTimeRaw = undefined
  const category = comet ? 'comet' : 'asteroid'
  const geometryStatus = status(orbit, kind)
  return {
    id: `sb:${category}:${designation}`,
    designation,
    name,
    category,
    parentId: 'naif:10',
    confirmation: 'confirmed',
    orbit,
    geometryStatus,
    ...(geometryStatus === 'missing-elements' ? { geometryReason: 'missing-or-invalid-orbit-fields' } : {}),
    sourceRef: cometFallback?.sourceRef || line.match(/(?:^|\s)((?:JPL|MPC|IAU)[^]*)$/)?.[1] || field(line, refStart, line.length),
  }
}
