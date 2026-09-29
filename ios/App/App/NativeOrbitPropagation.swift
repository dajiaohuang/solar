import Foundation
import CoreFoundation

/// Source/receipt consistency only, not independent numerical validation.
struct NativeOrbitEnsembleReport {
    static let maxBytes = 4 * 1024 * 1024
    let originalResponse: Data
    let designation, solutionId, sourceSHA256: String
    let referenceEpochTdb, durationSeconds: Double
    let states: [[Double]?]
    let failures: [String?]
    let failedCount, forceEvaluations: Int
    let momentsStatus, momentsReason: String
    let mean, sigmas: [Double]?
    let covariance: [[Double]]?
    let forceEvaluationsByDraw: [Int]
    let forceEvidence: [String]

    init(validating bytes: Data, request: NativeOrbitEnsembleRequest) throws {
        typealias V = NativeOrbitCovarianceReport
        typealias P = NativeOrbitPropagationReport
        try V.require(!bytes.isEmpty && bytes.count <= Self.maxBytes, "Ensemble response exceeds 4 MiB.")
        try Task.checkCancellation()
        let propagation = request.propagation
        let envelope = try NativeStellarMotionReport.jsonObject(bytes)
        try V.require(envelope["apiVersion"] as? String == "solar.api/v1", "Ensemble API mismatch.")
        let result = try V.object(envelope["ensemble"]), initial = try V.object(result["initial"])
        try V.require(result["method"] as? String == "nonlinear-joint-source-offsets-restricted-dynamics-v1"
            && initial["method"] as? String == "nonlinear-source-offsets-to-periapsis-conic-state-v1", "Ensemble method mismatch.")
        let force = try V.object(result["forceModel"])
        let evidence = try P.validateForce(force, request: propagation)
        let conversion = try V.object(initial["conversion"]), coordinates = try V.object(conversion["coordinates"])
        let reportedGM = try V.number(V.object(coordinates["adoptedSolarGM"])["au3PerDay2"])
        let adopted = evidence.solarGM * 86400 * 86400 / (149597870.7 * 149597870.7 * 149597870.7)
        try V.require(adopted.isFinite && adopted > 0 && abs(reportedGM-adopted) <= 8 * adopted.ulp, "Ensemble adopted GM mismatch.")
        let sourceRequest = try NativeOrbitCovarianceRequest(original: propagation.originalSbdbBase64, gm: reportedGM, source: evidence.gmIdentity)
        let source = try V(validating: bytes, request: sourceRequest, conversion: conversion)
        try V.require(source.epochTdb == propagation.referenceEpochTdb && source.labels.count == 6
            && P.integer(initial["dimension"]) == 6, "Ensemble source epoch/dimension mismatch.")
        let audited = try V.object(V.object(conversion["inspection"])["source"])
        try V.require(V.array(audited["additionalParameters"]).isEmpty, "Additional source forces unsupported.")
        try V.require(V.vector(initial["offsets"], request.offsets.count) == request.offsets, "Ensemble offsets mismatch.")
        try V.require(result["frame"] as? String == "heliocentric-IAU76/80-ecliptic-J2000"
            && V.strings(result["labels"]) == ["x", "y", "z", "vx", "vy", "vz"]
            && V.strings(result["units"]) == ["au", "au", "au", "au/d", "au/d", "au/d"], "Ensemble endpoint axes mismatch.")
        let epoch = try V.object(result["finalEpoch"])
        try V.require(V.number(epoch["referenceEpochTdb"]) == propagation.referenceEpochTdb
            && V.number(epoch["elapsedTdbSeconds"]) == propagation.durationSeconds, "Ensemble split epoch mismatch.")
        for entry in [initial, result] { try V.require(!V.strings(entry["limitations"]).isEmpty, "Ensemble limitations missing.") }
        let draws = try V.array(initial["draws"]), endpoints = try V.array(result["endpoints"])
        let count = request.offsets.count / 6
        try V.require(draws.count == count && endpoints.count == count && P.integer(result["maxEvaluations"]) == 250000, "Ensemble count/budget mismatch.")
        var output = [[Double]?](repeating: nil, count: count), errors = [String?](repeating: nil, count: count)
        var failed = 0, total = 0
        var drawEvaluations = [Int](repeating: 0, count: count)
        for index in 0..<count {
            try Task.checkCancellation()
            let draw = try V.object(draws[index]), endpoint = try V.object(endpoints[index])
            try V.require(P.integer(draw["index"]) == index && P.integer(endpoint["index"]) == index, "Ensemble identity mismatch.")
            let initialValid = try Self.flag(draw["valid"]), valid = try Self.flag(endpoint["valid"])
            let evaluations = try P.integer(endpoint["forceEvaluations"])
            try V.require(evaluations <= 250000, "Draw force budget exceeded."); total += evaluations
            drawEvaluations[index] = evaluations
            var initialState: [Double]?
            if initialValid {
                initialState = try V.vector(draw["state"], 6)
                try V.require(V.array(draw["additionalValues"]).isEmpty && V.isNull(draw["failure"]), "Unexpected initial draw fields.")
            } else {
                _ = try V.text(draw["failure"])
                try V.require(V.isNull(draw["state"]) && V.isNull(draw["additionalValues"]), "Failed initial draw must have null values.")
            }
            if !initialValid {
                try V.require(!valid && V.isNull(endpoint["integration"]) && evaluations == 0
                    && endpoint["failureStage"] as? String == "coordinates"
                    && V.text(draw["failure"]) == V.text(endpoint["failure"]), "Failed initial draw was replaced.")
            } else if propagation.durationSeconds == 0 {
                try V.require(valid && V.isNull(endpoint["integration"]) && evaluations == 0
                    && V.vector(endpoint["state"], 6) == initialState, "Zero-duration ensemble identity mismatch.")
            } else if !V.isNull(endpoint["integration"]) {
                let integration = try V.object(endpoint["integration"])
                let diagnostics = try P.validateIntegration(integration, request: propagation, refined: false, dimension: 6)
                try V.require(evaluations == diagnostics.evaluations, "Draw evaluation count mismatch.")
                if !valid { try V.require(endpoint["failureStage"] as? String == "projection", "Completed integration failure stage mismatch.") }
            } else {
                try V.require(!valid && endpoint["failureStage"] as? String == "integration", "Missing completed integration.")
            }
            if valid {
                try V.require(V.isNull(endpoint["failure"]) && V.isNull(endpoint["failureStage"]), "Valid endpoint contains failure.")
                output[index] = try V.vector(endpoint["state"], 6)
            } else {
                try V.require(V.isNull(endpoint["state"]), "Failed endpoint must be null.")
                failed += 1; errors[index] = try V.text(endpoint["failureStage"]) + ": " + V.text(endpoint["failure"])
            }
        }
        try V.require(total <= 250000 && total == P.integer(result["forceEvaluations"]), "Ensemble total force budget mismatch.")
        let moments = try V.object(result["moments"]), status = try V.text(moments["status"])
        try V.require(P.integer(moments["count"]) == count && P.integer(moments["failedCount"]) == failed
            && moments["method"] as? String == "anchored-compensated-two-pass-sample-moments-v1", "Ensemble moments identity mismatch.")
        _ = try V.text(moments["limitation"])
        var reason = "", average: [Double]?, deviations: [Double]?
        var sampleCovariance: [[Double]]?
        if failed > 0 || count < 2 {
            reason = failed > 0 ? "failed-draws" : "insufficient-draws"
            try V.require(status == "unavailable" && moments["reason"] as? String == reason
                && P.integer(moments["covarianceDivisor"]) == 0, "Unavailable moments mismatch.")
            for key in ["anchor", "meanOffset", "mean", "covariance", "standardDeviations"] {
                try V.require(V.isNull(moments[key]), "Unavailable moments must have null arrays.")
            }
        } else {
            try V.require(status == "available" && V.isNull(moments["reason"])
                && P.integer(moments["covarianceDivisor"]) == count-1, "Available moments mismatch.")
            let anchor = try V.vector(moments["anchor"], 6), offset = try V.vector(moments["meanOffset"], 6)
            let values = try V.vector(moments["mean"], 6), sigma = try V.vector(moments["standardDeviations"], 6)
            let covariance = try V.matrix(moments["covariance"], 6)
            try V.require(anchor == output[0], "Ensemble anchor mismatch.")
            for i in 0..<6 {
                try Task.checkCancellation()
                let expected = sqrt(covariance[i][i])
                try V.require(values[i] == anchor[i]+offset[i] && covariance[i][i] >= 0 && sigma[i] >= 0
                    && abs(sigma[i]-expected) <= 8 * expected.ulp, "Ensemble moments consistency mismatch.")
                for j in 0..<6 { try V.require(covariance[i][j] == covariance[j][i], "Asymmetric ensemble covariance.") }
            }
            average = values; deviations = sigma; sampleCovariance = covariance
        }
        try Task.checkCancellation()
        originalResponse = bytes; designation = source.designation; solutionId = source.solutionId; sourceSHA256 = source.sourceSHA256
        referenceEpochTdb = propagation.referenceEpochTdb; durationSeconds = propagation.durationSeconds
        states = output; failures = errors; failedCount = failed; forceEvaluations = total
        momentsStatus = status; momentsReason = reason; mean = average; sigmas = deviations
        covariance = sampleCovariance; forceEvaluationsByDraw = drawEvaluations
        forceEvidence = try P.describeForce(force)
    }

