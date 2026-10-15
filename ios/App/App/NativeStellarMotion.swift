import Foundation
import CoreFoundation

/// The original files remain authoritative. Scientific row validation belongs
/// to the backend and response validator, never to invented default values.
struct NativeStellarMotionRequest: Encodable, Equatable {
    static let rvPolicy = "spectroscopic-as-astrometric"
    static let independentRVPolicy = "independent-spectroscopic-rv"
    static let maxManifestBytes = 1024 * 1024
    static let maxRowsBytes = 16 * 1024 * 1024
    static let maxWireBytes = 26 * 1024 * 1024

    let originalManifestBase64: Data
    let originalRowsCsvBase64: Data
    let sourceId: String
    let targetEpochJulianYearTCB: Double
    let radialVelocityPolicy: String
    let covariancePolicy: String?

    init(manifest: Data, rows: Data, sourceId: String, epoch: Double,
         radialVelocityPolicy: String, covariancePolicy: String? = nil) throws {
        try Self.validateOriginalSources(manifest: manifest, rows: rows, sourceId: sourceId, radialVelocityPolicy: radialVelocityPolicy)
        guard epoch.isFinite, (1916...2116).contains(epoch),
              covariancePolicy == nil || covariancePolicy == Self.independentRVPolicy else {
            throw StateTileFailure.invalid("Explicit supported covariance assumption and J1916–J2116 TCB epoch required.")
        }
        originalManifestBase64 = manifest
        originalRowsCsvBase64 = rows
        self.sourceId = sourceId
        targetEpochJulianYearTCB = epoch
        self.radialVelocityPolicy = radialVelocityPolicy
        self.covariancePolicy = covariancePolicy
    }

    static func validateOriginalSources(manifest: Data, rows: Data, sourceId: String, radialVelocityPolicy: String) throws {
        guard !manifest.isEmpty, manifest.count <= Self.maxManifestBytes,
              !rows.isEmpty, rows.count <= Self.maxRowsBytes else {
            throw StateTileFailure.invalid("Original manifest/CSV must fit the 1 MiB/16 MiB byte budgets.")
        }
        guard sourceId.range(of: "\\A[1-9][0-9]{0,18}\\z", options: .regularExpression) != nil,
              let numericId = Int64(sourceId), numericId > 0 else {
            throw StateTileFailure.invalid("Exact positive signed-64-bit decimal Gaia source ID required.")
        }
        guard radialVelocityPolicy == Self.rvPolicy else {
            throw StateTileFailure.invalid("Explicit spectroscopic radial-velocity approximation required.")
        }
    }

    func bytes() throws -> Data {
        try Task.checkCancellation()
        let encoder = JSONEncoder()
        encoder.dataEncodingStrategy = .base64
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let data = try encoder.encode(self)
        try Task.checkCancellation()
        guard data.count <= Self.maxWireBytes else {
            throw StateTileFailure.invalid("Stellar wire request exceeds 26 MiB.")
        }
        return data
    }
}

/// UTC is authoritative; a station request carries no independent stellar year.
struct NativeStellarObserverRequest: Encodable, Equatable {
    struct Station: Encodable, Equatable {
        let longitudeDeg, latitudeDeg, heightMeters: Double
    }
    struct Atmosphere: Encodable, Equatable {
        let pressureHPa, temperatureC, relativeHumidity, wavelengthMicrometers: Double
        func validate() throws {
            guard [pressureHPa, temperatureC, relativeHumidity, wavelengthMicrometers].allSatisfy(\.isFinite),
                  (0...1100).contains(pressureHPa), (-100...100).contains(temperatureC),
                  (0...1).contains(relativeHumidity), (0.1...1e6).contains(wavelengthMicrometers) else {
                throw StateTileFailure.invalid("Invalid stellar observer atmosphere.")
            }
        }
    }
    let originalManifestBase64, originalRowsCsvBase64: Data
    let sourceId, radialVelocityPolicy, utc: String
    let station: Station
    let atmosphere: Atmosphere?

