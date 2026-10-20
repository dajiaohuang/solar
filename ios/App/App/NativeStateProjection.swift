import Foundation

/// A preset updates the reference and starts a request in one action. Its
/// deferred reference-change callback must not cancel that matching request.
struct NativeObservationRequestGate {
    struct Token: Equatable, Sendable { let generation: UInt64; let reference: String }
    private var generation: UInt64 = 0
    private var active: Token?

    mutating func begin(reference: String) -> Token {
        generation &+= 1
        let token = Token(generation: generation, reference: reference)
        active = token
        return token
    }

    mutating func cancel() { active = nil }
    func isCurrent(_ token: Token) -> Bool { active == token }
    func shouldCancel(reference: String) -> Bool {
        guard let active = active else { return false }
        return active.reference != reference
    }
}

struct NativeStateFrame: Sendable {
    let identity = UUID()
    let epochJd: Double
    let catalogHash: String
    let inventoryHash: String?
    var metadata: [TileMetadata] = []
    var states: [Double] = []
    var exact: [Bool] = []
    // Set only after every decoded chunk's count matches its verified plan.
    var verifiedExactCount: Int?

    /// Copies only verified rows into independent, bounded storage for an early frame.
    /// The caller accounts the returned allocation alongside its resident final frame.
    static func verifiedPrefix(of frame: NativeStateFrame, exactCount: Int,
                               budgetRemaining: Int) -> (frame: NativeStateFrame, residentBytes: Int)? {
        let count = frame.metadata.count
        guard count > 0, count <= Int.max / 6, frame.states.count == count * 6,
              frame.exact.count == count, exactCount >= 0, exactCount <= count,
              budgetRemaining >= 0,
              frame.exact.prefix(count).reduce(0, { $0 + ($1 ? 1 : 0) }) == exactCount else { return nil }
        let stateCount = count * 6
        let minimumBytes = count * (MemoryLayout<TileMetadata>.stride + MemoryLayout<Bool>.stride)
            + stateCount * MemoryLayout<Double>.stride
        guard minimumBytes <= budgetRemaining else { return nil }

        var metadata: [TileMetadata] = []
        metadata.reserveCapacity(count)
        var states: [Double] = []
        states.reserveCapacity(stateCount)
        var exact: [Bool] = []
        exact.reserveCapacity(count)
        let residentBytes = metadata.capacity * MemoryLayout<TileMetadata>.stride
            + states.capacity * MemoryLayout<Double>.stride + exact.capacity * MemoryLayout<Bool>.stride
        guard residentBytes <= budgetRemaining else { return nil }
        metadata.append(contentsOf: frame.metadata.prefix(count))
        states.append(contentsOf: frame.states.prefix(stateCount))
        exact.append(contentsOf: frame.exact.prefix(count))

        var prefix = NativeStateFrame(epochJd: frame.epochJd, catalogHash: frame.catalogHash,
                                      inventoryHash: frame.inventoryHash)
        prefix.metadata = metadata
        prefix.states = states
        prefix.exact = exact
        prefix.verifiedExactCount = exactCount
        return (prefix, residentBytes)
    }
}

/// A bounded frame-time window from a native renderer callback. It is a
/// display measurement only; it never changes the verified source frame.
struct NativeFrameWindow: Sendable, Equatable {
    let samples: Int
    let p50Ms: Double
    let p95Ms: Double
    let droppedRatio: Double

    var isValid: Bool {
        samples >= 12 && p50Ms.isFinite && p95Ms.isFinite && droppedRatio.isFinite
            && p50Ms > 0 && p95Ms >= p50Ms && droppedRatio >= 0 && droppedRatio <= 1
    }
}

/// Bounded render-callback sampler. The callback interval is evidence about
/// the native renderer, not a GPU timer or a physical-device SLO measurement.
final class NativeFrameSampler: @unchecked Sendable {
    private var intervals: [Double] = []
    private var previous: TimeInterval?
    private var warmup = 0
    private var elapsed = 0.0

    func reset() {
        intervals.removeAll(keepingCapacity: true)
        previous = nil; warmup = 0; elapsed = 0
    }

