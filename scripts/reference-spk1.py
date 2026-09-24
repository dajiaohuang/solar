"""Create new Type 1 fixtures from existing dimension-15 synthetic records.

rtk proxy uv run --python 3.12 --with spiceypy==8.2.0 python scripts/reference-spk1.py
Uses CSPICE Type 1 reading/evaluation, not the project's evaluator.
Outputs are exclusive-create; no original source or fixture is replaced.
"""
import hashlib
import json
import math
from pathlib import Path
import struct

import spiceypy as spice

root = Path(__file__).resolve().parents[1]
source = root / 'tests/fixtures/spk21-synthetic.bsp'
binary = root / 'tests/fixtures/spk1-synthetic.bsp'
report = root / 'tests/fixtures/spk1-synthetic.json'
if binary.exists() or report.exists():
    raise FileExistsError('Type 1 fixture outputs must be new')
raw = source.read_bytes()
assert raw[88:96] == b'LTL-IEEE'
summary = (struct.unpack_from('<i', raw, 76)[0] - 1) * 1024
count = int(struct.unpack_from('<d', raw, summary + 16)[0])
segments = []
data = bytearray(raw[:1024]) + bytearray(2048)
struct.pack_into('<ii', data, 76, 2, 2)
for index in range(count):
    start_et, end_et, target, center, frame, kind, start, end = struct.unpack_from('<2d6i', raw, summary + 24 + index * 40)
    if kind != 21 or struct.unpack_from('<d', raw, (end - 2) * 8)[0] != 15:
        continue
    # Synthetic Type 21 maximum-order fixtures exceed Type 1 workspace bounds.
    # Retain coefficients but reduce integration-order controls for this new
    # synthetic fixture. This is never applied to an observed spacecraft file.
    words = bytearray(raw[(start - 1) * 8:(end - 2) * 8] + raw[(end - 1) * 8:end * 8])
    records = int(struct.unpack_from('<d', words, len(words) - 8)[0])
    for record in range(records):
        struct.pack_into('<d', words, (record * 71 + 67) * 8, 15)
        for axis in range(3):
            at = (record * 71 + 68 + axis) * 8
            struct.pack_into('<d', words, at, min(14, struct.unpack_from('<d', words, at)[0]))
    new_start = len(data) // 8 + 1
    data.extend(words)
    new_end = len(data) // 8
    epochs = struct.unpack_from(f'<{records}d', words, records * 71 * 8)
    segments.append(dict(target=target, center=center, frame=frame, startEt=start_et, endEt=end_et,
                         startAddress=new_start, endAddress=new_end, recordCount=records, epochs=epochs))
struct.pack_into('<3d', data, 1024, 0, 0, len(segments))
struct.pack_into('<i', data, 84, len(data) // 8 + 1)
for index, segment in enumerate(segments):
    struct.pack_into('<2d6i', data, 1048 + index * 40, segment['startEt'], segment['endEt'],
                     segment['target'], segment['center'], segment['frame'], 1, segment['startAddress'], segment['endAddress'])
    name = f'SYNTHETIC TYPE 1 RECORDS {segment["recordCount"]}'.encode().ljust(40, b' ')
    data[2048 + index * 40:2088 + index * 40] = name
data.extend(bytes((-len(data)) % 1024))
with binary.open('xb') as output:
    output.write(data)
samples = []
handle = spice.spklef(str(binary))
try:
    for segment in segments:
        times = {segment['startEt'], segment['endEt']}
        previous = segment['startEt']
        for epoch in segment['epochs']:
            times.update([epoch, math.nextafter(epoch, -math.inf), math.nextafter(epoch, math.inf), (previous + epoch) / 2])
            previous = epoch
        for et in sorted(time for time in times if segment['startEt'] <= time <= segment['endEt']):
            state, _ = spice.spkgeo(segment['target'], et, 'J2000', segment['center'])
            samples.append(dict(target=segment['target'], et=et, state=state.tolist()))
finally:
    spice.spkuef(handle)
result = dict(schemaVersion=1, purpose='Synthetic parser and interpolation evidence only; no spacecraft solution admission',
              software=dict(spiceypy=spice.__version__, cspice=spice.tkvrsn('TOOLKIT')),
              originalFixtureSha256=hashlib.sha256(raw).hexdigest(), kernelSha256=hashlib.sha256(data).hexdigest(),
              generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), segments=segments, samples=samples)
with report.open('x', encoding='utf8', newline='\n') as output:
    json.dump(result, output, indent=2, allow_nan=False)
    output.write('\n')
print(json.dumps(dict(segments=len(segments), samples=len(samples), bytes=len(data), sha256=result['kernelSha256'])))
