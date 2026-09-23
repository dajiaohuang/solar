"""Independent DOP853 integration of explicitly synthetic Newtonian examples.
uv run --python 3.12 --with scipy==1.16.1 --with mpmath==1.3.0 python scripts/reference-dynamics.py --output <new.json>
No ephemeris source, physical orbit uncertainty or event-accuracy claim.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import scipy
import mpmath as mp
from scipy.integrate import solve_ivp


def analytic_kepler(initial, duration):
    """Universal-variable f/g solution, independently differentiated at 70 digits."""
    mp.mp.dps = 70
    nominal = list(map(mp.mpf, initial))
    dt = mp.mpf(duration)

    def state(*values):
        r0, v0 = mp.matrix(values[:3]), mp.matrix(values[3:])
        radius0 = mp.sqrt(mp.fdot(r0, r0))
        radial = mp.fdot(r0, v0)
        alpha = 2/radius0-mp.fdot(v0, v0)

        def stumpff(chi):
            z = alpha*chi**2
            root = mp.sqrt(z)
            return (1-mp.cos(root))/z, (root-mp.sin(root))/root**3

        def equation(chi):
            c, s = stumpff(chi)
            return radial*chi**2*c + (1-alpha*radius0)*chi**3*s + radius0*chi-dt

        chi = mp.findroot(equation, alpha*dt)
        c, s = stumpff(chi)
        r = (1-chi**2*c/radius0)*r0 + (dt-chi**3*s)*v0
        radius = mp.sqrt(mp.fdot(r, r))
        v = (alpha*chi**3*s-chi)/(radius*radius0)*r0 + (1-chi**2*c/radius)*v0
        return list(r)+list(v)

    value = state(*nominal)
    jacobian = mp.matrix(6, 6)
    for column in range(6):
        order = tuple(int(i == column) for i in range(6))
        for row in range(6):
            jacobian[row, column] = mp.diff(lambda *x: state(*x)[row], nominal, order)
    return [float(v) for v in value]+[float(jacobian[i, j]) for i in range(6) for j in range(6)]


def derivative(moving):
    def rhs(t, state):
        points = [np.zeros(3)]
        gms = [1.0]
        if moving:
            points.append(np.array([5*np.cos(t/10), 5*np.sin(t/10), 1.0]))
            gms.append(0.03)
        acceleration = np.zeros(3)
        gradient = np.zeros((3, 3))
        for position, gm in zip(points, gms):
            delta = position-state[:3]
            radius = np.linalg.norm(delta)
            acceleration += gm*delta/radius**3
            gradient += gm*(3*np.outer(delta, delta)/radius**5-np.eye(3)/radius**3)
        linear = np.zeros((6, 6))
        linear[:3, 3:] = np.eye(3)
        linear[3:, :3] = gradient
        phi = state[6:].reshape((6, 6))
        return np.concatenate([state[3:6], acceleration, (linear@phi).ravel()])
    return rhs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    cases = []
    for name, initial, duration, moving in [
        ('eccentric-forward', [0.1, 0, 0, 0, np.sqrt(19), 0], 2*np.pi, False),
        ('eccentric-backward', [0.1, 0, 0, 0, np.sqrt(19), 0], -2*np.pi, False),
        ('moving-perturber', [1, 0, 0.1, 0, 0.9, 0.05], 20.0, True),
    ]:
        y = np.concatenate([initial, np.eye(6).ravel()])
        result = solve_ivp(derivative(moving), [0, duration], y, method='DOP853', rtol=1e-13, atol=1e-14, max_step=0.05)
        if not result.success:
            raise RuntimeError(result.message)
        dop853 = result.y[:, -1].tolist()
        analytic = analytic_kepler(initial, duration) if not moving else None
        cases.append(dict(name=name, initial=initial, duration=duration, moving=moving,
                          result=analytic or dop853, dop853=dop853,
                          referenceMethod='mpmath-70-digit-universal-kepler' if analytic else 'SciPy-DOP853',
                          evaluations=result.nfev))
    evidence = dict(schemaVersion=1, source='Synthetic prescribed Newtonian masses; no observational data',
                    algorithm='mpmath analytic Kepler / SciPy DOP853', scipyVersion=scipy.__version__, numpyVersion=np.__version__, mpmathVersion=mp.__version__,
                    generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    rtol=1e-13, atol=1e-14, maxStep=0.05, cases=cases)
    with open(args.output, 'x', encoding='utf-8') as output:
        json.dump(evidence, output, indent=2, allow_nan=False)
        output.write('\n')
    print(f'Wrote {len(cases)} independent dynamics cases to {args.output}')


if __name__ == '__main__':
    main()
