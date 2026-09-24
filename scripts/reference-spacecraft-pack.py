"""Compare archived originals with prepared spacecraft pools using CSPICE.

uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-spacecraft-pack.py PACK NEW_REPORT
This is numerical equivalence evidence, not orbit accuracy or source admission.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import spiceypy as spice

pack, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
if output.exists():
    raise FileExistsError(output)
manifest_bytes = (pack / 'prepared-manifest.json').read_bytes()
manifest = json.loads(manifest_bytes)
start, end = (manifest['requestedWindow'][key] for key in ['startEt', 'endEt'])


def verified(relative, digest):
    path = (pack / relative).resolve()
    if not path.is_relative_to(pack):
        raise ValueError('Source path escapes pack')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f'Source hash mismatch: {relative}')
    return path, data


def boundaries(data):
    order = '<' if data[88:96] == b'LTL-IEEE' else '>'
    record = struct.unpack_from(order + 'i', data, 76)[0]
    times, visited = {start, end}, set()
    while record:
        if record in visited:
            raise ValueError('Cyclic summary chain')
        visited.add(record)
        offset = (record - 1) * 1024
        following, _, count = struct.unpack_from(order + '3d', data, offset)
        for index in range(int(count)):
            first, last, _, _, _, kind, begin, finish = struct.unpack_from(order + '2d6i', data, offset + 24 + index * 40)
            edges = [first, last]
            if kind == 1:
                size = int(struct.unpack_from(order + 'd', data, (finish - 1) * 8)[0])
                edges += list(struct.unpack_from(order + f'{size}d', data, (begin - 1 + size * 71) * 8))
            elif kind in [2, 3]:
                initial, interval, _, size = struct.unpack_from(order + '4d', data, (finish - 4) * 8)
                edges += [initial + i * interval for i in range(int(size) + 1)]
            else:
                raise ValueError(f'Unsupported prepared type {kind}')
            edges = sorted(set(edges))
            for edge in edges:
                times.update([edge, math.nextafter(edge, -math.inf), math.nextafter(edge, math.inf)])
            times.update((a + b) / 2 for a, b in zip(edges, edges[1:]))
        record = int(following)
    return sorted(time for time in times if start <= time <= end)


results = []
for source in manifest['sources']:
    original, _ = verified(source['originalPath'], source['sha256'])
    files = [entry for entry in manifest['files'] if entry['sourceIdentity']['sha256'] == source['sha256']]
    paths, times = [], {start, end}
    for entry in files:
        path, data = verified(entry['path'], entry['sha256'])
        paths.append(path)
        times.update(boundaries(data))
    times = sorted(times)
    spice.kclear()
    spice.furnsh(str(original))
    expected = [spice.spkgeo(source['target'], et, 'J2000', 0)[0].tolist() for et in times]
    spice.kclear()
    # The manifest orders explicit dependencies before the spacecraft root.
    for path in paths:
        spice.furnsh(str(path))
    maximum = [0.0] * 6
    for et, state in zip(times, expected):
        actual = spice.spkgeo(source['target'], et, 'J2000', 0)[0]
        maximum = [max(prior, abs(float(a) - b)) for prior, a, b in zip(maximum, actual, state)]
    spice.kclear()
    if any(value != 0 for value in maximum):
        raise ValueError(f'Original/crop states differ: {source["id"]}: {maximum}')
    results.append(dict(id=source['id'], target=source['target'], sourceSha256=source['sha256'],
                        maximumComponentDifference=maximum, samples=[dict(et=et, state=state) for et, state in zip(times, expected)]))
report = dict(schemaVersion=1, frame='J2000', origin='SSB', aberration='NONE',
              software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
              manifestSha256=hashlib.sha256(manifest_bytes).hexdigest(),
              generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), sources=results,
              limitation='Sampled original/crop equivalence only; not a physical accuracy bound or production admission.')
with output.open('x', encoding='utf8', newline='\n') as handle:
    json.dump(report, handle, indent=2, allow_nan=False)
    handle.write('\n')
print(json.dumps([dict(id=result['id'], samples=len(result['samples']), maximumComponentDifference=result['maximumComponentDifference']) for result in results]))
