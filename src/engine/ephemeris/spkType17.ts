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
  if (![epoch, et, ...r].every(Number.isFinite)) throw new Error('Invalid SPK: nonfinite type 17 input');
  if (!(a > 0)) throw new Error('Invalid SPK: type 17 semi-major axis must be positive');
  if (e > 0.9) throw new Error('Invalid SPK: type 17 eccentricity exceeds 0.9');
  if (meanLongitudeRate === 0) throw new Error('Invalid SPK: type 17 mean longitude rate must be nonzero');
  const dt = et - epoch;
  const dlp = periRate * dt, can = Math.cos(dlp), san = Math.sin(dlp);
  const hh = h * can + k * san, kk = k * can - h * san;
  const nodeDt = nodeRate * dt, cnn = Math.cos(nodeDt), snn = Math.sin(nodeDt);
  const pp = p * cnn + q * snn, qq = q * cnn - p * snn;
  const ml = wrapAngle(longitude + meanLongitudeRate * dt);
  let eccentric = ml;
  let converged = false;
  for (let i = 0; i < 20; i++) {
    const delta = (eccentric + hh * Math.cos(eccentric) - kk * Math.sin(eccentric) - ml) /
      (1 - hh * Math.sin(eccentric) - kk * Math.cos(eccentric));
    eccentric -= delta;
    if (Math.abs(delta) < 2e-15) { converged = true; break; }
  }
  if (!converged) {
    let lo = -Math.PI, hi = Math.PI;
    const residual = (x: number) => x + hh * Math.cos(x) - kk * Math.sin(x) - ml;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (residual(mid) > 0) hi = mid; else lo = mid; }
    eccentric = (lo + hi) / 2;
    if (Math.abs(residual(eccentric)) > 1e-13) throw new Error('Invalid SPK: type 17 Kepler solve did not converge');
  }
  const ce = Math.cos(eccentric), se = Math.sin(eccentric), b = 1 / (Math.sqrt(1 - hh * hh - kk * kk) + 1);
  const x1 = a * ((1 - b * hh * hh) * ce + (hh * kk * b * se - kk));
  const y1 = a * ((1 - b * kk * kk) * se + (hh * kk * b * ce - hh));
  const rb = hh * se + kk * ce, radius = a * (1 - rb), ra = meanLongitudeRate * a * a / radius;
  const dx1 = ra * (-se + hh * b * rb), dy1 = ra * (ce - kk * b * rb);
  const nfac = 1 - periRate / meanLongitudeRate, argRate = periRate - nodeRate;
  const dx = nfac * dx1 - argRate * y1, dy = nfac * dy1 + argRate * x1;
  const f = equinoctialBasis(pp, qq, false), g = equinoctialBasis(pp, qq, true);
  const position = add(scale(f, x1), scale(g, y1));
  const velocity = add(scale(f, dx), scale(g, dy));
  const temp = [-nodeRate * position[1], nodeRate * position[0], 0];
  velocity[0] += temp[0]; velocity[1] += temp[1];
  const pole = [Math.cos(decpol) * Math.cos(rapol), Math.cos(decpol) * Math.sin(rapol), Math.sin(decpol)];
  const xaxis = [-Math.sin(rapol), Math.cos(rapol), 0];
  const yaxis = [-Math.sin(decpol) * Math.cos(rapol), -Math.sin(decpol) * Math.sin(rapol), Math.cos(decpol)];
  return { position: rotate(position, xaxis, yaxis, pole), velocity: rotate(velocity, xaxis, yaxis, pole) };
}

function equinoctialBasis(p: number, q: number, second: boolean): number[] {
  const d = 1 + p * p + q * q;
  return second ? [2 * p * q / d, (1 + p * p - q * q) / d, 2 * q / d] : [(1 - p * p + q * q) / d, 2 * p * q / d, -2 * p / d];
}
function add(a: number[], b: number[]) { return a.map((v, i) => v + b[i]); }
function scale(a: number[], x: number) { return a.map(v => v * x); }
function rotate(v: number[], x: number[], y: number[], z: number[]) { return { x: v[0] * x[0] + v[1] * y[0] + v[2] * z[0], y: v[0] * x[1] + v[1] * y[1] + v[2] * z[1], z: v[0] * x[2] + v[1] * y[2] + v[2] * z[2] }; }
function wrapAngle(x: number) { return x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI)); }
