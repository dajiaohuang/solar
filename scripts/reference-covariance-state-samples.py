"""80-digit classical-anomaly reference for nonlinear source-offset conversion.

Run with mpmath==1.3.0. No application implementation is imported. This is
coordinate arithmetic evidence, not a physical orbit or uncertainty forecast.
"""
import argparse
import hashlib
import json
from pathlib import Path

import mpmath as mp

mp.mp.dps = 80
ROOT = Path(__file__).resolve().parents[1]


def state(nominal, offsets, epoch, gm):
    values = [mp.mpf(n) + mp.mpf(d) for n, d in zip(nominal, offsets)]
    e, q, tp, node, peri, inc = values[:6]
    elapsed = mp.mpf(epoch) - tp
    if e < 1:
        a = q / (1 - e)
        mean = mp.sqrt(gm / a**3) * elapsed
        u = mp.findroot(lambda x: x - e * mp.sin(x) - mean,
                        mean + mp.sign(mean) * e, maxsteps=200)
        anomaly = 2 * mp.atan2(mp.sqrt(1 + e) * mp.sin(u / 2),
                              mp.sqrt(1 - e) * mp.cos(u / 2))
    elif e > 1:
        a = q / (e - 1)
        mean = mp.sqrt(gm / a**3) * elapsed
        u = mp.findroot(lambda x: e * mp.sinh(x) - x - mean,
                        mp.asinh(mean / e), maxsteps=200)
        anomaly = 2 * mp.atan(mp.sqrt((e + 1) / (e - 1)) * mp.tanh(u / 2))
    else:
        barker = elapsed * mp.sqrt(gm / (2 * q**3))
        d = 2 * mp.sinh(mp.asinh(mp.mpf('1.5') * barker) / 3)
        anomaly = 2 * mp.atan(d)
    p = q * (1 + e)
    r = p / (1 + e * mp.cos(anomaly))
    speed = mp.sqrt(gm / p)
    position = mp.matrix([r * mp.cos(anomaly), r * mp.sin(anomaly), 0])
    velocity = mp.matrix([-speed * mp.sin(anomaly), speed * (e + mp.cos(anomaly)), 0])
    node, peri, inc = [x * mp.pi / 180 for x in (node, peri, inc)]

    def rz(x):
        return mp.matrix([[mp.cos(x), -mp.sin(x), 0], [mp.sin(x), mp.cos(x), 0], [0, 0, 1]])

    rotation = rz(node) * mp.matrix([[1, 0, 0], [0, mp.cos(inc), -mp.sin(inc)],
                                    [0, mp.sin(inc), mp.cos(inc)]]) * rz(peri)
    return list(map(float, list(rotation * position) + list(rotation * velocity)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    path = Path(parser.parse_args().output)
    original = (ROOT / 'tests/fixtures/orbit-covariance-reference.json').read_bytes()
    reference = json.loads(original)
    gm = reference['adoptedSolarGM']
    cases = []
    for source in reference['cases'][:2]:
        n = len(source['nominal'])
        for name, first in [('nominal', [0]*6), ('tiny-tp', [0, 0, 1e-10, 0, 0, 0]),
                            ('joint', [.01, -.02, .03, .04, -.05, .06]),
                            ('hyperbolic', [1.25-source['nominal'][0], 0, 0, 0, 0, 0])]:
            offsets = first + ([1.5, .00002] if n == 8 else [])
            cases.append({'name': source['name']+'-'+name, 'source': source['name'],
                          'offsets': offsets, 'state': state(source['nominal'], offsets,
                                                            source['epochTdb'], mp.mpf(gm['au3PerDay2']))})
    with path.open('x', encoding='utf-8') as handle:
        json.dump({'software': {'mpmath': mp.__version__, 'decimalDigits': mp.mp.dps},
                   'inputReferenceSha256': hashlib.sha256(original).hexdigest(),
                   'adoptedSolarGM': gm, 'cases': cases}, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(f'{len(cases)} independent coordinate cases written to {path}')


if __name__ == '__main__':
    main()