    private static func flag(_ value: Any?) throws -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
            throw StateTileFailure.invalid("Ensemble boolean required.")
        }
        return number.boolValue
    }
}

/// Explicit conditional force parameters; no material or illumination defaults.
struct NativeOrbitRadiationPressure: Encodable {
    let model = "constant-radial-srp"
    let illumination = "unshadowed"
    let pressureAt1AuNewtonPerSquareMeter, areaSquareMeters, massKg, reflectivityCoefficient: Double
    let source: String

    init(pressure: Double, area: Double, mass: Double, reflectivity: Double, source: String) throws {
        let amplitude = pressure * reflectivity * (area / mass) / 1000
        guard [pressure, area, mass, reflectivity, amplitude].allSatisfy({ $0.isFinite && $0 > 0 }),
              !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, source.utf8.count <= 8192 else {
            throw StateTileFailure.invalid("Positive finite SRP parameters and an explicit source (at most 8192 UTF-8 bytes) required.")
        }
        pressureAt1AuNewtonPerSquareMeter = pressure; areaSquareMeters = area
        massKg = mass; reflectivityCoefficient = reflectivity; self.source = source
    }

    func bind(_ receipt: [String: Any]) throws {
        typealias V = NativeOrbitCovarianceReport
        try V.require(receipt.count == 7 && receipt["model"] as? String == model
            && receipt["illumination"] as? String == illumination && receipt["source"] as? String == source,
            "SRP model/source mismatch.")
        for (key, value) in [("pressureAt1AuNewtonPerSquareMeter", pressureAt1AuNewtonPerSquareMeter),
                             ("areaSquareMeters", areaSquareMeters), ("massKg", massKg),
                             ("reflectivityCoefficient", reflectivityCoefficient)] {
            try V.require(V.number(receipt[key]) == value, "SRP parameter mismatch.")
        }
    }
}