    func record(_ timestamp: TimeInterval) -> NativeFrameWindow? {
        guard timestamp.isFinite, timestamp > 0 else { reset(); return nil }
        guard let previous else { self.previous = timestamp; return nil }
        let milliseconds = (timestamp - previous) * 1000
        self.previous = timestamp
        guard milliseconds.isFinite, milliseconds > 0 else { reset(); return nil }
        if warmup < 2 { warmup += 1; return nil }
        intervals.append(milliseconds); elapsed += milliseconds
        guard intervals.count >= 120 || (intervals.count >= 12 && elapsed >= 1_000) else { return nil }
        let sorted = intervals.sorted()
        let expectedSlots = elapsed / (1000.0 / 60)
        let missedSlots = max(0, expectedSlots - Double(sorted.count))
        let droppedRatio = expectedSlots.isFinite && expectedSlots > 0 ? missedSlots / expectedSlots : 1
        let result = NativeFrameWindow(samples: sorted.count,
            p50Ms: sorted[(sorted.count - 1) / 2],
            p95Ms: sorted[min(sorted.count - 1, Int(ceil(Double(sorted.count) * 0.95)) - 1)],
            droppedRatio: droppedRatio)
        intervals.removeAll(keepingCapacity: true); elapsed = 0
        return result
    }
}

/// Owns the single background projection preparation task. Projection
/// preparation is a display-only prefetch of the verified frame; cancelling a
/// mode or scene waits for the previous worker before another buffer starts.
actor NativeProjectionPrefetch {
    private var generation: UInt64 = 0
    private var worker: Task<NativeProjection, Error>?

    func prepare(frame: NativeStateFrame?, reference: String, limit: Int, mode3D: Bool = false) async throws -> NativeProjection {
        generation &+= 1
        let current = generation
        // This request also owns cleanup while draining its predecessor. If
        // cancelled during that wait, do not retain the completed old result.
        // The wait finishes before cleanup, preserving the allocation barrier.
        defer { if generation == current { worker = nil } }
        worker?.cancel()
        if let previous = worker { _ = await previous.result }
        try Task.checkCancellation()
        // The actor can admit a newer request while awaiting the old worker.
        guard generation == current else { throw CancellationError() }
        let maximum = mode3D ? NativeDisplayPressure.maximumSpatial : NativeDisplayPressure.maximumPlanar
        guard limit > 0, limit <= maximum else {
            throw StateTileFailure.invalid("Invalid display limit.")
        }
        let next = Task.detached(priority: .userInitiated) {
            let projection = try NativeProjection.make(frame: frame, reference: reference, limit: limit, mode3D: mode3D)
            try Task.checkCancellation()
            return projection
        }
        worker = next
        // Cancellation belongs to this request's worker. A deferred actor-wide
        // cancel from an old view task could otherwise kill its replacement.
        let result = try await withTaskCancellationHandler(operation: {
            try await next.value
        }, onCancel: { next.cancel() })
        try Task.checkCancellation()
        guard generation == current else { throw CancellationError() }
        return result
    }

    func cancel() async {
        generation &+= 1
        let cancelledGeneration = generation
        worker?.cancel()
        if let previous = worker { _ = await previous.result }
        if generation == cancelledGeneration { worker = nil }
    }
}

/// Display-only pressure and frame-time policy. Cooling down never proves
/// rendering headroom; growth requires fresh measurements for the active mode.
struct NativeDisplayPressure: Sendable {
    enum Thermal: Sendable { case nominal, fair, serious, critical }
    enum Reason: Sendable { case initial, thermal, memory, slow, headroom }
    private(set) var spatialLimit = 100_000
    private(set) var planarLimit = 250_000
    private(set) var reason = Reason.initial
    private(set) var revision: UInt64 = 0
    private(set) var lastPressureTime: Double?
    private var thermalLevel = 0
    private var spatialSlow = 0
    private var planarSlow = 0
    private var spatialFast = 0
    private var planarFast = 0
    private var lastSpatialAdjustment: Double?
    private var lastPlanarAdjustment: Double?
    static let minimum = 25_000
    static let maximumSpatial = 250_000
    static let maximumPlanar = 500_000
    private static let cooldown = 5.0

    func limit(mode3D: Bool) -> Int { mode3D ? spatialLimit : planarLimit }

    mutating func memoryWarning(now: Double) {
        spatialLimit = Self.minimum; planarLimit = Self.minimum
        resetSampling(); record(.memory, now: now)
    }

    mutating func thermalChanged(_ thermal: Thermal, now: Double) {
        let oldThermalLevel = thermalLevel
        let oldSpatialLimit = spatialLimit
        let oldPlanarLimit = planarLimit
        switch thermal {
        case .nominal:
            thermalLevel = 0
            return // No automatic restoration after a pressure event.
        case .fair:
            thermalLevel = 1
            spatialLimit = min(spatialLimit, 75_000)
            planarLimit = min(planarLimit, 100_000)
        case .serious, .critical:
            thermalLevel = 2
            spatialLimit = Self.minimum; planarLimit = Self.minimum
        }
        resetSampling()
        if oldThermalLevel == thermalLevel && oldSpatialLimit == spatialLimit && oldPlanarLimit == planarLimit { return }
        // A later mild thermal event must not hide a more restrictive memory warning.
        record(reason == .memory ? .memory : .thermal, now: now)
    }

