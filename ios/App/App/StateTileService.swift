import Foundation

private struct NativeManifest: Decodable {
    struct Limits: Decodable {
        let maxIds: Int?
        let maxPlanBytes: Int?
    }
    let apiVersion: String
    let catalogVersion: String
    let catalogManifestSha256: String
    let inventoryManifestSha256: String?
    let limits: Limits?
}

private struct NativePlan: Decodable {
    struct Tile: Decodable {
        let sequence: Int
        let ordinalStart: Int
        let ordinalCount: Int
    }
    let apiVersion: String
    let catalogVersion: String
    let catalogManifestSha256: String
    let inventoryManifestSha256: String?
    let requestIdsSha256: String
    let planId: String
    let epochJd: Double
    let timeScale: String
    let frame: String
    let precision: String
    let stateOriginId: String
    let distanceUnit: String
    let velocityUnit: String
    let fieldMask: [String]
    let bodyCount: Int
    let stride: Int
    let tileCount: Int
    let exactCount: Int
    let approximateCount: Int
    let missingCount: Int
    let tiles: [Tile]
}

/// One service per load: memory-admitted tile batches provide bounded backpressure.
actor StateTileService {
    static let maxAggregateRows = 2_000_000
    static let residentStateBudget = 1536 * 1024 * 1024
    private static let maxConcurrentTiles = 2
    private static let maxPlanRequestBytes = 8 * 1024 * 1024
    private static let legacyPlanRequestBytes = 1024 * 1024
    private let base: URL
    private let cache: StateTileCache

    init(base: URL, cache: StateTileCache) throws {
        guard base.scheme == "https", base.host != nil, base.user == nil,
              base.password == nil, base.query == nil, base.fragment == nil else {
            throw StateTileFailure.invalid("Enter an HTTPS backend address without credentials, query or fragment.")
        }
        self.base = base
        self.cache = cache
    }

    private func receive(path: String, body: [String: Any]? = nil, binary: Bool = false,
                         requestBodyLimit: Int? = nil) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: base.appendingPathComponent(path))
        if let body = body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let data = try JSONSerialization.data(withJSONObject: body)
            guard requestBodyLimit.map({ data.count <= $0 }) ?? true else {
                throw StateTileFailure.invalid("State plan request exceeds the advertised byte budget.")
            }
            request.httpBody = data
        }
        let limit = binary ? StateTileDecoder.maxBytes : 8 * 1024 * 1024
        let type = binary ? "application/vnd.solar.state-tile+binary" : "application/json"
        return try await NativeHTTPTransfer(contentType: type, limit: limit).receive(request)
    }

    func load(ids: [String], epochJd: Double, selectedPage: NativeSourceIdentityPage? = nil,
              onInitialPartial: (@MainActor @Sendable (NativeStateFrame) -> Void)? = nil) async throws -> NativeStateFrame {
        guard epochJd.isFinite, !ids.isEmpty, ids.count <= Self.maxAggregateRows, Set(ids).count == ids.count,
              ids.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 1024 }) else {
            throw StateTileFailure.invalid("A finite TDB epoch and unique body IDs are required.")
        }
        let decoder = JSONDecoder()
        let (manifestData, _) = try await receive(path: "v1/catalog/manifest")
        try selectedPage?.requireManifest(manifestData, base: base)
        let manifest = try decoder.decode(NativeManifest.self, from: manifestData)
        guard manifest.apiVersion == "solar.api/v1", !manifest.catalogVersion.isEmpty,
              StateTileDecoder.isHash(manifest.catalogManifestSha256),
              manifest.inventoryManifestSha256.map(StateTileDecoder.isHash) ?? true else {
            throw StateTileFailure.invalid("Unsupported catalog manifest.")
        }
        let maxPlanIds = manifest.limits?.maxIds ?? StateTileDecoder.maxRows
        let maxPlanBytes = manifest.limits?.maxPlanBytes ?? Self.legacyPlanRequestBytes
        guard (1...StateTileDecoder.maxRows).contains(maxPlanIds),
              (1...Self.maxPlanRequestBytes).contains(maxPlanBytes) else {
            throw StateTileFailure.invalid("Catalog manifest plan limits are invalid.")
        }
        let planChunks = try Self.chunkPlanIds(ids, epochJd: epochJd, maxIds: maxPlanIds, maxBytes: maxPlanBytes)
        var result = NativeStateFrame(epochJd: epochJd, catalogHash: manifest.catalogManifestSha256, inventoryHash: manifest.inventoryManifestSha256)
        var totalExactCount = 0
        // Admit the whole final array storage before reserving it. Incremental
        // append growth otherwise temporarily retains old and new large buffers.
        let baseBytes = ids.count * (6 * MemoryLayout<Double>.stride + MemoryLayout<Bool>.stride + MemoryLayout<TileMetadata>.stride)
        guard baseBytes <= Self.residentStateBudget else {
            throw StateTileFailure.invalid("Observation arrays exceed the native state memory budget.")
        }
        try Task.checkCancellation()
        result.metadata.reserveCapacity(ids.count)
        result.states.reserveCapacity(ids.count * 6)
        result.exact.reserveCapacity(ids.count)
        // Array allocators may reserve more than requested; account their actual
        // capacities, while strings and runtime overhead remain estimates.
        var residentBytes = result.metadata.capacity * MemoryLayout<TileMetadata>.stride
            + result.states.capacity * MemoryLayout<Double>.stride + result.exact.capacity * MemoryLayout<Bool>.stride
        guard residentBytes <= Self.residentStateBudget else {
            throw StateTileFailure.invalid("Reserved observation arrays exceed the native state memory budget.")
        }
        var start = 0
        for chunk in planChunks {
            try Task.checkCancellation()
            let (planData, _) = try await receive(path: "v1/state/plan", body: Self.planRequest(ids: chunk, epochJd: epochJd), requestBodyLimit: maxPlanBytes)
            let plan = try decoder.decode(NativePlan.self, from: planData)
            guard plan.apiVersion == manifest.apiVersion, plan.catalogVersion == manifest.catalogVersion,
                  plan.catalogManifestSha256 == manifest.catalogManifestSha256,
                  plan.inventoryManifestSha256 == manifest.inventoryManifestSha256,
                  plan.requestIdsSha256 == StateTileDecoder.requestHash(chunk), StateTileDecoder.isHash(plan.planId),
                  plan.epochJd == epochJd, plan.timeScale == "TDB", plan.frame == "ECLIPJ2000", plan.precision == "exact",
                  plan.stateOriginId == "naif:0", plan.distanceUnit == "km", plan.velocityUnit == "km/s",
                  plan.fieldMask == ["position", "velocity"], plan.stride == 6, plan.bodyCount == chunk.count,
                  plan.tileCount > 0, plan.tileCount <= chunk.count, plan.tiles.count == plan.tileCount,
                  plan.exactCount >= 0, plan.exactCount <= chunk.count,
                  plan.missingCount >= 0, plan.missingCount <= chunk.count, plan.approximateCount == 0,
                  plan.exactCount + plan.missingCount == chunk.count else {
                throw StateTileFailure.invalid("State plan does not match the requested scientific contract.")
            }
            var ordinal = 0, exactCount = 0, sequence = 0
            while sequence < plan.tiles.count {
                try Task.checkCancellation()
                let tile = plan.tiles[sequence]
                guard tile.sequence == sequence, tile.ordinalStart == ordinal,
                      tile.ordinalCount > 0, tile.ordinalCount <= chunk.count - ordinal else {
                    throw StateTileFailure.invalid("State plan has incomplete or overlapping tiles.")
                }
                // Admit the complete transient working set before either request
                // starts. If both tiles do not fit, preserve bounded serial reads.
                let workingBytes = tileWorkingBytes(rows: tile.ordinalCount)
                guard workingBytes <= Self.residentStateBudget - residentBytes else {
                    throw StateTileFailure.invalid("Insufficient native state budget for tile read and decode workspace. Any verified prefix remains available.")
                }
                var batchCount = 1
                if sequence + 1 < plan.tiles.count {
                    let next = plan.tiles[sequence + 1]
                    let nextStart = ordinal + tile.ordinalCount
                    guard next.sequence == sequence + 1, next.ordinalStart == nextStart,
                          next.ordinalCount > 0, next.ordinalCount <= chunk.count - nextStart else {
                        throw StateTileFailure.invalid("State plan has incomplete or overlapping tiles.")
                    }
                    if workingBytes + tileWorkingBytes(rows: next.ordinalCount) <= Self.residentStateBudget - residentBytes {
                        batchCount = Self.maxConcurrentTiles
                    }
                }
                let planId = plan.planId
                let requests = (sequence..<(sequence + batchCount)).map { index -> (Int, TileExpectation, String) in
                    let descriptor = plan.tiles[index]
                    let start = descriptor.ordinalStart
                    let expected = TileExpectation(planHash: planId, catalogHash: manifest.catalogManifestSha256, inventoryHash: manifest.inventoryManifestSha256, sequence: index, tileCount: plan.tileCount, ordinalStart: start, epochJd: epochJd, ids: Array(chunk[start..<(start + descriptor.ordinalCount)]))
                    let key = StateTileDecoder.sha256(Data("\(planId):\(index)".utf8))
                    return (index, expected, key)
                }
                let loaded: [(Int, VerifiedStateTile)]
                if batchCount == 1 {
                    let request = requests[0]
                    loaded = [(request.0, try await loadTile(planId: planId, sequence: request.0, expected: request.1, key: request.2))]
                } else {
                    loaded = try await withThrowingTaskGroup(of: (Int, VerifiedStateTile).self, returning: [(Int, VerifiedStateTile)].self) { group in
                        for request in requests {
                            group.addTask { [self] in
                                (request.0, try await loadTile(planId: planId, sequence: request.0, expected: request.1, key: request.2))
                            }
                        }
                        var completed: [(Int, VerifiedStateTile)] = []
                        completed.reserveCapacity(batchCount)
                        for try await item in group { completed.append(item) }
                        return completed.sorted { $0.0 < $1.0 }
                    }
                }
                guard loaded.count == batchCount else { throw StateTileFailure.invalid("State tile batch was incomplete.") }
                for (loadedSequence, decoded) in loaded {
                    try Task.checkCancellation()
                    let descriptor = plan.tiles[loadedSequence]
                    guard descriptor.sequence == loadedSequence, descriptor.ordinalStart == ordinal,
                          descriptor.ordinalCount == decoded.metadata.count else {
                        throw StateTileFailure.invalid("State tile does not match its ordered plan descriptor.")
                    }
                    var nextBytes = residentBytes
                    for (index, row) in decoded.metadata.enumerated() {
                        if index % 1024 == 0 { try Task.checkCancellation() }
                        // Fixed arrays were charged in full above; only retained
                        // string storage is added here, without double-counting rows.
                        let stringBytes = row.id.utf8.count + row.source.utf8.count + row.datasetVersion.utf8.count
                            + row.datasetSha256.utf8.count + row.kernelSha256.utf8.count + (row.sourceChainSha256?.utf8.count ?? 0)
                            + row.model.utf8.count + row.centerId.utf8.count + row.stateEvidence.utf8.count
                            + row.missingReason.utf8.count + row.identityStatus.utf8.count
                        guard stringBytes <= Self.residentStateBudget - nextBytes else {
                            throw StateTileFailure.invalid("Observation exceeds the native state memory budget. Select fewer bodies; any verified prefix remains available.")
                        }
                        nextBytes += stringBytes
                    }
                    try Task.checkCancellation()
                    residentBytes = nextBytes
                    result.metadata.append(contentsOf: decoded.metadata)
                    result.states.append(contentsOf: decoded.states)
                    result.exact.append(contentsOf: decoded.exact)
                    exactCount += decoded.exact.reduce(0) { $0 + ($1 ? 1 : 0) }
                    ordinal += descriptor.ordinalCount
                }
                sequence += batchCount
            }
            guard ordinal == chunk.count, exactCount == plan.exactCount else {
                throw StateTileFailure.invalid("Incomplete state plan or precision count mismatch.")
            }
            totalExactCount += exactCount
            if start == 0, start + chunk.count < ids.count, let onInitialPartial {
                try Task.checkCancellation()
                if let snapshot = NativeStateFrame.verifiedPrefix(of: result, exactCount: totalExactCount,
                                                                  budgetRemaining: Self.residentStateBudget - residentBytes) {
                    residentBytes += snapshot.residentBytes
                    await onInitialPartial(snapshot.frame)
                }
            }
            start += chunk.count
        }
        try Task.checkCancellation()
        result.verifiedExactCount = totalExactCount
        return result
    }

    private static func planRequest(ids: [String], epochJd: Double) -> [String: Any] {
        ["ids": ids, "epochJd": epochJd, "timeScale": "TDB", "frame": "ECLIPJ2000",
         "precision": "exact", "fieldMask": ["position", "velocity"], "tileSize": 16_384]
    }

    private static func chunkPlanIds(_ ids: [String], epochJd: Double, maxIds: Int, maxBytes: Int) throws -> [[String]] {
        let emptyBytes = try JSONSerialization.data(withJSONObject: planRequest(ids: [], epochJd: epochJd)).count
        guard emptyBytes <= maxBytes else { throw StateTileFailure.invalid("State plan fixed fields exceed the advertised byte budget.") }
        var chunks: [[String]] = [], chunk: [String] = [], bytes = emptyBytes
        for id in ids {
            let idBytes = jsonStringByteLength(id)
            let addition = idBytes + (chunk.isEmpty ? 0 : 1)
            if !chunk.isEmpty && (chunk.count >= maxIds || bytes + addition > maxBytes) {
                chunks.append(chunk); chunk = []; bytes = emptyBytes
            }
            guard bytes + idBytes <= maxBytes else {
                throw StateTileFailure.invalid("A body ID exceeds the advertised state plan byte budget.")
            }
            chunk.append(id); bytes += idBytes + (chunk.count > 1 ? 1 : 0)
        }
        if !chunk.isEmpty { chunks.append(chunk) }
        return chunks
    }

    private static func jsonStringByteLength(_ value: String) -> Int {
        var bytes = 2
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 0x22, 0x2f, 0x5c, 0x08, 0x09, 0x0a, 0x0c, 0x0d:
                // Slash and line-separator escapes are counted conservatively;
                // the complete request is measured again before it is sent.
                bytes += 2
            case 0x00...0x1f:
                bytes += 6
            case 0x2028, 0x2029:
                bytes += 6
            case 0x00...0x7f:
                bytes += 1
            case 0x80...0x7ff:
                bytes += 2
            case 0x800...0xffff:
                bytes += 3
            default:
                bytes += 4
            }
        }
        return bytes
    }

    /// A tile request is idempotent. Retry one interrupted transport after
    /// cancellation has been checked. Checksum/ETag validation happens after
    /// receipt and fails closed without retrying an invalid payload.
    private func receiveTileWithRetry(planId: String, sequence: Int) async throws -> (Data, HTTPURLResponse) {
        var failure: Error?
        for attempt in 0..<2 {
            do {
                try Task.checkCancellation()
                return try await receive(path: "v1/state/tiles", body: ["planId": planId, "sequence": sequence], binary: true)
            } catch {
                failure = error
                try Task.checkCancellation()
                if attempt == 1 { throw error }
            }
        }
        throw failure ?? CancellationError()
    }

    private func loadTile(planId: String, sequence: Int, expected: TileExpectation, key: String) async throws -> VerifiedStateTile {
        if let cachedData = try await cache.readData(key: key) {
            do { return try await decodeTileOffActor(cachedData, expected: expected) }
            catch is CancellationError { throw CancellationError() }
            catch {
                try Task.checkCancellation()
                await cache.invalidate(key: key)
            }
        }
        let (data, response) = try await receiveTileWithRetry(planId: planId, sequence: sequence)
        guard let etag = response.value(forHTTPHeaderField: "ETag") else {
            throw StateTileFailure.invalid("State tile ETag missing.")
        }
        let decoded = try await decodeTileOffActor(data, expected: expected)
        guard etag == "\"\(decoded.payloadHash)\"" else {
            throw StateTileFailure.invalid("State tile ETag mismatch.")
        }
        // The cache method absorbs persistence failures but still propagates
        // integrity and cancellation errors.
        try await cache.storeVerified(data, key: key, payloadHash: decoded.payloadHash, etag: etag)
        return decoded
    }

    private func decodeTileOffActor(_ data: Data, expected: TileExpectation) async throws -> VerifiedStateTile {
        let worker = Task.detached(priority: .utility) {
            try StateTileDecoder.decode(data, expected: expected)
        }
        return try await withTaskCancellationHandler(operation: {
            try await worker.value
        }, onCancel: {
            worker.cancel()
        })
    }

    private func tileWorkingBytes(rows: Int) -> Int {
        4 * StateTileDecoder.maxBytes + rows * 1024 + 8 * 1024 * 1024
    }
}

