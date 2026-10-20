import Foundation

/// Content is decoded and checked on every read. Actor isolation serializes
/// writes, quota eviction and access timestamps across all native requests.
actor StateTileCache {
    static let quota = 256 * 1024 * 1024
    private let directory: URL
    private let byteLimit: Int

    init(directory: URL? = nil, byteLimit: Int = StateTileCache.quota) throws {
        guard byteLimit > 0 && byteLimit <= Self.quota else { throw StateTileFailure.invalid("Invalid cache quota") }
        let base = try directory ?? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("state-tiles", isDirectory: true)
        self.directory = base
        self.byteLimit = byteLimit
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }

    private func file(_ key: String) throws -> URL {
        guard StateTileDecoder.isHash(key) else { throw StateTileFailure.invalid("Invalid cache key") }
        return directory.appendingPathComponent(key + ".tile")
    }

    /// Read only bounded raw bytes here. StateTileService verifies and decodes
    /// them off-actor so two budget-admitted tiles can use separate CPU workers.
    func readData(key: String) throws -> Data? {
        try Task.checkCancellation()
        let url = try file(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            let length = try handle.seekToEnd()
            guard length >= UInt64(StateTileDecoder.headerBytes) && length <= UInt64(StateTileDecoder.maxBytes) else {
                throw StateTileFailure.invalid("Invalid cached tile size")
            }
            try handle.seek(toOffset: 0)
            let size = Int(length)
            var data = Data(); data.reserveCapacity(size)
            while data.count < size {
                try Task.checkCancellation()
                let part = try handle.read(upToCount: min(262_144, size - data.count)) ?? Data()
                guard !part.isEmpty else { throw StateTileFailure.invalid("Truncated cached tile") }
                data.append(part)
            }
            try Task.checkCancellation()
            guard (try handle.read(upToCount: 1) ?? Data()).isEmpty else {
                throw StateTileFailure.invalid("Cached tile changed size")
            }
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
            return data
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            try Task.checkCancellation()
            try? FileManager.default.removeItem(at: url)
            return nil
        }
    }

    func invalidate(key: String) {
        guard let url = try? file(key) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    /// Persist only after StateTileDecoder has authenticated the entire payload
    /// against its plan; a second full SHA/decode here would serialize the tiles.
    func storeVerified(_ data: Data, key: String, payloadHash: String, etag: String) throws {
        _ = try file(key)
        guard data.count >= StateTileDecoder.headerBytes, data.count <= StateTileDecoder.maxBytes,
              StateTileDecoder.isHash(payloadHash), StateTileDecoder.headerPayloadHash(data) == payloadHash,
              etag == "\"\(payloadHash)\"" else {
            throw StateTileFailure.invalid("State tile verification or ETag mismatch.")
        }
        do { try persist(data, key: key) }
        catch is CancellationError { throw CancellationError() }
        catch { /* A cache I/O failure must not discard a verified observation. */ }
    }

    func read(key: String, expected: TileExpectation,
              checkCancellation: () throws -> Void = { try Task.checkCancellation() }) throws -> VerifiedStateTile? {
        try checkCancellation()
        let url = try file(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            // Bind allocation and reads to the opened file rather than a path
            // which could have been replaced after opening the handle.
            let length = try handle.seekToEnd()
            guard length >= UInt64(StateTileDecoder.headerBytes) && length <= UInt64(StateTileDecoder.maxBytes) else { throw StateTileFailure.invalid("Invalid cached tile size") }
            try handle.seek(toOffset: 0)
            let size = Int(length)
            var data = Data()
            data.reserveCapacity(size)
            while data.count < size {
                try checkCancellation()
                let part = try handle.read(upToCount: min(262_144, size - data.count)) ?? Data()
                guard !part.isEmpty else { throw StateTileFailure.invalid("Truncated cached tile") }
                data.append(part)
            }
            try checkCancellation()
            guard (try handle.read(upToCount: 1) ?? Data()).isEmpty else { throw StateTileFailure.invalid("Cached tile changed size") }
            let result = try StateTileDecoder.decode(data, expected: expected, checkCancellation: checkCancellation)
            try checkCancellation()
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
            return result
        } catch is CancellationError {
            // Cancellation says nothing about integrity; retain a valid file.
            throw CancellationError()
        } catch {
            // A caller's cancellation checker may use an error other than
            // CancellationError. Recheck before treating a failure as corrupt.
            try checkCancellation()
            try? FileManager.default.removeItem(at: url)
            return nil
        }
    }

    /// Decode exactly once, verify any HTTP ETag before publishing, and reuse
    /// that result even if the disk is full. Cancellation must still propagate.
    @discardableResult
    func decodeAndStore(_ data: Data, key: String, expected: TileExpectation, etag: String? = nil) throws -> VerifiedStateTile {
        _ = try file(key)
        let decoded = try StateTileDecoder.decode(data, expected: expected)
        if let etag = etag, etag != "\"\(decoded.payloadHash)\"" { throw StateTileFailure.invalid("State tile ETag mismatch.") }
        do { try persist(data, key: key) }
        catch is CancellationError { throw CancellationError() }
        catch { /* A cache I/O failure must not discard a verified observation. */ }
        return decoded
    }

    private func persist(_ data: Data, key: String) throws {
        try Task.checkCancellation()
        guard data.count <= byteLimit else { return }
        let destination = try file(key)
        let entries = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey], options: [.skipsHiddenFiles])
            .filter { $0.pathExtension == "tile" && $0 != destination }
            .map { url -> (URL, Int, Date) in
                let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                return (url, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast)
            }.sorted { $0.2 < $1.2 }
        var bytes = entries.reduce(data.count) { $0 + $1.1 }
        for entry in entries where bytes > byteLimit {
            try Task.checkCancellation()
            try FileManager.default.removeItem(at: entry.0)
            bytes -= entry.1
        }
        try Task.checkCancellation()
        try data.write(to: destination, options: .atomic)
    }
}
