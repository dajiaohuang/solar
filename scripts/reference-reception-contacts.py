"""Independent CSPICE CN directions and geometric-source occultation windows.
uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-reception-contacts.py --output <new.json>
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
    original = json.loads((ROOT/'tests/fixtures/occultation-contacts-reference.json').read_text())
    for source in original['sources']:
        path = ROOT/source['path']
        if hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('Source hash mismatch')
        spice.furnsh(str(path))
    spice.gfstol(1e-6)
    cases = []
    for original_case in original['cases']:
        epoch = original_case['referenceEpochTdb']
        body = original_case['foregroundId']
        et = (epoch-2451545)*86400
        directions = []
        for target in [body, 10]:
            position, light_time = spice.spkpos(str(target), et, 'J2000', 'CN', '399')
            directions.append(dict(targetId=target, positionKm=position.tolist(), lightTimeSeconds=float(light_time)))
        cnfine = SPICEDOUBLE_CELL(2)
        spice.wninsd(et-43200, et+43200, cnfine)
        contacts = []
        for kind in ['ANY', 'ANNULAR', 'FULL']:
            result = spice.gfoclt(kind, str(body), 'ELLIPSOID', 'IAU_VENUS' if body == 299 else 'IAU_MOON',
                                 '10', 'ELLIPSOID', 'IAU_SUN', 'CN', '399', 60.0, cnfine, SPICEDOUBLE_CELL(1000))
            for index in range(spice.wncard(result)):
                start, end = spice.wnfetd(result, index)
                for time, direction in [(start, 'enter'), (end, 'exit')]:
                    if time in [et-43200, et+43200]:
                        raise ValueError('Reference event clipped by window')
                    contacts.append(dict(boundary='external' if kind == 'ANY' else 'internal', direction=direction, elapsedTdbSeconds=time-et))
        contacts.sort(key=lambda contact: contact['elapsedTdbSeconds'])
        cases.append({**original_case, 'contacts': contacts, 'directionsAtReferenceEpoch': directions})
    report = dict(schemaVersion=1, sources=original['sources'], cases=cases, frame='J2000', aberration='CN', timeScale='TDB',
                  stepSeconds=60, convergenceToleranceSeconds=1e-6,
                  generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
                  boundary='Converged Newtonian reception, geocentric spherical-source comparison; no full relativistic apparent limb or physical timing accuracy claim.')
    with output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), contacts=[len(case['contacts']) for case in cases])))


if __name__ == '__main__':
    main()
