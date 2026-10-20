"""Independent CSPICE transformations for every original pinned PCK pole model.
uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-pck-orientation.py --output <new.json>
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
    path = ROOT/'src/data/pck00011.tpc'
    source = json.loads((ROOT/'src/data/pck00011.source.json').read_text())
    if hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
        raise ValueError('PCK hash mismatch')
    spice.kclear()
    spice.furnsh(str(path))
    ids = sorted(int(name[4:-8]) for name in spice.gnpool('BODY*_POLE_RA', 0, 1000))
    epochs = [-36525*86400, 0, 843523200, 36525*86400]
    cases = [dict(naifPckId=body, secondsPastJ2000Tdb=epoch,
                  j2000ToBodyFixed=spice.tipbod('J2000', body, epoch).reshape(9).tolist())
             for body in ids for epoch in epochs]
    report = dict(schemaVersion=1, sourceSha256=source['sha256'], ids=ids, cases=cases,
                  generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
                  boundary='Independent implementation parity of the same text kernel, not physical orientation accuracy or binary-PCK equivalence.')
    with output.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), bodies=len(ids), cases=len(cases))))


if __name__ == '__main__':
    main()
