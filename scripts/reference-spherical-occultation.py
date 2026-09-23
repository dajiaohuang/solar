"""Real DE440/PCK spherical cases classified independently by CSPICE occult.
uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-spherical-occultation.py --output <new.json>
Epochs are explicit TDB Julian dates; no UTC or ground-observer claim.
"""
import argparse
import hashlib
import json
from pathlib import Path
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    output = Path(parser.parse_args().output)
    if output.exists():
        raise FileExistsError('Choose a new reference output')
    paths = ['public/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp', 'src/data/pck00011.tpc']
    expected = ['8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069', '3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1']
    for path, sha in zip(paths, expected):
        if hashlib.sha256((ROOT/path).read_bytes()).hexdigest() != sha:
            raise ValueError('Source checksum mismatch')
        spice.furnsh(str(ROOT/path))
    cases = []
    # Samples around the 2012 Venus transit and two solar-eclipse alignments.
    # They are geocentric NONE cases, not published topocentric contact times.
    for name, body, epoch in [('venus-2012', 299, 2456084.5), ('moon-2017', 301, 2457987.25), ('moon-2024', 301, 2460409.25)]:
        for hours in [-8, -4, -2, 0, 2, 4, 8]:
            jd = epoch+hours/24
            et = (jd-2451545)*86400
            front = spice.spkpos(str(body), et, 'J2000', 'NONE', '399')[0]
            back = spice.spkpos('10', et, 'J2000', 'NONE', '399')[0]
            front_radii = spice.bodvcd(body, 'RADII', 3)[1].tolist()
            back_radii = spice.bodvcd(10, 'RADII', 3)[1].tolist()
            assert len(set(front_radii)) == 1 and len(set(back_radii)) == 1
            code = int(spice.occult(str(body), 'ELLIPSOID', 'IAU_VENUS' if body == 299 else 'IAU_MOON', '10', 'ELLIPSOID', 'IAU_SUN', 'NONE', '399', et))
            cases.append(dict(name=f'{name} {hours:+}h', epochTdb=jd, foregroundId=body, backgroundId=10, observerId=399,
                              foreground=dict(positionKm=front.tolist(), radiusKm=front_radii[0]),
                              background=dict(positionKm=back.tolist(), radiusKm=back_radii[0]),
                              separationRadians=float(spice.vsep(front, back)), occultCode=code))
    report = dict(schemaVersion=1, frame='J2000', aberration='NONE', timeScale='TDB',
                  sources=[dict(path=path, sha256=sha) for path, sha in zip(paths, expected)], cases=cases,
                  generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
                  boundary='Single-epoch geometric geocentric spherical-model comparison, not ground visibility, contact times or physical prediction error.')
    with output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), cases=len(cases), classifications=sorted(set(case['occultCode'] for case in cases)))))


if __name__ == '__main__':
    main()
