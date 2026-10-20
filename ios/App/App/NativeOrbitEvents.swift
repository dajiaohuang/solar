import Foundation
import CoreFoundation

/// Request/source consistency; not an independent numerical or probability result.
struct NativeOrbitEventReport {
    static let maxBytes = 8 * 1024 * 1024
    let originalResponse: Data
    let designation, solutionId, sourceSHA256: String
    let searched, failed, unresolved, forceEvaluations: Int
    let forceEvidence: [String]
    let draws: [Draw]
    let timing: [NativeOrbitEventTiming]
    struct Draw {
        let index: Int
        let status, stage, failure, resource: String
        let forceEvaluations: Int
        let events: [NativeOrbitDetectedEvent]
        let progress: NativeOrbitEventProgress?
        let failureBracket: [Double]?
    }
    init(validating bytes: Data, request r: NativeOrbitEventRequest) throws {
        typealias V = NativeOrbitCovarianceReport
        typealias P = NativeOrbitPropagationReport
        typealias B = NativeOrbitEventBinding
        try Task.checkCancellation()
        try V.require(!bytes.isEmpty && bytes.count <= Self.maxBytes, "Event response exceeds 8 MiB.")
        let envelope = try NativeStellarMotionReport.jsonObject(bytes)
        try V.require(envelope["apiVersion"] as? String == "solar.api/v1", "Event API mismatch.")
        let result = try V.object(envelope["eventEnsemble"]), initial = try V.object(result["initial"])
        try V.require(result["method"] as? String == "supplied-source-offset-distance-event-ensemble-nearest-scan-checkpoint-v3"
            && initial["method"] as? String == "nonlinear-source-offsets-to-periapsis-conic-state-v1", "Event method mismatch.")
        let settings = try V.object(result["settings"])
        try V.require(P.integer(settings["targetNaifId"]) == r.targetNaifId && V.number(settings["distanceKm"]) == r.distanceKm, "Event definition mismatch.")
        try B.settings(V.object(settings["search"]), request: r)
        let force = try V.object(result["forceModel"])
        let evidence = try P.validateForce(force, request: r.force, start: min(0, r.startSeconds), end: max(0, r.endSeconds))
        let conversion = try V.object(initial["conversion"]), coordinates = try V.object(conversion["coordinates"])
        let reportedGM = try V.number(V.object(coordinates["adoptedSolarGM"])["au3PerDay2"])
        let adopted = evidence.solarGM * 86400 * 86400 / (149597870.7 * 149597870.7 * 149597870.7)
        try V.require(adopted.isFinite && adopted > 0 && abs(reportedGM-adopted) <= 8*adopted.ulp, "Event adopted GM mismatch.")
        let sourceRequest = try NativeOrbitCovarianceRequest(original: r.force.originalSbdbBase64, gm: reportedGM, source: evidence.gmIdentity)
        let source = try V(validating: bytes, request: sourceRequest, conversion: conversion, responseLimit: Self.maxBytes)
        try V.require(source.epochTdb == r.force.referenceEpochTdb && source.labels.count == 6 && P.integer(initial["dimension"]) == 6, "Event source epoch/dimension mismatch.")
        let audited = try V.object(V.object(conversion["inspection"])["source"])
        try V.require(V.array(audited["additionalParameters"]).isEmpty && V.vector(initial["offsets"], r.offsets.count) == r.offsets, "Event source offsets/force axes mismatch.")
        let transform = try V.object(result["initialFrameTransform"])
        try V.require(transform["method"] as? String == "fixed-eclipj2000-to-j2000-plus-prescribed-sun-v1"
            && V.text(audited["frame"]) == V.text(transform["sourceFrame"]) && transform["destinationFrame"] as? String == "J2000"
            && transform["destinationOrigin"] as? String == "SSB" && V.number(transform["referenceEpochTdb"]) == source.epochTdb
            && V.number(transform["auKm"]) == 149597870.7 && V.number(transform["daySeconds"]) == 86400
            && V.number(transform["obliquityArcseconds"]) == 84381.448, "Event frame transform mismatch.")
        let sun = try V.vector(transform["sunStateKmKmPerSecond"], 6), integration = try V.object(result["integrationSettings"])
        try V.require(integration["algorithm"] as? String == "dormand-prince-54-component-max-v1"
            && V.number(integration["relativeTolerance"]) == 1e-12 && V.number(integration["initialStep"]) == 3600
            && V.number(integration["maxStep"]) == 86400 && P.integer(integration["maxAttempts"]) == 20000
            && V.vector(integration["absoluteTolerance"], 6) == [1e-5,1e-5,1e-5,1e-12,1e-12,1e-12], "Event integration adoption mismatch.")
        for entry in [initial, result] { try V.require(!V.strings(entry["limitations"]).isEmpty, "Event limitations missing.") }
        let originals = try V.array(initial["draws"]), rows = try V.array(result["draws"]), count = r.offsets.count/6
        try V.require(originals.count == count && rows.count == count && P.integer(result["maxForceEvaluations"]) == 250000, "Event count/budget mismatch.")
        var output = [Draw](), searchedCount = 0, failedCount = 0, unresolvedCount = 0, total = 0
        for index in 0..<count {
            try Task.checkCancellation()
            let original = try V.object(originals[index]), draw = try V.object(rows[index])
            try V.require(P.integer(original["index"]) == index && P.integer(draw["index"]) == index, "Event draw identity mismatch.")
            let valid = try B.flag(original["valid"])
            var state: [Double]?
            if valid {
                state = try V.vector(original["state"], 6)
                try V.require(V.array(original["additionalValues"]).isEmpty && V.isNull(original["failure"]), "Unexpected initial failure/forces.")
            } else {
                _ = try V.text(original["failure"])
                try V.require(V.isNull(original["state"]) && V.isNull(original["additionalValues"]), "Invalid initial values must be null.")
            }
            let status = try V.text(draw["status"]), calls = try P.integer(draw["forceEvaluations"])
            let integrations = try P.integer(draw["integrations"]), accepted = try P.integer(draw["accepted"]), rejected = try P.integer(draw["rejected"])
            // Checked integer inputs are capped at Int32.max; these sums fit iOS Int64.
            let completedCalls = integrations + 6*(accepted+rejected)
            try V.require(calls <= 250000 && integrations <= r.maxEvaluations && completedCalls <= calls, "Event integration counts exceed force calls.")
            let before = total; total += calls; try V.require(total <= 250000, "Shared event force budget exceeded.")
            if !V.isNull(draw["initialStateKmKmPerSecond"]) {
                guard let state else { throw StateTileFailure.invalid("Failed source has event initial state.") }
                try B.initial(V.vector(draw["initialStateKmKmPerSecond"], 6), source: state, sun: sun)
            }
            var events = [NativeOrbitDetectedEvent](), stage = "", failure = "", resource = ""
            var progress: NativeOrbitEventProgress?, bracket: [Double]?
            if status == "searched" {
                try V.require(valid && before < 250000 && !V.isNull(draw["initialStateKmKmPerSecond"])
                    && V.isNull(draw["stage"]) && V.isNull(draw["failure"]) && V.isNull(draw["resource"]) && V.isNull(draw["searchProgress"])
                    && V.isNull(draw["bracketSeconds"]) && V.isNull(draw["bracketValues"]) && completedCalls == calls, "Successful event draw mismatch.")
                let search = try B.search(V.object(draw["search"]), request: r)
                try V.require(integrations <= search.evaluations && search.evaluations-integrations <= 1, "Scalar/integration count mismatch.")
                events = search.events; searchedCount += 1
            } else {
                try V.require(V.isNull(draw["search"]), "Incomplete event search must not publish success.")
                stage = try V.text(draw["stage"]); failure = try V.text(draw["failure"])
                if status == "failed" {
                    failedCount += 1; try V.require(V.isNull(draw["resource"]), "Failed draw contains budget resource.")
                    switch stage {
                    case "coordinates":
                        try V.require(!valid && calls == 0 && V.isNull(draw["initialStateKmKmPerSecond"])
                            && V.isNull(draw["searchProgress"]) && failure == V.text(original["failure"]), "Coordinate failure was replaced.")
                    case "integration":
                        try V.require(valid && before < 250000 && V.isNull(draw["searchProgress"]), "Integration failure identity mismatch.")
                    case "localization":
                        try V.require(valid && before < 250000 && !V.isNull(draw["initialStateKmKmPerSecond"]), "Localization failure identity mismatch.")
                        bracket = try B.localization(draw, request: r)
                        progress = try NativeOrbitEventProgress(V.object(draw["searchProgress"]), request: r, resource: "localization")
                    default: throw StateTileFailure.invalid("Unknown event failure stage.")
                    }
                } else if status == "unresolved" {
                    unresolvedCount += 1; try V.require(valid, "Invalid initial draw cannot be unresolved.")
                    resource = try V.text(draw["resource"])
                    if stage == "not-started" {
                        try V.require(before == 250000 && calls == 0 && resource == "forces"
                            && V.isNull(draw["initialStateKmKmPerSecond"]) && V.isNull(draw["searchProgress"]), "Unstarted draw budget mismatch.")
                    } else {
                        try V.require(stage == "search" && before < 250000 && !V.isNull(draw["initialStateKmKmPerSecond"]), "Interrupted draw stage mismatch.")
                        try V.require(resource != "forces" || total == 250000, "Force exhaustion before shared cap.")
                        progress = try NativeOrbitEventProgress(V.object(draw["searchProgress"]), request: r, resource: resource)
                    }
                } else { throw StateTileFailure.invalid("Unknown event draw status.") }
                if stage != "localization" { try V.require(V.isNull(draw["bracketSeconds"]) && V.isNull(draw["bracketValues"]), "Unexpected failure bracket.") }
            }
            output.append(Draw(index: index, status: status, stage: stage, failure: failure, resource: resource,
                forceEvaluations: calls, events: events, progress: progress, failureBracket: bracket))
        }
        let counts = try V.object(result["counts"])
        try V.require(P.integer(counts["total"]) == count && P.integer(counts["searched"]) == searchedCount
            && P.integer(counts["failed"]) == failedCount && P.integer(counts["unresolved"]) == unresolvedCount
            && P.integer(result["forceEvaluations"]) == total, "Event aggregate counts mismatch.")
        try Task.checkCancellation()
        originalResponse = bytes; designation = source.designation; solutionId = source.solutionId; sourceSHA256 = source.sourceSHA256
        searched = searchedCount; failed = failedCount; unresolved = unresolvedCount; forceEvaluations = total
        draws = output; forceEvidence = try P.describeForce(force)
        timing = try NativeOrbitEventTiming.bind(result["timingSummary"], draws: output)
    }
}