    @discardableResult
    mutating func sample(mode3D: Bool, available: Int, window: NativeFrameWindow, now: Double) -> Bool {
        guard available > 0, window.isValid, now.isFinite else {
            resetSampling(); return false
        }
        let currentLimit = limit(mode3D: mode3D)
        let pressured = window.p95Ms > 18.5 || window.droppedRatio > 0.05
        let healthy = thermalLevel < 2 && available >= currentLimit
            && window.p95Ms <= 16.7 && window.droppedRatio < 0.02
        if mode3D {
            spatialSlow = pressured ? spatialSlow + 1 : 0
            spatialFast = healthy ? spatialFast + 1 : 0
            if canAdjust(lastSpatialAdjustment, now: now),
               spatialSlow >= 2 || window.p95Ms > 33.3 || window.droppedRatio > 0.2 {
                return change(mode3D: true, value: reduced(spatialLimit), now: now, reason: .slow)
            }
            if canAdjust(lastSpatialAdjustment, now: now), spatialFast >= 4 {
                return change(mode3D: true, value: grown(spatialLimit, maximum: maximum(mode3D: true)), now: now, reason: .headroom)
            }
        } else {
            planarSlow = pressured ? planarSlow + 1 : 0
            planarFast = healthy ? planarFast + 1 : 0
            if canAdjust(lastPlanarAdjustment, now: now),
               planarSlow >= 2 || window.p95Ms > 33.3 || window.droppedRatio > 0.2 {
                return change(mode3D: false, value: reduced(planarLimit), now: now, reason: .slow)
            }
            if canAdjust(lastPlanarAdjustment, now: now), planarFast >= 4 {
                return change(mode3D: false, value: grown(planarLimit, maximum: maximum(mode3D: false)), now: now, reason: .headroom)
            }
        }
        return false
    }

    private mutating func change(mode3D: Bool, value: Int, now: Double, reason: Reason) -> Bool {
        let old = limit(mode3D: mode3D)
        guard old != value else { return false }
        if mode3D { spatialLimit = value; lastSpatialAdjustment = now }
        else { planarLimit = value; lastPlanarAdjustment = now }
        record(reason, now: now); resetSampling()
        return true
    }

    private func reduced(_ value: Int) -> Int { max(Self.minimum, (value * 3 / 4 / 5_000) * 5_000) }
    private func grown(_ value: Int, maximum: Int) -> Int { min(maximum, ((value + value / 8 + 4_999) / 5_000) * 5_000) }
    private func maximum(mode3D: Bool) -> Int {
        switch thermalLevel {
        case 0: return mode3D ? Self.maximumSpatial : Self.maximumPlanar
        case 1: return mode3D ? 75_000 : 100_000
        default: return Self.minimum
        }
    }
    private func canAdjust(_ last: Double?, now: Double) -> Bool { last == nil || now >= last! + Self.cooldown }
    private mutating func resetSampling() { spatialSlow = 0; planarSlow = 0; spatialFast = 0; planarFast = 0 }

    private mutating func record(_ reason: Reason, now: Double) {
        self.reason = reason
        revision &+= 1 // Repeated warnings invalidate evidence even at the floor.
        if now.isFinite { lastPressureTime = max(lastPressureTime ?? now, now) }
    }
}

/// Immutable render-only coordinates; source states retain Float64 precision.
struct NativeProjection: Sendable {
    let identity = UUID()
    var points: [SIMD2<Float>] = []
    var candidates = 0
    var geometryPayload: NativePointPayload?
    var displayedCount: Int { geometryPayload?.count ?? points.count }

    /// A smaller prefix preserves the full-source scale and camera coordinates.
    /// Never retain a slice referencing the discarded oversized backing buffer.
    func limited(to limit: Int) throws -> NativeProjection {
        try Task.checkCancellation()
        try Self.validateLimit(limit)
        if displayedCount <= limit { return self }
        var result = NativeProjection(candidates: candidates)
        if let geometryPayload {
            guard points.isEmpty else { throw StateTileFailure.invalid("Mixed planar and spatial projection buffers.") }
            result.geometryPayload = try geometryPayload.limited(to: limit)
        } else {
            result.points.reserveCapacity(limit)
            for index in 0..<limit {
                if index % 4096 == 0 { try Task.checkCancellation() }
                result.points.append(points[index])
            }
        }
        try Task.checkCancellation()
        return result
    }

