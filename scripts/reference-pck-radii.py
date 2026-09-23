"""Extract all actual pool RADII values with CSPICE, independently of the TS parser.
uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-pck-radii.py --output <new.json>
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
    spice.furnsh(str(path))
    names = list(spice.gnpool('BODY*_RADII', 0, 1000))
    bodies = sorted([dict(naifPckId=int(name[4:-6]), radiiKm=spice.gdpool(name, 0, 3).tolist()) for name in names], key=lambda row: row['naifPckId'])
    report = dict(schemaVersion=1, sourceSha256=source['sha256'], bodies=bodies,
                  generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
                  boundary='Kernel-pool extraction parity only; no independent physical accuracy or limb/orientation certification.')
    with output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), bodies=len(bodies))))


if __name__ == '__main__':
    main()