/// URLSession delivers chunks directly into a bounded allocation. Avoid a
/// suspension and Data append for each of the tens of millions of tile bytes.
private final class NativeHTTPTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let expectedType: String
    private let limit: Int
    private let includeErrorBody: Bool
    private let resourceTimeout: TimeInterval
    private let lock = NSLock()
    private var continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var session: URLSession?
    private var response: HTTPURLResponse?
    private var body = Data()
    private var expectedLength = 0
    private var terminal = false

    init(contentType: String, limit: Int, includeErrorBody: Bool = false, resourceTimeout: TimeInterval = 120) { expectedType = contentType; self.limit = limit; self.includeErrorBody = includeErrorBody; self.resourceTimeout = resourceTimeout }

    func receive(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                start(request, continuation: continuation)
            }
        }, onCancel: { self.finish(.failure(CancellationError())) })
    }

    private func start(_ request: URLRequest, continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>) {
        lock.lock()
        guard !terminal else { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
        self.continuation = continuation
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = resourceTimeout
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
        self.session = session
        session.dataTask(with: request).resume()
        lock.unlock()
    }

    private func finish(_ result: Result<(Data, HTTPURLResponse), Error>) {
        lock.lock()
        guard !terminal else { lock.unlock(); return }
        terminal = true
        let continuation = self.continuation; self.continuation = nil
        let session = self.session; self.session = nil
        body = Data()
        lock.unlock()
        session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // The configured backend is authoritative; redirects cannot change it.
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            finish(.failure(StateTileFailure.invalid("Backend HTTP response is invalid.")))
            return
        }
        guard http.statusCode == 200 || includeErrorBody && (400...599).contains(http.statusCode) else {
            completionHandler(.cancel)
            finish(.failure(NativeHTTPStatusFailure(statusCode: http.statusCode)))
            return
        }
        let type = http.value(forHTTPHeaderField: "Content-Type")?.split(separator: ";").first?.trimmingCharacters(in: .whitespaces).lowercased()
        guard type == expectedType, let raw = http.value(forHTTPHeaderField: "Content-Length"),
              let length = Int(raw), length > 0, length <= limit else {
            completionHandler(.cancel)
            finish(.failure(StateTileFailure.invalid("Backend response type or size is invalid.")))
            return
        }
        lock.lock()
        guard !terminal else { lock.unlock(); completionHandler(.cancel); return }
        self.response = http; expectedLength = length; body.reserveCapacity(length)
        lock.unlock()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !terminal else { lock.unlock(); return }
        guard data.count <= expectedLength - body.count else {
            lock.unlock()
            finish(.failure(StateTileFailure.invalid("Backend response exceeds declared size.")))
            return
        }
        body.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error { finish(.failure(error)); return }
        lock.lock()
        let result: Result<(Data, HTTPURLResponse), Error>
        if let response = response, body.count == expectedLength {
            result = .success((body, response))
        } else { result = .failure(StateTileFailure.invalid("Backend response was interrupted.")) }
        lock.unlock()
        finish(result)
    }
}

