"""Independent ERFA single-star propagation oracle; exclusive output file."""
import argparse
from hashlib import sha256
import json
import math
from pathlib import Path
import warnings
import erfa

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
path = root/'tests/fixtures/gaia-six-20260923/r11-d22.json'
raw = path.read_bytes()
manifest = json.loads((path.parent/'manifest.json').read_text())
assert sha256(raw).hexdigest() == manifest['chunks'][0]['sha256']
rows = json.loads(raw)['sources']
f = 1-1.550519768e-8
masrad = math.pi/(180*3600*1000)
cases = []
warnings.simplefilter('error')
for source in rows:
    if source['parallax'] is None or source['parallax'] <= 0 or any(source[k] is None for k in ['pmra','pmdec','radial_velocity']):
        continue
    a, d = math.radians(source['ra']), math.radians(source['dec'])
    pmr, pmd, px = source['pmra']*masrad/math.cos(d), source['pmdec']*masrad, source['parallax']/1000
    for year in [1916, 2016, 2026, 2116]:
        t1 = erfa.tcbtdb(2451545., (2016-2000)*365.25)
        t2 = erfa.tcbtdb(2451545., (year-2000)*365.25)
        result = erfa.starpm(a,d,pmr/f,pmd/f,px/f,source['radial_velocity'],*t1,*t2)
        ar, dr, pr, pd, par, rv = [float(v) for v in result]
        state = [math.degrees(ar),math.degrees(dr),par*1000*f,pr*f*math.cos(dr)/masrad,pd*f/masrad,rv]
        # Independent convention check: the numerical uniform-motion model
        # evaluated wholly in TCB must be invariant under joint time/length scaling.
        direct = erfa.starpm(a,d,pmr,pmd,px,source['radial_velocity'],2451545.,16*365.25,2451545.,(year-2000)*365.25)
        da, dd, dpr, dpd, dpx, drv = [float(v) for v in direct]
        direct_state = [math.degrees(da),math.degrees(dd),dpx*1000,dpr*math.cos(dd)/masrad,dpd/masrad,drv]
        assert all(abs(x-y) < 2e-9 for x,y in zip(state,direct_state))
        cases.append({'source':source,'targetYearTCB':year,'expected':state,'directTCB':direct_state})
report = {'schemaVersion':1,'sourceSha256':sha256(raw).hexdigest(),
          'generatorSha256':sha256(Path(__file__).read_bytes()).hexdigest(),
          'software':{'pyerfa':erfa.__version__,'erfa':erfa.version.erfa_version},
          'order':['raDeg','decDeg','parallaxMas','pmraMasPerJulianYear','pmdecMasPerJulianYear','radialVelocityKmPerSecond'],
          'boundary':'Numerical single-star-model oracle and coordinate-scaling invariance, not physical trajectory accuracy or RV calibration.',
          'cases':cases}
with Path(args.output).open('x',encoding='utf-8',newline='\n') as out:
    json.dump(report,out,indent=2); out.write('\n')
print(json.dumps({'output':args.output,'cases':len(cases)}))