struct NativeOrbitPropagationRequest: Encodable {
    static let forceIDs = [10, 1, 2, 399, 301, 4, 5, 6, 7, 8, 9]
    let originalSbdbBase64: Data
    let referenceEpochTdb, durationSeconds: Double
    let adoptRestrictedDE440: Bool
    let exclusionKm: [String: Double]
    let solarRelativity, compareRefinement: Bool
    let solarRadiationPressure: NativeOrbitRadiationPressure?

    init(original: Data, epoch: Double, duration: Double, adoptRestrictedDE440: Bool,
         exclusions: [Int: Double], solarRelativity: Bool, radiation: NativeOrbitRadiationPressure? = nil, compareRefinement: Bool = false) throws {
        guard !original.isEmpty, original.count <= NativeOrbitCovarianceRequest.maxSourceBytes,
              epoch.isFinite, duration.isFinite, abs(duration) <= 365 * 86400, adoptRestrictedDE440,
              Set(exclusions.keys) == Set(Self.forceIDs), exclusions.values.allSatisfy({ $0.isFinite && $0 >= 0 }) else {
            throw StateTileFailure.invalid("Original SBDB JSON, finite epoch, duration within 365 days, explicit restricted-model adoption and eleven nonnegative exclusion distances required.")
        }
        originalSbdbBase64 = original; referenceEpochTdb = epoch; durationSeconds = duration
        self.adoptRestrictedDE440 = adoptRestrictedDE440; self.solarRelativity = solarRelativity
        exclusionKm = Dictionary(uniqueKeysWithValues: exclusions.map { (String($0.key), $0.value) })
        solarRadiationPressure = radiation
        self.compareRefinement = compareRefinement
    }

