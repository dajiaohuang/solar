"""Independent DE440 center light-time/orientation/limb composition via CSPICE."""
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
    paths = ['public/data/ephemerides/de440s-2000-01-01-2051-01-01.bsp', 'src/data/pck00011.tpc']
    hashes = ['8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069',
              '3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1']
    spice.kclear()
    for path, sha in zip(paths, hashes):
        if hashlib.sha256((ROOT/path).read_bytes()).hexdigest() != sha:
            raise ValueError('Original source hash mismatch')
        spice.furnsh(str(ROOT/path))
    cases = []
    for target, observer in [(301, 399), (399, 301), (299, 399)]:
        for epoch in [2456084.5, 2461287.5]:
            for aberration in ['NONE', 'CN']:
                et = (epoch-2451545)*86400
                position, light_time = spice.spkpos(str(target), et, 'J2000', aberration, str(observer))
                orientation_et = et-light_time if aberration == 'CN' else et
                rotation = spice.tipbod('J2000', target, orientation_et)
                viewpoint = rotation @ (-position)
                axes = spice.bodvcd(target, 'RADII', 3)[1]
                center, major, minor = spice.el2cgv(spice.edlimb(*axes, viewpoint))
                cases.append(dict(input=dict(schemaVersion=1, targetId=target, observerId=observer,
                    referenceEpochTdb=epoch, elapsedTdbSeconds=0, frame='J2000', timeScale='TDB',
                    aberration=aberration, maxLightTimeSeconds=2000),
                    observerJ2000Km=(-position).tolist(), orientationEt=orientation_et,
                    j2000ToBodyFixed=rotation.reshape(9).tolist(), centerBodyFixedKm=center.tolist(),
                    shapeTensor=[[float(major[i]*major[j]+minor[i]*minor[j]) for j in range(3)] for i in range(3)]))
    report = dict(schemaVersion=1, cases=cases, sources=[dict(path=p, sha256=h) for p, h in zip(paths, hashes)],
                  generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
                  boundary='Center CN or simultaneous NONE geometry only; not differential limb light-time, ground visibility or physical accuracy.')
    with output.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), cases=len(cases))))


if __name__ == '__main__':
    main()
