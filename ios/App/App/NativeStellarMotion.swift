import Foundation
import CoreFoundation

/// The original files remain authoritative. Scientific row validation belongs
/// to the backend and response validator, never to invented default values.
struct NativeStellarMotionRequest: Encodable, Equatable {
    static let rvPolicy = "spectroscopic-as-astrometric"
    static let independentRVPolicy = "independent-spectroscopic-rv"
    static let maxManifestBytes = 1024 * 1024
    static let maxRowsBytes = 8 * 1024 * 1024
    static let maxWireBytes = 13 * 1024 * 1024

    let originalManifestBase64: Data
    let originalRowsCsvBase64: Data
    let sourceId: String
    let targetEpochJulianYearTCB: Double
    let radialVelocityPolicy: String
    let covariancePolicy: String?

    init(manifest: Data, rows: Data, sourceId: String, epoch: Double,
         radialVelocityPolicy: String, covariancePolicy: String? = nil) throws {
        guard !manifest.isEmpty, manifest.count <= Self.maxManifestBytes,
              !rows.isEmpty, rows.count <= Self.maxRowsBytes else {
            throw StateTileFailure.invalid("Original manifest/CSV must fit the 1 MiB/8 MiB byte budgets.")
        }
        guard sourceId.range(of: "\\A[1-9][0-9]{0,18}\\z", options: .regularExpression) != nil,
              let numericId = Int64(sourceId), numericId > 0 else {
            throw StateTileFailure.invalid("Exact positive signed-64-bit decimal Gaia source ID required.")
        }
        guard epoch.isFinite, (1916...2116).contains(epoch),
              radialVelocityPolicy == Self.rvPolicy,
              covariancePolicy == nil || covariancePolicy == Self.independentRVPolicy else {
            throw StateTileFailure.invalid("Explicit supported RV/covariance assumptions and J1916–J2116 TCB epoch required.")
        }
        originalManifestBase64 = manifest
        originalRowsCsvBase64 = rows
        self.sourceId = sourceId
        targetEpochJulianYearTCB = epoch
        self.radialVelocityPolicy = radialVelocityPolicy
        self.covariancePolicy = covariancePolicy
    }

    func bytes() throws -> Data {
        try Task.checkCancellation()
        let encoder = JSONEncoder()
        encoder.dataEncodingStrategy = .base64
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let data = try encoder.encode(self)
        try Task.checkCancellation()
        guard data.count <= Self.maxWireBytes else {
            throw StateTileFailure.invalid("Stellar wire request exceeds 13 MiB.")
        }
        return data
    }
}

/// Keeps the received bytes for export only after original-source and numeric
/// contract checks. This validates evidence, not the physical model's accuracy.
struct NativeStellarMotionReport: Sendable {
    static let maxBytes = 14 * 1024 * 1024
    let sourceId: String
    let epoch: Double
    let state: [Double]
    let formalStandardDeviations: [Double]?
    let originalResponse: Data