    // Admission only; backend validation and source-bound receipt checks remain required.
    func preflightSource() throws {
        try Task.checkCancellation()
        typealias V = NativeOrbitCovarianceReport
        let root = try NativeStellarMotionReport.jsonObject(originalSbdbBase64)
        let orbit = try V.object(root["orbit"]), covariance = try V.object(orbit["covariance"])
        let labels = try V.strings(covariance["labels"])
        try V.require(labels.count == 6 && Set(labels) == Set(["e", "q", "tp", "node", "peri", "i"]),
            "Propagation requires exactly six orbital axes; additional fitted parameters need matched forces and cannot be dropped.")
        try V.require(V.sourceNumber(covariance["epoch"]) == referenceEpochTdb,
            "Requested epoch differs from original SBDB covariance epoch.")
        try Task.checkCancellation()
    }

    func bytes() throws -> Data {
        try preflightSource()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let result = try encoder.encode(self)
        guard result.count <= 3 * 1024 * 1024 else { throw StateTileFailure.invalid("Propagation request exceeds 3 MiB.") }
        try Task.checkCancellation()
        return result
    }
}

/// Explicit source-axis offsets; no implicit distribution, random seed or defaults.
struct NativeOrbitEnsembleRequest: Encodable {
    let propagation: NativeOrbitPropagationRequest
    let offsets: [Double]

    init(propagation: NativeOrbitPropagationRequest, offsets: [Double]) throws {
        guard !propagation.compareRefinement, offsets.count >= 6, offsets.count <= 128 * 6,
              offsets.count % 6 == 0, offsets.allSatisfy({ $0.isFinite }) else {
            throw StateTileFailure.invalid("Expected 1 to 128 finite six-axis source draws without covariance refinement.")
        }
        self.propagation = propagation; self.offsets = offsets
    }

    private enum CodingKeys: String, CodingKey {
        case originalSbdbBase64, referenceEpochTdb, durationSeconds, adoptRestrictedDE440
        case exclusionKm, solarRelativity, solarRadiationPressure, offsets
    }

    func encode(to encoder: Encoder) throws {
        try Task.checkCancellation()
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(propagation.originalSbdbBase64, forKey: .originalSbdbBase64)
        try values.encode(propagation.referenceEpochTdb, forKey: .referenceEpochTdb)
        try values.encode(propagation.durationSeconds, forKey: .durationSeconds)
        try values.encode(propagation.adoptRestrictedDE440, forKey: .adoptRestrictedDE440)
        try values.encode(propagation.exclusionKm, forKey: .exclusionKm)
        try values.encode(propagation.solarRelativity, forKey: .solarRelativity)
        try values.encodeIfPresent(propagation.solarRadiationPressure, forKey: .solarRadiationPressure)
        try values.encode(offsets, forKey: .offsets)
    }

    func bytes() throws -> Data {
        try propagation.preflightSource()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let result = try encoder.encode(self)
        guard result.count <= 3 * 1024 * 1024 else { throw StateTileFailure.invalid("Ensemble request exceeds 3 MiB.") }
        try Task.checkCancellation()
        return result
    }
}

/// Receipt consistency only: this does not independently integrate the trajectory.
struct NativeOrbitPropagationReport {
    static let maxBytes = 4 * 1024 * 1024
    private static let kernelHash = "8724d2d1bac115a75ad1f984c5b474ca778c96ee8be2df83e624cef61c001069"
    private static let gmHash = "924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140"
    private static let gmSource = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc"
    let originalResponse: Data
    let designation, solutionId, sourceSHA256, model: String
    let sourcePlanetaryEphemeris, sourceSmallBodyEphemeris: String?
    let integrationKernel: String
    let forceEvidence: [String]
    let referenceEpochTdb, durationSeconds: Double
    let accepted, rejected, evaluations: Int
    let smallestAcceptedStep: Double?
    let largestAcceptedStep, maxAcceptedErrorRatio, relativeTolerance: Double
    let nominal, sigmas: [Double]
    let limitations: [String]
    let refinement: Refinement?

