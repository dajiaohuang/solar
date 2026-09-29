import Foundation
import CoreFoundation

struct NativeOrbitCovarianceRequest: Encodable {
    static let maxSourceBytes = 2 * 1024 * 1024
    struct GM: Encodable { let au3PerDay2: Double; let source: String }
    let originalSbdbBase64: Data
    let adoptedSolarGM: GM
    init(original: Data, gm: Double, source: String) throws {
        guard !original.isEmpty, original.count <= Self.maxSourceBytes, gm.isFinite, gm > 0,
              !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, source.utf8.count <= 4096 else {
            throw StateTileFailure.invalid("Original SBDB JSON (1 byte–2 MiB), positive GM and explicit source (at most 4096 UTF-8 bytes) required.")
        }
        originalSbdbBase64 = original; adoptedSolarGM = GM(au3PerDay2: gm, source: source)
    }
    func bytes() throws -> Data {
        try Task.checkCancellation()
        let encoder = JSONEncoder()
        // Base64 slashes must not consume the source request's wire budget twice.
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let result = try encoder.encode(self)
        try Task.checkCancellation()
        guard result.count <= 3 * 1024 * 1024 else { throw StateTileFailure.invalid("SBDB request exceeds 3 MiB.") }
        return result
    }
}

/// Source/receipt consistency is not independent validation of the conic model.
struct NativeOrbitCovarianceReport {
    static let maxBytes = 4 * 1024 * 1024
    let originalResponse: Data
    let designation, solutionId, sourceSHA256, model, conicClass: String
    let planetaryEphemeris, smallBodyEphemeris: String?
    let epochTdb: Double
    let labels: [String]
    let units: [String?]
    let nominal, sigmas: [Double]
    let limitations: [String]
    let gm: NativeOrbitCovarianceRequest.GM

    init(validating bytes: Data, request: NativeOrbitCovarianceRequest) throws {
        try Self.require(!bytes.isEmpty && bytes.count <= Self.maxBytes, "SBDB response exceeds byte budget.")
        try Task.checkCancellation()
        let envelope = try NativeStellarMotionReport.jsonObject(bytes)
        try Self.require(envelope["apiVersion"] as? String == "solar.api/v1", "SBDB API mismatch.")
        try self.init(validating: bytes, request: request, conversion: Self.object(envelope["conversion"]))
    }

