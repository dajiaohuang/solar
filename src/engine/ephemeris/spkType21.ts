/** NAIF N0067 SPKR21/SPKE21 extended modified-difference records.
 * The disk tail contains MAXDIM,N; SPKR21's prepended workspace MAXDIM is
 * NOT part of the on-disk difference line. No trajectory refitting occurs.
 * https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/FORTRAN/spicelib/spke21.html
 */
export interface Type21Metadata { dimension: number; recordSize: number; recordCount: number; epochsAddress: number }
type ReadWord = (address: number) => number;
const fail = (message: string): never => { throw new Error(`Invalid SPK type 21: ${message}`); };

export function inspectType21(read: ReadWord, start: number, end: number, endEt: number): Type21Metadata {
  const dimension = read(end - 1), recordCount = read(end);
  if (!Number.isInteger(dimension) || dimension < 15 || dimension > 25) fail('unsupported difference-table dimension');
  if (!Number.isInteger(recordCount) || recordCount < 1 || recordCount > 1e7) fail('invalid record count');
  const recordSize = 4 * dimension + 11, directoryCount = Math.floor(recordCount / 100);
  if (end - start + 1 !== recordCount * (recordSize + 1) + directoryCount + 2) fail('inconsistent segment layout');
  const epochsAddress = start + recordCount * recordSize;
  let previous = -Infinity;
  for (let index = 0; index < recordCount; index++) {
    const epoch = read(epochsAddress + index);
    if (!Number.isFinite(epoch) || epoch <= previous) fail('unordered record final epochs');
    previous = epoch;
    const address = start + index * recordSize;
    for (let word = 0; word < recordSize; word++) if (!Number.isFinite(read(address + word))) fail('nonfinite difference-line word');
    const maximumOrderPlusOne = read(address + 4 * dimension + 7);
    if (!Number.isInteger(maximumOrderPlusOne) || maximumOrderPlusOne < 3 || maximumOrderPlusOne > dimension + 1) fail('invalid maximum integration order');
    for (let axis = 0; axis < 3; axis++) {
      const order = read(address + 4 * dimension + 8 + axis);
      if (!Number.isInteger(order) || order < 0 || order >= maximumOrderPlusOne || order > dimension) fail('invalid component integration order');
    }
    for (let j = 0; j < maximumOrderPlusOne - 2; j++) if (read(address + 1 + j) === 0) fail('zero active step size');
  }
  if (previous < endEt) fail('record epochs do not cover segment end');
  for (let index = 0; index < directoryCount; index++) {
    if (read(epochsAddress + recordCount + index) !== read(epochsAddress + (index + 1) * 100 - 1)) fail('inconsistent epoch directory');
  }
  return { dimension, recordSize, recordCount, epochsAddress };
}

export function evaluateType21(read: ReadWord, start: number, meta: Type21Metadata, et: number): number[] {
  // First final epoch >= ET, including exact record/directory endpoints.
  let low = 0, high = meta.recordCount;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (read(meta.epochsAddress + middle) < et) low = middle + 1; else high = middle;
  }
  if (low === meta.recordCount) fail('epoch outside record coverage');
  const address = start + low * meta.recordSize, dimension = meta.dimension;
  const at = (offset: number) => read(address + offset);
  const delta = et - at(0), maximumOrderPlusOne = at(4 * dimension + 7);
  const fc = new Float64Array(dimension), wc = new Float64Array(dimension), w = new Float64Array(dimension + 2);
  fc[0] = 1;
  let tp = delta;
  for (let j = 1; j <= maximumOrderPlusOne - 2; j++) {
    const step = at(j);
    fc[j] = tp / step; wc[j - 1] = delta / step; tp = delta + step;
  }
  for (let j = 1; j <= maximumOrderPlusOne; j++) w[j - 1] = 1 / j;
  let ks = maximumOrderPlusOne - 1, jx = 0, ks1 = ks - 1;
  while (ks >= 2) {
    jx++;
    for (let j = 1; j <= jx; j++) w[j + ks - 1] = fc[j] * w[j + ks1 - 1] - wc[j - 1] * w[j + ks - 1];
    ks = ks1; ks1--;
  }
  const state = new Array<number>(6);
  for (let axis = 0; axis < 3; axis++) {
    let sum = 0;
    for (let j = at(4 * dimension + 8 + axis); j >= 1; j--) sum += at(dimension + 7 + axis * dimension + j - 1) * w[j + ks - 1];
    state[axis] = at(dimension + 1 + 2 * axis) + delta * (at(dimension + 2 + 2 * axis) + delta * sum);
  }
  for (let j = 1; j <= jx; j++) w[j + ks - 1] = fc[j] * w[j + ks1 - 1] - wc[j - 1] * w[j + ks - 1];
  ks--;
  for (let axis = 0; axis < 3; axis++) {
    let sum = 0;
    for (let j = at(4 * dimension + 8 + axis); j >= 1; j--) sum += at(dimension + 7 + axis * dimension + j - 1) * w[j + ks - 1];
    state[axis + 3] = at(dimension + 2 + 2 * axis) + delta * sum;
  }
  if (!state.every(Number.isFinite)) fail('nonfinite evaluated state');
  return state;
}