    struct Refinement {
        let nominal, sigmas, marginalSigmaAbsoluteDifference: [Double]
        let accepted, rejected, evaluations: Int
        let relativeTolerance, maxAcceptedErrorRatio: Double
        let limitation: String

        init(_ receipt: [String: Any], request: NativeOrbitPropagationRequest, baseline: [Double]) throws {
            typealias V = NativeOrbitCovarianceReport
            let integration = try V.object(receipt["integration"])
            let diagnostics = try NativeOrbitPropagationReport.validateIntegration(integration, request: request, refined: true)
            let coordinates = try NativeOrbitPropagationReport.validateCoordinates(V.object(receipt["finalCoordinates"]), request: request)
            let differences = try V.vector(receipt["marginalSigmaAbsoluteDifference"], 6)
            for i in 0..<6 {
                try V.require(differences[i] == abs(coordinates.sigmas[i]-baseline[i]), "Covariance refinement sigma difference mismatch.")
            }
            nominal = coordinates.state; sigmas = coordinates.sigmas; marginalSigmaAbsoluteDifference = differences
            accepted = diagnostics.accepted; rejected = diagnostics.rejected; evaluations = diagnostics.evaluations
            relativeTolerance = try V.number(integration["relativeTolerance"]); maxAcceptedErrorRatio = diagnostics.ratio
            limitation = try V.text(receipt["limitation"])
        }
    }

    init(validating bytes: Data, request: NativeOrbitPropagationRequest) throws {
        typealias V = NativeOrbitCovarianceReport
        try V.require(!bytes.isEmpty && bytes.count <= Self.maxBytes, "Propagation response exceeds 4 MiB.")
        try Task.checkCancellation()
        let envelope = try NativeStellarMotionReport.jsonObject(bytes)
        try V.require(envelope["apiVersion"] as? String == "solar.api/v1", "Propagation API mismatch.")
        let p = try V.object(envelope["propagation"]), force = try V.object(p["forceModel"]), gravity = try V.object(force["gravity"])
        try V.require(p["method"] as? String == "first-order-variational-square-root-pushforward", "Propagation method mismatch.")
        try V.require(p["matrixArithmetic"] as? String == "neumaier-compensated-f64-dot-v1", "Covariance matrix arithmetic mismatch.")
        let (solarGM, expectedModel, gmIdentity) = try Self.validateForce(force, request: request)
        let initialCoordinates = try V.object(p["initialCoordinates"])
        let reportedGM = try V.number(V.object(initialCoordinates["adoptedSolarGM"])["au3PerDay2"])
        let derivedGM = solarGM * 86400 * 86400 / (149597870.7 * 149597870.7 * 149597870.7)
        try V.require(derivedGM.isFinite && derivedGM > 0 && abs(reportedGM-derivedGM) <= 8 * derivedGM.ulp, "Solar GM unit conversion mismatch.")
        let initialRequest = try NativeOrbitCovarianceRequest(original: request.originalSbdbBase64, gm: reportedGM, source: gmIdentity)
        let initial = try V(validating: bytes, request: initialRequest,
                            conversion: ["inspection": V.object(p["inspection"]), "coordinates": initialCoordinates])
        try V.require(initial.epochTdb == request.referenceEpochTdb && initial.labels.count == 6, "Initial covariance source mismatch.")
        _ = try V.vector(p["initialStateKmKmPerSecond"], 6)
        try V.require(p["transitionLayout"] as? String == "integration.state[0:6]: J2000 SSB km, km/s; [6:42]: row-major d(final state)/d(initial state)", "Transition layout mismatch.")
        let integration = try V.object(p["integration"]), result = try V.object(p["finalCoordinates"])
        let diagnostics = try Self.validateIntegration(integration, request: request, refined: false)
        let (state, deviations) = try Self.validateCoordinates(result, request: request)
        if request.compareRefinement {
            refinement = try Refinement(V.object(p["refinement"]), request: request, baseline: deviations)
        } else {
            try V.require(V.isNull(p["refinement"]), "Unrequested covariance refinement.")
            refinement = nil
        }
        var notes: [String] = []
        for entry in [p, force, gravity] {
            let part = try V.strings(entry["limitations"])
            try V.require(!part.isEmpty, "Propagation limitations missing."); notes.append(contentsOf: part)
        }
        originalResponse = bytes; designation = initial.designation; solutionId = initial.solutionId; sourceSHA256 = initial.sourceSHA256
        model = expectedModel; referenceEpochTdb = request.referenceEpochTdb; durationSeconds = request.durationSeconds
        sourcePlanetaryEphemeris = initial.planetaryEphemeris; sourceSmallBodyEphemeris = initial.smallBodyEphemeris
        integrationKernel = try V.text(force["kernelId"])
        self.accepted = diagnostics.accepted; self.rejected = diagnostics.rejected; self.evaluations = diagnostics.evaluations
        smallestAcceptedStep = try V.isNull(integration["smallestAcceptedStep"]) ? nil : V.number(integration["smallestAcceptedStep"])
        largestAcceptedStep = diagnostics.largest; maxAcceptedErrorRatio = diagnostics.ratio
        relativeTolerance = try V.number(integration["relativeTolerance"])
        nominal = state; sigmas = deviations; limitations = notes
        forceEvidence = try Self.describeForce(force)
        try Task.checkCancellation()
    }