    static func make(frame: NativeStateFrame?, reference: String, limit: Int, mode3D: Bool = false) throws -> NativeProjection {
        try Task.checkCancellation()
        try validateLimit(limit)
        guard let frame = frame else { return NativeProjection() }
        guard frame.metadata.count == frame.exact.count, frame.states.count / 6 == frame.exact.count,
              frame.states.count % 6 == 0 else { throw StateTileFailure.invalid("Incomplete render source.") }
        var originIndex: Int?, candidates = 0
        for row in frame.exact.indices {
            if row % 4096 == 0 { try Task.checkCancellation() }
            if originIndex == nil && frame.metadata[row].id == reference { originIndex = row }
            if frame.exact[row] { candidates += 1 }
        }
        try Task.checkCancellation()
        guard let origin = originIndex, frame.exact[origin] else {
            // An unavailable reference prevents projection, not exact target states.
            return NativeProjection(candidates: candidates)
        }
        let offset = origin * 6
        var radius = 0.0
        for row in frame.exact.indices {
            if row % 4096 == 0 { try Task.checkCancellation() }
            guard frame.exact[row] else { continue }
            let dx = frame.states[row * 6] - frame.states[offset]
            let dy = frame.states[row * 6 + 1] - frame.states[offset + 1]
            let dz = frame.states[row * 6 + 2] - frame.states[offset + 2]
            guard dx.isFinite, dy.isFinite, dz.isFinite else {
                throw StateTileFailure.invalid("Reference-relative coordinate exceeds numeric range.")
            }
            let distance = mode3D ? hypot(hypot(dx, dy), dz) : hypot(dx, dy)
            guard distance.isFinite else { throw StateTileFailure.invalid("Reference-relative radius exceeds numeric range.") }
            radius = max(radius, distance)
        }
        // A spherical 3D bound survives every camera rotation; 2D fits only
        // the displayed plane so distant z coordinates do not shrink the map.
        let scale = max(radius, 1) / 4.75
        var result = NativeProjection(candidates: candidates)
        try Task.checkCancellation()
        if mode3D {
            let displayed = min(limit, candidates)
            let vertexStride = MemoryLayout<SIMD3<Float>>.stride
            result.geometryPayload = try NativePointPayload.prepare(count: displayed) { bytes in
                // Preserve the reference first, followed by exact source order.
                bytes.storeBytes(of: Float.zero, toByteOffset: 0, as: Float.self)
                bytes.storeBytes(of: Float.zero, toByteOffset: MemoryLayout<Float>.stride, as: Float.self)
                bytes.storeBytes(of: Float.zero, toByteOffset: 2 * MemoryLayout<Float>.stride, as: Float.self)
                var written = 1
                for row in frame.exact.indices {
                    if written >= displayed { break }
                    if row % 4096 == 0 { try Task.checkCancellation() }
                    guard row != origin, frame.exact[row] else { continue }
                    let outputOffset = written * vertexStride
                    bytes.storeBytes(of: Float((frame.states[row * 6] - frame.states[offset]) / scale), toByteOffset: outputOffset, as: Float.self)
                    bytes.storeBytes(of: Float((frame.states[row * 6 + 1] - frame.states[offset + 1]) / scale), toByteOffset: outputOffset + MemoryLayout<Float>.stride, as: Float.self)
                    bytes.storeBytes(of: Float((frame.states[row * 6 + 2] - frame.states[offset + 2]) / scale), toByteOffset: outputOffset + 2 * MemoryLayout<Float>.stride, as: Float.self)
                    written += 1
                    if written == displayed { break }
                }
                return written
            }
            return result
        }
        result.points.reserveCapacity(min(limit, candidates))
        // The reference always survives a display cap, regardless of ID ordering.
        result.points.append(.zero)
        for row in frame.exact.indices {
            if row % 4096 == 0 { try Task.checkCancellation() }
            if result.points.count >= limit { break }
            guard row != origin, frame.exact[row] else { continue }
            result.points.append(SIMD2<Float>(Float((frame.states[row * 6] - frame.states[offset]) / scale), Float((frame.states[row * 6 + 1] - frame.states[offset + 1]) / scale)))
        }
        try Task.checkCancellation()
        return result
    }

    private static func validateLimit(_ limit: Int) throws {
        // Shared projection storage serves both modes. Their tighter adaptive
        // policies still apply at the caller; no entry may exceed the 2D cap.
        guard limit > 0, limit <= NativeDisplayPressure.maximumPlanar else {
            throw StateTileFailure.invalid("Invalid display limit.")
        }
    }
}
