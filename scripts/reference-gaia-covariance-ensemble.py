"""Seeded nonlinear ERFA ensemble check of declared Gaussian formal-error models."""
import argparse
from hashlib import sha256
import json
import math
from pathlib import Path
import warnings
import erfa
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
reference_bytes = (root/'tests/fixtures/gaia-covariance-reference.json').read_bytes()
reference = json.loads(reference_bytes)
source_bytes = (root/'tests/fixtures/gaia-six-20260923/r11-d22.json').read_bytes()
assert sha256(source_bytes).hexdigest() == reference['sourceSha256']
fields = ['ra','dec','parallax','pmra','pmdec','radial_velocity']
ids = ['65212004581252736','65227054146554368','66714281062596736']
seed, count = 20260923, 32768
rng = np.random.Generator(np.random.PCG64(seed))
warnings.simplefilter('error')
masrad = math.pi/(180*3600000)
cases = []
for case in reference['cases']:
    source, year = case['source'], case['targetYearTCB']
    if source['source_id'] not in ids or year not in [1916,2116]:
        continue
    correlation = np.eye(6)
    for i in range(5):
        for j in range(i+1,5):
            correlation[i,j] = correlation[j,i] = source[fields[i]+'_'+fields[j]+'_corr']
    sigma = np.array([source[k+'_error'] for k in fields])
    covariance = correlation*np.outer(sigma,sigma)
    draws = rng.standard_normal((count,6))@np.linalg.cholesky(covariance).T
    values = np.array([source[k] for k in fields])
    samples = draws.copy()
    samples[:,0] /= 3600000*math.cos(math.radians(values[1]))
    samples[:,1] /= 3600000
    samples += values
    if np.any(samples[:,2] <= 0):
        raise ValueError('Nonpositive parallax draw; do not filter or truncate the distribution')
    a,d = np.radians(samples[:,0]),np.radians(samples[:,1])
    output = erfa.starpm(a,d,samples[:,3]*masrad/np.cos(d),samples[:,4]*masrad,samples[:,2]/1000,samples[:,5],2451545.,16*365.25,2451545.,(year-2000)*365.25)
    ra,dec,pma,pmd,px,rv = output
    # Tangent coordinate chart centered on the nominal propagated direction.
    nd = math.radians(values[1])
    nominal = erfa.starpm(math.radians(values[0]),nd,values[3]*masrad/math.cos(nd),values[4]*masrad,values[2]/1000,values[5],2451545.,16*365.25,2451545.,(year-2000)*365.25)
    observed = np.column_stack((((ra-nominal[0]+np.pi)%(2*np.pi)-np.pi)*math.cos(nominal[1])/masrad,(dec-nominal[1])/masrad,px*1000,pma*np.cos(dec)/masrad,pmd/masrad,rv))
    empirical = np.cov(observed,rowvar=False,ddof=1)
    linear = np.array(case['expected'])
    difference = float(np.max(np.abs(empirical-linear)/np.sqrt(np.outer(np.diag(linear),np.diag(linear)))))
    if difference > .05:
        raise ValueError(f'ensemble differs by {difference}; inspect rather than relax the bound')
    cases.append({'sourceId':source['source_id'],'targetYearTCB':year,'sampleCount':count,
                  'sampleCovariance':empirical.tolist(),'maxNormalizedDifference':difference})
report = {'schemaVersion':1,'sourceSha256':sha256(source_bytes).hexdigest(),
          'linearReferenceSha256':sha256(reference_bytes).hexdigest(),
          'generatorSha256':sha256(Path(__file__).read_bytes()).hexdigest(),
          'seed':seed,'randomGenerator':'numpy.PCG64','software':{'numpy':np.__version__,'pyerfa':erfa.__version__},
          'assumptions':'Gaussian formal astrometric errors, independent Gaussian spectroscopic RV error, uniform single-star motion; no draws discarded.',
          'boundary':'Six finite-sample checks only. Sampling error remains; no general coverage guarantee, unknown systematics, observed direction or occultation timing accuracy.',
          'cases':cases}
with Path(args.output).open('x',encoding='utf-8',newline='\n') as out:
    json.dump(report,out,indent=2);out.write('\n')
print(json.dumps({'output':args.output,'cases':len(cases),'samples':len(cases)*count,'maxNormalizedDifference':max(c['maxNormalizedDifference'] for c in cases)}))