    static func describeForce(_ force: [String: Any]) throws -> [String] {
        typealias V = NativeOrbitCovarianceReport
        var lines: [String] = []
        for key in ["model", "kernelId", "kernelSha256", "kernelBytes", "kernelSource", "kernelSourceBytes", "kernelSourceMd5", "kernelSourceLastModified", "kernelDerivation", "gmSource", "gmSha256"] {
            lines.append(key + ": " + (try V.text(force[key])))
        }
        lines.append("J2000 / SSB / TDB · aberration NONE")
        let gravity = try V.object(force["gravity"])
        for value in try V.array(gravity["masses"]) {
            let mass = try V.object(value)
            let id = try integer(mass["naifId"]), gm = try V.number(mass["gmKm3PerSecond2"]), exclusion = try V.number(mass["exclusionKm"])
            lines.append("NAIF \(id) · GM \(gm) km³/s² · exclusion \(exclusion) km")
        }
        if V.isNull(force["solarRelativity"]) { lines.append("solarRelativity: none") }
        else {
            let pn = try V.object(force["solarRelativity"])
            let model = try V.text(pn["model"]), c = try V.number(pn["speedOfLightKmPerSecond"])
            let maximum = try V.number(pn["maxExpansionParameter"])
            lines.append("\(model) · c \(c) km/s · maxExpansionParameter \(maximum)")
            lines.append(try V.text(pn["approximation"]))
        }
        if V.isNull(force["solarRadiationPressure"]) { lines.append("solarRadiationPressure: none") }
        else {
            let srp = try V.object(force["solarRadiationPressure"])
            lines.append(try V.text(srp["model"]) + " · " + V.text(srp["illumination"]))
            let pressure = try V.number(srp["pressureAt1AuNewtonPerSquareMeter"]), area = try V.number(srp["areaSquareMeters"])
            let mass = try V.number(srp["massKg"]), coefficient = try V.number(srp["reflectivityCoefficient"])
            lines.append("P (1 au): \(pressure) N/m²")
            lines.append("A: \(area) m² · m: \(mass) kg · Cr: \(coefficient)")
            lines.append("SRP source: " + (try V.text(srp["source"])))
        }
        lines.append(contentsOf: try V.strings(force["limitations"]))
        return lines
    }