/// Reconstructs descriptive order statistics from checked events, not trajectories.
struct NativeOrbitEventTiming {
    let direction: String
    let total, selected, failed, unresolved, notDetected, ambiguousZero: Int
    let quantiles: [Quantile]
    struct Quantile {
        let fraction: Double
        let rank: Int
        let elapsedTdbSeconds: Double
        let localizationBounds: [Double]
    }
    static func bind(_ raw: Any?, draws: [NativeOrbitEventReport.Draw]) throws -> [Self] {
        typealias V = NativeOrbitCovarianceReport
        typealias P = NativeOrbitPropagationReport
        try V.require(!draws.isEmpty && draws.count <= 128, "Bounded timing draw identities required.")
        let root = try V.object(raw), summaries = try V.array(root["summaries"])
        try V.require(root["method"] as? String == "conditional-first-detected-nearest-rank-times-v1"
            && !V.strings(root["limitations"]).isEmpty && summaries.count == 2, "Timing method/directions mismatch.")
        var output = [Self]()
        for (d, direction) in ["decreasing", "increasing"].enumerated() {
            try Task.checkCancellation()
            let summary = try V.object(summaries[d])
            try V.require(summary["direction"] as? String == direction
                && summary["eventSelection"] as? String == "first-detected-in-chronological-order", "Timing selection mismatch.")
            let selections = try V.array(summary["selections"]), exclusions = try V.array(summary["exclusions"])
            try V.require(selections.count + exclusions.count == draws.count, "Timing partition size mismatch.")
            var counts = [draws.count, 0, 0, 0, 0, 0], selectionCursor = 0, exclusionCursor = 0
            var times = [Double](), lower = [Double](), upper = [Double]()
            for (index, draw) in draws.enumerated() {
                try Task.checkCancellation()
                try V.require(draw.index == index, "Timing draw identity mismatch.")
                var reason: String?, chosen: Int?, firstZero = Double.infinity
                switch draw.status {
                case "failed": reason = "failed"; counts[2] += 1
                case "unresolved": reason = "unresolved"; counts[3] += 1
                case "searched":
                    for (j, event) in draw.events.enumerated() {
                        if event.kind == "sampled-zero" { firstZero = min(firstZero, event.elapsedTdbSeconds) }
                        else if chosen == nil && event.kind == "sign-change" && event.direction == direction { chosen = j }
                    }
                    let candidateTime = chosen.map { draw.events[$0].elapsedTdbSeconds } ?? Double.infinity
                    if firstZero.isFinite && firstZero <= candidateTime {
                        reason = "earlier-unclassified-zero"; counts[5] += 1
                    } else if chosen == nil { reason = "not-detected"; counts[4] += 1 }
                default: throw StateTileFailure.invalid("Unknown timing draw status.")
                }
                if let reason {
                    try V.require(exclusionCursor < exclusions.count, "Missing timing exclusion.")
                    let entry = try V.object(exclusions[exclusionCursor]); exclusionCursor += 1
                    try V.require(P.integer(entry["index"]) == index && V.text(entry["reason"]) == reason, "Timing exclusion identity mismatch.")
                } else {
                    guard let chosen else { throw StateTileFailure.invalid("Missing timing candidate.") }
                    try V.require(selectionCursor < selections.count, "Missing timing selection.")
                    let entry = try V.object(selections[selectionCursor]); selectionCursor += 1
                    let event = draw.events[chosen]
                    try V.require(P.integer(entry["index"]) == index && P.integer(entry["eventIndex"]) == chosen
                        && V.number(entry["elapsedTdbSeconds"]) == event.elapsedTdbSeconds
                        && V.vector(entry["bracketSeconds"], 2) == event.localizationBracket, "Timing selection identity/value mismatch.")
                    counts[1] += 1; times.append(event.elapsedTdbSeconds)
                    lower.append(event.localizationBracket[0]); upper.append(event.localizationBracket[1])
                }
            }
            try V.require(selectionCursor == selections.count && exclusionCursor == exclusions.count, "Unexpected timing identities.")
            let reported = try V.object(summary["counts"])
            for (i, name) in ["total", "selected", "failed", "unresolved", "notDetected", "ambiguousZero"].enumerated() {
                try V.require(P.integer(reported[name]) == counts[i], "Timing counts mismatch.")
            }
            var quantiles = [Quantile]()
            if counts[1] < 2 {
                try V.require(summary["status"] as? String == "insufficient-selected-draws" && V.isNull(summary["quantiles"]), "Unavailable timing must have null quantiles.")
            } else {
                try V.require(summary["status"] as? String == "available", "Available timing status mismatch.")
                times.sort(); lower.sort(); upper.sort()
                let rows = try V.array(summary["quantiles"])
                try V.require(rows.count == 3, "Three timing ranks required.")
                for (i, fraction) in [0.05, 0.5, 0.95].enumerated() {
                    let rank = Int(ceil(fraction * Double(counts[1]))), row = try V.object(rows[i])
                    let bounds = [lower[rank-1], upper[rank-1]]
                    try V.require(V.number(row["fraction"]) == fraction && P.integer(row["rank"]) == rank
                        && V.number(row["elapsedTdbSeconds"]) == times[rank-1]
                        && V.vector(row["localizationBoundsSeconds"], 2) == bounds, "Timing rank/value/bounds mismatch.")
                    quantiles.append(Quantile(fraction: fraction, rank: rank, elapsedTdbSeconds: times[rank-1], localizationBounds: bounds))
                }
            }
            output.append(Self(direction: direction, total: counts[0], selected: counts[1], failed: counts[2],
                unresolved: counts[3], notDetected: counts[4], ambiguousZero: counts[5], quantiles: quantiles))
        }
        try Task.checkCancellation(); return output
    }
}

