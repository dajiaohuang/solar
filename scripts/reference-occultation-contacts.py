"""Independent CSPICE GF occultation windows for pinned spherical-body cases.
uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-occultation-contacts.py --output <new.json>
"""
import argparse
import hashlib
import json
from pathlib import Path
import spiceypy as spice
from spiceypy.utils.support_types import SPICEDOUBLE_CELL

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    output = Path(parser.parse_args().output)
    if output.exists():
        raise FileExistsError('Choose a new reference output')
    sources = json.loads((ROOT/'tests/fixtures/spherical-occultation-reference.json').read_text())['sources']
    for source in sources:
        path = ROOT/source['path']
        if hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('Source hash mismatch')
        spice.furnsh(str(path))
    spice.gfstol(1e-6)
    cases = []
    for name, body, epoch in [('venus-2012', 299, 2456084.5), ('moon-2017', 301, 2457987.25), ('moon-2024', 301, 2460409.25)]:
        et = (epoch-2451545)*86400
        cnfine = SPICEDOUBLE_CELL(2)
        spice.wninsd(et-43200, et+43200, cnfine)
        contacts = []
        for kind in ['ANY', 'ANNULAR', 'FULL']:
            result = spice.gfoclt(kind, str(body), 'ELLIPSOID', 'IAU_VENUS' if body == 299 else 'IAU_MOON',
                                 '10', 'ELLIPSOID', 'IAU_SUN', 'NONE', '399', 60.0, cnfine, SPICEDOUBLE_CELL(1000))
            for index in range(spice.wncard(result)):
                start, end = spice.wnfetd(result, index)
                for time, direction in [(start, 'enter'), (end, 'exit')]:
                    if time in [et-43200, et+43200]:
                        raise ValueError('Reference event is clipped by the window')
                    contacts.append(dict(boundary='external' if kind == 'ANY' else 'internal', direction=direction, elapsedTdbSeconds=time-et))
        contacts.sort(key=lambda contact: contact['elapsedTdbSeconds'])
        cases.append(dict(name=name, foregroundId=body, backgroundId=10, observerId=399, referenceEpochTdb=epoch,
                          startSeconds=-43200, endSeconds=43200, contacts=contacts))
    report = dict(schemaVersion=1, sources=sources, cases=cases, frame='J2000', aberration='NONE', timeScale='TDB',
                  stepSeconds=60, convergenceToleranceSeconds=1e-6,
                  generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
                  boundary='Geocentric spherical-source GF comparison. GF step affects detection completeness; convergence tolerance is not physical timing uncertainty.')
    with output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), contacts=[dict(name=case['name'], count=len(case['contacts'])) for case in cases])))


if __name__ == '__main__':
    main()