struct NativeHTTPStatusFailure: LocalizedError {
    let statusCode: Int
    var errorDescription: String? { "Backend HTTP \(statusCode)" }
}

actor NativeCoverageService {
    private let base: URL
    init(base: URL) throws {
        guard base.scheme == "https", !(base.host ?? "").isEmpty, base.user == nil, base.password == nil,
              base.query == nil, base.fragment == nil else { throw StateTileFailure.invalid("Enter an HTTPS backend address without credentials, query or fragment.") }
        self.base = base
    }

    func load() async throws -> NativeCoverageReport {
        try Task.checkCancellation()
        var manifestRequest = URLRequest(url: base.appendingPathComponent("v1/catalog/manifest"))
        manifestRequest.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (manifestData, _) = try await NativeHTTPTransfer(contentType: "application/json", limit: 8 * 1024 * 1024).receive(manifestRequest)
        let manifest = try JSONDecoder().decode(NativeCoverageManifest.self, from: manifestData)
        guard manifest.apiVersion == "solar.api/v1", !manifest.catalogVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              NativeCoverageReport.isHash(manifest.catalogManifestSha256), NativeCoverageReport.isHash(manifest.inventoryManifestSha256) else { throw StateTileFailure.invalid("Unsupported catalog manifest.") }
        try Task.checkCancellation()
        var request = URLRequest(url: base.appendingPathComponent("v1/coverage"))
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        do {
            let (data, _) = try await NativeHTTPTransfer(contentType: "application/json", limit: NativeCoverageReport.maxBytes).receive(request)
            try Task.checkCancellation()
            return try NativeCoverageReport(validating: data, catalogManifest: manifestData)
        } catch let error as NativeHTTPStatusFailure where error.statusCode == 404 {
            throw NativeCoverageUnavailable()
        }
    }
}