/// Explicit supplied offsets and chronological window; no implicit probability law.
struct NativeOrbitEventRequest: Encodable {
    let force: NativeOrbitPropagationRequest
    let offsets: [Double]
    let startSeconds, endSeconds, maxStepSeconds, toleranceSeconds, distanceKm: Double
    let targetNaifId, maxEvaluations, maxEvents, scanIntervals: Int

    init(original: Data, epoch: Double, start: Double, end: Double, adopt: Bool,
         exclusions: [Int: Double], relativity: Bool, offsets: [Double], target: Int,
         distance: Double, step: Double, tolerance: Double, evaluations: Int, events: Int) throws {
        typealias V = NativeOrbitCovarianceReport
        try V.require(start.isFinite && end.isFinite && start <= end && max(abs(start), abs(end)) <= 365 * 86400,
                      "Ordered event window within 365 days required.")
        try V.require(distance.isFinite && distance > 0 && step.isFinite && step > 0 && tolerance.isFinite
                      && tolerance > 0 && tolerance <= step && (1...2048).contains(evaluations) && (1...128).contains(events),
                      "Positive threshold/step/tolerance and bounded event budgets required.")
        let intervals = end == start ? 0 : max(1, ceil((end-start)/step))
        try V.require(intervals.isFinite && intervals + 1 <= Double(evaluations), "Event scan exceeds evaluation budget.")
        try V.require(NativeOrbitPropagationRequest.forceIDs.contains(target), "Event target must be a pinned force body.")
        try V.require(offsets.count >= 6 && offsets.count <= 768 && offsets.count % 6 == 0 && offsets.allSatisfy { $0.isFinite },
                      "Expected 1 to 128 finite six-axis source draws.")
        force = try NativeOrbitPropagationRequest(original: original, epoch: epoch, duration: 0,
            adoptRestrictedDE440: adopt, exclusions: exclusions, solarRelativity: relativity)
        self.offsets = offsets; startSeconds = start; endSeconds = end; maxStepSeconds = step
        toleranceSeconds = tolerance; distanceKm = distance; targetNaifId = target
        maxEvaluations = evaluations; maxEvents = events; scanIntervals = Int(intervals)
    }

