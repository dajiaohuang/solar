"""Independent finite-draw DE440 integration; no application imports.

uv run --python 3.12 --with scipy==1.16.1 --with spiceypy==8.2.0 --with mpmath==1.3.0 python scripts/reference-nonlinear-ensemble.py --output <new.json>
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
    helper = ROOT/'scripts/reference-covariance-state-samples.py'
    spec = importlib.util.spec_from_file_location('coordinates', helper)
    coordinates = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(coordinates)
    source = json.loads((ROOT/'tests/fixtures/orbit-covariance-reference.json').read_bytes())['cases'][0]
    epoch = source['epochTdb']
    et = (epoch-2451545)*DAY
    manifest = json.loads((ROOT/'src/data/ephemeris-manifest.json').read_text())
    entry = next(f for f in manifest['files'] if f['id'] == 'de440s-2000-01-01-2051-01-01')
    spk = ROOT/'public/data/ephemerides'/entry['path']
    gm = ROOT/'src/data/gm_de440.tpc'
    if digest(spk) != entry['sha256'] or digest(gm) != '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140':
        raise ValueError('Pinned source checksum mismatch')
    spice.furnsh(str(spk)); spice.furnsh(str(gm))
    gms = [float(spice.bodvcd(body, 'GM', 1)[1][0]) for body in IDS]
    transform = spice.sxform('ECLIPJ2000', 'J2000', et) @ np.diag([AU]*3+[AU/DAY]*3)
    inverse = np.linalg.inv(transform)
    cases = []
    # Deliberately larger than source sigmas: exercises nonlinear trajectories,
    # not a probabilistic interpretation of these hand-selected offsets.
    for offsets in [[0]*6, [.01, -.02, .03, .04, -.05, .06], [-.02, .03, -.1, -.2, .1, -.15]]:
        initial = coordinates.state(source['nominal'], offsets, epoch, coordinates.mp.mpf(gms[0]*DAY**2/AU**3))
        y0 = transform @ initial + spice.spkgeo(10, et, 'J2000', 0)[0]
        for solar_1pn in [False, True]:
            def rhs(t, y):
                states = [spice.spkgeo(body, et+t, 'J2000', 0)[0] for body in IDS]
                acceleration = np.zeros(3)
                for state, mu in zip(states, gms):
                    delta = state[:3]-y[:3]
                    acceleration += mu*delta/np.linalg.norm(delta)**3
                if solar_1pn:
                    relative = y-states[0]
                    r, v = relative[:3], relative[3:]
                    radius = np.linalg.norm(r)
                    acceleration += gms[0]/299792.458**2/radius**3*((4*gms[0]/radius-np.dot(v, v))*r+4*np.dot(r, v)*v)
                return np.concatenate([y[3:], acceleration])

            for days in [-10, 30]:
                duration = days*DAY
                endpoints = []
                for tolerance in [1e-12, 1e-13]:
                    result = solve_ivp(rhs, [0, duration], y0, method='DOP853', rtol=tolerance,
                                       atol=[1e-6]*3+[1e-12]*3, max_step=DAY)
                    if not result.success:
                        raise RuntimeError(result.message)
                    endpoints.append(inverse @ (result.y[:, -1]-spice.spkgeo(10, et+duration, 'J2000', 0)[0]))
                cases.append(dict(offsets=offsets, solar1pn=solar_1pn, durationSeconds=duration,
                                  final=endpoints[1].tolist(), refinementMaxAbsolute=float(np.max(np.abs(endpoints[1]-endpoints[0])))))
    report = dict(schemaVersion=1, referenceEpochTdb=epoch, sourceSha256=source['sourceSha256'],
                  spkSha256=entry['sha256'], gmSha256=digest(gm), generatorSha256=digest(Path(__file__)),
                  coordinateGeneratorSha256=digest(helper), cases=cases,
                  software=dict(scipy=scipy.__version__, spiceypy=spice.__version__, mpmath=coordinates.mp.__version__),
                  boundary='Finite hand-selected source offsets under restricted forces. No event probability, complete fit or physical-error certification.')
    with output.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(cases=len(cases), refinementMax=max(c['refinementMaxAbsolute'] for c in cases))))


if __name__ == '__main__':
    main()
