export type ExtremumMode = 'minimum' | 'maximum'

export type SampledExtremum = {
  sampleIndex: number
  sampleOffset: number
  value: number
}

/**
 * Finds strict, non-endpoint local extrema and refines each one with the
 * parabola through the neighboring samples. Endpoint extrema are deliberately
 * excluded because they only describe the boundary of the requested window.
 */
export function findSampledExtrema(values: readonly number[], mode: ExtremumMode): SampledExtremum[] {
  const extrema: SampledExtremum[] = []
  for (let index = 1; index < values.length - 1; index += 1) {
    const plateauStart = index
    let plateauEnd = index
    while (plateauEnd + 1 < values.length - 1 && values[plateauEnd + 1] === values[plateauStart]) plateauEnd += 1
    const sampleIndex = Math.floor((plateauStart + plateauEnd) / 2)
    const before = values[plateauStart - 1]
    const current = values[sampleIndex]
    const after = values[plateauEnd + 1]
    if (![before, current, after].every(Number.isFinite)) continue

    const isMinimum = current <= before && current <= after && (current < before || current < after)
    const isMaximum = current >= before && current >= after && (current > before || current > after)
    if ((mode === 'minimum' && !isMinimum) || (mode === 'maximum' && !isMaximum)) continue

    const curvature = plateauStart === plateauEnd ? before - 2 * current + after : 0
    const hasExpectedCurvature = mode === 'minimum' ? curvature > 0 : curvature < 0
    const candidateOffset = hasExpectedCurvature ? (before - after) / (2 * curvature) : 0
    const sampleOffset = Number.isFinite(candidateOffset) && Math.abs(candidateOffset) <= 1
      ? candidateOffset
      : 0
    const refinedValue = current - 0.25 * (before - after) * sampleOffset
    extrema.push({ sampleIndex, sampleOffset, value: refinedValue })
    index = plateauEnd
  }
  return extrema
}

export function extremumJulianDay(
  julianDays: readonly number[],
  extremum: Pick<SampledExtremum, 'sampleIndex' | 'sampleOffset'>,
) {
  const center = julianDays[extremum.sampleIndex]
  if (!Number.isFinite(center)) throw new Error('Missing Julian Day for sampled extremum')
  const neighborIndex = extremum.sampleOffset < 0 ? extremum.sampleIndex - 1 : extremum.sampleIndex + 1
  const neighbor = julianDays[neighborIndex]
  if (!Number.isFinite(neighbor)) return center
  return center + Math.abs(extremum.sampleOffset) * (neighbor - center)
}

export type RefinedExtremum = {
  julianDay: number
  value: number
  numericalRefinementHalfWidthDays: number
  iterations: number
}

/**
 * Refines a coarse candidate bracket and re-evaluates the physical model at
 * every candidate time. The remaining bracket width is a conservative timing
 * numerical refinement interval for this exploratory result. It is not an
 * estimate of physical prediction uncertainty.
 */
export function refineBracketedExtremum(
  startJulianDay: number,
  endJulianDay: number,
  mode: ExtremumMode,
  evaluate: (julianDay: number) => number,
  iterations = 16,
): RefinedExtremum {
  if (!(endJulianDay > startJulianDay)) throw new RangeError('Extremum bracket must have positive width')
  const boundedIterations = Math.max(1, Math.min(Math.trunc(iterations), 64))
  const objective = mode === 'minimum' ? evaluate : (julianDay: number) => -evaluate(julianDay)
  const ratio = (Math.sqrt(5) - 1) / 2
  let left = startJulianDay
  let right = endJulianDay
  let innerLeft = right - ratio * (right - left)
  let innerRight = left + ratio * (right - left)
  let leftValue = objective(innerLeft)
  let rightValue = objective(innerRight)
  for (let iteration = 0; iteration < boundedIterations; iteration += 1) {
    if (leftValue <= rightValue) {
      right = innerRight
      innerRight = innerLeft
      rightValue = leftValue
      innerLeft = right - ratio * (right - left)
      leftValue = objective(innerLeft)
    } else {
      left = innerLeft
      innerLeft = innerRight
      leftValue = rightValue
      innerRight = left + ratio * (right - left)
      rightValue = objective(innerRight)
    }
  }
  const julianDay = (left + right) / 2
  return {
    julianDay,
    value: evaluate(julianDay),
    numericalRefinementHalfWidthDays: (right - left) / 2,
    iterations: boundedIterations,
  }
}
