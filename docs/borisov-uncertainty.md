# 2I/Borisov mapped state uncertainty

The evidence workspace includes 147 fixed JPL Horizons vector epochs for
Borisov (C/2019 Q4), from 2019-01-01 through 2030-12-29 TDB at a 30-day step.
Each record contains a geometric heliocentric ECLIPJ2000 state in AU and AU/day
and JPL Horizons formal statistical one-sigma state components in instantaneous
RTN coordinates. The frozen request omits `VEC_CORR`; the API default is `NONE`
(geometric state). The selected Horizons solution is JPL #54 (record 90004568), with
964 observations from 2019-02-24 through 2020-09-30. Horizons identifies the
planetary and small-perturber ephemerides as DE441 and SB441-N16.

The immutable API response is
`tests/fixtures/horizons-borisov-uncertainty-20260929/response.json`; its
retrieval time, request, byte count and SHA-256 are in the adjacent
`receipt.json`. `scripts/build-horizons-borisov-uncertainty.mjs` deterministically
normalizes those rows and the pinned SBDB nominal-fit reconciliation into
`src/data/borisovHorizonsUncertainty.json` without interpolation. A new service
snapshot must use a new dated fixture directory; do not replace this captured
response.

The SBDB API also identifies solution 54, and its full-precision `cov=mat` response is pinned at
`tests/fixtures/sbdb-borisov-covariance-20260929/c9024403ab74ad1863cca2d1b481ac1976c4f6954c0515f99320949c46d60987.json`
(SHA-256 `c9024403ab74ad1863cca2d1b481ac1976c4f6954c0515f99320949c46d60987`).
It contains the joint ten-axis covariance at JD 2458853.5 TDB and is available
from the Orbit Uncertainty panel. The browser displays the source matrix and
solution-epoch coordinate conversion, while temporal propagation refuses this
source because A1/A2/A3/DT force derivatives are not implemented.

The pinned Horizons header and SBDB response do not report bit-identical nominal
fit values for every axis. Their ten values reconcile within the corresponding
SBDB formal marginal sigmas; the largest normalized difference is about
`2.91e-7 σ` (A1). This is a source-snapshot consistency check, not proof that
Horizons mapped the covariance from this exact SBDB byte snapshot and not a
bound on systematic or model error. The original values, covariance and hashes
remain separate and auditable.

The matching Horizons SPK is integrated into the Pages and full manifests as
`horizons-comet-borisov-2026-01-01-2027-01-01` and
`horizons-comet-borisov-2019-01-01-2031-01-01`. Its source records retain the
same solution identity and fitted parameters; they do not encode its SBDB
covariance.

The original 292,864-byte Horizons SPK is durably retained at
`tests/fixtures/horizons-borisov-spk-20260929/original.bsp`, with the full
query, source solution text, retrieval time and source-response hash in the
adjacent `receipt.json`. Its binary SHA-256 is
`8e2931d03595c01ab5c50d9d268376ee0024ebf881846dc1def6f2c1559e1705`; the
integration script consumes this pinned fixture and does not depend on the
ignored acquisition cache.

The reported values are marginal standard deviations at sampled epochs. This
vector format does not provide cross-axis or cross-epoch covariance, so the
data cannot support a confidence ellipsoid, continuous uncertainty tube, or
event probability. The fitted non-gravitational model is represented in the
Horizons trajectory, but the plotted marginal values do not estimate every
model error. SPK interpolation fidelity and a smooth displayed curve must not
be interpreted as physical orbit accuracy.

The fetcher is a source capture operation and the normalizer is an offline data
generator. Neither runs tests or builds the application.
