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

/// Display-only pressure policy. Cooling down never proves rendering headroom.
/// Frame-time-driven growth is deliberately not implemented by this reducer.
struct NativeDisplayPressure: Sendable {
    enum Thermal: Sendable { case nominal, fair, serious, critical }
    enum Reason: Sendable { case initial, thermal, memory }
    private(set) var spatialLimit = 100_000
    private(set) var planarLimit = 250_000
    private(set) var reason = Reason.initial
    private(set) var revision: UInt64 = 0
    private(set) var lastPressureTime: Double?
    static let minimum = 25_000

    func limit(mode3D: Bool) -> Int { mode3D ? spatialLimit : planarLimit }

    mutating func memoryWarning(now: Double) {
        spatialLimit = Self.minimum; planarLimit = Self.minimum
        record(.memory, now: now)
    }

    mutating func thermalChanged(_ thermal: Thermal, now: Double) {
        switch thermal {
        case .nominal: return // No automatic restoration after a pressure event.
        case .fair:
            spatialLimit = min(spatialLimit, 75_000)
            planarLimit = min(planarLimit, 100_000)
        case .serious, .critical:
            spatialLimit = Self.minimum; planarLimit = Self.minimum
        }
        // A later mild thermal event must not hide a more restrictive memory warning.
        record(reason == .memory ? .memory : .thermal, now: now)
    }

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