    private enum CodingKeys: String, CodingKey {
        case originalSbdbBase64, referenceEpochTdb, adoptRestrictedDE440, exclusionKm, solarRelativity, offsets
        case startSeconds, endSeconds, maxStepSeconds, toleranceSeconds, distanceKm, targetNaifId, maxEvaluations, maxEvents
    }
    func encode(to encoder: Encoder) throws {
        try Task.checkCancellation()
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(force.originalSbdbBase64, forKey: .originalSbdbBase64)
        try c.encode(force.referenceEpochTdb, forKey: .referenceEpochTdb)
        try c.encode(force.adoptRestrictedDE440, forKey: .adoptRestrictedDE440)
        try c.encode(force.exclusionKm, forKey: .exclusionKm)
        try c.encode(force.solarRelativity, forKey: .solarRelativity)
        try c.encode(offsets, forKey: .offsets)
        try c.encode(startSeconds, forKey: .startSeconds); try c.encode(endSeconds, forKey: .endSeconds)
        try c.encode(maxStepSeconds, forKey: .maxStepSeconds); try c.encode(toleranceSeconds, forKey: .toleranceSeconds)
        try c.encode(distanceKm, forKey: .distanceKm); try c.encode(targetNaifId, forKey: .targetNaifId)
        try c.encode(maxEvaluations, forKey: .maxEvaluations); try c.encode(maxEvents, forKey: .maxEvents)
    }
    func bytes() throws -> Data {
        try force.preflightSource()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let data = try encoder.encode(self)
        try NativeOrbitCovarianceReport.require(data.count <= 3 * 1024 * 1024, "Event request exceeds 3 MiB.")
        try Task.checkCancellation(); return data
    }
}

