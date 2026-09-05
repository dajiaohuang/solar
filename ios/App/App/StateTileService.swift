import Foundation

private struct NativeManifest: Decodable {
    let apiVersion: String
    let catalogVersion: String
    let catalogManifestSha256: String
    let inventoryManifestSha256: String?
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

/// One service per load: sequential tiles provide bounded backpressure.
actor StateTileService {
    static let maxAggregateRows = 2_000_000
    static let residentStateBudget = 1536 * 1024 * 1024
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

    private func receive(path: String, body: [String: Any]? = nil, binary: Bool = false) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: base.appendingPathComponent(path))
        if let body = body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let limit = binary ? StateTileDecoder.maxBytes : 8 * 1024 * 1024
        let type = binary ? "application/vnd.solar.state-tile+binary" : "application/json"
        return try await NativeHTTPTransfer(contentType: type, limit: limit).receive(request)
    }

    func load(ids: [String], epochJd: Double) async throws -> NativeStateFrame {
        guard epochJd.isFinite, !ids.isEmpty, ids.count <= Self.maxAggregateRows, Set(ids).count == ids.count,
              ids.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 1024 }) else {
            throw StateTileFailure.invalid("A finite TDB epoch and unique body IDs are required.")
        }
        let decoder = JSONDecoder()
        let (manifestData, _) = try await receive(path: "v1/catalog/manifest")
        let manifest = try decoder.decode(NativeManifest.self, from: manifestData)
        guard manifest.apiVersion == "solar.api/v1", !manifest.catalogVersion.isEmpty,
              StateTileDecoder.isHash(manifest.catalogManifestSha256),
              manifest.inventoryManifestSha256.map(StateTileDecoder.isHash) ?? true else {
            throw StateTileFailure.invalid("Unsupported catalog manifest.")
        }
        var result = NativeStateFrame(epochJd: epochJd, catalogHash: manifest.catalogManifestSha256, inventoryHash: manifest.inventoryManifestSha256)
        var residentBytes = 0
        for start in stride(from: 0, to: ids.count, by: StateTileDecoder.maxRows) {
            try Task.checkCancellation()
            let chunk = Array(ids[start..<min(ids.count, start + StateTileDecoder.maxRows)])
            let (planData, _) = try await receive(path: "v1/state/plan", body: ["ids": chunk, "epochJd": epochJd, "timeScale": "TDB", "frame": "ECLIPJ2000", "precision": "exact", "fieldMask": ["position", "velocity"], "tileSize": 16_384])
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
            var ordinal = 0, exactCount = 0
            for (sequence, tile) in plan.tiles.enumerated() {
                try Task.checkCancellation()
                guard tile.sequence == sequence, tile.ordinalStart == ordinal,
                      tile.ordinalCount > 0, tile.ordinalCount <= chunk.count - ordinal else {
                    throw StateTileFailure.invalid("State plan has incomplete or overlapping tiles.")
                }
                let expected = TileExpectation(planHash: plan.planId, catalogHash: manifest.catalogManifestSha256, inventoryHash: manifest.inventoryManifestSha256, sequence: sequence, tileCount: plan.tileCount, ordinalStart: ordinal, epochJd: epochJd, ids: Array(chunk[ordinal..<(ordinal + tile.ordinalCount)]))
                let key = StateTileDecoder.sha256(Data("\(plan.planId):\(sequence)".utf8))
                let decoded: VerifiedStateTile
                if let cached = try await cache.read(key: key, expected: expected) {
                    decoded = cached
                } else {
                    let (data, response) = try await receive(path: "v1/state/tiles", body: ["planId": plan.planId, "sequence": sequence], binary: true)
                    guard let etag = response.value(forHTTPHeaderField: "ETag") else {
                        throw StateTileFailure.invalid("State tile ETag missing.")
                    }
                    decoded = try await cache.decodeAndStore(data, key: key, expected: expected, etag: etag)
                }
                let tileBytes = decoded.metadata.reduce(decoded.states.count * 8 + decoded.exact.count) { bytes, row in
                    bytes + MemoryLayout<TileMetadata>.stride + row.id.utf8.count + row.source.utf8.count + row.datasetVersion.utf8.count + row.datasetSha256.utf8.count + row.kernelSha256.utf8.count + row.model.utf8.count + row.centerId.utf8.count + row.stateEvidence.utf8.count + row.missingReason.utf8.count + row.identityStatus.utf8.count
                }
                guard tileBytes <= Self.residentStateBudget - residentBytes else {
                    throw StateTileFailure.invalid("Observation exceeds the native state memory budget. Select fewer bodies; no partial frame was published.")
                }
                residentBytes += tileBytes
                result.metadata.append(contentsOf: decoded.metadata)
                result.states.append(contentsOf: decoded.states)
                result.exact.append(contentsOf: decoded.exact)
                exactCount += decoded.exact.reduce(0) { $0 + ($1 ? 1 : 0) }
                ordinal += tile.ordinalCount
            }
            guard ordinal == chunk.count, exactCount == plan.exactCount else {
                throw StateTileFailure.invalid("Incomplete state plan or precision count mismatch.")
            }
        }
        try Task.checkCancellation()
        return result
    }
}

/// URLSession delivers chunks directly into a bounded allocation. Avoid a
/// suspension and Data append for each of the tens of millions of tile bytes.
private final class NativeHTTPTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let expectedType: String
    private let limit: Int
    private let lock = NSLock()
    private var continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var session: URLSession?
    private var response: HTTPURLResponse?
    private var body = Data()
    private var expectedLength = 0
    private var terminal = false

    init(contentType: String, limit: Int) { expectedType = contentType; self.limit = limit }

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
        configuration.timeoutIntervalForResource = 120
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
        guard http.statusCode == 200 else {
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
