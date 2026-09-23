"""Independent five-point ERFA covariance oracle; original Gaia bytes, exclusive output."""
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
path = Path(__file__).resolve().parent.parent/'tests/fixtures/gaia-six-20260923/r11-d22.json'
raw = path.read_bytes()
manifest = json.loads((path.parent/'manifest.json').read_text())
assert sha256(raw).hexdigest() == manifest['chunks'][0]['sha256']
fields = ['ra', 'dec', 'parallax', 'pmra', 'pmdec', 'radial_velocity']
warnings.simplefilter('error')
masrad = math.pi / (180 * 3600000)

def propagate(values, year):
    # Entirely TCB-compatible ERFA evaluation, independent of Go's TDB scaling.
    a, d, px, pma, pmd, rv = values
    a, d = math.radians(a), math.radians(d)
    output = erfa.starpm(a, d, pma*masrad/math.cos(d), pmd*masrad, px/1000, rv,
                         2451545., 16*365.25, 2451545., (year-2000)*365.25)
    ra, dec, pmra, pmdec, parallax, velocity = map(float, output)
    return np.array([math.degrees(ra), math.degrees(dec), parallax*1000,
                     pmra*math.cos(dec)/masrad, pmdec/masrad, velocity])

cases = []
for source in json.loads(raw)['sources']:
    if any(source[k] is None or source[k+'_error'] is None for k in fields):
        continue
    if source['parallax'] <= 0:
        continue
    sigma = np.array([source[k+'_error'] for k in fields])
    correlation = np.eye(6)
    for i in range(5):
        for j in range(i+1, 5):
            correlation[i,j] = correlation[j,i] = source[fields[i]+'_'+fields[j]+'_corr']
    np.linalg.cholesky(correlation)
    covariance = correlation * np.outer(sigma, sigma)
    values = np.array([source[k] for k in fields])
    steps = .01*np.maximum(np.abs(values), sigma)
    steps[:2] = 100
    for year in [1916, 2016, 2026, 2116]:
        nominal = propagate(values, year)
        matrices = []
        for factor in [1, .5]:
            jacobian = np.zeros((6,6))
            for axis in range(6):
                outputs = []
                step = steps[axis]*factor
                for multiplier in [-2,-1,1,2]:
                    shifted = values.copy()
                    offset = step*multiplier
                    if axis == 0:
                        shifted[0] = (shifted[0]+offset/(3600000*math.cos(math.radians(values[1])))) % 360
                    elif axis == 1:
                        shifted[1] += offset/3600000
                    else:
                        shifted[axis] += offset
                    output = propagate(shifted, year)-nominal
                    output[0] = math.remainder(output[0],360)*3600000*math.cos(math.radians(nominal[1]))
                    output[1] *= 3600000
                    outputs.append(output)
                jacobian[:,axis] = (outputs[0]-8*outputs[1]+8*outputs[2]-outputs[3])/(12*step)
            matrices.append(jacobian@covariance@jacobian.T)
        scale = np.sqrt(np.outer(np.diag(matrices[1]),np.diag(matrices[1])))
        difference = float(np.max(np.abs(matrices[0]-matrices[1])/scale))
        if difference >= 5e-5:
            raise ValueError(f'oracle step convergence failed {source["source_id"]} {year}: {difference}')
        cases.append({'source':source, 'targetYearTCB':year, 'expected':matrices[1].tolist(),
                      'oracleScaledStepDifference':difference})
report = {'schemaVersion':1, 'sourceSha256':sha256(raw).hexdigest(),
          'generatorSha256':sha256(Path(__file__).read_bytes()).hexdigest(),
          'software':{'pyerfa':erfa.__version__, 'erfa':erfa.version.erfa_version, 'numpy':np.__version__},
          'coordinates':['delta-alpha*cos(delta)', 'delta-dec', 'parallax', 'pmra', 'pmdec', 'radial-velocity'],
          'units':['mas','mas','mas','mas/Julian-year','mas/Julian-year','km/s'],
          'method':'Five-point derivative at two independent step sizes, entirely TCB-compatible ERFA evaluation.',
          'boundary':'First-order covariance under adopted independent RV errors; not nonlinear coverage, astrophysical calibration or physical trajectory accuracy.',
          'cases':cases}
with Path(args.output).open('x',encoding='utf-8',newline='\n') as out:
    json.dump(report,out,indent=2); out.write('\n')
print(json.dumps({'output':args.output,'cases':len(cases),'maxOracleScaledStepDifference':max(c['oracleScaledStepDifference'] for c in cases)}))