    init(manifest: Data, rows: Data, sourceId: String, radialVelocityPolicy: String, utc: String,
         station: Station, atmosphere: Atmosphere? = nil) throws {
        try NativeStellarMotionRequest.validateOriginalSources(manifest: manifest, rows: rows, sourceId: sourceId, radialVelocityPolicy: radialVelocityPolicy)
        guard utc.range(of: "\\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z\\z", options: .regularExpression) != nil else {
            throw StateTileFailure.invalid("Explicit ISO UTC Z required; SOFA validates calendar and leap seconds.")
        }
        guard [station.longitudeDeg, station.latitudeDeg, station.heightMeters].allSatisfy(\.isFinite),
              abs(station.longitudeDeg) <= 180, abs(station.latitudeDeg) <= 90,
              (-1000...100000).contains(station.heightMeters) else {
            throw StateTileFailure.invalid("Invalid WGS84 stellar observer station.")
        }
        try atmosphere?.validate()
        originalManifestBase64 = manifest; originalRowsCsvBase64 = rows
        self.sourceId = sourceId; self.radialVelocityPolicy = radialVelocityPolicy
        self.utc = utc; self.station = station; self.atmosphere = atmosphere
    }

    func bytes() throws -> Data {
        try Task.checkCancellation()
        let encoder = JSONEncoder()
        encoder.dataEncodingStrategy = .base64
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let data = try encoder.encode(self)
        try Task.checkCancellation()
        guard data.count <= NativeStellarMotionRequest.maxWireBytes else {
            throw StateTileFailure.invalid("Stellar observer wire request exceeds 26 MiB.")
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
        let envelope = try Self.jsonObject(raw)
        try Self.require(envelope["apiVersion"] as? String == "solar.api/v1", "Stellar API identity mismatch.")
        let values = try Self.validateExperiment(Self.object(envelope["experiment"]), request: request)
        state = values.state; formalStandardDeviations = values.deviations
        sourceId = request.sourceId; epoch = request.targetEpochJulianYearTCB; originalResponse = raw
    }

    static func validateExperiment(_ experiment: [String: Any], request: NativeStellarMotionRequest) throws -> (state: [Double], deviations: [Double]?) {
        try Task.checkCancellation()
        let result = try Self.object(experiment["result"])
        try Self.require(Self.number(experiment["schemaVersion"]) == 1, "Stellar schema mismatch.")
        let manifest = request.originalManifestBase64, rows = request.originalRowsCsvBase64
        try Self.require(Self.matchesOriginalBase64(experiment["originalManifestBase64"], original: manifest)
            && Self.matchesOriginalBase64(experiment["originalRowsCsvBase64"], original: rows)
            && experiment["manifestSha256"] as? String == StateTileDecoder.cancellableSHA256(manifest)
            && experiment["rowsSha256"] as? String == StateTileDecoder.cancellableSHA256(rows), "Original stellar source bytes/hash mismatch.")
        let source = try Self.object(experiment["selectedSource"])
        let original = try Self.selectedRow(rows, id: request.sourceId)
        try Self.require(source.count == original.count, "Selected source field count differs from CSV.")
        for (key, value) in original {
            if key == "source_id" { try Self.require(source[key] as? String == value as? String, "Selected source ID differs from CSV.") }
            else if value is NSNull { try Self.require(source[key] is NSNull, "Missing CSV value was replaced.") }
            else {
                let actual = try Self.number(source[key]), expected = try Self.number(value)
                try Self.require(actual == expected, "Selected source field \(key) differs from CSV: \(actual.bitPattern) versus \(expected.bitPattern).")
            }
        }
        try Self.require(Self.number(source["ref_epoch"]) == 2016
            && result["sourceId"] as? String == request.sourceId
            && Self.number(result["targetEpochJulianYearTCB"]) == request.targetEpochJulianYearTCB
            && result["model"] as? String == "gofa-starpm-scaled-gaia-single-star-v1"
            && result["radialVelocityPolicy"] as? String == NativeStellarMotionRequest.rvPolicy
            && Self.number(result["tdbCompatibleScaleFactor"]) == 1 - 1.550519768e-8, "Stellar model identity mismatch.")
        try Self.texts(result["limitations"])
        try Self.require(!(experiment["provenanceBoundary"] as? String ?? "").isEmpty, "Stellar provenance boundary missing.")
        try Self.epochParts(result["sourceJdTdbParts"], yearTCB: 2016)
        try Self.epochParts(result["targetJdTdbParts"], yearTCB: request.targetEpochJulianYearTCB)
        let values = try Self.object(result["stateTCBCompatible"])
        let nominal = try ["raDeg", "decDeg", "parallaxMas", "pmraMasPerJulianYear", "pmdecMasPerJulianYear", "radialVelocityKmPerSecond"].map { try Self.number(values[$0]) }
        try Self.require(nominal[0] >= 0 && nominal[0] < 360 && abs(nominal[1]) < 90 && nominal[2] > 0, "Stellar state domain mismatch.")
        let deviations: [Double]?
        if request.covariancePolicy != nil {
            deviations = try Self.covariance(Self.object(experiment["formalCovariance"]), source: source, request: request)
        } else {
            try Self.require(experiment["formalCovariance"] == nil, "Unrequested covariance.")
            deviations = nil
        }
        try Task.checkCancellation()
        return (nominal, deviations)
    }

    private static func epochParts(_ raw: Any?, yearTCB: Double) throws {
        let parts = try vector(raw, count: 2)
        try require(yearTCB.isFinite && abs(yearTCB-2016) <= 100 && parts.allSatisfy { abs($0) <= 10000000 }, "Stellar epoch domain mismatch.")
        // IAU 2006 B3; retain a J2000 split. The two-microsecond allowance is
        // for receipt arithmetic/representation, not a physical error bound.
        let elapsed = (yearTCB-2000)*365.25
        let expected = elapsed - 6.55e-5/86400 - ((2451545-2443144.5)+(elapsed-32.184/86400))*1.550519768e-8
        let difference = (parts[0]-2451545)+(parts[1]-expected)
        try require(difference.isFinite && abs(difference)*86400 <= 2e-6, "Stellar TDB epoch does not match requested TCB epoch.")
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
                let inputDifference = abs(expected - input[i][j]) / sqrt(input[i][i]) / sqrt(input[j][j])
                try require(expected.isFinite && inputDifference.isFinite && inputDifference <= 1e-10, "Input covariance differs from source errors.")
                var transformed = 0.0
                for a in 0..<6 { for b in 0..<6 { transformed += jacobian[i][a] * input[a][b] * jacobian[j][b] } }
                let outputDifference = abs(transformed - output[i][j]) / sqrt(output[i][i]) / sqrt(output[j][j])
                try require(transformed.isFinite && outputDifference.isFinite && outputDifference <= 1e-10, "Covariance Jacobian mismatch.")
            }
        }
        return (0..<6).map { sqrt(output[$0][$0]) }
    }

    private static func positive(_ matrix: [[Double]]) throws {
        var lower = Array(repeating: Array(repeating: 0.0, count: 6), count: 6)
        try require((0..<6).allSatisfy { matrix[$0][$0] > 0 }, "Nonpositive covariance variance.")
        for i in 0..<6 { for j in 0...i {
            try require(matrix[i][j] == matrix[j][i], "Asymmetric covariance.")
            var value = matrix[i][j] / sqrt(matrix[i][i]) / sqrt(matrix[j][j])
            try require(value.isFinite, "Nonfinite covariance correlation.")
            for k in 0..<j { value -= lower[i][k] * lower[j][k] }
            if i == j { try require(value.isFinite && value > 0, "Covariance not positive definite."); lower[i][j] = sqrt(value) }
            else { lower[i][j] = value / lower[j][j]; try require(lower[i][j].isFinite, "Nonfinite covariance factor.") }
        } }
    }

    // Compare canonical padded Base64 without materializing a second full source
    // encoding. A multiple-of-three chunk size pads only the final chunk.
    static func matchesOriginalBase64(_ value: Any?, original: Data) throws -> Bool {
        try Task.checkCancellation()
        guard let encoded = value as? String else { return false }
        var supplied = encoded.utf8.makeIterator()
        return try original.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            var offset = 0
            while offset < bytes.count {
                try Task.checkCancellation()
                let size = min(12 * 1024, bytes.count - offset)
                let chunk = Data(bytes: bytes.baseAddress!.advanced(by: offset), count: size)
                for byte in chunk.base64EncodedString().utf8 {
                    guard supplied.next() == byte else { return false }
                }
                offset += size
            }
            try Task.checkCancellation()
            return supplied.next() == nil
        }
    }

    private static func selectedRow(_ data: Data, id: String) throws -> [String: Any] {
        try Task.checkCancellation()
        return try data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            try selectedRow(bytes, id: id)
        }
    }

    // The borrowed source buffer is used only during this synchronous scan.
    private static func selectedRow(_ bytes: UnsafeRawBufferPointer, id: String) throws -> [String: Any] {
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
                try Task.checkCancellation()
                guard let field = String(bytes: cell, encoding: .utf8) else {
                    throw StateTileFailure.invalid("Invalid CSV UTF-8.")
                }
                row.append(field); cell.removeAll(keepingCapacity: true); closed = false
                if byte != 44 {
                    if byte == 13 && index + 1 < bytes.count && bytes[index + 1] == 10 { index += 1 }
                    if row != [""] {
                        if let columns = header {
                            count += 1
                            try require(count <= 30000 && row.count == columns.count, "CSV row shape/budget mismatch.")
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
            try Task.checkCancellation()
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

    fileprivate static func object(_ value: Any?) throws -> [String: Any] {
        guard let object = value as? [String: Any] else { throw StateTileFailure.invalid("Stellar object required.") }
        return object
    }
    // Decode numeric tokens directly to binary64. Do not route science values
    // through Foundation's inferred NSNumber/NSDecimalNumber representation.
    static func jsonObject(_ data: Data) throws -> [String: Any] {
        try object(JSONDecoder().decode(ScientificJSON.self, from: data).value)
    }
    private struct ScientificJSON: Decodable {
        let value: Any
        private struct Key: CodingKey {
            let stringValue: String
            var intValue: Int? { nil }
            init?(stringValue: String) { self.stringValue = stringValue }
            init?(intValue: Int) { return nil }
        }
        init(from decoder: Decoder) throws {
            try Task.checkCancellation()
            guard decoder.codingPath.count <= 32 else {
                throw StateTileFailure.invalid("Stellar JSON nesting exceeds its budget.")
            }
            let container = try decoder.singleValueContainer()
            if container.decodeNil() { value = NSNull() }
            else if let boolean = try? container.decode(Bool.self) { value = boolean }
            else if let number = try? container.decode(Double.self), number.isFinite { value = number }
            else if let text = try? container.decode(String.self) { value = text }
            else if var items = try? decoder.unkeyedContainer() {
                // Only container selection may fail speculatively. Child failures,
                // including cancellation and depth limits, must propagate unchanged.
                var list: [Any] = []
                while !items.isAtEnd {
                    try Task.checkCancellation()
                    list.append(try items.decode(ScientificJSON.self).value)
                }
                value = list
            } else {
                let fields = try decoder.container(keyedBy: Key.self)
                var object: [String: Any] = [:]
                for key in fields.allKeys {
                    try Task.checkCancellation()
                    object[key.stringValue] = try fields.decode(ScientificJSON.self, forKey: key).value
                }
                value = object
            }
            try Task.checkCancellation()
        }
    }
    fileprivate static func number(_ value: Any?) throws -> Double {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { throw StateTileFailure.invalid("Finite stellar number required.") }
        return number.doubleValue
    }
    private static func texts(_ value: Any?) throws {
        guard let values = value as? [String], !values.isEmpty, values.allSatisfy({ !$0.isEmpty }) else { throw StateTileFailure.invalid("Stellar limits required.") }
    }
    fileprivate static func vector(_ value: Any?, count: Int) throws -> [Double] {
        guard let values = value as? [Any], values.count == count else { throw StateTileFailure.invalid("Stellar vector shape mismatch.") }
        return try values.map { try number($0) }
    }
    private static func matrix(_ value: Any?) throws -> [[Double]] {
        guard let values = value as? [Any], values.count == 6 else { throw StateTileFailure.invalid("Stellar matrix shape mismatch.") }
        return try values.map { try vector($0, count: 6) }
    }
    fileprivate static func require(_ condition: Bool, _ message: String) throws {
        if !condition { throw StateTileFailure.invalid(message) }
    }
}

/// Checks consistency/source identity; does not independently compute astrometry.
struct NativeStellarObserverReport: Sendable {
    static let maxBytes = 14 * 1024 * 1024
    private typealias V = NativeStellarMotionReport
    let originalResponse: Data
    let sourceId, utc, catalogVersion, catalogManifestSha256, earthOrientationSha256, refractionStatus: String
    let coordinateDirection, epochTdbParts, airless, catalogState: [Double]
    let refracted: [Double]?
    let raDeg, decDeg, cirsRaDeg, cirsDecDeg, solarElongationDeg: Double
    let solarDeflectionLimited: Bool
    let notes: [String]

    init(validating raw: Data, request: NativeStellarObserverRequest) throws {
        try V.require(!raw.isEmpty && raw.count <= Self.maxBytes, "Stellar observer response exceeds its budget.")
        try Task.checkCancellation()
        let envelope = try V.jsonObject(raw), e = try V.object(envelope["experiment"])
        try V.require(envelope["apiVersion"] as? String == "solar.api/v1" && V.number(e["schemaVersion"]) == 1
            && e["model"] as? String == "source-gaia-starpm-pmpx-earth-station-v1", "Stellar observer identity mismatch.")
        let catalogVersion = try Self.text(envelope["catalogVersion"]), catalogHash = try Self.hash(envelope["catalogManifestSha256"])
        let observation = try V.object(e["observation"]), echo = try V.object(observation["request"]), station = try V.object(echo["station"])
        try V.require(observation["model"] as? String == "earth-station-iau2006-2000a-spk-v1" && echo["utc"] as? String == request.utc
            && echo["bodyIds"] as? [String] == ["naif:10"] && V.number(station["longitudeDeg"]) == request.station.longitudeDeg
            && V.number(station["latitudeDeg"]) == request.station.latitudeDeg && V.number(station["heightMeters"]) == request.station.heightMeters,
            "Stellar station echo mismatch.")
        if let wanted = request.atmosphere {
            let a = try V.object(echo["atmosphere"])
            try V.require(V.number(a["pressureHPa"]) == wanted.pressureHPa && V.number(a["temperatureC"]) == wanted.temperatureC
                && V.number(a["relativeHumidity"]) == wanted.relativeHumidity && V.number(a["wavelengthMicrometers"]) == wanted.wavelengthMicrometers, "Stellar weather echo mismatch.")
        } else { try V.require(Self.absent(echo["atmosphere"]), "Unrequested stellar atmosphere.") }
        let manifest = try V.object(envelope["earthOrientation"]), sample = try V.object(observation["earthOrientation"])
        let eopHash = try Self.hash(manifest["sha256"]), retrieved = try Self.text(manifest["retrievedAt"])
        try V.require(manifest["sourceUrl"] as? String == "https://data.iers.org/products/eop/rapid/standard/finals2000A.all"
            && sample["sourceSha256"] as? String == eopHash && sample["retrievedAt"] as? String == retrieved, "Stellar EOP identity mismatch.")
        _ = try Self.boolean(sample["predicted"]); _ = try Self.boolean(sample["celestialPoleCorrectionAvailable"])
        for key in ["xpArcsec", "ypArcsec", "ut1MinusUtcSeconds"] { _ = try V.number(sample[key]) }
        let jd = try V.number(observation["jdTdb"])
        _ = try V.number(observation["jdTt"]); _ = try V.number(observation["jdUt1"])
        let contract = try V.object(observation["contract"]), observer = try V.object(observation["observerState"])
        try V.require(observer["frame"] as? String == "J2000" && observer["origin"] as? String == "solar-system-barycenter"
            && contract["vectorFrame"] as? String == "J2000" && contract["vectorUnit"] as? String == "km"
            && contract["vectorOrigin"] as? String == "observer-at-reception" && contract["stationDatum"] as? String == "WGS84-ellipsoidal-height"
            && contract["angleUnit"] as? String == "deg" && contract["azimuthConvention"] as? String == "north-zero-east-positive"
            && contract["physicalUncertainty"] as? String == "not-propagated"
            && contract["observerStateModel"] as? String == "SOFA-Apco; terrestrial rotation plus source Earth barycentric state", "Stellar observer vector contract mismatch.")
        _ = try V.vector(observer["positionKm"], count: 3); _ = try V.vector(observer["velocityKmPerSecond"], count: 3)
        let epoch = try V.vector(e["epochJdTdbParts"], count: 2), observerEpoch = try V.vector(observer["epochJdTdbParts"], count: 2)
        try V.require(epoch == observerEpoch && epoch[0]+epoch[1] == jd && epoch.allSatisfy { abs($0) <= 10000000 }, "Stellar observer epoch mismatch.")
        guard let sources = observation["sources"] as? [Any], (2...512).contains(sources.count) else { throw StateTileFailure.invalid("Stellar SPK source budget mismatch.") }
        var earth = false, sun = false
        for rawSource in sources {
            let source = try V.object(rawSource), id = try Self.text(source["bodyId"])
            _ = try Self.text(source["source"]); _ = try Self.hash(source["kernelSha256"])
            let start = try V.number(source["startJdTdb"]), end = try V.number(source["endJdTdb"])
            try V.require(start <= end, "Invalid stellar SPK source interval.")
            if start <= jd && jd <= end { earth = earth || id == "naif:399"; sun = sun || id == "naif:10" }
        }
        try V.require(earth && sun, "Earth/Sun reception source coverage missing.")
        try Self.validateSun(observation["bodies"], atmosphere: request.atmosphere != nil)
        let stellar = try V.object(e["stellar"]), nominal = try V.object(stellar["result"]), year = try V.number(nominal["targetEpochJulianYearTCB"])
        let tdbOffset = (epoch[0]-2451545)+epoch[1]
        let elapsed1977 = (epoch[0]-2443144.5)+(epoch[1]-32.184/86400)
        let tcbOffset = tdbOffset+(1.550519768e-8*elapsed1977+6.55e-5/86400)/(1-1.550519768e-8)
        try V.require(abs(year-(2000+tcbOffset/365.25))*365.25*86400 <= 2e-6, "Stellar TCB year does not match observer epoch.")
        let nested = try NativeStellarMotionRequest(manifest: request.originalManifestBase64, rows: request.originalRowsCsvBase64,
            sourceId: request.sourceId, epoch: year, radialVelocityPolicy: request.radialVelocityPolicy)
        let values = try V.validateExperiment(stellar, request: nested)
        let target = try V.vector(nominal["targetJdTdbParts"], count: 2)
        let residual = ((epoch[0]-target[0])+(epoch[1]-target[1]))/365.25
        try V.require(abs(V.number(e["propagationResidualTdbJulianYears"])-residual)*365.25*86400 <= 2e-6, "Stellar residual epoch mismatch.")
        let coordinate = try Self.unit(e["coordinateDirectionBcrs"]), ra = try Self.angle(e["raDeg"], min: 0, max: 360, inclusive: false), dec = try Self.angle(e["decDeg"], min: -90, max: 90)
        let alpha = ra * .pi/180, delta = dec * .pi/180
        let expected = [cos(alpha)*cos(delta), sin(alpha)*cos(delta), sin(delta)]
        try V.require((0..<3).allSatisfy { abs(expected[$0]-coordinate[$0]) <= 1e-12 }, "Stellar direction and angles disagree.")
        let observed = try V.object(e["observed"])
        try V.require(observed["model"] as? String == "sofa-ldsun-ab-cirs-atioq-v1", "Stellar observed model mismatch.")
        _ = try Self.unit(observed["properDirectionGcrs"])
        let cirsRA = try Self.angle(observed["cirsRaDeg"], min: 0, max: 360, inclusive: false), cirsDec = try Self.angle(observed["cirsDecDeg"], min: -90, max: 90)
        let elongation = try Self.angle(observed["solarElongationDeg"], min: 0, max: 180), limited = try Self.boolean(observed["solarDeflectionLimited"])
        let warnings = try Self.texts(observed["warnings"])
        try V.require(warnings.contains("solar-deflection-limited-near-solar-center") == limited, "Solar limiter warning mismatch.")
        let airless = try Self.direction(observed["apparentAirless"])
        let status = request.atmosphere == nil ? "not-requested" : airless[1] < 5 ? "outside-altitude-domain" : "applied"
        try V.require(observed["refractionStatus"] as? String == status
            && warnings.contains("refraction-outside-supported-altitude-at-least-5-deg") == (status == "outside-altitude-domain"), "Stellar refraction status mismatch.")
        let refracted: [Double]?
        if status == "applied" { refracted = try Self.direction(observed["refracted"]) }
        else { try V.require(Self.absent(observed["refracted"]), "Unexpected stellar refraction."); refracted = nil }
        let limits = try Self.texts(e["limitations"], nonempty: true), observedLimits = try Self.texts(observed["limitations"], nonempty: true)
        let observerWarnings = try Self.texts(observation["warnings"])
        try Task.checkCancellation()
        self.originalResponse = raw; self.sourceId = request.sourceId; self.utc = request.utc
        self.catalogVersion = catalogVersion; catalogManifestSha256 = catalogHash; earthOrientationSha256 = eopHash
        refractionStatus = status; coordinateDirection = coordinate; epochTdbParts = epoch; self.airless = airless
        self.refracted = refracted; catalogState = values.state; raDeg = ra; decDeg = dec
        cirsRaDeg = cirsRA; cirsDecDeg = cirsDec; solarElongationDeg = elongation; solarDeflectionLimited = limited
        notes = limits + observerWarnings + warnings + observedLimits
    }

    private static func validateSun(_ raw: Any?, atmosphere: Bool) throws {
        guard let bodies = raw as? [Any], bodies.count == 1 else { throw StateTileFailure.invalid("Unexpected stellar observer bodies.") }
        let b = try V.object(bodies[0])
        try V.require(b["bodyId"] as? String == "naif:10", "Unexpected stellar observer body.")
        _ = try texts(b["warnings"])
        if b["status"] as? String == "available" {
            _ = try direction(b["geometric"]); _ = try direction(b["apparentAirless"])
            if !absent(b["refracted"]) { try V.require(atmosphere, "Unrequested solar refraction."); _ = try direction(b["refracted"]) }
            try V.require(V.number(b["lightTimeRangeKm"]) > 0 && V.number(b["lightTimeSeconds"]) > 0, "Invalid solar range.")
            _ = try V.vector(b["geometricPositionKm"], count: 3); _ = try V.vector(b["receptionPositionKm"], count: 3)
            let residual = try V.number(b["lightTimeResidualSeconds"])
            try V.require((0...0.00005).contains(residual), "Invalid solar light-time residual.")
        } else {
            try V.require(b["status"] as? String == "missing", "Invalid solar status."); _ = try text(b["missingReason"])
            for key in ["geometric", "apparentAirless", "refracted", "geometricPositionKm", "receptionPositionKm", "lightTimeResidualSeconds"] {
                try V.require(absent(b[key]), "Contradictory missing solar state.")
            }
        }
    }
    private static func absent(_ value: Any?) -> Bool { value == nil || value is NSNull }
    private static func text(_ value: Any?) throws -> String {
        guard let text = value as? String, !text.isEmpty else { throw StateTileFailure.invalid("Stellar observer text required.") }; return text
    }
    private static func texts(_ value: Any?, nonempty: Bool = false) throws -> [String] {
        guard let values = value as? [String], (!nonempty || !values.isEmpty), values.allSatisfy({ !$0.isEmpty }) else { throw StateTileFailure.invalid("Stellar observer text array required.") }; return values
    }
    private static func hash(_ value: Any?) throws -> String {
        let value = try text(value)
        try V.require(value.range(of: "\\A[a-f0-9]{64}\\z", options: .regularExpression) != nil, "Stellar observer SHA-256 required."); return value
    }
    private static func boolean(_ value: Any?) throws -> Bool {
        guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { throw StateTileFailure.invalid("Stellar observer boolean required.") }; return n.boolValue
    }
    private static func unit(_ value: Any?) throws -> [Double] {
        let vector = try V.vector(value, count: 3)
        try V.require(abs(hypot(hypot(vector[0],vector[1]),vector[2])-1) <= 1e-12, "Stellar unit direction required."); return vector
    }
    private static func angle(_ value: Any?, min: Double, max: Double, inclusive: Bool = true) throws -> Double {
        let number = try V.number(value)
        try V.require(number >= min && (inclusive ? number <= max : number < max), "Stellar angle domain mismatch."); return number
    }
    private static func direction(_ value: Any?) throws -> [Double] {
        let d = try V.object(value)
        return try [angle(d["azimuthDeg"], min: 0, max: 360, inclusive: false), angle(d["altitudeDeg"], min: -90, max: 90)]
    }
}

/// Provider reads run away from MainActor. Cancellation is cooperative between
/// bounded reads; a provider blocked inside an OS read may finish later.
actor StellarSourceReader {
    static let shared = StellarSourceReader()
    func read(_ url: URL, limit: Int) throws -> Data {
        try Task.checkCancellation()
        guard limit == NativeStellarMotionRequest.maxManifestBytes || limit == NativeStellarMotionRequest.maxRowsBytes || limit == NativeOrbitCovarianceRequest.maxSourceBytes else {
            throw StateTileFailure.invalid("Unsupported original-file byte budget.")
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var result = Data()
        while true {
            try Task.checkCancellation()
            let chunk = try file.read(upToCount: min(16384, limit - result.count + 1)) ?? Data()
            try Task.checkCancellation()
            if chunk.isEmpty { break }
            guard chunk.count <= limit - result.count else { throw StateTileFailure.invalid("Original file exceeds its byte budget.") }
            result.append(chunk)
        }
        guard !result.isEmpty else { throw StateTileFailure.invalid("Original file is empty.") }
        return result
    }
}
