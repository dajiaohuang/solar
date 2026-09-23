"""Independent conditional covariance evolution; no application imports.

uv run --python 3.12 --with scipy==1.16.1 --with spiceypy==8.2.0 --with mpmath==1.3.0 python scripts/reference-dynamics-covariance.py --output <new.json>
Evolves the normalized covariance differential equation directly with DOP853,
not the application's transition-matrix square-root pushforward.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
import scipy
import spiceypy as spice
from scipy.integrate import solve_ivp

ROOT = Path(__file__).resolve().parents[1]
IDS = [10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9]
AU, DAY = 149597870.7, 86400


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    output = Path(parser.parse_args().output)
    if output.exists():
        raise FileExistsError('Choose a new immutable reference output')
    helper_path = ROOT/'scripts/reference-orbit-covariance.py'
    spec = importlib.util.spec_from_file_location('coordinates', helper_path)
    coordinates = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(coordinates)
    source = coordinates.source_case('eros')
    initial = coordinates.reference(source)
    epoch = source['epochTdb']
    et = (epoch-2451545)*DAY
    manifest = json.loads((ROOT/'src/data/ephemeris-manifest.json').read_text())
    entry = next(f for f in manifest['files'] if f['id'] == 'de440s-2000-01-01-2051-01-01')
    spk = ROOT/'public/data/ephemerides'/entry['path']
    if digest(spk) != entry['sha256']:
        raise ValueError('SPK hash mismatch')
    gm = ROOT/'src/data/gm_de440.tpc'
    if digest(gm) != '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140':
        raise ValueError('GM hash mismatch')
    spice.furnsh(str(spk))
    spice.furnsh(str(gm))
    gms = [float(spice.bodvcd(body, 'GM', 1)[1][0]) for body in IDS]
    transform = spice.sxform('ECLIPJ2000', 'J2000', et) @ np.diag([AU]*3+[AU/DAY]*3)
    inverse = np.linalg.inv(transform)
    initial_state = transform @ initial['referenceNominal'] + spice.spkgeo(10, et, 'J2000', 0)[0]
    covariance = transform @ initial['referenceMatrix'] @ transform.T
    scales = np.sqrt(np.diag(covariance))
    normalized = covariance / np.outer(scales, scales)
    y0 = np.concatenate([initial_state, normalized.ravel()])

    def relativistic(relative):
        r, v = relative[:3], relative[3:]
        radius = np.sqrt(np.dot(r, r))
        return gms[0]/299792.458**2/radius**3*((4*gms[0]/radius-np.dot(v, v))*r+4*np.dot(r, v)*v)

    cases = []
    for solar_1pn in [False, True]:
        def rhs(t, y):
            states = [spice.spkgeo(body, et+t, 'J2000', 0)[0] for body in IDS]
            acceleration = np.zeros(3)
            linear = np.zeros((6, 6))
            linear[:3, 3:] = np.eye(3)
            for state, mu in zip(states, gms):
                delta = state[:3]-y[:3]
                radius = np.linalg.norm(delta)
                acceleration += mu*delta/radius**3
                linear[3:, :3] += mu*(3*np.outer(delta, delta)/radius**5-np.eye(3)/radius**3)
            if solar_1pn:
                relative = y[:6]-states[0]
                acceleration += relativistic(relative)
                for axis in range(6):
                    perturbed = relative.astype(complex)
                    perturbed[axis] += 1e-15j
                    linear[3:, axis] += np.imag(relativistic(perturbed))/1e-15
            scaled_linear = linear*scales[np.newaxis, :]/scales[:, np.newaxis]
            cov = y[6:].reshape((6, 6))
            derivative = scaled_linear @ cov + cov @ scaled_linear.T
            return np.concatenate([y[3:6], acceleration, derivative.ravel()])

        for days in [-10, 0, 30]:
            duration = days*DAY
            results = []
            for tolerance in [1e-12, 1e-13]:
                if duration == 0:
                    final = y0
                else:
                    integration = solve_ivp(rhs, [0, duration], y0, method='DOP853', rtol=tolerance,
                                            atol=[1e-6]*3+[1e-12]*3+[tolerance]*36, max_step=DAY)
                    if not integration.success:
                        raise RuntimeError(integration.message)
                    final = integration.y[:, -1]
                final_cov = final[6:].reshape((6, 6))*np.outer(scales, scales)
                matrix = inverse @ final_cov @ inverse.T
                nominal = inverse @ (final[:6]-spice.spkgeo(10, et+duration, 'J2000', 0)[0])
                results.append((nominal, matrix))
            nominal, matrix = results[1]
            denominator = np.sqrt(np.outer(np.diag(matrix), np.diag(matrix)))
            cases.append(dict(solar1pn=solar_1pn, durationSeconds=duration, nominal=nominal.tolist(), matrix=matrix.tolist(),
                              refinementMaxSigmaNormalized=float(np.max(np.abs(matrix-results[0][1])/denominator))))
    report = dict(schemaVersion=1, referenceEpochTdb=epoch, sourceSha256=source['sourceSha256'],
                  spkSha256=entry['sha256'], gmSha256=digest(gm), frame='ECLIPJ2000', origin='Sun',
                  units=['AU']*3+['AU/day']*3, coordinateGeneratorSha256=digest(helper_path),
                  generatorSha256=digest(Path(__file__)), cases=cases,
                  software=dict(scipy=scipy.__version__, spiceypy=spice.__version__, mpmath=coordinates.mp.__version__, cspice=spice.tkvrsn('TOOLKIT')),
                  method='80-digit coordinate Jacobian, CSPICE frame/states, direct normalized dC/dt = A C + C A^T using DOP853',
                  boundary='Conditional six-parameter Gaussian linearization under fixed DE440 inputs. No complete SBDB fit model, nonlinear confidence or physical-error certification.')
    with output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), cases=len(cases), refinementMax=max(case['refinementMaxSigmaNormalized'] for case in cases))))


if __name__ == '__main__':
    main()
