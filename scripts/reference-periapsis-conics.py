"""Independent CSPICE conics states; no external kernels are needed.
rtk proxy uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-periapsis-conics.py --output <new.json>
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import spiceypy as spice

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
cases = []
for e in [0, 0.8, 0.999999, 1.0, 1.000001, 1.5, 3.0]:
    q, mu = 149597870.7, 132712440041.93938
    for days in [-1000, -100, -0.001, 0, 0.001, 100, 1000]:
        elements = [q,e,0.6,1.2,2.3,0,0,mu]
        state = spice.conics(elements,days*86400)
        cases.append(dict(eccentricity=e,periapsisKm=q,gmKm3PerSecond2=mu,inclinationRadians=0.6,
                          ascendingNodeRadians=1.2,argumentOfPeriapsisRadians=2.3,elapsedTdbSeconds=days*86400,
                          state=state.tolist()))
report = dict(schemaVersion=1,software=dict(spiceypy=spice.__version__,cspice=spice.tkvrsn('TOOLKIT')),
              generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              reference='https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/conics_c.html',
              boundary='Independent numerical two-body conics. Synthetic elements, not measured comet trajectories or physical accuracy.',cases=cases)
with Path(args.output).open('x',encoding='utf-8') as output:
    json.dump(report,output,indent=2,allow_nan=False)
    output.write('\n')
print(json.dumps(dict(output=args.output,cases=len(cases))))
