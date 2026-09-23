import Foundation

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
