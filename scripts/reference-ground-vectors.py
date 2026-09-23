"""Independent ERFA station/ray reference; writes only an explicitly new file.

rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 --with numpy==2.4.2 \
  --with jplephem==2.24 python scripts/reference-ground-vectors.py --output <new.json>
"""
import argparse
from datetime import datetime
from hashlib import sha256
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("observer_reference", ROOT / "scripts/verify-observer-erfa.py")
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    baseline_path = ROOT / "tests/fixtures/observer-erfa-reference.json"
    baseline = json.loads(baseline_path.read_text())
    manifest = json.loads((ROOT / "src/data/ephemeris-manifest.json").read_text())
    source = next(row for row in manifest["files"] if row["sha256"] == baseline["spkSha256"])
    spk = ROOT / "public/data/ephemerides" / source["path"]
    iers = ROOT / "tests/fixtures/observer-iers-sample.txt"
    assert sha256(spk.read_bytes()).hexdigest() == baseline["spkSha256"]
    assert sha256(iers.read_bytes()).hexdigest() == baseline["iersFixtureSha256"]
    paths = [spk, iers, baseline_path, ROOT / "scripts/verify-observer-erfa.py", Path(__file__)]
    report = {"schemaVersion": 1, "frame": "J2000", "observerOrigin": "solar-system-barycenter",
              "vectorOrigin": "observer-at-reception", "positionUnit": "km", "velocityUnit": "km/s",
              "software": baseline["software"],
              "boundary": "Numerical model comparison, not physical accuracy. Separate ERFA terrestrial PV rotation and original SPK Earth translation; no station tectonics/tides or exact relativistic terrestrial/BCRS transform.",
              "sources": [{"path": str(path.relative_to(ROOT)).replace('\\', '/'), "sha256": sha256(path.read_bytes()).hexdigest()} for path in paths], "cases": []}
    rows = {float(line[7:15]): line for line in iers.read_text().splitlines()}
    with oracle.SPK.open(spk) as kernel:
        for case in baseline["cases"]:
            vectors = {}
            oracle.evaluate_direction(kernel, rows, datetime.fromisoformat(case["utc"].rstrip("Z")),
                                      case["station"], int(case["bodyId"].split(":")[1]), vectors=vectors)
            report["cases"].append({"utc": case["utc"], "station": case["station"], "bodyId": case["bodyId"], **vectors})
    with Path(args.output).open("x", encoding="utf-8", newline="\n") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps({"output": args.output, "cases": len(report["cases"])}))


if __name__ == "__main__":
    main()
