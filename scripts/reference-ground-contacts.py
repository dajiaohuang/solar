"""Independent ERFA/jplephem CN sphere contacts for Dallas, 2024-04-08.

rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 --with numpy==2.4.2 \
  --with jplephem==2.24 python scripts/reference-ground-contacts.py --output <new.json>
"""
import argparse
from datetime import datetime, timedelta
from hashlib import sha256
import importlib.util
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("oracle", ROOT / "scripts/verify-observer-erfa.py")
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    baseline = json.loads((ROOT / "tests/fixtures/observer-erfa-reference.json").read_text())
    manifest = json.loads((ROOT / "src/data/ephemeris-manifest.json").read_text())
    source = next(row for row in manifest["files"] if row["sha256"] == baseline["spkSha256"])
    spk = ROOT / "public/data/ephemerides" / source["path"]
    iers = ROOT / "tests/fixtures/eclipse-iers-sample.txt"
    provenance = json.loads((ROOT / "tests/fixtures/eclipse-iers-provenance.json").read_text())
    assert sha256(spk.read_bytes()).hexdigest() == source["sha256"]
    assert sha256(iers.read_bytes()).hexdigest() == provenance["fixtureSha256"]
    radii_path = ROOT / "tests/fixtures/pck-radii-reference.json"
    radii = json.loads(radii_path.read_text())
    assert sha256((ROOT / "src/data/pck00011.tpc").read_bytes()).hexdigest() == radii["sourceSha256"]
    axes = {r["naifPckId"]: r["radiiKm"] for r in radii["bodies"]}
    assert len(set(axes[301])) == 1 and len(set(axes[10])) == 1
    rows = {float(line[7:15]): line for line in iers.read_text().splitlines()}
    start = datetime(2024, 4, 8, 17)
    request = {"startUtc": "2024-04-08T17:00:00Z", "endUtc": "2024-04-08T21:00:00Z",
               "station": {"longitudeDeg": -96.797, "latitudeDeg": 32.7767, "heightMeters": 130},
               "foregroundId": 301, "backgroundId": 10, "aberration": "CN"}
    cache = {}
    with oracle.SPK.open(spk) as kernel:
        def gaps(seconds):
            if seconds not in cache:
                vectors = []
                for target in [301, 10]:
                    detail = {}
                    oracle.evaluate_direction(kernel, rows, start+timedelta(seconds=seconds), request["station"], target, vectors=detail)
                    vectors.append(np.array(detail["receptionPositionKm"]))
                a, b = vectors
                da, db = np.linalg.norm(a), np.linalg.norm(b)
                assert da+axes[301][0] < db-axes[10][0]
                aa, ab = np.arcsin(axes[301][0]/da), np.arcsin(axes[10][0]/db)
                a, b = a/da, b/db
                separation = np.arctan2(np.linalg.norm(np.cross(a,b)), np.dot(a,b))
                cache[seconds] = [float(separation-aa-ab), float(separation-abs(aa-ab))]
            return cache[seconds]
        contacts = []
        for lo in range(0, 14400, 60):
            hi = lo+60
            for k, name in enumerate(["external", "internal"]):
                a, b = gaps(lo)[k], gaps(hi)[k]
                if (a < 0) == (b < 0):
                    continue
                left, right = lo, hi
                while right-left > 0.001:
                    middle = (left+right)/2
                    if (gaps(middle)[k] < 0) == (a < 0): left = middle
                    else: right = middle
                at = (left+right)/2
                contacts.append({"boundary": name, "direction": "enter" if a > 0 else "exit", "elapsedTaiSeconds": at,
                                 "utc": (start+timedelta(seconds=at)).isoformat()+"Z", "bracketSeconds": [left,right]})
        contacts.sort(key=lambda c: c["elapsedTaiSeconds"])
        assert len(contacts) == 4
    paths = [spk, iers, radii_path, ROOT / "src/data/pck00011.tpc", ROOT / "scripts/verify-observer-erfa.py", Path(__file__)]
    report = {"schemaVersion": 1, "request": request, "contacts": contacts, "evaluations": len(cache),
              "software": baseline["software"], "stepSeconds": 60, "toleranceSeconds": 0.001,
              "sources": [{"path": str(p.relative_to(ROOT)).replace('\\','/'), "sha256": sha256(p.read_bytes()).hexdigest()} for p in paths],
              "boundary": "Independent numerical CN spherical-limb model, not observed eclipse timings, limb topography or physical timing uncertainty. This UTC interval has no leap second; elapsed UTC seconds equal elapsed TAI seconds."}
    with Path(args.output).open("x", encoding="utf-8", newline="\n") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps({"contacts": contacts, "evaluations": len(cache)}))


if __name__ == "__main__":
    main()