struct NativeCoverageUnavailable: Error {}

/// Browsing never calls the state planner and retains only the requested page.
actor NativeSourceIdentityService {
    private let base: URL
    init(base: URL) throws { self.base = try NativeSourceIdentityPage.validatedBase(base) }

    func load(query: String, previous: NativeSourceIdentityPage? = nil) async throws -> NativeSourceIdentityPage {
        try NativeSourceIdentityPage.validateQuery(query)
        if let previous = previous {
            guard previous.base == base, previous.query == query, !previous.next.isEmpty else {
                throw NativeSourceIdentityFailure.cursor
            }
        }
        try Task.checkCancellation()
        let manifest = try await receive(base.appendingPathComponent("v1/catalog/manifest"), limit: NativeSourceIdentityPage.maxManifestBytes)
        try previous?.requireManifest(manifest, base: base)
        try Task.checkCancellation()
        guard var components = URLComponents(url: base.appendingPathComponent("v1/identities"), resolvingAgainstBaseURL: false) else {
            throw NativeSourceIdentityFailure.address
        }
        components.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: String(NativeSourceIdentityPage.size))]
        if let previous = previous { components.queryItems?.append(URLQueryItem(name: "pageToken", value: previous.next)) }
        // Go parses query '+' as space; preserve literal query text.
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let url = components.url else { throw NativeSourceIdentityFailure.query }
        let data = try await receive(url, limit: NativeSourceIdentityPage.maxBytes)
        let page = try NativeSourceIdentityPage(validating: data, catalogManifest: manifest, base: base, query: query)
        guard previous == nil || page.next.isEmpty || page.next != previous?.next else { throw NativeSourceIdentityFailure.cursor }
        if let previous = previous {
            guard page.totalRecords == previous.totalRecords else { throw NativeSourceIdentityFailure.changed }
            let previousIds = Set(previous.rows.map(\.id))
            for row in page.rows {
                try Task.checkCancellation()
                guard !previousIds.contains(row.id) else { throw NativeSourceIdentityFailure.cursor }
            }
        }
        try Task.checkCancellation()
        return page
    }

    private func receive(_ url: URL, limit: Int) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, _) = try await NativeHTTPTransfer(contentType: "application/json", limit: limit).receive(request)
        return data
    }
}

