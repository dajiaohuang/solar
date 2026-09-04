import { describe, expect, it } from 'vitest';
import { SpkKernel } from '../../src/engine/ephemeris/spk';
import { readFileSync } from 'node:fs';
import type21Reference from '../fixtures/spk21-synthetic.json';

function makeKernel(type: 2 | 3, frame = 1, malformed?: 'endian' | 'bounds' | 'unsupported', summaryRecord = 3, coefficientCount = 2): ArrayBuffer {
  const c = coefficientCount;
  const rs = type === 2 ? 2 + 3 * c : 2 + 6 * c;
  const words = rs + 4;
  const bytes = 4 * 1024;
  const b = new ArrayBuffer(bytes), v = new DataView(b), u = new Uint8Array(b);
  const ascii = (at: number, s: string) => [...s].forEach((ch, i) => { u[at + i] = ch.charCodeAt(0); });
  ascii(0, 'DAF/SPK '); ascii(88, malformed === 'endian' ? 'NOPE----' : 'LTL-IEEE');
  v.setInt32(8, 2, true); v.setInt32(12, 6, true); v.setInt32(76, summaryRecord, true); v.setInt32(80, summaryRecord, true);
  const so = (summaryRecord - 1) * 1024;
  v.setFloat64(so, 0, true); v.setFloat64(so + 8, 0, true); v.setFloat64(so + 16, 1, true);
  const start = 385, end = malformed === 'bounds' ? bytes / 8 + 2 : start + words - 1;
  v.setFloat64(so + 24, 0, true); v.setFloat64(so + 32, 10, true);
  [499, 10, malformed === 'unsupported' ? 2 : frame, type, start, end].forEach((n, i) => v.setInt32(so + 40 + i * 4, n, true));
  const at = (addr: number) => (addr - 1) * 8;
  v.setFloat64(at(start), 5, true); v.setFloat64(at(start + 1), 5, true);
  const coeff = Array.from({ length: 3 * c }, (_, i) => i + 1);
  coeff.forEach((n, i) => v.setFloat64(at(start) + 16 + i * 8, n, true));
  if (type === 3) coeff.forEach((n, i) => v.setFloat64(at(start) + 16 + (3 * c + i) * 8, n / 10, true));
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

  it('accepts comment-shifted summaries and constant (degree zero) records', () => {
    const k = new SpkKernel(makeKernel(2, 1, undefined, 2, 1));
    expect(k.segments[0].coefficientCount).toBe(1);
    expect(k.evaluate(499, 5)!.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('rejects malformed endian, bounds, and unsupported matching segments', () => {
    expect(() => new SpkKernel(makeKernel(2, 1, 'endian'))).toThrow(/format/);
    expect(() => new SpkKernel(makeKernel(2, 1, 'bounds'))).toThrow(/descriptor|bounds/);
    const k = new SpkKernel(makeKernel(2, 1, 'unsupported'));
    expect(() => k.evaluate(499, 5)).toThrow(/unsupported matching segment/);
  });
});

describe('SPK type 21 against independent NAIF CSPICE', () => {
  const bytes = readFileSync(new URL('../fixtures/spk21-synthetic.bsp', import.meta.url));
  const buffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const kernel = new SpkKernel(buffer());
  it('matches all six CSPICE components at boundaries and interior epochs', () => {
    expect(kernel.segments.map(s => s.recordCount)).toEqual([1, 99, 100, 101, 200, 201]);
    expect(kernel.segments.map(s => s.type21?.dimension)).toEqual([15, 20, 25, 15, 20, 25]);
    expect(type21Reference.samples).toHaveLength(175);
    for (const sample of type21Reference.samples) {
      const state = kernel.evaluate(sample.target, sample.et)!;
      const actual = [state.position.x, state.position.y, state.position.z, state.velocity.x, state.velocity.y, state.velocity.z];
      actual.forEach((value, axis) => expect(Math.abs(value - sample.state[axis])).toBeLessThanOrEqual(axis < 3 ? 1e-7 : 1e-14));
    }
  });
  it('keeps coverage, frame and Chebyshev-accessor contracts explicit', () => {
    for (const s of kernel.segments) {
      expect(kernel.evaluate(s.target, s.startEt - 1e-6)).toBeNull();
      expect(kernel.evaluate(s.target, s.endEt + 1e-6)).toBeNull();
      expect(kernel.evaluate(s.target, s.startEt)).toMatchObject({ center: 0, frame: 1 });
      expect(() => kernel.getRecordData(s)).toThrow(/requires type 2 or 3/);
    }
  });
  it('reads big-endian difference lines and preserves last matching segment precedence', () => {
    const converted = buffer(), view = new DataView(converted), original = new DataView(buffer());
    new Uint8Array(converted).set(new TextEncoder().encode('BIG-IEEE'), 88);
    for (const offset of [8, 12, 76, 80, 84]) view.setInt32(offset, original.getInt32(offset, true), false);
    const summary = (original.getInt32(76, true) - 1) * 1024;
    for (const offset of [0, 8, 16]) view.setFloat64(summary + offset, original.getFloat64(summary + offset, true), false);
    kernel.segments.forEach((s, index) => {
      const descriptor = summary + 24 + index * 40;
      for (const offset of [0, 8]) view.setFloat64(descriptor + offset, original.getFloat64(descriptor + offset, true), false);
      for (let offset = 16; offset < 40; offset += 4) view.setInt32(descriptor + offset, original.getInt32(descriptor + offset, true), false);
      for (let address = s.startAddress; address <= s.endAddress; address++) view.setFloat64((address - 1) * 8, original.getFloat64((address - 1) * 8, true), false);
    });
    const big = new SpkKernel(converted);
    for (const sample of type21Reference.samples) expect(big.evaluate(sample.target, sample.et)).toEqual(kernel.evaluate(sample.target, sample.et));
    const second = kernel.segments[1], first = kernel.segments[0];
    view.setInt32(summary + 24 + 40 + 16, first.target, false);
    const x = (second.startAddress + second.type21!.dimension) * 8;
    view.setFloat64(x, view.getFloat64(x, false) + 100, false);
    const overlap = new SpkKernel(converted);
    expect(overlap.evaluate(first.target, 0)!.position.x).toBeCloseTo(kernel.evaluate(first.target, 0)!.position.x + 100, 6);
    view.setInt32(summary + 24 + 40 + 24, 2, false);
    expect(() => new SpkKernel(converted).evaluate(first.target, 0)).toThrow(/unsupported matching segment/);
  });
  it('rejects malformed dimensions, counts, epochs, directories and active steps', () => {
    const s = kernel.segments[2], m = s.type21!;
    const corruptions: Array<[number, number]> = [
      [s.endAddress - 1, 26], [s.endAddress, 99], [s.startAddress, NaN],
      [m.epochsAddress + 1, 1000], [m.epochsAddress + m.recordCount, -1],
      [s.startAddress + 1, 0], [s.startAddress + 4 * m.dimension + 7, 2],
      [s.startAddress + 4 * m.dimension + 8, m.dimension + 1],
      [s.startAddress + 4 * m.dimension + 9, 2.5],
    ];
    for (const [address, value] of corruptions) {
      const bad = buffer(); new DataView(bad).setFloat64((address - 1) * 8, value, true);
      expect(() => new SpkKernel(bad)).toThrow(/type 21/);
    }
  });
});
