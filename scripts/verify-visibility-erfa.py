"""Independent ERFA/jplephem visibility reference; never contacts a service.

uv run --python 3.12 --with pyerfa==2.0.1.5 --with numpy==2.4.2 \
  --with jplephem==2.24 python scripts/verify-visibility-erfa.py [--write-fixture]

Uses a separate 120-second grid and 0.001-second root brackets, direct ITRS
east/north/up directions, the pinned original DE440 and IERS excerpt. The
reference is numerical validation of this model, not a physical error bound.
Only modern UTC dates without leap transitions are used by this oracle;
the Go time-axis tests separately exercise leap seconds and a 86401-second day.
"""
import argparse
from datetime import datetime, timedelta
from hashlib import sha256
import importlib.util
import json
from pathlib import Path

import erfa
import jplephem
from jplephem.spk import SPK
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("observer_oracle", ROOT / "scripts/verify-observer-erfa.py")
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-fixture", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "src/data/ephemeris-manifest.json").read_text())
    source = next(item for item in manifest["files"] if item["id"].startswith("de440s"))
    path = ROOT / "public/data/ephemerides" / source["path"]
    assert sha256(path.read_bytes()).hexdigest() == source["sha256"]
    iers_path = ROOT / "tests/fixtures/observer-iers-sample.txt"
    iers_meta = json.loads((ROOT / "tests/fixtures/observer-iers-provenance.json").read_text())
    assert sha256(iers_path.read_bytes()).hexdigest() == iers_meta["fixtureSha256"]
    rows = {float(line[7:15]): line for line in iers_path.read_text().splitlines()}
    singapore = {"longitudeDeg": 103.851959, "latitudeDeg": 1.29027, "heightMeters": 0}
    cases = [
        ("sun-singapore", 10, singapore, 0, None),
        ("moon-singapore-darkness", 301, singapore, 10, -6),
        ("venus-greenwich", 299, {"longitudeDeg": 0, "latitudeDeg": 51.4779, "heightMeters": 46}, 5, None),
        ("sun-arctic-below-threshold", 10, {"longitudeDeg": 0, "latitudeDeg": 80, "heightMeters": 0}, 20, None),
        ("sun-contradictory-constraints", 10, singapore, 0, -6),
    ]
    report = {"schemaVersion": 1, "software": {"pyerfa": erfa.__version__, "erfa": erfa.version.erfa_version, "numpy": np.__version__, "jplephem": jplephem.__version__}, "spkSha256": source["sha256"], "iersFixtureSha256": iers_meta["fixtureSha256"], "stepSeconds": 120, "boundaryToleranceSeconds": .001, "boundary": "Independent numerical reference for airless centers; not physical uncertainty or a proof of search completeness.", "cases": []}
    with SPK.open(path) as kernel:
        for name, target, station, minimum, sun_max in cases:
            start = datetime(2026, 9, 23)
            cache = {}

            def altitude(t, body):
                key = (t, body)
                if key not in cache:
                    cache[key] = oracle.evaluate_direction(kernel, rows, start+timedelta(seconds=t), station, body)[1]
                return cache[key]

            crossings = []
            constraints = [(lambda t: altitude(t, target)-minimum, "rise", "set")]
            if sun_max is not None:
                constraints.append((lambda t: sun_max-altitude(t, 10), "darkness-begins", "darkness-ends"))
            for value, enter, leave in constraints:
                previous = value(0)
                for hi in range(120, 86401, 120):
                    current = value(hi)
                    if (previous >= 0) != (current >= 0):
                        a, b = hi-120., float(hi)
                        while b-a > .001:
                            mid = (a+b)/2
                            if (value(mid) >= 0) == (previous >= 0):
                                a = mid
                            else:
                                b = mid
                        crossings.append({"kind": enter if current >= 0 else leave, "seconds": (a+b)/2})
                    previous = current
            crossings.sort(key=lambda row: row["seconds"])
            cuts = [0]+[row["seconds"] for row in crossings]+[86400]
            windows = []
            for a, b in zip(cuts[:-1], cuts[1:]):
                if all(value((a+b)/2) >= 0 for value, _, _ in constraints):
                    windows.append({"startSeconds": a, "endSeconds": b})
            request = {"startUtc": "2026-09-23T00:00:00Z", "endUtc": "2026-09-24T00:00:00Z", "station": station, "bodyId": f"naif:{target}", "minAltitudeDeg": minimum}
            if sun_max is not None:
                request["maxSunAltitudeDeg"] = sun_max
            report["cases"].append({"name": name, "request": request, "crossings": crossings, "windows": windows})
    encoded = json.dumps(report, indent=2)+"\n"
    if args.write_fixture:
        (ROOT / "tests/fixtures/visibility-erfa-reference.json").write_text(encoded, encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
