import Foundation

/// A preset updates the reference and starts a request in one action. Its
/// deferred reference-change callback must not cancel that matching request.
struct NativeObservationRequestGate {
    struct Token: Equatable { let generation: UInt64; let reference: String }
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
        var dropped = 0.0
        for interval in sorted { dropped += max(0, (interval / (1000.0 / 60)).rounded() - 1) }
        let result = NativeFrameWindow(samples: sorted.count,
            p50Ms: sorted[(sorted.count - 1) / 2],
            p95Ms: sorted[min(sorted.count - 1, Int(ceil(Double(sorted.count) * 0.95)) - 1)],
            droppedRatio: dropped / (Double(sorted.count) + dropped))
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

    func prepare(frame: NativeStateFrame?, reference: String, limit: Int) async throws -> NativeProjection {
        generation &+= 1
        let current = generation
        worker?.cancel()
        if let previous = worker { _ = await previous.result }
        try Task.checkCancellation()
        let next = Task.detached(priority: .userInitiated) {
            try NativeProjection.make(frame: frame, reference: reference, limit: limit)
        }
        worker = next
        defer { if generation == current { worker = nil } }
        return try await next.value
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
                return change(mode3D: true, value: grown(spatialLimit, maximum: Self.maximumSpatial), now: now, reason: .headroom)
            }
        } else {
            planarSlow = pressured ? planarSlow + 1 : 0
            planarFast = healthy ? planarFast + 1 : 0
            if canAdjust(lastPlanarAdjustment, now: now),
               planarSlow >= 2 || window.p95Ms > 33.3 || window.droppedRatio > 0.2 {
                return change(mode3D: false, value: reduced(planarLimit), now: now, reason: .slow)
            }
            if canAdjust(lastPlanarAdjustment, now: now), planarFast >= 4 {
                return change(mode3D: false, value: grown(planarLimit, maximum: Self.maximumPlanar), now: now, reason: .headroom)
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
    var points: [SIMD3<Float>] = []
    var candidates = 0

    /// A smaller prefix preserves the full-source scale and camera coordinates.
    /// Never retain a slice referencing the discarded oversized backing buffer.
    func limited(to limit: Int) throws -> NativeProjection {
        guard limit > 0 else { throw StateTileFailure.invalid("Invalid display limit.") }
        if points.count <= limit { return self }
        return NativeProjection(points: Array(points.prefix(limit)), candidates: candidates)
    }

    static func make(frame: NativeStateFrame?, reference: String, limit: Int) throws -> NativeProjection {
        guard limit > 0 else { throw StateTileFailure.invalid("Invalid display limit.") }
        guard let frame = frame else { return NativeProjection() }
        guard frame.metadata.count == frame.exact.count, frame.states.count / 6 == frame.exact.count,
              frame.states.count % 6 == 0 else { throw StateTileFailure.invalid("Incomplete render source.") }
        guard let origin = frame.metadata.firstIndex(where: { $0.id == reference }), frame.exact[origin] else {
            var candidates = 0
            for row in frame.exact.indices {
                if row % 4096 == 0 { try Task.checkCancellation() }
                if frame.exact[row] { candidates += 1 }
            }
            // An unavailable reference prevents projection, not exact target states.
            return NativeProjection(candidates: candidates)
        }
        let offset = origin * 6
        var radius = 0.0, candidates = 0
        for row in frame.exact.indices {
            if row % 4096 == 0 { try Task.checkCancellation() }
            guard frame.exact[row] else { continue }
            candidates += 1
            for axis in 0..<3 {
                let relative = frame.states[row * 6 + axis] - frame.states[offset + axis]
                guard relative.isFinite else { throw StateTileFailure.invalid("Reference-relative coordinate exceeds numeric range.") }
                radius = max(radius, abs(relative))
            }
        }
        let scale = max(radius, 1) / 5
        var result = NativeProjection(candidates: candidates)
        result.points.reserveCapacity(min(limit, candidates))
        // The reference always survives a display cap, regardless of ID ordering.
        result.points.append(.zero)
        for row in frame.exact.indices {
            if row % 4096 == 0 { try Task.checkCancellation() }
            if result.points.count >= limit { break }
            guard row != origin, frame.exact[row] else { continue }
            result.points.append(SIMD3<Float>(Float((frame.states[row * 6] - frame.states[offset]) / scale), Float((frame.states[row * 6 + 1] - frame.states[offset + 1]) / scale), Float((frame.states[row * 6 + 2] - frame.states[offset + 2]) / scale)))
        }
        return result
    }
}
