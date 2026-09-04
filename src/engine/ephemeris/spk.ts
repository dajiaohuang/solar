/**
 * Minimal, dependency-free reader for binary DAF/SPK kernels.
 *
 * Layout and polynomial conventions follow NAIF's DAF and SPK Required
 * Reading documents: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/daf.html
 * and https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html.
 */

export interface SpkSegment {
  target: number; center: number; frame: number; type: number;
  startEt: number; endEt: number; startAddress: number; endAddress: number;
  /** Number of coefficients per coordinate (types 2 and 3). */
  coefficientCount: number;
  /** Number of data records, excluding the terminal metadata record. */
  recordCount: number;
  /** Number of double words in each data record. */
  recordSize: number;
}

export interface SpkRecordData {
  segment: SpkSegment;
  coefficientCount: number;
  recordCount: number;
  recordSize: number;
  metadata: { init: number; interval: number; recordSize: number; recordCount: number };
  readRecord(index: number): { mid: number; radius: number; position: Float64Array; velocity?: Float64Array };
}

export interface SpkState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  center: number; frame: number;
}

const RECORD_BYTES = 1024;
const MAX_SUMMARY_RECORDS = 1_000_000;

function fail(message: string): never { throw new Error(`Invalid SPK: ${message}`); }

export class SpkKernel {
  readonly segments: SpkSegment[];
  private readonly view: DataView;
  private readonly little: boolean;
  private readonly bytes: number;

  constructor(buffer: ArrayBuffer) {
    this.bytes = buffer.byteLength;
    if (this.bytes < RECORD_BYTES * 3 || this.bytes % RECORD_BYTES !== 0) fail('file length is not a whole number of 1024-byte records');
    this.view = new DataView(buffer);
    const id = this.ascii(0, 8);
    if (id.slice(0, 7) !== 'DAF/SPK') fail('missing DAF/SPK identifier');
    const endian = this.ascii(88, 8);
    if (endian === 'LTL-IEEE') this.little = true;
    else if (endian === 'BIG-IEEE') this.little = false;
    else fail(`unsupported binary format ${JSON.stringify(endian)}`);
    const nd = this.i32(8), ni = this.i32(12);
    if (nd !== 2 || ni !== 6) fail(`unsupported summary dimensions ND=${nd}, NI=${ni}`);
    const first = this.i32(76), last = this.i32(80);
    if (first !== 3 || last < first || last > this.bytes / RECORD_BYTES) fail('invalid summary record bounds');
    const summaries: Array<{ d: number[]; i: number[] }> = [];
    let rec = first, previous = 0, seen = 0;
    while (rec !== 0) {
      if (++seen > MAX_SUMMARY_RECORDS || !Number.isInteger(rec) || rec < 3 || rec > this.bytes / RECORD_BYTES) fail('invalid summary record chain');
      const off = (rec - 1) * RECORD_BYTES;
      const next = this.controlInt(off), prev = this.controlInt(off + 8), count = this.controlInt(off + 16);
      if (prev !== previous || count < 0 || count > 50) fail('invalid summary record links or count');
      for (let n = 0; n < count; n++) {
        const so = off + 24 + n * 40;
        const d = [this.f64(so), this.f64(so + 8)];
        const i: number[] = [];
        for (let j = 0; j < 6; j++) i.push(this.i32(so + 16 + j * 4));
        summaries.push({ d, i });
      }
      previous = rec; rec = next;
    }
    if (previous !== last) fail('summary chain does not terminate at final summary record');
    this.segments = summaries.map(s => this.parseSegment(s.d, s.i));
  }

  evaluate(target: number, et: number): SpkState | null {
    let unsupported: SpkSegment | undefined;
    // DAF/SPK precedence is last matching segment (later segments override).
    for (let n = this.segments.length - 1; n >= 0; n--) {
      const s = this.segments[n];
      if (s.target !== target || et < s.startEt || et > s.endEt) continue;
      if (s.frame !== 1 && s.frame !== 17 || s.type !== 2 && s.type !== 3) { unsupported = s; break; }
      return this.evaluateSegment(s, et);
    }
    if (unsupported) fail(`unsupported matching segment frame=${unsupported.frame} type=${unsupported.type}`);
    return null;
  }