/// Checked scalar-search fields. Original full receipts remain necessary for provenance.
struct NativeOrbitDetectedEvent {
    let kind, direction: String
    let elapsedTdbSeconds: Double
    let scanBracket, localizationBracket, localizationValues: [Double]
}

struct NativeOrbitEventProgress {
    let attempted, completed, retained: Int
    let lastAttemptSeconds: Double

    init(_ raw: [String: Any], request: NativeOrbitEventRequest, resource: String) throws {
        typealias V = NativeOrbitCovarianceReport
        typealias P = NativeOrbitPropagationReport
        attempted = try P.integer(raw["attemptedEvaluations"])
        completed = try P.integer(raw["completedEvaluations"])
        retained = try P.integer(raw["retainedEventCount"])
        lastAttemptSeconds = try V.number(raw["lastAttemptSeconds"])
        try V.require(attempted >= 1 && attempted <= request.maxEvaluations && completed <= attempted
            && retained <= request.maxEvents && retained <= completed
            && lastAttemptSeconds >= request.startSeconds && lastAttemptSeconds <= request.endSeconds, "Event progress bounds mismatch.")
        if resource == "forces" {
            try V.require(completed + 1 == attempted, "Force interruption requires one unfinished scalar call.")
        } else {
            try V.require(completed == attempted, "Completed event progress mismatch.")
            switch resource {
            case "evaluations": try V.require(attempted == request.maxEvaluations, "Evaluation cap mismatch.")
            case "events": try V.require(retained == request.maxEvents, "Event record cap mismatch.")
            case "localization": break
            default: throw StateTileFailure.invalid("Unknown event budget resource.")
            }
        }
    }
}

