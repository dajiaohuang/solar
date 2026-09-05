import Foundation

@main
struct ProtocolTests {
    static let hashA = String(repeating: "a", count: 64)
    static let hashB = String(repeating: "b", count: 64)
    static let ids = ["naif:10", "missing:fixture"]
    static let values: [Double] = [Double(1).nextUp, -0.0, 149_597_870.7, -29.78, Double.leastNormalMagnitude, 0]
    static var expected: TileExpectation {
        TileExpectation(planHash: hashA, catalogHash: hashB, inventoryHash: nil, sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2_451_545, ids: ids)
    }

    static func put(_ data: inout Data, at offset: Int, value: UInt64, width: Int) {
        for byte in 0..<width { data[offset + byte] = UInt8(truncatingIfNeeded: value >> (byte * 8)) }
    }

    static func fixture() throws -> Data {
        let common: [String: Any] = ["source": "protocol-test-fixture", "datasetVersion": "fixture", "datasetSha256": hashB, "kernelSha256": hashA, "model": "spk-original", "centerId": "naif:0", "validityStartEt": 0, "validityEndEt": 0, "validityPresent": true, "stateEvidence": "fixture-only", "evidenceWindowStartEt": 0, "evidenceWindowEndEt": 0, "evidenceWindowPresent": false]
        var metadata = Data()
        for (index, id) in ids.enumerated() {
            var row = common; row["id"] = id; row["missingReason"] = index == 0 ? "" : "no-kernel"
            row["sourceRecord"] = false; row["identityStatus"] = ""
            metadata.append(try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])); metadata.append(10)
        }
        let exact = 200 + metadata.count, approximate = exact + 1, missing = approximate + 1
        let states = (missing + 1 + 7) / 8 * 8
        var data = Data(count: states + 96)
        data.replaceSubrange(0..<8, with: [83, 76, 82, 84, 73, 76, 69, 0])
        for (offset, value, width) in [(8, 1, 2), (10, 200, 2), (16, 1, 4), (24, 2, 4), (28, 6, 2), (30, 3, 2), (40, 200, 4), (44, metadata.count, 4), (48, exact, 4), (52, 1, 4), (56, approximate, 4), (60, missing, 4), (64, states, 4), (68, 96, 4)] {
            put(&data, at: offset, value: UInt64(value), width: width)
        }
        put(&data, at: 32, value: Double(2_451_545).bitPattern, width: 8)
        data.replaceSubrange(72..<104, with: repeatElement(UInt8(0xaa), count: 32))
        data.replaceSubrange(104..<136, with: repeatElement(UInt8(0xbb), count: 32))
        data.replaceSubrange(200..<exact, with: metadata)
        data[exact] = 1; data[missing] = 2
        for (index, value) in values.enumerated() { put(&data, at: states + index * 8, value: value.bitPattern, width: 8) }
        checksum(&data)
        return data
    }

    static func checksum(_ data: inout Data) {
        let hash = StateTileDecoder.sha256(data.subdata(in: 200..<data.count))
        let bytes = stride(from: 0, to: hash.count, by: 2).map { index -> UInt8 in
            let start = hash.index(hash.startIndex, offsetBy: index)
            return UInt8(hash[start..<hash.index(start, offsetBy: 2)], radix: 16)!
        }
        data.replaceSubrange(168..<200, with: bytes)
    }

    static func coverageFixture() throws -> Data {
        let hash = String(repeating: "a", count: 64)
        let object: [String: Any] = [
            "apiVersion": "solar.api/v1", "purpose": "source-identity-and-dependency-window-audit",
            "reportSha256": hash, "catalogVersion": "fixture", "catalogManifestSha256": hash,
            "inventoryManifestSha256": hash, "sourceSnapshotSha256": hash, "identityMappingSha256": hash,
            "satelliteCatalogSha256": hash, "sourceBytesVerified": true, "profile": "full",
            "auditEt": 500, "timeScale": "TDB seconds past J2000", "frame": "ECLIPJ2000",
            "requestedWindow": ["startEt": 0, "endEt": 1000, "timeScale": "TDB seconds past J2000"],
            "counts": ["sourceRecords": 10, "mappedSourceRecords": 3, "unresolvedSourceRecords": 7, "explicitNaifTargets": 2, "availableTargetsAtAuditEpoch": 2],
            "windowCounts": ["dependencyCoveredTargets": 1, "targetsWithDependencyGaps": 1, "numericallyCertifiedWholeWindowTargets": NSNull()],
            "unresolvedReasons": ["no-explicit-naif-mapping": 6, "unresolved-component": 1]
        ]
        return try JSONSerialization.data(withJSONObject: object)
    }

    static func coverageRejects(_ data: Data, manifest: Data, mutate: (inout [String: Any]) -> Void) throws {
        var value = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        mutate(&value)
        try rejectsCoverage(try JSONSerialization.data(withJSONObject: value), manifest: manifest)
    }

    static func rejectsCoverage(_ data: Data, manifest: Data) throws {
        do { _ = try NativeCoverageReport(validating: data, catalogManifest: manifest) }
        catch { return }
        throw StateTileFailure.invalid("Malformed coverage report was accepted")
    }

    static func rejects(_ data: Data, expected: TileExpectation = ProtocolTests.expected) throws {
        do {
            _ = try StateTileDecoder.decode(data, expected: expected)
        } catch { return }
        throw StateTileFailure.invalid("Malformed fixture was accepted")
    }

    final class CancellationProbe: @unchecked Sendable {
        private let lock = NSLock()
        private var remaining: Int
        init(after checks: Int) { remaining = checks }
        func check() throws {
            lock.lock()
            remaining -= 1
            let cancelled = remaining == 0
            lock.unlock()
            if cancelled { throw CancellationError() }
        }
    }

    static func main() async throws {
        let coverage = try coverageFixture()
        let coverageManifest = try JSONSerialization.data(withJSONObject: ["apiVersion": "solar.api/v1", "catalogVersion": "fixture", "catalogManifestSha256": String(repeating: "a", count: 64), "inventoryManifestSha256": String(repeating: "a", count: 64)])
        _ = try NativeCoverageReport(validating: coverage, catalogManifest: coverageManifest)
        try coverageRejects(coverage, manifest: coverageManifest) { $0["sourceBytesVerified"] = false }
        try coverageRejects(coverage, manifest: coverageManifest) { $0["windowCounts"] = ["dependencyCoveredTargets": 1, "targetsWithDependencyGaps": 1] }
        try coverageRejects(coverage, manifest: coverageManifest) { $0["counts"] = ["sourceRecords": 10, "mappedSourceRecords": 3, "unresolvedSourceRecords": 8, "explicitNaifTargets": 2, "availableTargetsAtAuditEpoch": 2] }
        try coverageRejects(coverage, manifest: coverageManifest) { $0["unresolvedReasons"] = ["Bad reason": 7] }
        try coverageRejects(coverage, manifest: coverageManifest) { $0["reportSha256"] = "not-a-hash" }
        try coverageRejects(coverage, manifest: coverageManifest) { $0["counts"] = ["sourceRecords": 10, "mappedSourceRecords": 3, "unresolvedSourceRecords": 7, "explicitNaifTargets": 3, "availableTargetsAtAuditEpoch": 2] }
        var requests = NativeObservationRequestGate()
        let oldRequest = requests.begin(reference: "naif:10")
        let presetRequest = requests.begin(reference: "naif:399")
        // SwiftUI reports the reference change after the preset action has
        // already started its matching load; it must remain current.
        precondition(!requests.shouldCancel(reference: "naif:399"))
        precondition(requests.isCurrent(presetRequest) && !requests.isCurrent(oldRequest))
        precondition(requests.shouldCancel(reference: "naif:499"))
        requests.cancel()
        precondition(!requests.isCurrent(presetRequest))
        let nextRequest = requests.begin(reference: "naif:399")
        precondition(requests.isCurrent(nextRequest) && !requests.isCurrent(presetRequest))
        if let directory = ProcessInfo.processInfo.environment["SOLAR_STATE_TILE_FIXTURE_DIR"] {
            try golden(directory: directory)
        }
        let data = try fixture()
        let tile = try StateTileDecoder.decode(data, expected: expected)
        precondition(tile.exact == [true, false])
        for index in values.indices { precondition(tile.states[index].bitPattern == values[index].bitPattern) }
        var frame = NativeStateFrame(epochJd: expected.epochJd, catalogHash: hashB, inventoryHash: nil,
            metadata: Array(tile.metadata.reversed()), states: Array(repeating: 0, count: 12), exact: [true, true])
        // Large absolute origin and small displacement must be subtracted as
        // Float64 before any Float32 conversion. Reference is last in the list.
        frame.states[0] = 1_000_000_001; frame.states[6] = 1_000_000_000
        let projected = try NativeProjection.make(frame: frame, reference: ids[0], limit: 2)
        precondition(projected.points == [SIMD3<Float>.zero, SIMD3<Float>(5, 0, 0)] && projected.candidates == 2)
        let capped = try NativeProjection.make(frame: frame, reference: ids[0], limit: 1)
        precondition(capped.points == [.zero] && capped.candidates == 2)
        frame.exact[1] = false
        let absent = try NativeProjection.make(frame: frame, reference: ids[0], limit: 2)
        precondition(absent.points.isEmpty)
        frame.exact[1] = true
        frame.states[0] = Double.greatestFiniteMagnitude; frame.states[6] = -Double.greatestFiniteMagnitude
        var overflowRejected = false
        do { _ = try NativeProjection.make(frame: frame, reference: ids[0], limit: 2) } catch { overflowRejected = true }
        precondition(overflowRejected)
        try rejects(Data(data.prefix(199)))
        var prefixed = Data([0]); prefixed.append(data)
        let sliced = try StateTileDecoder.decode(prefixed.dropFirst(), expected: expected)
        precondition(sliced.payloadHash == tile.payloadHash)
        var bad = data; bad[200] ^= 1; try rejects(bad)
        bad = data; bad[201] = 0xff; checksum(&bad); try rejects(bad)
        bad = data; bad[200] = 10; checksum(&bad); try rejects(bad)
        // A second metadata line must not be accepted for a declared one-row
        // tile; the decoder scans only declared rows, never an unbounded split.
        bad = data
        put(&bad, at: 24, value: 1, width: 4)
        put(&bad, at: 68, value: 48, width: 4)
        let missingOffset = (0..<4).reduce(0) { $0 | (Int(data[60 + $1]) << ($1 * 8)) }
        bad[missingOffset] = 0
        bad.removeLast(48); checksum(&bad)
        let oneRow = TileExpectation(planHash: hashA, catalogHash: hashB, inventoryHash: nil, sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2_451_545, ids: [ids[0]])
        try rejects(bad, expected: oneRow)
        var decodeCancelled = false
        do {
            _ = try StateTileDecoder.decode(data, expected: expected, checkCancellation: CancellationProbe(after: 4).check)
        } catch is CancellationError { decodeCancelled = true }
        precondition(decodeCancelled)
        bad = data; bad.append(0); checksum(&bad); try rejects(bad)
        bad = data; put(&bad, at: 24, value: 32_769, width: 4); try rejects(bad)
        bad = data; put(&bad, at: 32, value: Double(2_451_546).bitPattern, width: 8); try rejects(bad)
        bad = data; bad[72] ^= 1; try rejects(bad)
        bad = data; put(&bad, at: 52, value: 2, width: 4); try rejects(bad)
        let wrong = TileExpectation(planHash: hashA, catalogHash: hashB, inventoryHash: nil, sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2_451_545, ids: Array(ids.reversed()))
        try rejects(data, expected: wrong)
        // Independently known SHA-256 of an empty ordered request.
        precondition(StateTileDecoder.requestHash([]) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        precondition(StateTileDecoder.requestHash(["a", "bc"]) != StateTileDecoder.requestHash(["ab", "c"]))
        precondition(StateTileDecoder.requestHash(ids) != StateTileDecoder.requestHash(Array(ids.reversed())))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("solar-protocol-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try StateTileCache(directory: directory, byteLimit: data.count)
        let stored = try await cache.decodeAndStore(data, key: hashA, expected: expected, etag: "\"\(tile.payloadHash)\"")
        precondition(stored.payloadHash == tile.payloadHash)
        let cached = try await cache.read(key: hashA, expected: expected)
        precondition(cached?.payloadHash == tile.payloadHash)
        var cacheCancelled = false
        do {
            _ = try await cache.read(key: hashA, expected: expected, checkCancellation: CancellationProbe(after: 5).check)
        } catch is CancellationError { cacheCancelled = true }
        precondition(cacheCancelled)
        let retained = try await cache.read(key: hashA, expected: expected)
        precondition(retained?.payloadHash == tile.payloadHash)
        var badETagRejected = false
        do {
            _ = try await cache.decodeAndStore(data, key: hashB, expected: expected, etag: "\"wrong\"")
        } catch { badETagRejected = true }
        precondition(badETagRejected)
        precondition(!FileManager.default.fileExists(atPath: directory.appendingPathComponent(hashB + ".tile").path))
        try await cache.decodeAndStore(data, key: hashB, expected: expected)
        let evicted = try await cache.read(key: hashA, expected: expected)
        precondition(evicted == nil)
        try Data([0]).write(to: directory.appendingPathComponent(hashB + ".tile"))
        let corrupted = try await cache.read(key: hashB, expected: expected)
        precondition(corrupted == nil)
        // Failed persistence is best-effort, but the verified live result survives.
        let unavailableDirectory = directory.appendingPathComponent("unavailable")
        let unavailable = try StateTileCache(directory: unavailableDirectory)
        try FileManager.default.removeItem(at: unavailableDirectory)
        try Data([0]).write(to: unavailableDirectory)
        let live = try await unavailable.decodeAndStore(data, key: hashA, expected: expected)
        precondition(live.payloadHash == tile.payloadHash)
        print("iOS state protocol: Float64 identity, malformed payloads, request identity, cache corruption/quota/cancellation, single-decode storage, ETag, reference precision and display caps passed")
    }

    struct GoldenManifest: Decodable {
        struct Tile: Decodable {
            struct Row: Decodable {
                let id: String
                let status: String
                let stateIEEE754BitsLE: [String]
            }
            let sequence: Int
            let file: String
            let bytes: Int
            let sha256: String
            let payloadSha256: String
            let ordinalStart: Int
            let recordCount: Int
            let expectedRows: [Row]
        }
        let format: String
        let ids: [String]
        let epochJd: Double
        let tiles: [Tile]
    }

    // Consume actual HTTP handler output, not a second hand-written Swift wire
    // fixture. This checks serialization parity, not physical model accuracy.
    static func golden(directory: String) throws {
        let root = URL(fileURLWithPath: directory, isDirectory: true)
        func read(_ name: String, limit: Int) throws -> Data {
            let file = root.appendingPathComponent(name)
            let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size > 0 && size <= limit else { throw StateTileFailure.invalid("Golden file size: \(name)") }
            return try Data(contentsOf: file)
        }
        func object(_ name: String) throws -> [String: Any] {
            guard let value = try JSONSerialization.jsonObject(with: read(name, limit: 8 * 1024 * 1024)) as? [String: Any] else {
                throw StateTileFailure.invalid("Golden JSON object: \(name)")
            }
            return value
        }
        let manifest = try JSONDecoder().decode(GoldenManifest.self, from: read("manifest.json", limit: 8 * 1024 * 1024))
        let catalog = try object("catalog-manifest.json"), plan = try object("plan.json")
        guard manifest.format == "solar.state-tile-fixture/v1",
              let catalogHash = catalog["catalogManifestSha256"] as? String,
              let planHash = plan["planId"] as? String,
              let descriptors = plan["tiles"] as? [[String: Any]] else {
            throw StateTileFailure.invalid("Golden manifest contract")
        }
        let inventoryHash = catalog["inventoryManifestSha256"] as? String
        precondition(plan["catalogManifestSha256"] as? String == catalogHash)
        precondition(plan["inventoryManifestSha256"] as? String == inventoryHash)
        precondition(plan["requestIdsSha256"] as? String == StateTileDecoder.requestHash(manifest.ids))
        precondition(plan["epochJd"] as? Double == manifest.epochJd)
        precondition(plan["bodyCount"] as? Int == manifest.ids.count)
        precondition(plan["tileCount"] as? Int == manifest.tiles.count && descriptors.count == manifest.tiles.count)
        precondition(plan["timeScale"] as? String == "TDB" && plan["frame"] as? String == "ECLIPJ2000")
        precondition(plan["distanceUnit"] as? String == "km" && plan["velocityUnit"] as? String == "km/s")
        precondition(plan["stateOriginId"] as? String == "naif:0" && plan["precision"] as? String == "exact")
        var ids = [String](), exactCount = 0
        for (sequence, item) in manifest.tiles.enumerated() {
            precondition(item.sequence == sequence && item.file == "tile-\(sequence).bin")
            precondition(item.ordinalStart == ids.count && item.recordCount == item.expectedRows.count)
            precondition(descriptors[sequence]["sequence"] as? Int == sequence)
            precondition(descriptors[sequence]["ordinalStart"] as? Int == item.ordinalStart)
            precondition(descriptors[sequence]["ordinalCount"] as? Int == item.recordCount)
            let expectedIDs = item.expectedRows.map(\.id)
            let bytes = try read(item.file, limit: StateTileDecoder.maxBytes)
            precondition(bytes.count == item.bytes && StateTileDecoder.sha256(bytes) == item.sha256)
            let expected = TileExpectation(planHash: planHash, catalogHash: catalogHash, inventoryHash: inventoryHash,
                sequence: sequence, tileCount: manifest.tiles.count, ordinalStart: item.ordinalStart,
                epochJd: manifest.epochJd, ids: expectedIDs)
            let decoded = try StateTileDecoder.decode(bytes, expected: expected)
            precondition(decoded.payloadHash == item.payloadSha256)
            for (row, item) in item.expectedRows.enumerated() {
                precondition(item.status == "exact" || item.status == "missing")
                precondition(decoded.exact[row] == (item.status == "exact"))
                precondition(item.stateIEEE754BitsLE.count == 6)
                for axis in 0..<6 {
                    precondition(UInt64(item.stateIEEE754BitsLE[axis], radix: 16) == decoded.states[row * 6 + axis].bitPattern)
                }
                if decoded.exact[row] { exactCount += 1 }
            }
            ids.append(contentsOf: expectedIDs)
        }
        precondition(ids == manifest.ids)
        precondition(plan["exactCount"] as? Int == exactCount)
        precondition(plan["missingCount"] as? Int == ids.count - exactCount && plan["approximateCount"] as? Int == 0)
        print("Go → Swift golden: \(ids.count) rows / \(manifest.tiles.count) tiles, exact Float64 bits matched")
    }
}