actor NativeGroundContactService {
    private let base: URL
    init(base: URL) throws { self.base = try NativeSourceIdentityPage.validatedBase(base) }
    func load(_ input: NativeGroundContactRequest) async throws -> (NativeGroundContacts, Data) {
        let deadline = ProcessInfo.processInfo.systemUptime + 25
        func checkDeadline() throws {
            try Task.checkCancellation()
            guard ProcessInfo.processInfo.systemUptime < deadline else {
                throw StateTileFailure.invalid("Contact search deadline exceeded.")
            }
        }
        try input.validate(); try Task.checkCancellation()
        var request = URLRequest(url: base.appendingPathComponent("v1/observation/contacts"))
        request.httpMethod = "POST"; request.httpBody = try JSONEncoder().encode(input)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        try checkDeadline()
        let remaining = deadline - ProcessInfo.processInfo.systemUptime
        guard remaining > 0 else { throw StateTileFailure.invalid("Contact search deadline exceeded.") }
        let (bytes, response) = try await NativeHTTPTransfer(contentType: "application/json", limit: NativeGroundContacts.maxBytes, includeErrorBody: true, resourceTimeout: remaining).receive(request)
        try checkDeadline()
        if response.statusCode != 200 {
            struct Failure: Decodable { struct Detail: Decodable { let code, message: String }; let error: Detail }
            let failure = try JSONDecoder().decode(Failure.self, from: bytes)
            throw StateTileFailure.invalid(failure.error.code + ": " + failure.error.message)
        }
        let report = try NativeGroundContacts.decode(bytes, request: input)
        try checkDeadline(); return (report, bytes)
    }
}

