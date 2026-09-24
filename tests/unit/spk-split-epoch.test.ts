import { expect, test } from 'vitest'
import { SpkKernel } from '../../src/engine/ephemeris/spk'

const base = 2 ** 30, low = 2 ** -30
// Two deliberately discontinuous linear records distinguish the selected
// coefficient set. These are analytic fixtures, not physical ephemerides.
function kernel(type: 2 | 3) {
  const bytes = new ArrayBuffer(4096), view = new DataView(bytes)
  const ascii = (at: number, value: string) => new Uint8Array(bytes).set(new TextEncoder().encode(value), at)
  ascii(0, 'DAF/SPK '); ascii(88, 'LTL-IEEE')
  for (const [at, value] of [[8, 2], [12, 6], [76, 3], [80, 3]]) view.setInt32(at, value, true)
  const summary = 2048, start = 385, recordSize = type === 2 ? 8 : 14
  view.setFloat64(summary + 16, 1, true)
  view.setFloat64(summary + 24, base, true); view.setFloat64(summary + 32, base + 20, true)
  ;[499, 0, 1, type, start, start + 2 * recordSize + 3].forEach((value, i) => view.setInt32(summary + 40 + 4 * i, value, true))
  const write = (address: number, value: number) => view.setFloat64((address - 1) * 8, value, true)
  for (let record = 0; record < 2; record++) {
    const at = start + record * recordSize
    write(at, base + 5 + 10 * record); write(at + 1, 5)
    write(at + 2, record * 100); write(at + 3, 5)
    if (type === 3) { write(at + 8, record * 200); write(at + 9, 10) }
  }
  const terminal = start + 2 * recordSize
  ;[base, 10, recordSize, 2].forEach((value, i) => write(terminal + i, value))
  return new SpkKernel(bytes)
}

for (const type of [2, 3] as const) {
  test(`Type ${type} normalizes large cancelling absolute epoch parts`, () => {
    const source = kernel(type), high = 1e20, offset = base - high
    expect(high + offset).toBe(base)
    expect(source.evaluateChebyshevAtOffset(499, high, offset)).toEqual(source.evaluate(499, base))
  })
  test(`Type ${type} retains a low epoch part smaller than the absolute ET resolution`, () => {
    const source = kernel(type), mid = base + 5
    expect(mid + low).toBe(mid)
    expect(source.evaluateChebyshevAtOffset(499, mid, low)!.position.x).toBe(low)
    expect(source.evaluateChebyshevAtOffset(499, mid, -low)!.position.x).toBe(-low)
    expect(source.evaluateChebyshevAtOffset(499, mid, 0)).toEqual(source.evaluate(499, mid))
  })
  test(`Type ${type} preserves the side of a record or coverage boundary`, () => {
    const source = kernel(type)
    expect(source.evaluateChebyshevAtOffset(499, base + 10, -low)!.position.x).toBe(5 - low)
    expect(source.evaluateChebyshevAtOffset(499, base + 10, low)!.position.x).toBe(95 + low)
    expect(source.evaluateChebyshevAtOffset(499, base + 10, 0)!.position.x).toBe(95)
    expect(source.evaluateChebyshevAtOffset(499, base, -low)).toBeNull()
    expect(source.evaluateChebyshevAtOffset(499, base + 20, low)).toBeNull()
    expect(source.evaluateChebyshevAtOffset(499, base + 20, -low)).not.toBeNull()
    if (type === 3) expect(source.evaluateChebyshevAtOffset(499, base + 10, low)!.velocity.x).toBe(190 + 2 * low)
  })
}