    static func validateForce(_ force: [String: Any], request: NativeOrbitPropagationRequest) throws -> (solarGM: Double, model: String, gmIdentity: String) {
        try validateForce(force, request: request, start: min(0, request.durationSeconds), end: max(0, request.durationSeconds))
    }
    static func validateForce(_ force: [String: Any], request: NativeOrbitPropagationRequest, start: Double, end: Double) throws -> (solarGM: Double, model: String, gmIdentity: String) {
        typealias V = NativeOrbitCovarianceReport
        try Task.checkCancellation()
        let gravity = try V.object(force["gravity"])
        try V.require(force["kernelSha256"] as? String == Self.kernelHash && force["gmSha256"] as? String == Self.gmHash
            && V.number(force["kernelBytes"]) == 5558272 && force["kernelId"] as? String == "de440s-2000-01-01-2051-01-01"
            && V.number(force["kernelSourceBytes"]) == 32726016 && force["kernelSourceMd5"] as? String == "3917ee56769db332790c751e2168843d"
            && force["kernelSourceLastModified"] as? String == "Mon, 21 Dec 2020 19:39:26 GMT"
            && force["kernelDerivation"] as? String == "Solar Atlas crop-spk.mjs: exact original J2000 type-2/3 records for segments overlapping the bounded TDB window; no refit. Parent SHA-256 was not captured; parent identity uses its URL, byte count, Last-Modified value and NAIF-published MD5."
            && force["gmSource"] as? String == Self.gmSource
            && force["kernelSource"] as? String == "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp", "Pinned propagation source identity mismatch.")
        let expectedModel: String
        if request.solarRadiationPressure != nil {
            expectedModel = request.solarRelativity ? "restricted-newtonian-plus-solar-1pn-and-radial-srp" : "restricted-newtonian-plus-radial-srp"
        } else {
            expectedModel = request.solarRelativity ? "restricted-newtonian-plus-solar-1pn" : "restricted-newtonian-prescribed-point-masses"
        }
        try V.require(force["model"] as? String == expectedModel, "Propagation force model mismatch.")
        if let radiation = request.solarRadiationPressure { try radiation.bind(V.object(force["solarRadiationPressure"])) }
        else { try V.require(V.isNull(force["solarRadiationPressure"]), "Unrequested SRP force.") }
        if request.solarRelativity {
            let pn = try V.object(force["solarRelativity"])
            try V.require(pn["model"] as? String == "solar-monopole-1pn" && V.number(pn["speedOfLightKmPerSecond"]) == 299792.458
                && V.number(pn["maxExpansionParameter"]) == 1e-4, "Solar 1PN model mismatch.")
            _ = try V.text(pn["approximation"])
        } else { try V.require(V.isNull(force["solarRelativity"]), "Unrequested solar relativity.") }
        try V.require(gravity["model"] as? String == "restricted-newtonian-prescribed-point-masses"
            && gravity["frame"] as? String == "J2000" && gravity["origin"] as? String == "SSB"
            && gravity["timeScale"] as? String == "TDB" && gravity["aberration"] as? String == "NONE"
            && V.number(gravity["referenceEpochTdb"]) == request.referenceEpochTdb, "Force epoch/frame mismatch.")
        try V.require(V.vector(gravity["elapsedRangeSeconds"], 2) == [start, end], "Force time window mismatch.")
        try V.require(V.strings(gravity["stateUnits"]) == ["km", "km", "km", "km/s", "km/s", "km/s"]
            && gravity["ephemerisSource"] as? String == "de440s-2000-01-01-2051-01-01 SHA-256 " + Self.kernelHash, "Force source units mismatch.")
        let masses = try V.array(gravity["masses"]), gmIdentity = Self.gmSource + " SHA-256 " + Self.gmHash
        try V.require(masses.count == NativeOrbitPropagationRequest.forceIDs.count, "Force mass plan mismatch.")
        var solarGM = 0.0
        for (i, id) in NativeOrbitPropagationRequest.forceIDs.enumerated() {
            try Task.checkCancellation()
            let mass = try V.object(masses[i])
            try V.require(Self.integer(mass["naifId"]) == id && V.number(mass["exclusionKm"]) == request.exclusionKm[String(id)]
                && mass["gmSource"] as? String == gmIdentity, "Mass/exclusion/source mismatch.")
            let gm = try V.number(mass["gmKm3PerSecond2"])
            try V.require(gm > 0, "Nonpositive force GM.")
            if i == 0 { solarGM = gm }
        }
        for entry in [force, gravity] { try V.require(!V.strings(entry["limitations"]).isEmpty, "Force limitations missing.") }
        return (solarGM, expectedModel, gmIdentity)
    }