    init(validating raw: Data, request: NativeStellarMotionRequest) throws {
        try Self.require(!raw.isEmpty && raw.count <= Self.maxBytes, "Stellar response byte budget exceeded.")
        try Task.checkCancellation()
        let envelope = try Self.object(JSONSerialization.jsonObject(with: raw))
        let experiment = try Self.object(envelope["experiment"]), result = try Self.object(experiment["result"])
        try Self.require(envelope["apiVersion"] as? String == "solar.api/v1" && Self.number(experiment["schemaVersion"]) == 1, "Stellar API identity mismatch.")
        let manifest = request.originalManifestBase64, rows = request.originalRowsCsvBase64
        try Self.require(experiment["originalManifestBase64"] as? String == manifest.base64EncodedString()
            && experiment["originalRowsCsvBase64"] as? String == rows.base64EncodedString()
            && experiment["manifestSha256"] as? String == StateTileDecoder.sha256(manifest)
            && experiment["rowsSha256"] as? String == StateTileDecoder.sha256(rows), "Original stellar source bytes/hash mismatch.")
        let source = try Self.object(experiment["selectedSource"])
        let original = try Self.selectedRow(rows, id: request.sourceId)
        try Self.require(source.count == original.count, "Selected source field count differs from CSV.")
        for (key, value) in original {
            if key == "source_id" { try Self.require(source[key] as? String == value as? String, "Selected source ID differs from CSV.") }
            else if value is NSNull { try Self.require(source[key] is NSNull, "Missing CSV value was replaced.") }
            else { try Self.require(Self.number(source[key]) == Self.number(value), "Selected source value differs from CSV.") }
        }
        try Self.require(Self.number(source["ref_epoch"]) == 2016
            && result["sourceId"] as? String == request.sourceId
            && Self.number(result["targetEpochJulianYearTCB"]) == request.targetEpochJulianYearTCB
            && result["model"] as? String == "gofa-starpm-scaled-gaia-single-star-v1"
            && result["radialVelocityPolicy"] as? String == NativeStellarMotionRequest.rvPolicy
            && Self.number(result["tdbCompatibleScaleFactor"]) == 1 - 1.550519768e-8, "Stellar model identity mismatch.")
        try Self.texts(result["limitations"])
        try Self.require(!(experiment["provenanceBoundary"] as? String ?? "").isEmpty, "Stellar provenance boundary missing.")
        _ = try Self.vector(result["sourceJdTdbParts"], count: 2)
        _ = try Self.vector(result["targetJdTdbParts"], count: 2)
        let values = try Self.object(result["stateTCBCompatible"])
        let nominal = try ["raDeg", "decDeg", "parallaxMas", "pmraMasPerJulianYear", "pmdecMasPerJulianYear", "radialVelocityKmPerSecond"].map { try Self.number(values[$0]) }
        try Self.require(nominal[0] >= 0 && nominal[0] < 360 && abs(nominal[1]) < 90 && nominal[2] > 0, "Stellar state domain mismatch.")
        if request.covariancePolicy != nil {
            formalStandardDeviations = try Self.covariance(Self.object(experiment["formalCovariance"]), source: source, request: request)
        } else {
            try Self.require(experiment["formalCovariance"] == nil, "Unrequested covariance.")
            formalStandardDeviations = nil
        }
        try Task.checkCancellation()
        state = nominal; sourceId = request.sourceId; epoch = request.targetEpochJulianYearTCB; originalResponse = raw
    }

    private static func covariance(_ value: [String: Any], source: [String: Any], request: NativeStellarMotionRequest) throws -> [Double] {
        try require(value["model"] as? String == "first-order-starpm-covariance-v1"
            && value["policy"] as? String == NativeStellarMotionRequest.independentRVPolicy
            && value["timeScale"] as? String == "TCB" && value["frame"] as? String == "ICRS"
            && number(value["targetEpochJulianYearTCB"]) == request.targetEpochJulianYearTCB, "Covariance identity mismatch.")
        try require(value["coordinateLabels"] as? [String] == ["delta-alpha*cos(delta)", "delta-dec", "parallax", "pmra", "pmdec", "radial-velocity"]
            && value["coordinateUnits"] as? [String] == ["mas", "mas", "mas", "mas/Julian-year", "mas/Julian-year", "km/s"], "Covariance coordinate mismatch.")
        try texts(value["assumptions"])
        let difference = try number(value["maxScaledDerivativeDifference"])
        try require(difference >= 0 && difference <= 1e-4, "Covariance derivative not converged.")
        for step in try vector(value["differenceSteps"], count: 6) {
            try require(request.targetEpochJulianYearTCB == 2016 ? step == 0 : step > 0, "Invalid covariance derivative step.")
        }
        let input = try matrix(value["inputMatrix"]), output = try matrix(value["outputMatrix"]), jacobian = try matrix(value["jacobian"])
        try positive(input); try positive(output)
        let solution = try number(source["astrometric_params_solved"])
        try require(solution == 31 || solution == 95, "Invalid astrometric solution.")
        let fields = ["ra", "dec", "parallax", "pmra", "pmdec", "radial_velocity"]
        let sigma = try fields.map { try number(source[$0 + "_error"]) }
        try require(sigma.allSatisfy { $0 > 0 }, "Missing positive formal errors.")
        for i in 0..<6 {
            try Task.checkCancellation()
            for j in 0..<6 {
                var correlation = i == j ? 1.0 : 0.0
                if i < 5 && j < 5 && i != j {
                    correlation = try number(source[fields[min(i,j)] + "_" + fields[max(i,j)] + "_corr"])
                    try require(abs(correlation) <= 1, "Invalid source correlation.")
                }
                let expected = correlation * sigma[i] * sigma[j]
                try require(expected.isFinite && abs(expected - input[i][j]) / (sqrt(input[i][i]) * sqrt(input[j][j])) <= 1e-10, "Input covariance differs from source errors.")
                var transformed = 0.0
                for a in 0..<6 { for b in 0..<6 { transformed += jacobian[i][a] * input[a][b] * jacobian[j][b] } }
                try require(transformed.isFinite && abs(transformed - output[i][j]) / (sqrt(output[i][i]) * sqrt(output[j][j])) <= 1e-10, "Covariance Jacobian mismatch.")
            }
        }
        return (0..<6).map { sqrt(output[$0][$0]) }
    }

