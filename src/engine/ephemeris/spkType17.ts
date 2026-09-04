/** SPK Type 17 (equinoctial elements), following NAIF EQNCPV/SPKE17. */

export interface Type17Metadata { recordSize: 12; recordCount: 1 }

type ReadDouble = (address: number) => number;

export function inspectType17(read: ReadDouble, startAddress: number, endAddress: number): Type17Metadata {
  if (endAddress - startAddress + 1 !== 12) throw new Error('Invalid SPK: type 17 record must contain exactly 12 doubles');
  for (let i = 0; i < 12; i++) {
    const value = read(startAddress + i);
    if (!Number.isFinite(value)) throw new Error('Invalid SPK: nonfinite type 17 element');
  }
  const a = read(startAddress + 1), e = Math.hypot(read(startAddress + 2), read(startAddress + 3));
  if (a <= 0) throw new Error('Invalid SPK: type 17 semi-major axis must be positive');
  if (e > 0.9) throw new Error('Invalid SPK: type 17 eccentricity exceeds 0.9');
  return { recordSize: 12, recordCount: 1 };
}

export function evaluateType17(read: ReadDouble, startAddress: number, et: number) {
  const r = new Float64Array(12);
  for (let i = 0; i < 12; i++) r[i] = read(startAddress + i);
  const [epoch, a, h, k, longitude, p, q, periRate, meanLongitudeRate, nodeRate, rapol, decpol] = r;
  const e = Math.hypot(h, k);
  if (!(a > 0)) throw new Error('Invalid SPK: type 17 semi-major axis must be positive');
  if (e > 0.9) throw new Error('Invalid SPK: type 17 eccentricity exceeds 0.9');
  const dt = et - epoch;
  const varpi = Math.atan2(h, k) + periRate * dt;
  const node = Math.atan2(p, q) + nodeRate * dt;
  const inclinationParameter = Math.hypot(p, q);
  const currentP = inclinationParameter * Math.sin(node);
  const currentQ = inclinationParameter * Math.cos(node);
  const meanAnomaly = longitude + meanLongitudeRate * dt - varpi;
  const m = wrapAngle(meanAnomaly);
  let eccentric = m;
  for (let i = 0; i < 12; i++) {
    const delta = (eccentric - e * Math.sin(eccentric) - m) / (1 - e * Math.cos(eccentric));
    eccentric -= delta;
    if (Math.abs(delta) < 2e-15) break;
  }
  const ce = Math.cos(eccentric), se = Math.sin(eccentric), beta = Math.sqrt(1 - e * e);
  // The equinoctial basis already carries the node orientation; longitude of
  // periapse is therefore used directly (rather than subtracting the node).
  const periAngle = varpi;
  const cp = Math.cos(periAngle), sp = Math.sin(periAngle);
  const f = equinoctialBasis(currentP, currentQ, false), g = equinoctialBasis(currentP, currentQ, true);
  const u = add(scale(f, cp), scale(g, sp));
  const vdir = add(scale(f, -sp), scale(g, cp));
  const den = 1 - e * ce;
  const meanAnomalyRate = meanLongitudeRate - periRate;
  const position = scale(add(scale(u, a * (ce - e)), scale(vdir, a * beta * se)), 1);
  const velocity = scale(add(scale(u, -a * se), scale(vdir, a * beta * ce)), meanAnomalyRate / den);
  const pole = [Math.cos(decpol) * Math.cos(rapol), Math.cos(decpol) * Math.sin(rapol), Math.sin(decpol)];
  const xaxis = [-Math.sin(rapol), Math.cos(rapol), 0];
  const yaxis = [-Math.sin(decpol) * Math.cos(rapol), -Math.sin(decpol) * Math.sin(rapol), Math.cos(decpol)];
  return { position: rotate(position, xaxis, yaxis, pole), velocity: rotate(velocity, xaxis, yaxis, pole) };
}

function equinoctialBasis(p: number, q: number, second: boolean): number[] {
  const d = 1 + p * p + q * q;
  return second ? [2 * p * q / d, (1 + q * q - p * p) / d, -2 * p / d] : [(1 - q * q + p * p) / d, 2 * p * q / d, 2 * q / d];
}
function add(a: number[], b: number[]) { return a.map((v, i) => v + b[i]); }
function scale(a: number[], x: number) { return a.map(v => v * x); }
function rotate(v: number[], x: number[], y: number[], z: number[]) { return { x: v[0] * x[0] + v[1] * y[0] + v[2] * z[0], y: v[0] * x[1] + v[1] * y[1] + v[2] * z[1], z: v[0] * x[2] + v[1] * y[2] + v[2] * z[2] }; }
function wrapAngle(x: number) { return x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI)); }
