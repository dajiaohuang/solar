"""Independent local observer oracle; no HTTP requests or runtime dependency.

rtk proxy uv run --python 3.12 --with pyerfa==2.0.1.5 --with numpy==2.4.2 \
  --with jplephem==2.24 python scripts/verify-observer-erfa.py

Uses ERFA's C implementation and jplephem's SPK evaluation, then directly
rotates the aberrated ray into WGS84 east/north/up (does not call Atioq).
Produces a reviewable local report; --write-fixture explicitly updates the
numerical reference fixture. No changes to source SPK/IERS snapshots.
"""
import argparse
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path

import erfa
import jplephem
from jplephem.spk import SPK
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
AU_KM = 149597870.7


def state(kernel, target, jd):
    if target in (399, 301):
        p, v = kernel[0, 3].compute_and_differentiate(jd)
        pp, vv = kernel[3, target].compute_and_differentiate(jd)
        return (p+pp)/AU_KM, (v+vv)/AU_KM
    # The core's Venus center is coincident with its system barycenter.
    p, v = kernel[0, 2 if target == 299 else target].compute_and_differentiate(jd)
    return p/AU_KM, v/AU_KM


def evaluate_direction(kernel, rows, instant, station, target, *, dut1_override=None):
    lon_deg, lat_deg, height_km = station["longitudeDeg"], station["latitudeDeg"], station["heightMeters"]/1000
    lon, lat = np.deg2rad([lon_deg, lat_deg])
    utc = erfa.dtf2d("UTC", instant.year, instant.month, instant.day, instant.hour, instant.minute, instant.second+instant.microsecond/1e6)
    mjd = sum(utc)-2400000.5
    lo, hi = np.floor(mjd), np.ceil(mjd)
    def eop(start, end):
        a, b = float(rows[lo][start:end]), float(rows[hi][start:end])
        return a+(b-a)*(mjd-lo)
    xp, yp = eop(18, 27)*erfa.DAS2R, eop(37, 46)*erfa.DAS2R
    dut1, dx, dy = eop(58, 68), eop(97, 106)*erfa.DMAS2R, eop(116, 125)*erfa.DMAS2R
    if dut1_override is not None:
        if not np.isfinite(dut1_override):
            raise ValueError("DUT1 diagnostic override must be finite")
        dut1 = dut1_override
    tt = erfa.taitt(*erfa.utctai(*utc))
    ut1 = erfa.utcut1(*utc, dut1)
    xyz = erfa.gd2gc(1, lon, lat, height_km*1000)
    dtr = erfa.dtdb(*tt, (ut1[0] % 1+ut1[1] % 1+.5) % 1, lon, np.hypot(*xyz[:2])/1000, xyz[2]/1000)
    tdb = erfa.tttdb(*tt, dtr)
    jd = sum(tdb)
    ep, ev = state(kernel, 399, jd)
    sun, _ = state(kernel, 10, jd)
    x, y, _ = erfa.xys06a(*tt)
    x, y = x+dx, y+dy
    s = erfa.s06(*tt, x, y)
    a = erfa.apco(*tdb, np.array((ep, ev), dtype=erfa.dt_pv), ep-sun, x, y, s, erfa.era00(*ut1), lon, lat, height_km*1000, xp, yp, erfa.sp00(*tt), 0., 0.)
    tau = 0.
    for _ in range(16):
        tp, _ = state(kernel, target, jd-tau/86400)
        p = tp-a["eb"]
        distance = np.linalg.norm(p)
        p = p/distance
        updated = distance*erfa.AULT
        if abs(updated-tau) < 1e-9:
            break
        tau = updated
    else:
        raise RuntimeError("Independent light-time iteration did not converge")
    pnat = p
    if target != 10:
        delay = max(0, min(tau, np.dot(sun-a["eb"], p)*erfa.AULT))
        sun, _ = state(kernel, 10, jd-delay/86400)
        e, q = a["eb"]-sun, tp-sun
        em = np.linalg.norm(e)
        pnat = erfa.ld(1., p, q/np.linalg.norm(q), e/em, em, 1e-6/max(em*em, 1))
    apparent = erfa.ab(pnat, a["v"], a["em"], a["bm1"])
    rc2t = erfa.c2tcio(erfa.c2ixys(x, y, s), erfa.era00(*ut1), erfa.pom00(xp, yp, erfa.sp00(*tt)))
    terrestrial = rc2t @ apparent
    east = np.array([-np.sin(lon), np.cos(lon), 0])
    north = np.array([-np.sin(lat)*np.cos(lon), -np.sin(lat)*np.sin(lon), np.cos(lat)])
    up = np.array([np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)])
    az = np.rad2deg(np.arctan2(east @ terrestrial, north @ terrestrial)) % 360
    alt = np.rad2deg(np.arctan2(up @ terrestrial, np.hypot(east @ terrestrial, north @ terrestrial)))
    return float(az), float(alt), float(distance)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-fixture", action="store_true")
    parser.add_argument("--diagnose-horizons", action="store_true",
                        help="Compare the unchanged model with only the published Horizons DUT1 substituted")
    args = parser.parse_args()
    if args.diagnose_horizons and args.write_fixture:
        parser.error("diagnostics cannot overwrite the independent reference fixture")
    manifest = json.loads((ROOT / "src/data/ephemeris-manifest.json").read_text())
    source = next(item for item in manifest["files"] if item["id"].startswith("de440s"))
    path = ROOT / "public/data/ephemerides" / source["path"]
    assert sha256(path.read_bytes()).hexdigest() == source["sha256"]
    iers_path = ROOT / "tests/fixtures/observer-iers-sample.txt"
    iers_meta = json.loads((ROOT / "tests/fixtures/observer-iers-provenance.json").read_text())
    assert sha256(iers_path.read_bytes()).hexdigest() == iers_meta["fixtureSha256"]
    rows = {float(line[7:15]): line for line in iers_path.read_text().splitlines()}
    report = {"schemaVersion": 1, "software": {"pyerfa": erfa.__version__, "erfa": erfa.version.erfa_version, "numpy": np.__version__, "jplephem": jplephem.__version__}, "spkSha256": source["sha256"], "iersFixtureSha256": iers_meta["fixtureSha256"], "boundary": "Numerical cross-implementation reference, not a physical uncertainty estimate. Direct Horizons angular residuals are retained separately.", "cases": []}
    with SPK.open(path) as kernel:
        for name in ("moon-singapore", "venus-greenwich", "sun-singapore"):
            f = json.loads((ROOT / f"tests/fixtures/observer-{name}.json").read_text())
            assert sha256(f["rawResponse"].encode()).hexdigest() == f["responseSha256"]
            text = json.loads(f["rawResponse"])["result"]
            lon_deg, lat_deg, height_km = map(float, f["params"]["SITE_COORD"].strip("'").split(","))
            target = int(f["params"]["COMMAND"].strip("'"))
            for line in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
                cols = line.split(",")
                instant = datetime.strptime(cols[0].strip(), "%Y-%b-%d %H:%M:%S.%f")
                az, alt, distance = evaluate_direction(kernel, rows, instant, {"longitudeDeg": lon_deg, "latitudeDeg": lat_deg, "heightMeters": height_km*1000}, target)
                def sky(azimuth, altitude):
                    aa, hh = np.deg2rad([azimuth, altitude])
                    return np.array([np.cos(hh)*np.cos(aa), np.cos(hh)*np.sin(aa), np.sin(hh)])
                lhs, rhs = sky(az, alt), sky(float(cols[4]), float(cols[5]))
                separation = np.rad2deg(np.arctan2(np.linalg.norm(np.cross(lhs, rhs)), np.dot(lhs, rhs)))*3600
                report["cases"].append({"name": name, "utc": instant.isoformat()+"Z", "bodyId": f"naif:{target}", "station": {"longitudeDeg": lon_deg, "latitudeDeg": lat_deg, "heightMeters": height_km*1000}, "azimuthDeg": float(az), "altitudeDeg": float(alt), "lightTimeRangeKm": float(distance*AU_KM), "horizonsAngularResidualArcsec": float(separation), "horizonsResponseSha256": f["responseSha256"]})
                if args.diagnose_horizons:
                    station = report["cases"][-1]["station"]
                    horizons_dut1 = float(cols[9])
                    aa, hh, _ = evaluate_direction(kernel, rows, instant, station, target,
                                                   dut1_override=horizons_dut1)
                    changed = sky(aa, hh)
                    def separation_arcsec(a, b):
                        return float(np.rad2deg(np.arctan2(np.linalg.norm(np.cross(a, b)), np.dot(a, b)))*3600)
                    utc = erfa.dtf2d("UTC", instant.year, instant.month, instant.day,
                                     instant.hour, instant.minute, instant.second+instant.microsecond/1e6)
                    mjd = sum(utc)-2400000.5
                    lo, hi = np.floor(mjd), np.ceil(mjd)
                    local_dut1 = float(rows[lo][58:68])+(float(rows[hi][58:68])-float(rows[lo][58:68]))*(mjd-lo)
                    report["cases"][-1]["dut1Diagnostic"] = {
                        "iersDut1Seconds": local_dut1,
                        "horizonsPrintedDut1Seconds": horizons_dut1,
                        "horizonsPrintedResolutionSeconds": 0.00001,
                        "angularChangeArcsec": separation_arcsec(lhs, changed),
                        "remainingHorizonsResidualArcsec": separation_arcsec(changed, rhs),
                    }
    if args.diagnose_horizons:
        report["diagnosticBoundary"] = (
            "One-factor sensitivity experiment, not a runtime correction or error budget. "
            "Uses rounded Horizons UT1-UTC; preserves local SPK, pole offsets, polar motion, "
            "IAU 2006/2000A and WGS84. It cannot identify the remaining model-chain difference."
        )
    encoded = json.dumps(report, indent=2)+"\n"
    if args.write_fixture:
        (ROOT / "tests/fixtures/observer-erfa-reference.json").write_text(encoded, encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
