export type ExtremumMode = 'minimum' | 'maximum'

export type SampledExtremum = {
  sampleIndex: number
  sampleOffset: number
  /** Samples just outside the whole plateau, or adjacent to a single peak. */
  bracketStartIndex: number
  bracketEndIndex: number
  value: number
}

/**
 * Finds strict, non-endpoint local extrema and refines each one with the
 * parabola through the neighboring samples for single-point peaks. Plateaus
 * retain both outside neighbors as their refinement bracket. Endpoint extrema are deliberately
 * excluded because they only describe the boundary of the requested window.
 */
export function findSampledExtrema(values: readonly number[], mode: ExtremumMode): SampledExtremum[] {
  const extrema: SampledExtremum[] = []
  for (let index = 1; index < values.length - 1; index += 1) {
    const plateauStart = index
    let plateauEnd = index
    while (plateauEnd + 1 < values.length && values[plateauEnd + 1] === values[plateauStart]) plateauEnd += 1
    // Advance even when the plateau is not an extremum or borders a gap.
    // Otherwise a flat track is rescanned quadratically.
    index = plateauEnd
    const sampleIndex = Math.floor((plateauStart + plateauEnd) / 2)
    const before = values[plateauStart - 1]
    const current = values[sampleIndex]
    const after = values[plateauEnd + 1]
    if (![before, current, after].every(Number.isFinite)) continue

    const isMinimum = current < before && current < after
    const isMaximum = current > before && current > after
    if ((mode === 'minimum' && !isMinimum) || (mode === 'maximum' && !isMaximum)) continue

    const curvature = plateauStart === plateauEnd ? before - 2 * current + after : 0
    const hasExpectedCurvature = mode === 'minimum' ? curvature > 0 : curvature < 0
    const candidateOffset = hasExpectedCurvature ? (before - after) / (2 * curvature) : 0
    const sampleOffset = Number.isFinite(candidateOffset) && Math.abs(candidateOffset) <= 1
      ? candidateOffset
      : 0
    const refinedValue = current - 0.25 * (before - after) * sampleOffset
    extrema.push({ sampleIndex, sampleOffset, value: refinedValue,
      bracketStartIndex: plateauStart - 1, bracketEndIndex: plateauEnd + 1 })
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
 * every candidate time. The reported radius encloses the remaining numerical
 * search interval around the returned time. Golden-section localization assumes
 * a unimodal objective inside the initial bracket; this is not a certificate
 * that a physical extremum lies there or a physical prediction uncertainty.
 */
export function refineBracketedExtremum(
  startJulianDay: number,
  endJulianDay: number,
  mode: ExtremumMode,
  evaluate: (julianDay: number) => number,
  iterations = 16,
): RefinedExtremum {
  if (![startJulianDay, endJulianDay, iterations].every(Number.isFinite) || !(endJulianDay > startJulianDay)) throw new RangeError('Extremum bracket and iterations must be finite with positive width')
  if (!Number.isFinite(endJulianDay - startJulianDay)) throw new RangeError('Extremum bracket width must be finite')
  if (mode !== 'minimum' && mode !== 'maximum') throw new RangeError('Unknown extremum mode')
  const boundedIterations = Math.max(1, Math.min(Math.trunc(iterations), 64))
  const checkedValue = (julianDay: number) => {
    const value = evaluate(julianDay)
    if (!Number.isFinite(value)) throw new RangeError('Extremum refinement encountered a missing or non-finite model value')
    return value
  }
  const objective = mode === 'minimum' ? checkedValue : (julianDay: number) => -checkedValue(julianDay)
  const ratio = (Math.sqrt(5) - 1) / 2
  let left = startJulianDay
  let right = endJulianDay
  let innerLeft = right - ratio * (right - left)
  let innerRight = left + ratio * (right - left)
  const hasInterior = () => left < innerLeft && innerLeft < innerRight && innerRight < right
  let leftValue = hasInterior() ? objective(innerLeft) : 0
  let rightValue = hasInterior() ? objective(innerRight) : 0
  let completedIterations = 0
  for (; completedIterations < boundedIterations && hasInterior(); completedIterations += 1) {
    // Equal values supply no directional information: this can be a plateau,
    // rounded evaluations or a symmetric extremum. Keep the current interval
    // instead of repeatedly preferring the left side and implying localization.
    if (leftValue === rightValue) break
    if (leftValue < rightValue) {
      right = innerRight
      innerRight = innerLeft
      rightValue = leftValue
      innerLeft = right - ratio * (right - left)
      if (hasInterior()) leftValue = objective(innerLeft)
    } else {
      left = innerLeft
      innerLeft = innerRight
      leftValue = rightValue
      innerRight = left + ratio * (right - left)
      if (hasInterior()) rightValue = objective(innerRight)
    }
  }
  const julianDay = left + (right - left) / 2
  return {
    julianDay,
    value: checkedValue(julianDay),
    numericalRefinementHalfWidthDays: Math.max(julianDay - left, right - julianDay),
    iterations: completedIterations,
  }
}