/// Encoding and validation run on this actor, away from the SwiftUI main actor.
/// Each invocation owns a bounded transfer; cancellation invalidates its session.
actor NativeStellarMotionService {
    private let base: URL
    private var running = false
    private var deadline: TimeInterval?
    init(base: URL) throws { self.base = try NativeSourceIdentityPage.validatedBase(base) }

    private func checkDeadline() throws {
        try Task.checkCancellation()
        guard let deadline, ProcessInfo.processInfo.systemUptime < deadline else {
            throw StateTileFailure.invalid("Scientific request deadline exceeded.")
        }
    }

    func load(_ input: NativeStellarMotionRequest) async throws -> NativeStellarMotionReport {
        try Task.checkCancellation()
        guard !running else { throw StateTileFailure.invalid("Stellar request already running.") }
        running = true
        defer { running = false }
        deadline = ProcessInfo.processInfo.systemUptime + 25
        defer { deadline = nil }
        let bytes = try await receive(input.bytes(), path: "v1/stellar/motion")
        let report = try NativeStellarMotionReport(validating: bytes, request: input)
        try checkDeadline()
        return report
    }

    func loadObserver(_ input: NativeStellarObserverRequest) async throws -> NativeStellarObserverReport {
        try Task.checkCancellation()
        guard !running else { throw StateTileFailure.invalid("Stellar request already running.") }
        running = true
        defer { running = false }
        deadline = ProcessInfo.processInfo.systemUptime + 25
        defer { deadline = nil }
        let bytes = try await receive(input.bytes(), path: "v1/stellar/observer")
        let report = try NativeStellarObserverReport(validating: bytes, request: input)
        try checkDeadline()
        return report
    }

    func loadCovariance(_ input: NativeOrbitCovarianceRequest) async throws -> NativeOrbitCovarianceReport {
        try Task.checkCancellation()
        guard !running else { throw StateTileFailure.invalid("Scientific request already running.") }
        running = true
        defer { running = false }
        deadline = ProcessInfo.processInfo.systemUptime + 25
        defer { deadline = nil }
        let bytes = try await receive(input.bytes(), path: "v1/orbit/covariance/convert", limit: NativeOrbitCovarianceReport.maxBytes)
        let report = try NativeOrbitCovarianceReport(validating: bytes, request: input)
        try checkDeadline()
        return report
    }

    func loadPropagation(_ input: NativeOrbitPropagationRequest) async throws -> NativeOrbitPropagationReport {
        try Task.checkCancellation()
        guard !running else { throw StateTileFailure.invalid("Scientific request already running.") }
        running = true
        defer { running = false }
        deadline = ProcessInfo.processInfo.systemUptime + 25
        defer { deadline = nil }
        let bytes = try await receive(input.bytes(), path: "v1/orbit/covariance/propagate", limit: NativeOrbitPropagationReport.maxBytes)
        let report = try NativeOrbitPropagationReport(validating: bytes, request: input)
        try checkDeadline()
        return report
    }

    func loadEnsemble(_ input: NativeOrbitEnsembleRequest) async throws -> NativeOrbitEnsembleReport {
        try Task.checkCancellation()
        guard !running else { throw StateTileFailure.invalid("Scientific request already running.") }
        running = true
        defer { running = false }
        deadline = ProcessInfo.processInfo.systemUptime + 25
        defer { deadline = nil }
        let bytes = try await receive(input.bytes(), path: "v1/orbit/covariance/ensemble", limit: NativeOrbitEnsembleReport.maxBytes)
        let report = try NativeOrbitEnsembleReport(validating: bytes, request: input)
        try checkDeadline()
        return report
    }

    func loadEvents(_ input: NativeOrbitEventRequest) async throws -> NativeOrbitEventReport {
        try Task.checkCancellation()
        guard !running else { throw StateTileFailure.invalid("Scientific request already running.") }
        running = true
        defer { running = false }
        deadline = ProcessInfo.processInfo.systemUptime + 25
        defer { deadline = nil }
        let bytes = try await receive(input.bytes(), path: "v1/orbit/covariance/ensemble/events", limit: NativeOrbitEventReport.maxBytes)
        let report = try NativeOrbitEventReport(validating: bytes, request: input)
        try checkDeadline()
        return report
    }

    private func receive(_ payload: Data, path: String, limit: Int = NativeStellarMotionReport.maxBytes) async throws -> Data {
        try checkDeadline()
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.httpBody = payload
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        guard let deadline else { throw StateTileFailure.invalid("Scientific request deadline missing.") }
        let remaining = deadline - ProcessInfo.processInfo.systemUptime
        guard remaining > 0 else { throw StateTileFailure.invalid("Scientific request deadline exceeded.") }
        let (bytes, response) = try await NativeHTTPTransfer(contentType: "application/json",
            limit: limit, includeErrorBody: true, resourceTimeout: remaining).receive(request)
        try checkDeadline()
        if response.statusCode != 200 {
            struct Failure: Decodable { struct Detail: Decodable { let code, message: String }; let error: Detail }
            let failure = try JSONDecoder().decode(Failure.self, from: bytes)
            throw StateTileFailure.invalid(failure.error.code + ": " + failure.error.message)
        }
        try Task.checkCancellation()
        return bytes
    }
}
