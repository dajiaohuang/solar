import Foundation

struct NativeCoverageReport: Decodable, Equatable {
    struct Window: Decodable, Equatable {
        let startEt: Double
        let endEt: Double
        let timeScale: String
    }
    struct Counts: Decodable, Equatable {
        let sourceRecords: UInt64
        let mappedSourceRecords: UInt64
        let unresolvedSourceRecords: UInt64
        let explicitNaifTargets: UInt64
        let availableTargetsAtAuditEpoch: UInt64
    }
    struct WindowCounts: Decodable, Equatable {
        let dependencyCoveredTargets: UInt64
        let targetsWithDependencyGaps: UInt64
        let numericallyCertifiedWholeWindowTargets: UInt64?

        private enum CodingKeys: String, CodingKey { case dependencyCoveredTargets, targetsWithDependencyGaps, numericallyCertifiedWholeWindowTargets }
        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            guard container.contains(.numericallyCertifiedWholeWindowTargets) else {
                throw StateTileFailure.invalid("Coverage certification must be explicitly null.")
            }
            dependencyCoveredTargets = try container.decode(UInt64.self, forKey: .dependencyCoveredTargets)
            targetsWithDependencyGaps = try container.decode(UInt64.self, forKey: .targetsWithDependencyGaps)
            numericallyCertifiedWholeWindowTargets = try container.decodeIfPresent(UInt64.self, forKey: .numericallyCertifiedWholeWindowTargets)
        }
    }

    let apiVersion: String
    let purpose: String
    let reportSha256: String
    let catalogVersion: String
    let catalogManifestSha256: String
    let inventoryManifestSha256: String
    let sourceSnapshotSha256: String
    let identityMappingSha256: String
    let satelliteCatalogSha256: String
    let sourceBytesVerified: Bool
    let profile: String
    let auditEt: Double
    let timeScale: String
    let frame: String
    let requestedWindow: Window
    let counts: Counts
    let windowCounts: WindowCounts
    let unresolvedReasons: [String: UInt64]

    static let maxBytes = 64 * 1024
    static let maxReasonLength = 128
    private static let maxSafeInteger: UInt64 = 9_007_199_254_740_991
    private static let hashPattern = "\\A[0-9a-f]{64}\\z"

    init(validating data: Data, catalogManifest: Data) throws {
        guard data.count <= Self.maxBytes, catalogManifest.count <= 8 * 1024 * 1024 else { throw StateTileFailure.invalid("Coverage response exceeds its size bound.") }
        let decoder = JSONDecoder()
        let report = try decoder.decode(Self.self, from: data)
        let manifest = try decoder.decode(NativeCoverageManifest.self, from: catalogManifest)
        try report.validate(against: manifest)
        self = report
    }

    private func validate(against manifest: NativeCoverageManifest) throws {
        guard apiVersion == "solar.api/v1",
              purpose == "source-identity-and-dependency-window-audit",
              profile == "full", sourceBytesVerified,
              timeScale == "TDB seconds past J2000", frame == "ECLIPJ2000",
              manifest.apiVersion == "solar.api/v1",
              !catalogVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !manifest.catalogVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              catalogVersion.trimmingCharacters(in: .whitespacesAndNewlines) == manifest.catalogVersion.trimmingCharacters(in: .whitespacesAndNewlines),
              catalogManifestSha256 == manifest.catalogManifestSha256,
              inventoryManifestSha256 == manifest.inventoryManifestSha256,
              Self.isHash(reportSha256), Self.isHash(catalogManifestSha256),
              Self.isHash(inventoryManifestSha256), Self.isHash(sourceSnapshotSha256),
              Self.isHash(identityMappingSha256), Self.isHash(satelliteCatalogSha256),
              auditEt.isFinite, requestedWindow.startEt.isFinite, requestedWindow.endEt.isFinite,
              requestedWindow.startEt <= requestedWindow.endEt,
              requestedWindow.timeScale == timeScale else {
            throw StateTileFailure.invalid("Coverage report provenance is invalid.")
        }
        let c = counts
        guard Self.safe(c.sourceRecords), Self.safe(c.mappedSourceRecords), Self.safe(c.unresolvedSourceRecords),
              Self.safe(c.explicitNaifTargets), Self.safe(c.availableTargetsAtAuditEpoch),
              Self.sum([c.mappedSourceRecords, c.unresolvedSourceRecords]) == c.sourceRecords,
              c.explicitNaifTargets <= c.mappedSourceRecords,
              c.availableTargetsAtAuditEpoch <= c.explicitNaifTargets else {
            throw StateTileFailure.invalid("Coverage report counts are inconsistent.")
        }
        let w = windowCounts
        guard Self.safe(w.dependencyCoveredTargets), Self.safe(w.targetsWithDependencyGaps),
              Self.sum([w.dependencyCoveredTargets, w.targetsWithDependencyGaps]) == c.explicitNaifTargets,
              w.numericallyCertifiedWholeWindowTargets == nil else {
            throw StateTileFailure.invalid("Coverage window certification is invalid.")
        }
        guard unresolvedReasons.count <= 128, unresolvedReasons.allSatisfy({ key, value in
            key.utf8.count <= Self.maxReasonLength && key.range(of: "\\A[a-z0-9][a-z0-9-]{0,127}\\z", options: .regularExpression) != nil && Self.safe(value)
        }), Self.sum(unresolvedReasons.values) == c.unresolvedSourceRecords else {
            throw StateTileFailure.invalid("Coverage unresolved reasons are invalid.")
        }
    }

    static func isHash(_ value: String) -> Bool { value.utf8.count == 64 && value.range(of: hashPattern, options: .regularExpression) != nil }
    private static func safe(_ value: UInt64) -> Bool { value <= maxSafeInteger }
    private static func sum<S: Sequence>(_ values: S) -> UInt64? where S.Element == UInt64 {
        var total: UInt64 = 0
        for value in values {
            let (next, overflow) = total.addingReportingOverflow(value)
            guard !overflow, safe(next) else { return nil }
            total = next
        }
        return total
    }
}

struct NativeCoverageManifest: Decodable, Equatable {
    let apiVersion: String
    let catalogVersion: String
    let catalogManifestSha256: String
    let inventoryManifestSha256: String
}
