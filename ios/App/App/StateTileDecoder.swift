import Foundation
import CryptoKit

enum StateTileFailure: Error, LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        switch self { case .invalid(let message): return message }
    }
}

struct TileMetadata: Decodable, Sendable {
    let id: String
    let source: String
    let datasetVersion: String
    let datasetSha256: String
    let kernelSha256: String
    let model: String
    let centerId: String
    let validityStartEt: Double
    let validityEndEt: Double
    let validityPresent: Bool
    let stateEvidence: String
    let evidenceWindowStartEt: Double
    let evidenceWindowEndEt: Double
    let evidenceWindowPresent: Bool
    let missingReason: String
    let identityStatus: String
    let sourceRecord: Bool
}

struct TileExpectation {
    let planHash: String
    let catalogHash: String
    let inventoryHash: String?
    let sequence: Int
    let tileCount: Int
    let ordinalStart: Int
    let epochJd: Double
    let ids: [String]
}

/// Float64 source states stay in a single packed allocation. Float32 conversion
/// belongs exclusively to the renderer after subtracting its reference origin.
struct VerifiedStateTile {
    let metadata: [TileMetadata]
    let exact: [Bool]
    let states: [Double]
    let payloadHash: String
}

enum StateTileDecoder {
    static let maxBytes = 64 * 1024 * 1024
    static let maxRows = 32_768

