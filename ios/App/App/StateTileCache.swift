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

    func read(key: String, expected: TileExpectation,
              checkCancellation: () throws -> Void = { try Task.checkCancellation() }) throws -> VerifiedStateTile? {
        try checkCancellation()
        let url = try file(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size > 0 && size <= StateTileDecoder.maxBytes else { throw StateTileFailure.invalid("Invalid cached tile size") }
            var data = Data()
            data.reserveCapacity(size)
            while true {
                try checkCancellation()
                let part = try handle.read(upToCount: min(262_144, StateTileDecoder.maxBytes + 1 - data.count)) ?? Data()
                if part.isEmpty { break }
                data.append(part)
                guard data.count <= StateTileDecoder.maxBytes else { throw StateTileFailure.invalid("Oversized cached tile") }
            }
            let result = try StateTileDecoder.decode(data, expected: expected, checkCancellation: checkCancellation)
            try checkCancellation()
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
            return result
        } catch is CancellationError {
            // Cancellation says nothing about integrity; retain a valid file.
            throw CancellationError()
        } catch {
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
