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
    const before = values[index - 1]
    const current = values[index]
    const after = values[index + 1]
    if (![before, current, after].every(Number.isFinite)) continue

    const isMinimum = current <= before && current <= after && (current < before || current < after)
    const isMaximum = current >= before && current >= after && (current > before || current > after)
    if ((mode === 'minimum' && !isMinimum) || (mode === 'maximum' && !isMaximum)) continue

    const curvature = before - 2 * current + after
    const hasExpectedCurvature = mode === 'minimum' ? curvature > 0 : curvature < 0
    const candidateOffset = hasExpectedCurvature ? (before - after) / (2 * curvature) : 0
    const sampleOffset = Number.isFinite(candidateOffset) && Math.abs(candidateOffset) <= 1
      ? candidateOffset
      : 0
    const refinedValue = current - 0.25 * (before - after) * sampleOffset
    extrema.push({ sampleIndex: index, sampleOffset, value: refinedValue })
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