enum NativeOrbitEventBinding {
    typealias V = NativeOrbitCovarianceReport
    typealias P = NativeOrbitPropagationReport

    static func settings(_ value: [String: Any], request r: NativeOrbitEventRequest) throws {
        try V.require(V.number(value["referenceEpochTdb"]) == r.force.referenceEpochTdb
            && V.number(value["startSeconds"]) == r.startSeconds && V.number(value["endSeconds"]) == r.endSeconds
            && V.number(value["maxStepSeconds"]) == r.maxStepSeconds && V.number(value["toleranceSeconds"]) == r.toleranceSeconds
            && P.integer(value["maxEvaluations"]) == r.maxEvaluations && P.integer(value["maxEvents"]) == r.maxEvents,
            "Event search settings mismatch.")
    }

    static func search(_ value: [String: Any], request r: NativeOrbitEventRequest) throws -> (events: [NativeOrbitDetectedEvent], evaluations: Int) {
        try settings(V.object(value["settings"]), request: r)
        let evaluations = try P.integer(value["evaluations"])
        try V.require(value["method"] as? String == "context-sampled-sign-change-bisection-v1"
            && value["timeScale"] as? String == "TDB" && value["coverage"] as? String == "sampled-sign-changes-only"
            && flag(value["possibleMissedEvents"]) && P.integer(value["scanIntervals"]) == r.scanIntervals
            && evaluations >= r.scanIntervals + 1 && evaluations <= r.maxEvaluations, "Event search method/coverage mismatch.")
        try V.require(!V.strings(value["limitations"]).isEmpty, "Event limitations missing.")
        let width = try V.number(value["maximumScanIntervalSeconds"])
        try V.require(width >= 0 && width <= r.endSeconds-r.startSeconds && (r.scanIntervals == 0 ? width == 0 : width > 0), "Scan interval width mismatch.")
        _ = try V.number(value["startValue"]); _ = try V.number(value["endValue"])
        let rows = try V.array(value["events"])
        try V.require(rows.count <= r.maxEvents && rows.count <= evaluations, "Event record budget exceeded.")
        var events = [NativeOrbitDetectedEvent](), previous = -Double.infinity
        for raw in rows {
            try Task.checkCancellation()
            let row = try V.object(raw)
            let kind = try V.text(row["kind"]), direction = try V.text(row["direction"])
            let time = try V.number(row["elapsedTdbSeconds"]), scan = try V.vector(row["scanBracketSeconds"], 2)
            let bracket = try V.vector(row["localizationBracketSeconds"], 2), values = try V.vector(row["localizationValues"], 2)
            try V.require(scan[0] >= r.startSeconds && scan[1] <= r.endSeconds && scan[0] <= bracket[0]
                && bracket[0] <= time && time <= bracket[1] && bracket[1] <= scan[1] && time > previous
                && bracket[1]-bracket[0] <= r.toleranceSeconds, "Event bracket/time mismatch.")
            if kind == "sampled-zero" {
                try V.require(direction == "unclassified" && scan[0] == scan[1] && values == [0, 0], "Sampled zero classification mismatch.")
            } else {
                try V.require(kind == "sign-change" && scan[0] < scan[1] && ["increasing", "decreasing"].contains(direction), "Sign-change classification mismatch.")
                try V.require(bracket[0] == bracket[1] ? values == [0, 0] : opposite(values) && ((values[0] < 0) == (direction == "increasing")), "Localized event signs mismatch.")
            }
            events.append(NativeOrbitDetectedEvent(kind: kind, direction: direction, elapsedTdbSeconds: time,
                scanBracket: scan, localizationBracket: bracket, localizationValues: values))
            previous = time
        }
        return (events, evaluations)
    }

