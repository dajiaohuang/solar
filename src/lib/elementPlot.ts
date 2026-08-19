import type { ElementPlotMode } from '../state/ui-store'
import type { AsteroidRecord } from '../types'

export function elementPlotCoordinates(record: AsteroidRecord, mode: ElementPlotMode): [number, number] | null {
  const a = record.semiMajorAxisAU
  const e = record.eccentricity
  if (mode === 'a-H' && record.absoluteMagnitude === undefined) return null
  const values: Record<ElementPlotMode, [number, number]> = {
    'a-e': [a, e],
    'a-i': [a, record.inclinationDeg],
    'a-H': [a, record.absoluteMagnitude!],
    'q-Q': [a * (1 - e), a * (1 + e)],
    'a-period': [a, Math.sqrt(a ** 3)],
  }
  return values[mode]
}