    init(validating bytes: Data, request: NativeOrbitCovarianceRequest, conversion: [String: Any], responseLimit: Int = NativeOrbitCovarianceReport.maxBytes) throws {
        try Self.require(!bytes.isEmpty && bytes.count <= responseLimit, "SBDB response exceeds byte budget.")
        try Task.checkCancellation()
        let inspection = try Self.object(conversion["inspection"])
        let original = request.originalSbdbBase64
        let hash = try StateTileDecoder.cancellableSHA256(original)
        try Self.require(inspection["model"] as? String == "sbdb-solution-covariance-inspection-v1"
            && NativeStellarMotionReport.matchesOriginalBase64(inspection["originalSbdbBase64"], original: original)
            && inspection["sourceSha256"] as? String == hash, "SBDB original bytes/hash mismatch.")
        try Self.require(Self.number(inspection["sourceBytes"]) == Double(original.count), "SBDB byte count mismatch.")
        _ = try Self.text(inspection["provenanceLimitation"])
        let root = try NativeStellarMotionReport.jsonObject(original)
        let signature = try Self.object(root["signature"]), body = try Self.object(root["object"]), orbit = try Self.object(root["orbit"])
        let cov = try Self.object(orbit["covariance"]), source = try Self.object(inspection["source"]), coordinates = try Self.object(conversion["coordinates"])
        try Self.require(signature["version"] as? String == "1.3" && signature["source"] as? String == "NASA/JPL Small-Body Database (SBDB) API" && orbit["equinox"] as? String == "J2000", "Unsupported SBDB source signature/frame.")
        let epoch = try Self.sourceNumber(cov["epoch"]), standard = try Self.sourceNumber(orbit["epoch"]), solution = try Self.trimmed(orbit["orbit_id"])
        try Self.require(source["solutionId"] as? String == solution && Self.trimmed(body["des"]) == Self.text(source["designation"]) && Self.trimmed(body["spkid"]) == Self.text(source["spkId"]), "SBDB source identity mismatch.")
        if body["orbit_id"] != nil { try Self.require(body["orbit_id"] as? String == solution, "Conflicting SBDB solution identifiers.") }
        if !Self.isNull(orbit["cov_epoch"]) { try Self.require(Self.sourceNumber(orbit["cov_epoch"]) == epoch, "Conflicting covariance epochs.") }
        let frame = "heliocentric-IAU76/80-ecliptic-J2000"
        try Self.require(Self.number(source["solutionEpochTdb"]) == epoch && Self.number(source["standardElementEpochTdb"]) == standard && source["frame"] as? String == frame, "SBDB source epoch/frame mismatch.")
        for (field, originalField) in [("solutionDateLocal", "soln_date"), ("planetaryEphemeris", "pe_used"), ("smallBodyEphemeris", "sb_used")] {
            try Self.require(Self.optionalText(source[field]) == Self.optionalText(orbit[originalField]), "SBDB source metadata mismatch.")
        }
        let rawElements = Self.isNull(cov["elements"]) && epoch == standard ? orbit["elements"] : cov["elements"]
        let elements = try Self.named(rawElements)
        let models: [String: [String: Any]] = try Self.isNull(orbit["model_pars"]) ? [:] : Self.named(orbit["model_pars"])
        let inputLabels = try Self.array(cov["labels"]).map { try Self.trimmed($0) }, n = inputLabels.count
        let axes = ["e", "q", "tp", "node", "peri", "i"], names = ["e", "q", "tp", "om", "w", "i"]
        let originalUnits: [String?] = [nil, "au", "TDB", "deg", "deg", "deg"]
        try Self.require((6...16).contains(n) && Set(inputLabels).count == n && inputLabels.prefix(6).allSatisfy { axes.contains($0) }, "Unsupported SBDB axes.")
        var inputUnits: [String?] = [], input: [Double] = []
        for (index, label) in inputLabels.enumerated() {
            let entry: [String: Any]
            if index < 6 {
                guard let axis = axes.firstIndex(of: label), let found = elements[names[axis]] else { throw StateTileFailure.invalid("Missing orbital element.") }
                entry = found
                let unit = try Self.nullableText(entry["units"])
                try Self.require(unit == originalUnits[axis], "SBDB element unit mismatch.")
                inputUnits.append(axis == 2 ? "d" : originalUnits[axis])
            } else {
                guard let found = models[label], found["kind"] as? String == "EST" else { throw StateTileFailure.invalid("Extra covariance axes must be estimated model parameters.") }
                entry = found; inputUnits.append(Self.isNull(entry["units"]) ? nil : try Self.trimmed(entry["units"]))
            }
            input.append(try Self.sourceNumber(entry["value"]))
        }
        try Self.validateModelParameterAxes(inputLabels, models)
        try Self.require(Self.strings(source["labels"]) == inputLabels && Self.unitArray(source["units"]) == inputUnits && Self.strings(source["additionalParameters"]) == Array(inputLabels.dropFirst(6)), "Source axes mismatch.")
        try Self.require(Self.vector(source["nominal"], n) == input, "Source nominal parameters mismatch.")
        let matrix = try Self.matrix(source["matrix"], n), rawMatrix = try Self.array(cov["data"])
        try Self.require(rawMatrix.count == n, "Original covariance dimensions mismatch.")
        for i in 0..<n {
            try Task.checkCancellation()
            let row = try Self.array(rawMatrix[i])
            try Self.require(row.count == n && matrix[i][i] > 0, "Original covariance dimensions/variance mismatch.")
            for j in 0..<n { try Self.require(Self.sourceNumber(row[j]) == matrix[i][j], "Original covariance entry mismatch.") }
        }
        try Self.require(Self.number(coordinates["epochTdb"]) == epoch && coordinates["frame"] as? String == frame && Self.strings(coordinates["inputLabels"]) == inputLabels && Self.unitArray(coordinates["inputUnits"]) == inputUnits, "Coordinate source binding mismatch.")
        let outputLabels = ["x", "y", "z", "vx", "vy", "vz"] + Array(inputLabels.dropFirst(6))
        let outputUnits: [String?] = ["au", "au", "au", "au/d", "au/d", "au/d"] + Array(inputUnits.dropFirst(6))
        try Self.require(Self.strings(coordinates["labels"]) == outputLabels && Self.unitArray(coordinates["units"]) == outputUnits, "Cartesian axes mismatch.")
        let adopted = try Self.object(coordinates["adoptedSolarGM"])
        try Self.require(Self.number(adopted["au3PerDay2"]) == request.adoptedSolarGM.au3PerDay2 && adopted["source"] as? String == request.adoptedSolarGM.source, "Adopted GM mismatch.")
        let e = input[inputLabels.firstIndex(of: "e")!], q = input[inputLabels.firstIndex(of: "q")!], tp = input[inputLabels.firstIndex(of: "tp")!], inclination = input[inputLabels.firstIndex(of: "i")!]
        try Self.require(e >= 0 && q > 0 && (0...180).contains(inclination), "Invalid source conic.")
        let conic = try Self.object(coordinates["nominalConic"]), domain = try Self.object(coordinates["numericalDomain"])
        let universal = e > 0.9999, classification = e < 1 ? "elliptic" : e == 1 ? "parabolic" : "hyperbolic"
        try Self.require(Self.number(conic["eccentricity"]) == e && Self.number(conic["periapsisAU"]) == q && Self.number(conic["elapsedTdbDaysFromPeriapsis"]) == epoch-tp && conic["classification"] as? String == classification, "Conic identity mismatch.")
        let expectedModel = universal ? "universal-conic-osculating-coordinate-transform" : "elliptic-osculating-coordinate-transform"
        try Self.require(coordinates["model"] as? String == expectedModel && domain["formulation"] as? String == (universal ? "unwrapped-universal-periapsis" : "elliptic-anomaly") && Self.number(domain[universal ? "maximumAbsoluteDimensionlessTime" : "maximumAbsoluteMeanAnomalyRadians"]) == 1e6, "Coordinate numerical domain mismatch.")
        let state = try Self.vector(coordinates["nominal"], n), deviations = try Self.vector(coordinates["marginalSigmas"], n)
        let jacobian = try Self.matrix(coordinates["jacobian"], n), output = try Self.matrix(coordinates["matrix"], n)
        for i in 0..<n {
            try Self.require(output[i][i] >= 0 && deviations[i] >= 0, "Negative output variance.")
            let expectedSigma = sqrt(output[i][i])
            try Self.require(abs(deviations[i]-expectedSigma) <= 8*expectedSigma.ulp, "Marginal sigma mismatch.")
            for j in 0..<n {
                try Self.require(output[i][j] == output[j][i], "Asymmetric output covariance.")
                if i >= 6 { try Self.require(jacobian[i][j] == (i == j ? 1 : 0), "Extra-parameter identity mismatch.") }
                else if j >= 6 { try Self.require(jacobian[i][j] == 0, "Unexpected extra-parameter derivative.") }
            }
            if i >= 6 { try Self.require(state[i] == input[i], "Extra nominal parameter changed.") }
        }
        var left = Array(repeating: Array(repeating: 0.0, count: n), count: n)
        for i in 0..<n {
            try Task.checkCancellation()
            for j in 0..<n {
                for k in 0..<n { left[i][j] += jacobian[i][k]*Self.mean(matrix[k][j], matrix[j][k]) }
                try Self.require(left[i][j].isFinite, "Nonfinite receipt intermediate.")
            }
        }
        for i in 0..<n {
            try Task.checkCancellation()
            for j in i..<n {
                var expected = 0.0
                for k in 0..<n { expected += left[i][k]*jacobian[j][k] }
                try Self.require(expected.isFinite, "Nonfinite transformed receipt covariance.")
                if deviations[i] == 0 || deviations[j] == 0 { try Self.require(expected == output[i][j], "Zero-variance receipt mismatch.") }
                else { let scaled = abs(expected-output[i][j])/min(deviations[i],deviations[j])/max(deviations[i],deviations[j]); try Self.require(scaled.isFinite && scaled <= 1e-10, "Jacobian covariance receipt mismatch.") }
            }
        }
        let notes = try Self.strings(coordinates["limitations"])
        try Self.require(!notes.isEmpty, "Coordinate limitations missing.")
        originalResponse = bytes; designation = try Self.text(source["designation"]); solutionId = solution; sourceSHA256 = hash
        planetaryEphemeris = Self.optionalText(source["planetaryEphemeris"]); smallBodyEphemeris = Self.optionalText(source["smallBodyEphemeris"])
        model = expectedModel; conicClass = classification; epochTdb = epoch; labels = outputLabels; units = outputUnits
        nominal = state; sigmas = deviations; limitations = notes; gm = request.adoptedSolarGM
        try Task.checkCancellation()
    }
    static func require(_ condition: Bool, _ message: String) throws { if !condition { throw StateTileFailure.invalid(message) } }
    static func isNull(_ value: Any?) -> Bool { value == nil || value is NSNull }
    static func object(_ value: Any?) throws -> [String: Any] { guard let result = value as? [String: Any] else { throw StateTileFailure.invalid("SBDB object required.") }; return result }
    static func array(_ value: Any?) throws -> [Any] { guard let result = value as? [Any] else { throw StateTileFailure.invalid("SBDB array required.") }; return result }
    static func text(_ value: Any?) throws -> String { guard let result = value as? String, !result.isEmpty else { throw StateTileFailure.invalid("SBDB text required.") }; return result }
    static func trimmed(_ value: Any?) throws -> String { let result = try text(value).trimmingCharacters(in: .whitespacesAndNewlines); try require(!result.isEmpty, "SBDB text required."); return result }
    static func optionalText(_ value: Any?) -> String? { guard let result = value as? String else { return nil }; let trimmed = result.trimmingCharacters(in: .whitespacesAndNewlines); return trimmed.isEmpty ? nil : trimmed }
    static func nullableText(_ value: Any?) throws -> String? { if isNull(value) { return nil }; return try text(value) }
    static func strings(_ value: Any?) throws -> [String] { try array(value).map { try text($0) } }
    static func unitArray(_ value: Any?) throws -> [String?] { try array(value).map { try nullableText($0) } }
    static func number(_ value: Any?) throws -> Double { guard let result = value as? NSNumber, CFGetTypeID(result) != CFBooleanGetTypeID(), result.doubleValue.isFinite else { throw StateTileFailure.invalid("Finite SBDB number required.") }; return result.doubleValue }
    static func sourceNumber(_ value: Any?) throws -> Double {
        if let string = value as? String {
            let raw = string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard raw.range(of: #"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$"#, options: .regularExpression) != nil,
                  let result = Double(raw), result.isFinite else {
                throw StateTileFailure.invalid("Finite decimal SBDB numeric text required.")
            }
            return result
        }
        return try number(value)
    }
    static func vector(_ value: Any?, _ n: Int) throws -> [Double] { let values = try array(value); try require(values.count == n, "SBDB vector dimensions mismatch."); return try values.map { try number($0) } }
    static func matrix(_ value: Any?, _ n: Int) throws -> [[Double]] { let rows = try array(value); try require(rows.count == n, "SBDB matrix dimensions mismatch."); return try rows.map { try vector($0, n) } }
    static func validateModelParameterAxes(_ labels: [String], _ models: [String: [String: Any]]) throws {
        var estimated = Set<String>(), indices = Set<Int>()
        for (name, entry) in models {
            try Task.checkCancellation()
            let kind = try trimmed(entry["kind"])
            try require(["SET", "EST", "CON"].contains(kind), "Unsupported SBDB model parameter kind.")
            if kind == "EST" { estimated.insert(name) }
            let rawIndex = entry["n"]
            if isNull(rawIndex) { continue }
            let numeric = try sourceNumber(rawIndex)
            try require(numeric >= 0 && numeric <= 64 && numeric.rounded(.towardZero) == numeric, "Invalid SBDB model parameter index.")
            let index = Int(numeric)
            try require(kind == "SET" ? index == 0 : index > 0, "SBDB model parameter index/kind mismatch.")
            if kind != "SET" { try require(indices.insert(index).inserted, "Duplicate SBDB estimated/considered parameter index.") }
        }
        let axes = Array(labels.dropFirst(6))
        try require(axes.count == estimated.count && Set(axes) == estimated, "Covariance labels disagree with estimated model parameters.")
        var previous = 0
        for label in axes {
            let rawIndex = models[label]?["n"]
            if isNull(rawIndex) { continue }
            let index = Int(try sourceNumber(rawIndex))
            try require(index > previous, "Covariance labels disagree with SBDB model index order.")
            previous = index
        }
    }
    static func named(_ value: Any?) throws -> [String: [String: Any]] { let rows = try array(value); try require(rows.count <= 64, "SBDB named list exceeds supported size 64."); var result: [String: [String: Any]] = [:]; for raw in rows { try Task.checkCancellation(); let entry = try object(raw), name = try trimmed(entry["name"]); try require(result[name] == nil, "Duplicate SBDB element."); result[name] = entry }; return result }
    static func mean(_ a: Double, _ b: Double) -> Double { let low = min(a,b), high = max(a,b); return (low < 0) == (high < 0) ? low+(high-low)/2 : (low+high)/2 }
}
