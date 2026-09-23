"""Independent CSPICE OSCELT diagnostics; no network or file overwrite.
uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-conic-diagnostics.py --output <new.json>
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
    reference_path = ROOT/'tests/fixtures/de440-solar-1pn-reference.json'
    reference = json.loads(reference_path.read_text())
    source = next(row for row in reference['sources'] if row['id'].startswith('de440s-'))
    kernel = ROOT/source['path']
    if hashlib.sha256(kernel.read_bytes()).hexdigest() != source['sha256']:
        raise ValueError('Original DE440 hash mismatch')
    spice.furnsh(str(kernel))
    gm = reference['masses'][0]['gmKm3PerSecond2']
    cases = []

    def record(name, state, epoch=0):
        elements = spice.oscelt(state, epoch, gm)
        cases.append(dict(name=name, stateKmKmPerSecond=list(map(float, state)), gmKm3PerSecond2=gm,
                          periapsisKm=float(elements[0]), eccentricity=float(elements[1]),
                          inclinationDeg=float(elements[2]*spice.dpr()),
                          reciprocalSemiMajorAxisPerKm=float((1-elements[1])/elements[0])))

    for row in [dict(duration=0, result=reference['initial']), *reference['cases']]:
        et = (reference['referenceEpochTdb']-2451545)*86400+row['duration']
        sun = spice.spkgeo(10, et, 'J2000', 0)[0]
        record(f"Eros integrated {row['duration']} seconds", [row['result'][i]-sun[i] for i in range(6)], et)
    # Synthetic conics use CSPICE CONICS, including hyperbolic and retrograde
    # motion. They test conversion, not coverage of real comet ephemerides.
    for eccentricity, inclination in [(0, 0), (.7, 2.3), (1.5, .5), (3, 3.141592653589793)]:
        state = spice.conics([5e7, eccentricity, inclination, .7, 1.1, .3, 0, gm], 0)
        record(f'Synthetic e={eccentricity}, i={inclination}', state)
    report = dict(schemaVersion=1, reference='https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/oscelt_c.html',
                  source=source, inputReferenceSha256=hashlib.sha256(reference_path.read_bytes()).hexdigest(),
                  generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')), cases=cases,
                  limitation='Instantaneous conic coordinate diagnostics; not invariants of the integrated perturbed or 1PN model.')
    with output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write('\n')
    print(json.dumps(dict(output=str(output), cases=len(cases))))


if __name__ == '__main__':
    main()