  getRecordData(segment: SpkSegment): SpkRecordData {
    if (!this.segments.includes(segment)) fail('segment does not belong to this kernel');
    const metaOff = this.addressOffset(segment.endAddress - 3);
    const init = this.f64(metaOff), interval = this.f64(metaOff + 8);
    const recordSize = this.f64(metaOff + 16), recordCount = this.f64(metaOff + 24);
    if (![init, interval, recordSize, recordCount].every(Number.isFinite) || recordSize !== segment.recordSize || recordCount !== segment.recordCount) fail('invalid segment terminal metadata');
    return { segment, coefficientCount: segment.coefficientCount, recordCount: segment.recordCount, recordSize: segment.recordSize,
      metadata: { init, interval, recordSize, recordCount }, readRecord: (index: number) => {
        if (!Number.isInteger(index) || index < 0 || index >= segment.recordCount) fail('record index out of range');
        const off = this.addressOffset(segment.startAddress + index * segment.recordSize);
        const mid = this.f64(off), radius = this.f64(off + 8);
        const count = segment.coefficientCount, v = segment.type === 3 ? new Float64Array(3) : undefined;
        const po = off + 16;
        // Accessor returns complete coefficient vectors flattened by coordinate.
        const position = new Float64Array(3 * count), velocity = v ? new Float64Array(3 * count) : undefined;
        for (let j = 0; j < 3 * count; j++) position[j] = this.f64(po + j * 8);
        if (velocity) for (let j = 0; j < 3 * count; j++) velocity[j] = this.f64(po + (3 * count + j) * 8);
        return { mid, radius, position, velocity };
      } };
  }

  private evaluateSegment(s: SpkSegment, et: number): SpkState {
    const data = this.getRecordData(s);
    let index = Math.floor((et - data.metadata.init) / data.metadata.interval);
    if (index < 0) index = 0; if (index >= s.recordCount) index = s.recordCount - 1;
    const r = data.readRecord(index), x = (et - r.mid) / r.radius;
    if (!Number.isFinite(x) || Math.abs(x) > 1 + 1e-10) fail('epoch falls outside selected record');
    const pos = [0, 0, 0], vel = [0, 0, 0], c = s.coefficientCount;
    for (let axis = 0; axis < 3; axis++) {
      const coeff = r.position.subarray(axis * c, (axis + 1) * c);
      const q = chebyshev(coeff, x); pos[axis] = q.value;
      vel[axis] = s.type === 2 ? q.derivative / r.radius : chebyshev(r.velocity!.subarray(axis * c, (axis + 1) * c), x).value;
    }
    return { position: { x: pos[0], y: pos[1], z: pos[2] }, velocity: { x: vel[0], y: vel[1], z: vel[2] }, center: s.center, frame: s.frame };
  }

  private parseSegment(d: number[], i: number[]): SpkSegment {
    const [startEt, endEt] = d, [target, center, frame, type, startAddress, endAddress] = i;
    if (![startEt, endEt].every(Number.isFinite) || startEt > endEt || startAddress < 1 || endAddress < startAddress || endAddress > this.bytes / 8) fail('invalid segment descriptor');
    if (type !== 2 && type !== 3) return { target, center, frame, type, startEt, endEt, startAddress, endAddress, coefficientCount: 0, recordCount: 0, recordSize: 0 };
    const terminal = this.addressOffset(endAddress - 3);
    const rs = this.f64(terminal + 16), count = this.f64(terminal + 24);
    if (!Number.isInteger(rs) || !Number.isInteger(count) || count < 1 || rs < 5 || count > 1e7) fail('invalid segment record metadata');
    const words = endAddress - startAddress + 1;
    if (words !== count * rs + 4 || (type === 2 ? (rs - 2) % 3 : (rs - 2) % 6) !== 0) fail('inconsistent segment record count/size');
    const coefficientCount = type === 2 ? (rs - 2) / 3 : (rs - 2) / 6;
    if (coefficientCount < 2) fail('too few Chebyshev coefficients');
    return { target, center, frame, type, startEt, endEt, startAddress, endAddress, coefficientCount, recordCount: count, recordSize: rs };
  }

  private addressOffset(address: number): number {
    if (!Number.isInteger(address) || address < 1 || address > this.bytes / 8) fail('DAF address out of bounds');
    return (address - 1) * 8;
  }
  private ascii(offset: number, length: number): string { return String.fromCharCode(...new Uint8Array(this.view.buffer, offset, length)); }
  private f64(offset: number): number { if (offset < 0 || offset + 8 > this.bytes) fail('read out of bounds'); return this.view.getFloat64(offset, this.little); }
  private i32(offset: number): number { if (offset < 0 || offset + 4 > this.bytes) fail('read out of bounds'); return this.view.getInt32(offset, this.little); }
  private controlInt(offset: number): number { const n = this.f64(offset); if (!Number.isInteger(n) || n < 0) fail('invalid DAF control word'); return n; }
}

function chebyshev(coeff: ArrayLike<number>, x: number): { value: number; derivative: number } {
  let b1 = 0, b2 = 0, d1 = 0, d2 = 0;
  for (let k = coeff.length - 1; k >= 1; k--) { const b = 2 * x * b1 - b2 + coeff[k]; b2 = b1; b1 = b; const d = 2 * x * d1 - d2 + 2 * b2; d2 = d1; d1 = d; }
  return { value: x * b1 - b2 + coeff[0], derivative: x * d1 - d2 + b1 };
}
