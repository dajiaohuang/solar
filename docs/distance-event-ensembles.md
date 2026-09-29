# Conditional distance-event ensembles

Implementation is present but unverified. Do not treat this document as numerical
acceptance or performance evidence. Execution remains deferred under the owner's
current instruction to finish implementation before testing.

The covariance panel's **Distance-threshold events across orbit samples** section
draws six-parameter Gaussian offsets from the submitted SBDB covariance and
searches each valid trajectory for geometric distance-threshold crossings. The
target is a prescribed DE440 force-body center. A system barycenter is not a
planetary surface. The threshold is not an adopted body radius and the search is
not collision, occultation or apparent-contact analysis.

## Offline entry point

`scripts/search-sbdb-events.mjs` reads only local files. It requires the pinned
DE440 kernel already present under `public/data/ephemerides`, the repository GM
file, an SBDB JSON source, and a settings JSON file. It performs no download,
deployment or data-release publication. The output must be a new file; the shared
scientific receipt writer rejects an existing destination.

Example settings (not a prediction or a validated reference case):

```json
{
  "durationSeconds": 86400,
  "exclusionKm": 1,
  "sampleCount": 8,
  "seed": 20260923,
  "solarRelativity": false,
  "eventSearch": {
    "targetNaifId": 399,
    "distanceKm": 1000000,
    "maxStepSeconds": 3600,
    "toleranceSeconds": 1,
    "maxEvaluations": 256,
    "maxEvents": 32
  }
}
```

Invocation for later use, **not executed as part of implementation**:

```text
node --experimental-strip-types scripts/search-sbdb-events.mjs <sbdb.json> <settings.json> <new-output.json> --adopt-conditional-de440-model
```

The CLI requires explicit conditional-model adoption and handles Ctrl+C through
an abort signal. It shares the browser request validator, engine and typed receipt
checker. The browser also imposes its existing 300-second Worker deadline; the
offline entry point uses cooperative cancellation and computational budgets,
without claiming that browser wall-time limit.

## Interpreting results

- `searched`: the bounded sampled search finished. An empty event list means no
  crossing was detected, not proof that no event occurred.
- `failed`: a known coordinate or trajectory-specific failure, with the original
  draw index and reason preserved.
- `unresolved`: a search/result/force budget was insufficient. These draws must
  not be counted as event-free. After shared force exhaustion, valid remaining
  draws retain unsearched status; invalid initial draws retain their failures.

An unresolved draw has `stage: search` when a started search exhausted a budget,
or `stage: not-started` when the shared force budget had already been exhausted.
The latter must report zero force calls. Receipt validation checks cumulative
force calls in draw order: force exhaustion must coincide with the shared limit,
and no searched or integration-failed draw may start after that limit. This is
receipt consistency, not an independent measurement of executed derivatives.

Started budget interruptions retain `searchProgress`: attempted and completed
scalar evaluations, the count of already localized records, and the last
attempted elapsed TDB time. Unstarted draws have null progress. The receiver
requires the relevant evaluation/result cap to be reached; a force-budget
interruption has one attempted scalar evaluation that did not complete. These
diagnostics are not a partial successful event list, a covered-time interval or
a basis for timing statistics. Refinement can revisit earlier times, so the last
attempt is not necessarily a completed scan frontier.

A `failed` draw with `stage: localization` retains an opposite-sign bracket that
is wider than the requested tolerance but has no representable interior midpoint.
The bracket, endpoint values and search counters are exported; it is not a
successfully localized event and does not contribute a timing statistic. Other
draws can continue. Invalid settings or an unrepresentable scan grid still reject
the job. Positive-duration scan admission always requires at least two endpoint
evaluations, even if duration divided by scan spacing underflows to zero.

Every draw retains its offsets, source identity and status. All draws share
250,000 force calls; each draw admits at most 2,048 scalar event evaluations and
128 event records, and there are at most 128 draws. Scan checkpoints are
integrated chronologically; each refinement independently integrates from the
nearest fixed scan/reference checkpoint. Refinement states do not enter the
checkpoint cache, which avoids interpolation and query-order-dependent states
but can be costly.
The budget is not a runtime or memory benchmark.

Searched results aggregate the maximum accepted DP54 embedded local-error ratio
and the smallest/largest accepted integration step across completed segments.
The ratio is dimensionless and at most one for an accepted step. Rejected steps
and completed integration counts remain separate. These solver diagnostics do
not bound accumulated state error or event-time error; localization brackets
still exclude integration, sampling and physical-model uncertainty.

The search traverses the interval chronologically even for a negative requested
duration. Times remain elapsed TDB seconds plus a reference TDB Julian date.
`sampled-zero` has no inferred crossing direction. Sign-change brackets retain
their scan and localization intervals; reported directions describe the sampled
signs rather than certifying a unique root or a local derivative. Tangencies,
multiple crossings and short events can be missed. Localization width excludes
integration error and physical/model uncertainty.

The timing summary selects the first chronologically detected entry and exit
separately in each draw, without asserting that different draws represent the
same physical event. An unclassified sampled zero before a candidate excludes
that draw from the corresponding first-event summary. Failed, unresolved,
not-detected and ambiguous-zero identities remain separately listed.

