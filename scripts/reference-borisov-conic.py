"""CSPICE two-body evaluation from original Borisov SBDB plus pinned solar GM."""
import argparse
import hashlib
import json
from decimal import Decimal
from pathlib import Path
import spiceypy as spice

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
raw = (root/'tests/fixtures/sbdb-borisov-20260923/response.json').read_bytes()
receipt = json.loads((root/'tests/fixtures/sbdb-borisov-20260923/receipt.json').read_text())
assert hashlib.sha256(raw).hexdigest() == receipt['sha256']
gm_path = root/'src/data/gm_de440.tpc'
gm_hash = hashlib.sha256(gm_path.read_bytes()).hexdigest()
assert gm_hash == '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140'
spice.furnsh(str(gm_path))
mu = spice.bodvrd('SUN','GM',1)[1][0]
source = json.loads(raw)
e = {row['name']:row['value'] for row in source['orbit']['elements']}
elts = [float(e['q'])*149597870.7,float(e['e']),*[float(e[name])*spice.rpd() for name in ['i','om','w']],0,0,mu]
cases = []
for offset in [-1000,-100,0,100,1000]:
    target = Decimal(source['orbit']['epoch'])+offset
    dt = float((target-Decimal(e['tp']))*86400)
    cases.append(dict(targetTdbText=str(target),elapsedTdbSeconds=dt,state=spice.conics(elts,dt).tolist()))
report = dict(sourceSha256=receipt['sha256'],gmSha256=gm_hash,solarGmKm3PerSecond2=mu,
              software=dict(spiceypy=spice.__version__,cspice=spice.tkvrsn('TOOLKIT')),
              generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),cases=cases,
              boundary='Real source elements; independent numerical two-body comparison only, not the JPL fitted trajectory.')
with Path(args.output).open('x',encoding='utf-8') as f:
    json.dump(report,f,indent=2,allow_nan=False)
    f.write('\n')
print(json.dumps(dict(output=args.output,cases=len(cases))))
