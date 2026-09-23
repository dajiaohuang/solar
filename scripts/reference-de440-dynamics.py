"""CSPICE/DOP853 reference for the explicitly restricted DE440 force model.
uv run --python 3.12 --with scipy==1.16.1 --with spiceypy==8.2.0 python scripts/reference-de440-dynamics.py --output <new.json>
Original SPK states are separately retained to expose model discrepancies.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import scipy
import spiceypy as spice
from scipy.integrate import solve_ivp

ROOT = Path(__file__).resolve().parents[1]
IDS = [10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9]
EPOCH = 2461234.5
ET = (EPOCH-2451545)*86400


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    output = Path(parser.parse_args().output)
    if output.exists():
        raise FileExistsError('Choose a new immutable reference output')
    manifest = json.loads((ROOT/'src/data/ephemeris-manifest.json').read_text())
    sources = []
    for name in ['de440s-2000-01-01-2051-01-01', 'horizons-eros-2026-01-01-2027-01-01']:
        entry = next(f for f in manifest['files'] if f['id'] == name)
        path = ROOT/'public/data/ephemerides'/entry['path']
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if sha != entry['sha256']:
            raise ValueError('SPK source hash mismatch')
        spice.furnsh(str(path))
        sources.append(dict(id=name, sha256=sha, path=str(path.relative_to(ROOT)).replace('\\', '/')))
    gm_path = ROOT/'src/data/gm_de440.tpc'
    gm_hash = hashlib.sha256(gm_path.read_bytes()).hexdigest()
    if gm_hash != '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140':
        raise ValueError('GM source hash mismatch')
    spice.furnsh(str(gm_path))
    gms = [float(spice.bodvcd(id_, 'GM', 1)[1][0]) for id_ in IDS]
    initial = spice.spkgeo(20000433, ET, 'J2000', 0)[0]

    def positions(t):
        return [spice.spkgeo(id_, ET+t, 'J2000', 0)[0][:3] for id_ in IDS]

    def rhs(t, state):
        acceleration, gradient = np.zeros(3), np.zeros((3, 3))
        for position, gm in zip(positions(t), gms):
            delta = position-state[:3]
            radius = np.linalg.norm(delta)
            acceleration += gm*delta/radius**3
            gradient += gm*(3*np.outer(delta, delta)/radius**5-np.eye(3)/radius**3)
        linear = np.zeros((6, 6))
        linear[:3, 3:] = np.eye(3)
        linear[3:, :3] = gradient
        return np.concatenate([state[3:6], acceleration, (linear@state[6:].reshape((6, 6))).ravel()])

    cases = []
    for days in [-10, 10, 30]:
        duration = days*86400
        y0 = np.concatenate([initial, np.eye(6).ravel()])
        solutions = []
        for tolerance in [1e-12, 1e-13]:
            solution = solve_ivp(rhs, [0, duration], y0, method='DOP853', rtol=tolerance,
                                 atol=[1e-6]*3+[1e-12]*39, max_step=86400)
            if not solution.success:
                raise RuntimeError(solution.message)
            solutions.append(solution.y[:, -1])
        nominal_spk = spice.spkgeo(20000433, ET+duration, 'J2000', 0)[0]
        cases.append(dict(duration=duration, result=solutions[1].tolist(), originalSpkState=nominal_spk.tolist(),
                          modelResidualPositionKm=float(np.linalg.norm(solutions[1][:3]-nominal_spk[:3])),
                          modelResidualVelocityKmPerSecond=float(np.linalg.norm(solutions[1][3:6]-nominal_spk[3:])),
                          dop853RefinementMaxNormalized=float(np.max(np.abs(solutions[0]-solutions[1])/(1+np.abs(solutions[1]))))))
    report = dict(schemaVersion=1, referenceEpochTdb=EPOCH, frame='J2000', origin='SSB', timeScale='TDB',
                  initialTarget=20000433, initial=initial.tolist(), sources=sources, gmSha256=gm_hash,
                  masses=[dict(naifId=id_, gmKm3PerSecond2=gm) for id_, gm in zip(IDS, gms)],
                  sourceStates=[dict(elapsed=t, states=[spice.spkgeo(id_, ET+t, 'J2000', 0)[0].tolist() for id_ in IDS]) for t in [0, 12345, 864000]],
                  software=dict(scipy=scipy.__version__, spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
                  generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  boundary='Restricted Newtonian point-mass integration from real Eros initial state. Original SPK residuals are model disagreement, not numerical tolerance or physical uncertainty.',
                  cases=cases)
    with output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), residuals=[{k: v for k, v in c.items() if k not in ['result', 'originalSpkState']} for c in cases])))


if __name__ == '__main__':
    main()
