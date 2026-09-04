// JPL ELEMENTS: identity/name fields are fixed-width; numeric columns can
// overflow their display widths. Never slice a digit off an epoch or element.
const KINDS = new Set(['numbered-asteroid', 'unnumbered-asteroid', 'comet'])
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function cometDesignation(name) {
  const numbered = /^([1-9]\d*[PDI](?:-[A-Z]+\d*)?)(?:\/|\s|$)/.exec(name)?.[1]
  if (numbered) {
    // ELEMENTS.COMET puts fragments after the name (73P/... 3-AA), while
    // SBDB designations put them after the number (73P-AA). A surname such as
    // LINEAR-LONEOS is not a one/two-letter fragment suffix.
    const fragment = /-([A-Z]{1,2}\d*)$/.exec(name)?.[1]
    return fragment && !numbered.includes('-') ? `${numbered}-${fragment}` : numbered
  }
  return /^([CPDXAI]\/-?\d{1,4}\s+[A-Z]{1,2}\d*(?:-[A-Z]+\d*)?)(?:\s|\(|$)/.exec(name)?.[1]
}

function geometry(orbit, comet) {
  if (orbit.eccentricity === undefined) return 'missing-elements'
  const e = orbit.eccentricity, a = orbit.semiMajorAxisAU
  const invalidAxis = comet ? orbit.perihelionAU <= 0 : e < 1 ? a <= 0 : e > 1 ? a >= 0 : true
  if (e < 0 || orbit.inclinationDeg < 0 || orbit.inclinationDeg > 180 || invalidAxis) return 'missing-elements'
  return e >= 1 ? 'open-conic-elements' : 'elliptic-elements'
}

export function parseElementLine(line, kind) {
  if (!KINDS.has(kind)) throw new Error(`Unknown element kind: ${kind}`)
  if (typeof line !== 'string') throw new TypeError('Element line must be a string')
  if (!line.trim() || /^\s*(?:Num|Designation)\b/.test(line) || /^\s*-{5,}/.test(line)) return null
  const comet = kind === 'comet', numbered = kind === 'numbered-asteroid'
  // Header separator widths: numbered 6+1+17+1, unnumbered 13+1,
  // comet designation/name 43+1. Epochs may be negative and 7 characters wide.
  const numericStart = comet ? 44 : numbered ? 25 : 14
  const name = line.slice(numbered ? 7 : 0, comet ? 43 : numbered ? 24 : 13).trim()
  const rawDesignation = numbered ? line.slice(0, 6).trim() : name
  if (!rawDesignation || (numbered && !/^[1-9]\d*$/.test(rawDesignation))) throw new Error('Missing or malformed designation')
  const resolved = comet ? cometDesignation(rawDesignation) : rawDesignation
  const designation = resolved ?? rawDesignation
  const category = comet ? 'comet' : 'asteroid'
  const tokens = line.slice(numericStart).trim().split(/\s+/).filter(Boolean)
  const expected = comet ? 7 : 9 // asteroid H/G are part of the source tail
  const firstText = tokens.findIndex((token) => !DECIMAL.test(token))
  const numericCount = firstText < 0 ? tokens.length : firstText
  if (firstText >= 0 && numericCount < expected && !/^(?:JPL|MPC|IAU)/.test(tokens[firstText])) throw new Error(`Malformed numeric element columns (epoch/axis/eccentricity): ${tokens[firstText]}`)
  if (numericCount > expected) throw new Error('Unexpected extra numeric element column')
  const complete = numericCount === expected
  const values = tokens.slice(0, numericCount).map(Number)
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Nonfinite numeric element')
  const orbit = { timeScale: 'TDB', frame: 'ECLIPJ2000', center: 'naif:10', ...(complete ? {
    epochJd: values[0] + 2_400_000.5,
    ...(comet ? { perihelionAU: values[1], perihelionTimeRaw: tokens[6] } : { semiMajorAxisAU: values[1], meanAnomalyDeg: values[6] }),
    eccentricity: values[2], inclinationDeg: values[3], argPeriapsisDeg: values[4], ascendingNodeDeg: values[5],
  } : {}) }
  const geometryStatus = geometry(orbit, comet)
  return { id: `sb:${category}:${resolved === undefined ? 'unresolved:' : ''}${designation}`, designation, name, category,
    parentId: 'naif:10', confirmation: 'confirmed', identityStatus: resolved === undefined ? 'unresolved-designation' : 'source-designation',
    orbit, geometryStatus,
    ...(geometryStatus === 'missing-elements' ? { geometryReason: 'missing-or-inconsistent-orbit-fields', rawElementText: line.slice(numericStart) } : {}),
    ...(!comet && complete ? { photometry: { absoluteMagnitude: values[7] === 99 ? null : values[7], slopeParameter: values[7] === 99 ? null : values[8] } } : {}),
    sourceRef: tokens.slice(numericCount).join(' '),
  }
}
