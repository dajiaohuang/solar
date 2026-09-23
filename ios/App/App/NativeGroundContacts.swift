import Foundation

struct NativeGroundContactRequest: Codable, Equatable {
    struct Station: Codable, Equatable { let longitudeDeg, latitudeDeg, heightMeters: Double }
    let startUtc, endUtc: String
    let station: Station
    let foregroundId, backgroundId: Int
    let aberration: String
    func validate() throws {
        let utc = "\\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z\\z"
        guard startUtc.range(of: utc, options: .regularExpression) != nil, endUtc.range(of: utc, options: .regularExpression) != nil,
              station.longitudeDeg.isFinite, abs(station.longitudeDeg) <= 180, station.latitudeDeg.isFinite, abs(station.latitudeDeg) <= 90, station.heightMeters.isFinite,
              foregroundId > 0, backgroundId > 0, foregroundId != backgroundId, foregroundId != 399, backgroundId != 399, aberration == "CN" else { throw StateTileFailure.invalid("Explicit station, UTC bounds and distinct non-Earth CN targets required.") }
    }
}

struct NativeGroundContacts: Decodable {
    struct Contact: Decodable {
        let boundary, direction, utc: String
        let elapsedTaiSeconds: Double
        let bracketSeconds: [Double]
        let bracketUtc: [String]
    }
    struct Edge: Decodable {
        let kind, utc: String
        let elapsedTaiSeconds: Double
        let bracketSeconds: [Double]
        let bracketUtc: [String]
    }
    struct Window: Decodable {
        let boundary: String
        let start, end: Edge
        let durationSeconds: Double
        let numericalDurationBoundsSeconds: [Double]
    }
    struct Geometry: Decodable {
        let classification: String
        let separationRadians, foregroundAngularRadiusRadians, backgroundAngularRadiusRadians, externalGapRadians, internalGapRadians: Double
        func valid() -> Bool {
            let s = separationRadians, a = foregroundAngularRadiusRadians, b = backgroundAngularRadiusRadians, e = externalGapRadians, i = internalGapRadians
            return [s,a,b,e,i].allSatisfy(\.isFinite) && s >= 0 && s <= .pi && a > 0 && a < .pi/2 && b > 0 && b < .pi/2 && abs(e-(s-a-b)) <= 1e-12 && abs(i-(s-abs(a-b))) <= 1e-12 && classification == (e >= 0 ? "none" : i > 0 ? "partial" : a >= b ? "total" : "annular")
        }
    }
    struct Source: Decodable { let bodyId, source, kernelSha256: String; let startJdTdb, endJdTdb: Double }
    struct EOP: Decodable { let sha256, sourceUrl, retrievedAt: String }
    struct Contract: Decodable { let timeAxis, coverage: String; let stepSeconds, toleranceSeconds: Double; let maxEvaluations, maxContacts: Int }
    struct Result: Decodable {
        let model: String
        let request: NativeGroundContactRequest
        let durationSeconds: Double
        let evaluations: Int
        let contacts: [Contact]
        let sampledOverlapWindows: [Window]?
        let startGeometry, endGeometry: Geometry
        let sources: [Source]
        let earthOrientation: EOP
        let radiusSourceSha256, radiusSourceUrl: String
        let possibleMissedEvents: Bool
        let warnings: [String]
        let contract: Contract
    }
    let apiVersion, catalogVersion, catalogManifestSha256: String
    let result: Result
    static let maxBytes = 1024 * 1024
    static func decode(_ data: Data, request: NativeGroundContactRequest) throws -> Self {
        try request.validate()
        guard !data.isEmpty, data.count <= maxBytes else { throw StateTileFailure.invalid("Ground response exceeds bounds.") }
        let value = try JSONDecoder().decode(Self.self, from: data), r = value.result, c = r.contract
        let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let rawResult = raw?["result"] as? [String: Any], rawContract = rawResult?["contract"] as? [String: Any]
        guard value.apiVersion == "solar.api/v1", !value.catalogVersion.isEmpty, hash(value.catalogManifestSha256),
              r.request == request, r.model == "earth-station-cn-spherical-contacts-v1", r.possibleMissedEvents,
              r.durationSeconds.isFinite, r.durationSeconds >= 1, r.durationSeconds <= 86401, (1...8192).contains(r.evaluations),
              c.timeAxis == "TAI-elapsed-SI-seconds", c.coverage == "sampled-sign-changes-only", c.stepSeconds == 30, c.toleranceSeconds == 0.05, c.maxEvaluations == 8192, c.maxContacts == 512,
              rawContract?["physicalTimingUncertaintySeconds"] is NSNull,
              r.radiusSourceSha256 == "3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1",
              r.radiusSourceUrl == "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc",
              hash(r.earthOrientation.sha256), r.earthOrientation.sourceUrl == "https://data.iers.org/products/eop/rapid/standard/finals2000A.all",
              r.earthOrientation.retrievedAt.range(of: "\\A[0-9]{4}-[0-9]{2}-[0-9]{2}T.+Z\\z", options: .regularExpression) != nil,
              r.startGeometry.valid(), r.endGeometry.valid(), r.contacts.count <= 512, r.warnings.count <= 128 else { throw StateTileFailure.invalid("Ground scientific identity or contract mismatch.") }
        var expected: Set<String> = ["naif:399", "naif:10", "naif:\(request.foregroundId)", "naif:\(request.backgroundId)"]
        for source in r.sources {
            guard expected.remove(source.bodyId) != nil, !source.source.isEmpty, hash(source.kernelSha256), source.startJdTdb.isFinite, source.endJdTdb.isFinite, source.startJdTdb <= source.endJdTdb else { throw StateTileFailure.invalid("Invalid ground SPK evidence.") }
        }
        guard expected.isEmpty else { throw StateTileFailure.invalid("Missing ground SPK source.") }
        var previous = 0.0
        for contact in r.contacts {
            guard ["external", "internal"].contains(contact.boundary), ["enter", "exit", "sampled-zero"].contains(contact.direction), contact.elapsedTaiSeconds >= previous,
                  bracket(contact.elapsedTaiSeconds, contact.utc, contact.bracketSeconds, contact.bracketUtc, r.durationSeconds) else { throw StateTileFailure.invalid("Invalid contact bracket.") }
            previous = contact.elapsedTaiSeconds
        }
        if let windows = r.sampledOverlapWindows {
            guard windows.count <= 514 else { throw StateTileFailure.invalid("Too many overlap windows.") }
            var last = -1.0, ends = ["external": -1.0, "internal": -1.0]
            for window in windows {
                guard let previousEnd = ends[window.boundary], window.start.elapsedTaiSeconds >= last, window.start.elapsedTaiSeconds > previousEnd else { throw StateTileFailure.invalid("Unordered overlap windows.") }
                for (index, edge) in [window.start, window.end].enumerated() {
                    guard ["search-boundary", "sampled-zero", "bracketed-contact"].contains(edge.kind), bracket(edge.elapsedTaiSeconds, edge.utc, edge.bracketSeconds, edge.bracketUtc, r.durationSeconds),
                          (edge.kind == "search-boundary") == (edge.elapsedTaiSeconds == 0 || edge.elapsedTaiSeconds == r.durationSeconds),
                          edge.kind == "bracketed-contact" || edge.bracketSeconds == [edge.elapsedTaiSeconds, edge.elapsedTaiSeconds] else { throw StateTileFailure.invalid("Invalid overlap edge.") }
                    if edge.kind != "search-boundary" {
                        guard r.contacts.contains(where: { $0.boundary == window.boundary && $0.direction == (edge.kind == "sampled-zero" ? "sampled-zero" : index == 0 ? "enter" : "exit") && $0.elapsedTaiSeconds == edge.elapsedTaiSeconds && $0.utc == edge.utc && $0.bracketSeconds == edge.bracketSeconds && $0.bracketUtc == edge.bracketUtc }) else { throw StateTileFailure.invalid("Overlap edge has no contact evidence.") }
                    }
                }
                guard window.durationSeconds > 0, window.durationSeconds == window.end.elapsedTaiSeconds-window.start.elapsedTaiSeconds,
                      window.numericalDurationBoundsSeconds == [max(0, window.end.bracketSeconds[0]-window.start.bracketSeconds[1]), window.end.bracketSeconds[1]-window.start.bracketSeconds[0]] else { throw StateTileFailure.invalid("Invalid overlap duration bounds.") }
                last = window.start.elapsedTaiSeconds; ends[window.boundary] = window.end.elapsedTaiSeconds
            }
        }
        return value
    }
    private static func hash(_ value: String) -> Bool { value.range(of: "\\A[a-f0-9]{64}\\z", options: .regularExpression) != nil }
    private static func bracket(_ at: Double, _ utc: String, _ seconds: [Double], _ times: [String], _ duration: Double) -> Bool {
        let pattern = "\\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{6}Z\\z"
        return at.isFinite && seconds.count == 2 && times.count == 2 && seconds.allSatisfy(\.isFinite) && ([utc]+times).allSatisfy { $0.range(of: pattern, options: .regularExpression) != nil }
            && seconds[0] >= 0 && seconds[0] <= at && at <= seconds[1] && seconds[1] <= duration && seconds[1]-seconds[0] <= 0.05+1e-9 && times[0] <= utc && times[1] >= utc
    }
}
