"""Independent ERFA TCB/TDB oracle; explicit exclusive output, no external kernels."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import erfa

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True)
args = parser.parse_args()
cases = []
for day, fraction in [(2443144, .5003725), (2451545, 0), (2457389, 0),
                      (2461041, .123456789012345), (2457389, .999999999999),
                      (2400000, .000000000001), (2500000, .999999999999)]:
    for name in ['tcbtdb', 'tdbtcb']:
        a, b = getattr(erfa, name)(float(day), fraction)
        cases.append({'direction': name, 'input': {'day': day, 'fraction': fraction},
                      'expectedParts': [float(a), float(b)]})
report = {'schemaVersion': 1, 'software': {'pyerfa': erfa.__version__, 'erfa': erfa.version.erfa_version},
          'generatorSha256': sha256(Path(__file__).read_bytes()).hexdigest(),
          'source': 'https://www.iau.org/static/resolutions/IAU2006_Resol3.pdf',
          'boundary': 'Time-coordinate conversion only, not astrometric parameter scaling or stellar propagation.',
          'cases': cases}
with Path(args.output).open('x', encoding='utf-8', newline='\n') as out:
    json.dump(report, out, indent=2)
    out.write('\n')
print(json.dumps({'output': args.output, 'cases': len(cases)}))
