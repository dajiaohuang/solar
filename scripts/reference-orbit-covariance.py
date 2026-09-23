"""Independent solution-epoch coordinate/Jacobian reference, not an orbit forecast.

rtk proxy uv run --python 3.12 --with mpmath==1.3.0 --with spiceypy==8.2.0 \
  python scripts/reference-orbit-covariance.py --output .cache/orbit-covariance-reference.json

Uses 80-digit differentiation of a true-anomaly state formulation, and CSPICE
conics for a second nominal-state calculation. Never imports application code.
"""
import argparse
import hashlib
import json
from pathlib import Path

import mpmath as mp
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
AU_KM, DAY_SECONDS = 149597870.7, 86400.0
GM = 132712440041.27942 * DAY_SECONDS**2 / AU_KM**3
LABELS = ["e", "q", "tp", "node", "peri", "i"]
ELEMENT_NAMES = ["e", "q", "tp", "om", "w", "i"]
mp.mp.dps = 80


def state(parameters, epoch, gm):
    e, q, tp, node, peri, inc = parameters[:6]
    a = q / (1 - e)
    mean = mp.sqrt(gm / a**3) * (epoch - tp)
    eccentric = mp.findroot(lambda u: u - e * mp.sin(u) - mean,
                            mean + mp.sign(mean) * e,
                            df=lambda u: 1 - e * mp.cos(u), solver="newton", maxsteps=120)
    true = 2 * mp.atan2(mp.sqrt(1 + e) * mp.sin(eccentric / 2),
                        mp.sqrt(1 - e) * mp.cos(eccentric / 2))
    semilatus = q * (1 + e)
    radius = semilatus / (1 + e * mp.cos(true))
    speed = mp.sqrt(gm / semilatus)
    position = mp.matrix([radius * mp.cos(true), radius * mp.sin(true), 0])
    velocity = mp.matrix([-speed * mp.sin(true), speed * (e + mp.cos(true)), 0])

    def rz(degrees):
        angle = degrees * mp.pi / 180
        c, s = mp.cos(angle), mp.sin(angle)
        return mp.matrix([[c, -s, 0], [s, c, 0], [0, 0, 1]])

    angle = inc * mp.pi / 180
    rotation = rz(node) * mp.matrix([[1, 0, 0], [0, mp.cos(angle), -mp.sin(angle)],
                                   [0, mp.sin(angle), mp.cos(angle)]]) * rz(peri)
    return list(rotation * position) + list(rotation * velocity) + list(parameters[6:])


def reference(case):
    # Float64 inputs are intentional: this isolates application arithmetic
    # from the separate decimal-source -> Float64 input-rounding boundary.
    values = list(map(mp.mpf, case["nominal"]))
    epoch, gm = mp.mpf(case["epochTdb"]), mp.mpf(GM)
    count = len(values)
    nominal = state(values, epoch, gm)
    jacobian = mp.matrix(count, count)
    for row in range(count):
        for column in range(count):
            def component(value):
                sample = values.copy()
                sample[column] = value
                return state(sample, epoch, gm)[row]
            jacobian[row, column] = mp.diff(component, values[column])
    matrix = jacobian * mp.matrix(case["matrix"]) * jacobian.T
    e, q, tp, node, peri, inc = case["nominal"][:6]
    elements = [q * AU_KM, e, inc * float(mp.pi / 180), node * float(mp.pi / 180),
                peri * float(mp.pi / 180), 0, 0, GM * AU_KM**3 / DAY_SECONDS**2]
    conic = spice.conics(elements, (case["epochTdb"] - tp) * DAY_SECONDS)
    conic = [float(v / AU_KM * (DAY_SECONDS if i >= 3 else 1)) for i, v in enumerate(conic)]
    return {**case, "referenceNominal": list(map(float, nominal)),
            "referenceJacobian": [[float(v) for v in row] for row in jacobian.tolist()],
            "referenceMatrix": [[float(v) for v in row] for row in matrix.tolist()],
            "cspiceNominal": conic}


def source_case(name):
    path = ROOT / "tests" / "fixtures" / f"sbdb-{name}-covariance.json"
    raw = path.read_bytes()
    payload = json.loads(raw)
    orbit, cov = payload["orbit"], payload["orbit"]["covariance"]
    elements = {e["name"]: e for e in cov.get("elements", orbit["elements"])}
    models = {p["name"]: p for p in orbit["model_pars"]}
    assert cov["labels"][:6] == LABELS
    nominal = [float(elements[key]["value"]) for key in ELEMENT_NAMES]
    nominal += [float(models[key]["value"]) for key in cov["labels"][6:]]
    return {"name": name, "sourcePath": str(path.relative_to(ROOT)).replace("\\", "/"),
            "sourceSha256": hashlib.sha256(raw).hexdigest(), "epochTdb": float(cov["epoch"]),
            "labels": cov["labels"], "nominal": nominal,
            "matrix": [[float(value) for value in row] for row in cov["data"]]}


def synthetic_case(name, e, q, elapsed, node, peri, inc):
    sigmas = [1e-9, 2e-9, 3e-6, 4e-6, 5e-6, 6e-6]
    matrix = [[sigmas[i] * sigmas[j] * (1 if i == j else .1) for j in range(6)] for i in range(6)]
    return {"name": name, "epochTdb": 2451545.0, "labels": LABELS,
            "nominal": [e, q, 2451545.0 - elapsed, node, peri, inc], "matrix": matrix}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    output = Path(parser.parse_args().output)
    if output.exists():
        raise FileExistsError("Choose a new immutable reference output path")
    cases = [source_case("eros"), source_case("bennu")]
    cases += [synthetic_case(*values) for values in [
        ("circular-equatorial", 0, 1, 0, 0, 0, 0),
        ("circular-retrograde", 0, 1, 35, 320, 20, 180),
        ("eccentric-perihelion", .9999, .05, 0, 120, 35, 89),
        ("eccentric-inbound", .99, .1, -5, 320, 175, 60),
        ("eccentric-outbound", .99, .1, 5, 320, 175, 60),
        ("many-revolutions", .6, .8, 12000, 359.9, .1, 170),
        ("reverse-revolutions", .6, .8, -12000, .1, 359.9, .001),
        ("distant-orbit", .4, 80, 1000, 60, 130, 50),
    ]]
    report = {"schemaVersion": 1, "software": {"mpmath": mp.__version__, "decimalDigits": mp.mp.dps,
              "spiceypy": spice.__version__, "cspice": spice.tkvrsn("TOOLKIT")},
              "adoptedSolarGM": {"au3PerDay2": GM, "source": "Conditional DE440 solar GM from the repository-pinned gm_de440.tpc; not asserted to reproduce the SBDB fit model"},
              "gmFileSha256": hashlib.sha256((ROOT / "src/data/gm_de440.tpc").read_bytes()).hexdigest(),
              "boundary": "Independent coordinate/Jacobian arithmetic only; no temporal covariance propagation or physical accuracy inference.",
              "cases": [reference(case) for case in cases]}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write("\n")
    print(json.dumps({"output": str(output), "cases": len(cases), "software": report["software"]}))


if __name__ == "__main__":
    main()