    static func localization(_ draw: [String: Any], request r: NativeOrbitEventRequest) throws -> [Double] {
        let bracket = try V.vector(draw["bracketSeconds"], 2), values = try V.vector(draw["bracketValues"], 2)
        let mid = bracket[0] + (bracket[1]-bracket[0])/2
        try V.require(bracket[0] >= r.startSeconds && bracket[1] <= r.endSeconds && bracket[1]-bracket[0] > r.toleranceSeconds
            && !(mid > bracket[0] && mid < bracket[1]) && opposite(values), "Invalid localization failure bracket.")
        return bracket
    }

    static func initial(_ received: [Double], source: [Double], sun: [Double]) throws {
        let angle = 84381.448/3600 * Double.pi/180, s = sin(angle), c = cos(angle)
        for axis in [0, 3] {
            let scale = axis == 0 ? 149597870.7 : 149597870.7/86400
            let rotated = [source[axis], c*source[axis+1]-s*source[axis+2], s*source[axis+1]+c*source[axis+2]]
            let magnitude = max(abs(source[axis]), max(abs(source[axis+1]), abs(source[axis+2]))) * scale
            for j in 0..<3 {
                let expected = rotated[j]*scale+sun[axis+j], bound = 32 * max(magnitude, abs(sun[axis+j])).ulp
                try V.require(expected.isFinite && bound.isFinite && abs(expected-received[axis+j]) <= bound, "Initial event frame transformation mismatch.")
            }
        }
    }
    static func opposite(_ v: [Double]) -> Bool { v[0] != 0 && v[1] != 0 && ((v[0] < 0) != (v[1] < 0)) }
    static func flag(_ value: Any?) throws -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
            throw StateTileFailure.invalid("Event boolean required.")
        }
        return number.boolValue
    }
}