    private static func positive(_ matrix: [[Double]]) throws {
        var lower = Array(repeating: Array(repeating: 0.0, count: 6), count: 6)
        try require((0..<6).allSatisfy { matrix[$0][$0] > 0 }, "Nonpositive covariance variance.")
        for i in 0..<6 { for j in 0...i {
            try require(matrix[i][j] == matrix[j][i], "Asymmetric covariance.")
            var value = matrix[i][j] / (sqrt(matrix[i][i]) * sqrt(matrix[j][j]))
            for k in 0..<j { value -= lower[i][k] * lower[j][k] }
            if i == j { try require(value.isFinite && value > 0, "Covariance not positive definite."); lower[i][j] = sqrt(value) }
            else { lower[i][j] = value / lower[j][j] }
        } }
    }

    private static func selectedRow(_ data: Data, id: String) throws -> [String: Any] {
        try require(String(data: data, encoding: .utf8) != nil, "Invalid CSV UTF-8.")
        let bytes = Array(data)
        var header: [String]?, selected: [String]?, row = [String](), cell = [UInt8]()
        var quoted = false, closed = false, count = 0, index = 0, nextCheck = 0
        while index <= bytes.count {
            if index >= nextCheck { try Task.checkCancellation(); nextCheck = index + 32768 }
            let end = index == bytes.count, byte: UInt8 = end ? 10 : bytes[index]
            if quoted {
                try require(!end, "Unterminated CSV field.")
                if byte == 34 {
                    if index + 1 < bytes.count && bytes[index + 1] == 34 { cell.append(34); index += 1 }
                    else { quoted = false; closed = true }
                } else { cell.append(byte) }
                index += 1; continue
            }
            if byte == 44 || byte == 10 || byte == 13 {
                row.append(String(decoding: cell, as: UTF8.self)); cell.removeAll(keepingCapacity: true); closed = false
                if byte != 44 {
                    if byte == 13 && index + 1 < bytes.count && bytes[index + 1] == 10 { index += 1 }
                    if row != [""] {
                        if let columns = header {
                            count += 1
                            try require(count <= 10000 && row.count == columns.count, "CSV row shape/budget mismatch.")
                            if row[0] == id { try require(selected == nil, "Duplicate selected CSV source."); selected = row }
                        } else {
                            try require(row.first == "source_id" && !row.contains("") && Set(row).count == row.count, "Invalid CSV header.")
                            header = row
                        }
                    }
                    row.removeAll(keepingCapacity: true)
                }
            } else if byte == 34 && cell.isEmpty && !closed { quoted = true }
            else { try require(!closed && byte != 34, "Malformed CSV quoting."); cell.append(byte) }
            index += 1
        }
        guard let columns = header, let values = selected else { throw StateTileFailure.invalid("Selected source absent from CSV.") }
        var result = [String: Any]()
        for (i, key) in columns.enumerated() {
            let value = values[i]
            if i == 0 { result[key] = value }
            else if value.isEmpty { result[key] = NSNull() }
            else {
                guard value.range(of: "\\A[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?\\z", options: .regularExpression) != nil,
                      let number = Double(value), number.isFinite else { throw StateTileFailure.invalid("Invalid CSV numeric field.") }
                result[key] = number
            }
        }
        return result
    }

    private static func object(_ value: Any?) throws -> [String: Any] {
        guard let object = value as? [String: Any] else { throw StateTileFailure.invalid("Stellar object required.") }
        return object
    }
    private static func number(_ value: Any?) throws -> Double {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { throw StateTileFailure.invalid("Finite stellar number required.") }
        return number.doubleValue
    }
    private static func texts(_ value: Any?) throws {
        guard let values = value as? [String], !values.isEmpty, values.allSatisfy({ !$0.isEmpty }) else { throw StateTileFailure.invalid("Stellar limits required.") }
    }
    private static func vector(_ value: Any?, count: Int) throws -> [Double] {
        guard let values = value as? [Any], values.count == count else { throw StateTileFailure.invalid("Stellar vector shape mismatch.") }
        return try values.map { try number($0) }
    }
    private static func matrix(_ value: Any?) throws -> [[Double]] {
        guard let values = value as? [Any], values.count == 6 else { throw StateTileFailure.invalid("Stellar matrix shape mismatch.") }
        return try values.map { try vector($0, count: 6) }
    }
    private static func require(_ condition: Bool, _ message: String) throws {
        if !condition { throw StateTileFailure.invalid(message) }
    }
}
