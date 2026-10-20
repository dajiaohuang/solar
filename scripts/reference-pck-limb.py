"""Independent source-backed finite-distance limb ellipses via CSPICE edlimb."""
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
    source = json.loads((ROOT/'src/data/pck00011.source.json').read_text())
    kernel = ROOT/'src/data/pck00011.tpc'
    if hashlib.sha256(kernel.read_bytes()).hexdigest() != source['sha256']:
        raise ValueError('Original PCK hash mismatch')
    spice.kclear()
    spice.furnsh(str(kernel))
    cases = []
    for body in [399, 401, 499, 501, 599, 699, 999]:
        axes = spice.bodvcd(body, 'RADII', 3)[1]
        for epoch in [0, 843523200]:
            matrix = spice.tipbod('J2000', body, epoch)
            for direction in [[1.001, 0, 0], [3, 4, 5], [-1e6, 2e6, -3e6]]:
                viewpoint = axes * direction
                center, major, minor = spice.el2cgv(spice.edlimb(*axes, viewpoint))
                tensor = [[float(major[i]*major[j]+minor[i]*minor[j]) for j in range(3)] for i in range(3)]
                cases.append(dict(body=body, epoch=epoch, axes=axes.tolist(), j2000ToBodyFixed=matrix.reshape(9).tolist(),
                                  observerJ2000Km=(matrix.T @ viewpoint).tolist(),
                                  centerBodyFixedKm=center.tolist(), shapeTensor=tensor))
    report = dict(schemaVersion=1, sourceSha256=source['sha256'], cases=cases,
                  generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
                  boundary='Same-model implementation parity only; generated observer vectors are numerical fixtures, not observed events.')
    with output.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), cases=len(cases))))


if __name__ == '__main__':
    main()
