import { describe, expect, it } from 'vitest';
import { SpkKernel } from '../../src/engine/ephemeris/spk';

function makeKernel(type: 2 | 3, frame = 1, malformed?: 'endian' | 'bounds' | 'unsupported'): ArrayBuffer {
  const c = 2;
  const rs = type === 2 ? 2 + 3 * c : 2 + 6 * c;
  const words = rs + 4;
  const bytes = 4 * 1024;
  const b = new ArrayBuffer(bytes), v = new DataView(b), u = new Uint8Array(b);
  const ascii = (at: number, s: string) => [...s].forEach((ch, i) => { u[at + i] = ch.charCodeAt(0); });
  ascii(0, 'DAF/SPK '); ascii(88, malformed === 'endian' ? 'NOPE----' : 'LTL-IEEE');
  v.setInt32(8, 2, true); v.setInt32(12, 6, true); v.setInt32(76, 3, true); v.setInt32(80, 3, true);
  const so = 2 * 1024;
  v.setFloat64(so, 0, true); v.setFloat64(so + 8, 0, true); v.setFloat64(so + 16, 1, true);
  const start = 385, end = malformed === 'bounds' ? bytes / 8 + 2 : start + words - 1;
  v.setFloat64(so + 24, 0, true); v.setFloat64(so + 32, 10, true);
  [499, 10, malformed === 'unsupported' ? 2 : frame, type, start, end].forEach((n, i) => v.setInt32(so + 40 + i * 4, n, true));
  const at = (addr: number) => (addr - 1) * 8;
  v.setFloat64(at(start), 5, true); v.setFloat64(at(start + 1), 5, true);
  const coeff = [1, 2, 3, 4, 5, 6];
  coeff.forEach((n, i) => v.setFloat64(at(start) + 16 + i * 8, n, true));
  if (type === 3) coeff.forEach((n, i) => v.setFloat64(at(start) + 16 + (6 + i) * 8, n / 10, true));
  const meta = at(start + rs);
  v.setFloat64(meta, 0, true); v.setFloat64(meta + 8, 10, true); v.setFloat64(meta + 16, rs, true); v.setFloat64(meta + 24, 1, true);
  return b;
}

describe('SpkKernel', () => {
  it('reads type 2 Chebyshev position and derivative', () => {
    const k = new SpkKernel(makeKernel(2));
    const s = k.segments[0];
    expect(s).toMatchObject({ target: 499, center: 10, frame: 1, type: 2, recordCount: 1, coefficientCount: 2 });
    const state = k.evaluate(499, 5)!;
    expect(state.position).toEqual({ x: 1, y: 3, z: 5 });
    expect(state.velocity.x).toBeCloseTo(0.4);
    expect(k.getRecordData(s).metadata.recordCount).toBe(1);
  });

  it('reads type 3 velocity coefficients and returns null outside coverage', () => {
    const k = new SpkKernel(makeKernel(3, 17));
    const state = k.evaluate(499, 5)!;
    expect(state.frame).toBe(17);
    expect(state.velocity).toEqual({ x: 0.1, y: 0.3, z: 0.5 });
    expect(k.evaluate(499, 11)).toBeNull();
  });

  it('rejects malformed endian, bounds, and unsupported matching segments', () => {
    expect(() => new SpkKernel(makeKernel(2, 1, 'endian'))).toThrow(/format/);
    expect(() => new SpkKernel(makeKernel(2, 1, 'bounds'))).toThrow(/descriptor|bounds/);
    const k = new SpkKernel(makeKernel(2, 1, 'unsupported'));
    expect(() => k.evaluate(499, 5)).toThrow(/unsupported matching segment/);
  });
});