For at least two selected draws, the summary reports conditional empirical
5th/50th/95th percentiles using rank `ceil(fraction * selectedCount)`, without
interpolation. Sorting localization lower and upper endpoints separately supplies
numeric localization bounds for each order statistic. These exclude integration,
finite-sampling and physical-model errors and are not confidence intervals.
The minimum draw count is not evidence of statistical adequacy or convergence.
The receipt checker reconstructs the summary from the returned draw records.

No physical event correspondence, population timing quantiles or physical probability is
inferred when different draws contain different numbers of events. Unknown
source/model errors and cancellation reject the job instead of manufacturing
per-draw scientific failures.

JSON retains original source bytes and hashes, seed, model, settings and draw
receipts. Invalid coordinate NaNs serialize as null with an explicit convention;
consult validity/status fields. Offline output additionally stores settings-file
bytes/hash and hashes of listed implementation modules. Receipt checks establish
request consistency, not independent scientific accuracy. Native consumption,
independent reference cases and runtime acceptance are still pending.

`initialFrameTransform` records the fixed ECLIPJ2000-to-J2000 rotation constants,
AU/day conversion, reference epoch and prescribed barycentric Sun six-state.
The receiver checks each searched draw's integration initial state against that
draw's reported heliocentric coordinates and the recorded transform, and binds
the coordinate conversion's adopted solar GM to the force-model GM. This closes
a state-association gap, but does not independently authenticate the reported Sun
state against SPK or recompute nonlinear source-coordinate conversion. The Sun
translation and adopted GM remain conditional, without their own propagated
uncertainty.

The backend additionally exposes `POST /v1/orbit/covariance/ensemble/events` for
caller-supplied six-axis offsets. This is a distinct contract from the seeded
browser/offline ensemble: it does not generate samples or assign a probability
law. Required fields are `originalSbdbBase64`, `referenceEpochTdb`, `startSeconds`,
`endSeconds`, `maxStepSeconds`, `toleranceSeconds`, `maxEvaluations`, `maxEvents`,
`targetNaifId`, `distanceKm`, `adoptRestrictedDE440: true`, `exclusionKm` and
`offsets`. `solarRelativity` selects the existing optional solar 1PN model. No SRP
field is accepted by this endpoint. The chronological search window may straddle
the source epoch; the force window also includes zero for independent integration
from the initial state. The response envelope contains `apiVersion` and
`eventEnsemble`; all incomplete searches retain diagnostics, not partial success.
Its `supplied-source-offset-distance-event-ensemble-nearest-scan-checkpoint-v3`
method binds the fixed-checkpoint refinement rule: only scan endpoints enter the
sorted cache, root refinements use the nearest checkpoint (earlier epoch on ties),
and refinement samples never alter later integrations. Android and iOS receipt
decoders require this method identifier.

Backend admission limits requests to 3 MiB including at most 2 MiB source bytes,
128 supplied draws, 2048 scalar calls and 128 detected records per draw. All draws
share 250000 derivative calls and the backend's 20-second request context and
compute queue. Responses exceeding 8 MiB are rejected. These are configured
bounds, not measured latency or capacity results.

Android now has `OrbitEventRequest`, `OrbitEventReport` and the cancellable
`StellarMotionService.loadEvents` transport. The request owns source/offset copies;
the decoder binds original bytes and source identity, adopted GM, pinned force
sources, initial-frame transform, settings, indexed failures and budget accounting.
Event brackets, diagnostics and original response export are retained. This is
source-level integration only. The Android covariance panel now exposes event
mode inside supplied-offset ensembles, explicit chronological-window and budget
fields, per-draw previous/next navigation and full response export. Only one
draw's events are expanded at a time. Changes to input, mode or lifecycle cancel
the current request and clear its displayed/exportable result; event mode does
not apply the endpoint-duration, SRP or covariance-refinement settings. English
and Chinese labels describe the geometric and sampled-detection limitations.
iOS now also has explicit event request and receipt models in
`NativeOrbitEvents.swift`, Xcode source registration and `loadEvents` transport.
It retains indexed draws and cancellation/budget diagnostics under the same
8 MiB envelope. The nested coordinate validator receives that cap explicitly;
ordinary covariance callers keep their existing 4 MiB limit. The iOS covariance
panel exposes event mode within supplied-offset ensembles, explicit window and
budget inputs, previous/next draw navigation and complete export. Displayed
results retain the submitted request for epoch/window/threshold readout. Input,
mode and lifecycle changes cancel the task and discard displayed results; stale
responses cannot replace the current generation. Endpoint duration, SRP and
refinement do not apply in event mode. Both native interfaces expand only one
draw's events at a time. The backend now also emits `timingSummary` using the
conditional first-detected nearest-rank rule described above. Caller-supplied
offsets remain descriptive draws, with no inferred probability distribution.
Each direction retains selected source/event indices and all excluded identities;
fewer than two selected draws yield null quantiles. Android reconstructs the
selection/exclusion partition, counts, nearest ranks and separately sorted bracket
bounds from its checked event records before accepting the summary. It displays
the two directions with selected and excluded counts, ranks and numerical bounds;
the complete identities remain in export. iOS now applies the same reconstruction
to its checked draws before publishing the receipt and displays the two direction
summaries with bilingual limitations. Both native clients require the timing
summary; an older backend response without it is rejected rather than displayed
as a complete event receipt. Independent numerical/runtime validation remains
pending. No tests or application runs have been performed for these additions.