    static func validateIntegration(_ integration: [String: Any], request: NativeOrbitPropagationRequest, refined: Bool, dimension: Int = 42) throws -> (accepted: Int, rejected: Int, evaluations: Int, largest: Double, ratio: Double) {
        typealias V = NativeOrbitCovarianceReport
        try V.require(integration["algorithm"] as? String == "dormand-prince-54-component-max-v1"
            && V.number(integration["elapsed"]) == request.durationSeconds && V.number(integration["relativeTolerance"]) == (refined ? 1e-13 : 1e-12)
            && V.number(integration["initialStep"]) == (refined ? 1800 : 3600) && V.number(integration["maxStep"]) == (refined ? 43200 : 86400)
            && Self.integer(integration["maxAttempts"]) == 20000, "Integration settings mismatch.")
        try V.require(dimension == 6 || dimension == 42, "Unsupported integration dimension.")
        _ = try V.vector(integration["state"], dimension)
        let atol = try V.vector(integration["absoluteTolerance"], dimension)
        for i in 0..<dimension { try V.require(atol[i] == (i < 3 ? 1e-5 : 1e-12) / (refined ? 10 : 1), "Integration tolerance mismatch.") }
        let accepted = try Self.integer(integration["accepted"]), rejected = try Self.integer(integration["rejected"])
        let attempts = try Self.integer(integration["attempts"]), evaluations = try Self.integer(integration["evaluations"])
        try V.require(accepted + rejected == attempts && attempts <= 20000
            && evaluations == (request.durationSeconds == 0 ? 0 : 1 + 6 * attempts), "Integration counters mismatch.")
        let largest = try V.number(integration["largestAcceptedStep"]), ratio = try V.number(integration["maxAcceptedErrorRatio"])
        try V.require((0...(refined ? 43200.0 : 86400.0)).contains(largest) && (0...1).contains(ratio), "Integration diagnostics mismatch.")
        if request.durationSeconds == 0 {
            try V.require(attempts == 0 && V.isNull(integration["smallestAcceptedStep"]) && largest == 0 && ratio == 0, "Zero-duration integration mismatch.")
        } else {
            let smallest = try V.number(integration["smallestAcceptedStep"])
            try V.require(accepted > 0 && smallest > 0 && smallest <= largest && largest <= abs(request.durationSeconds), "Accepted step bounds mismatch.")
        }
        return (accepted, rejected, evaluations, largest, ratio)
    }

    private static func validateCoordinates(_ result: [String: Any], request: NativeOrbitPropagationRequest) throws -> (state: [Double], sigmas: [Double]) {
        typealias V = NativeOrbitCovarianceReport
        let epoch = try V.object(result["epoch"])
        try V.require(V.number(epoch["referenceEpochTdb"]) == request.referenceEpochTdb && V.number(epoch["elapsedTdbSeconds"]) == request.durationSeconds
            && result["frame"] as? String == "heliocentric-IAU76/80-ecliptic-J2000", "Final split epoch/frame mismatch.")
        try V.require(V.strings(result["labels"]) == ["x", "y", "z", "vx", "vy", "vz"]
            && V.strings(result["units"]) == ["au", "au", "au", "au/d", "au/d", "au/d"], "Final axes mismatch.")
        let state = try V.vector(result["nominal"], 6), deviations = try V.vector(result["marginalSigmas"], 6)
        let root = try V.matrix(result["squareRoot"], 6), matrix = try V.matrix(result["matrix"], 6)
        for i in 0..<6 {
            try Task.checkCancellation()
            let expectedSigma = sqrt(matrix[i][i])
            try V.require(matrix[i][i] >= 0 && deviations[i] >= 0 && abs(deviations[i]-expectedSigma) <= 8 * expectedSigma.ulp, "Final variance mismatch.")
            for j in 0..<6 {
                try V.require(matrix[i][j] == matrix[j][i], "Asymmetric final covariance.")
                var expected = 0.0
                for k in 0..<6 { expected += root[i][k] * root[j][k] }
                try V.require(expected.isFinite, "Nonfinite covariance root product.")
                if deviations[i] == 0 || deviations[j] == 0 { try V.require(expected == matrix[i][j], "Zero-variance root mismatch.") }
                else {
                    let scaled = abs(expected-matrix[i][j]) / deviations[i] / deviations[j]
                    try V.require(scaled.isFinite && scaled <= 1e-10, "Covariance root mismatch.")
                }
            }
        }
        return (state, deviations)
    }

    static func integer(_ value: Any?) throws -> Int {
        let n = try NativeOrbitCovarianceReport.number(value)
        try NativeOrbitCovarianceReport.require(n >= 0 && n <= 2147483647 && n == floor(n), "Nonnegative integer required.")
        return Int(n)
    }
}