    static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func isHash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }

    static func requestHash(_ ids: [String]) -> String {
        var hash = SHA256()
        for id in ids {
            let bytes = Data(id.utf8)
            var length = UInt32(bytes.count).littleEndian
            withUnsafeBytes(of: &length) { hash.update(bufferPointer: $0) }
            hash.update(data: bytes)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func decode(_ input: Data, expected: TileExpectation,
                       checkCancellation: () throws -> Void = { try Task.checkCancellation() }) throws -> VerifiedStateTile {
        try checkCancellation()
        let data = Data(input)
        func require(_ condition: Bool, _ reason: String) throws {
            if !condition { throw StateTileFailure.invalid("State tile: \(reason)") }
        }
        try require(data.count >= 200 && data.count <= maxBytes, "invalid byte count")
        // Assemble little-endian scalars without assuming Data pointer alignment.
        func integer(_ offset: Int, _ width: Int) -> UInt64 {
            var value: UInt64 = 0
            for n in 0..<width { value |= UInt64(data[offset + n]) << (n * 8) }
            return value
        }
        func u32(_ offset: Int) -> Int { Int(integer(offset, 4)) }
        func hash(_ offset: Int) -> String {
            data[offset..<(offset + 32)].map { String(format: "%02x", $0) }.joined()
        }
        try require(data.prefix(8) == Data([83, 76, 82, 84, 73, 76, 69, 0]), "magic mismatch")
        try require(integer(8, 2) == 1 && integer(10, 2) == 200, "unsupported wire format")
        let sequence = u32(12), tileCount = u32(16), ordinal = u32(20), count = u32(24)
        let epoch = Double(bitPattern: integer(32, 8))
        try require(count > 0 && count <= maxRows && count == expected.ids.count, "row count mismatch")
        try require(sequence == expected.sequence && tileCount == expected.tileCount && tileCount > 0 && tileCount <= maxRows && sequence < tileCount && ordinal == expected.ordinalStart, "ordering mismatch")
        try require(integer(28, 2) == 6 && integer(30, 2) == 3 && epoch.isFinite && epoch == expected.epochJd, "numeric contract mismatch")
        try require(isHash(expected.planHash) && isHash(expected.catalogHash) && hash(72) == expected.planHash && hash(104) == expected.catalogHash, "source identity mismatch")
        let inventory = expected.inventoryHash ?? String(repeating: "0", count: 64)
        try require(isHash(inventory) && hash(136) == inventory, "inventory identity mismatch")
        let metadataOffset = u32(40), metadataLength = u32(44), exactOffset = u32(48)
        let bitmapLength = u32(52), approximateOffset = u32(56), missingOffset = u32(60)
        let statesOffset = u32(64), statesLength = u32(68)
        try require(metadataOffset == 200 && metadataLength > 0 && metadataOffset + metadataLength <= data.count, "metadata bounds")
        try require(bitmapLength == (count + 7) / 8 && exactOffset == metadataOffset + metadataLength && approximateOffset == exactOffset + bitmapLength && missingOffset == approximateOffset + bitmapLength, "bitmap bounds")
        try require(statesOffset == (missingOffset + bitmapLength + 7) / 8 * 8 && statesLength == count * 48 && statesOffset + statesLength == data.count, "state bounds")
        let payloadHash = hash(168)
        var digest = SHA256()
        for start in stride(from: 200, to: data.count, by: 262_144) {
            try checkCancellation()
            digest.update(data: data[start..<min(start + 262_144, data.count)])
        }
        try require(digest.finalize().map { String(format: "%02x", $0) }.joined() == payloadHash, "checksum mismatch")
        try require(data[approximateOffset..<(approximateOffset + bitmapLength)].allSatisfy { $0 == 0 }, "approximate bitmap is nonzero")
        if count % 8 != 0 {
            let unused = UInt8(truncatingIfNeeded: 0xff << (count % 8))
            try require(data[exactOffset + bitmapLength - 1] & unused == 0 && data[missingOffset + bitmapLength - 1] & unused == 0, "unused status bits are nonzero")
        }
        let metadataEnd = metadataOffset + metadataLength
        try require(data[metadataEnd - 1] == 10, "metadata must be newline-terminated UTF-8")
        try require(data[(missingOffset + bitmapLength)..<statesOffset].allSatisfy { $0 == 0 }, "nonzero alignment padding")
        let decoder = JSONDecoder()
        var rows = [TileMetadata](), exact = [Bool](), states = [Double]()
        rows.reserveCapacity(count); exact.reserveCapacity(count); states.reserveCapacity(count * 6)
        func bit(_ offset: Int, _ row: Int) -> Bool { data[offset + row / 8] & (1 << (row % 8)) != 0 }
        var cursor = metadataOffset
        for row in 0..<count {
            try checkCancellation()
            let start = cursor
            while cursor < metadataEnd && data[cursor] != 10 {
                cursor += 1
                if cursor % 262_144 == 0 { try checkCancellation() }
            }
            try require(cursor > start && cursor < metadataEnd, "metadata count mismatch")
            // Scan only the declared rows. Splitting an untrusted 64 MiB payload
            // first could allocate millions of slices before rejecting its count.
            let line = data.subdata(in: start..<cursor)
            cursor += 1
            try require(String(data: line, encoding: .utf8) != nil, "metadata must be UTF-8")
            let metadata = try decoder.decode(TileMetadata.self, from: line)
            try require(metadata.id == expected.ids[row], "requested body identity mismatch")
            let isExact = bit(exactOffset, row), missing = bit(missingOffset, row)
            try require(!bit(approximateOffset, row) && isExact != missing, "invalid exact/missing status")
            if isExact {
                try require(!metadata.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !metadata.datasetVersion.isEmpty && isHash(metadata.datasetSha256) && !metadata.stateEvidence.isEmpty && !metadata.centerId.isEmpty && metadata.missingReason.isEmpty, "exact provenance missing")
                try require(metadata.model == "spk-original" || metadata.model == "source-kernel-state-at-audit-epoch", "unsupported exact model")
                let datasetHash = metadata.sourceRecord ? expected.inventoryHash : expected.catalogHash
                try require(datasetHash != nil && metadata.datasetSha256 == datasetHash, "dataset hash is not bound to this manifest")
                if metadata.model == "source-kernel-state-at-audit-epoch" { try require(metadata.sourceRecord && !metadata.identityStatus.isEmpty, "snapshot source identity missing") }
                try require(isHash(metadata.kernelSha256), "kernel hash missing")
                let et = (epoch - 2_451_545) * 86_400
                if metadata.validityPresent {
                    try require(metadata.validityStartEt.isFinite && metadata.validityEndEt.isFinite && metadata.validityStartEt <= metadata.validityEndEt && et >= metadata.validityStartEt - 0.0001 && et <= metadata.validityEndEt + 0.0001, "state outside validity")
                }
                if metadata.evidenceWindowPresent {
                    try require(metadata.evidenceWindowStartEt.isFinite && metadata.evidenceWindowEndEt.isFinite && metadata.evidenceWindowStartEt <= metadata.evidenceWindowEndEt && et >= metadata.evidenceWindowStartEt - 0.0001 && et <= metadata.evidenceWindowEndEt + 0.0001, "state outside evidence window")
                }
            } else { try require(!metadata.missingReason.isEmpty, "missing reason absent") }
            for component in 0..<6 {
                let value = Double(bitPattern: integer(statesOffset + (row * 6 + component) * 8, 8))
                try require(value.isFinite && (isExact || value == 0), "invalid state value")
                states.append(value)
            }
            rows.append(metadata); exact.append(isExact)
        }
        try require(cursor == metadataEnd, "metadata count mismatch")
        try checkCancellation()
        return VerifiedStateTile(metadata: rows, exact: exact, states: states, payloadHash: payloadHash)
    }
}
