import Foundation

struct NativeStateFrame: Sendable {
    let identity = UUID()
    let epochJd: Double
    let catalogHash: String
    let inventoryHash: String?
    var metadata: [TileMetadata] = []
    var states: [Double] = []
    var exact: [Bool] = []
}

/// Immutable render-only coordinates; source states retain Float64 precision.
struct NativeProjection: Sendable {
    let identity = UUID()
    var points: [SIMD3<Float>] = []
    var candidates = 0

    static func make(frame: NativeStateFrame?, reference: String, limit: Int) throws -> NativeProjection {
        guard limit > 0 else { throw StateTileFailure.invalid("Invalid display limit.") }
        guard let frame = frame else { return NativeProjection() }
        guard frame.metadata.count == frame.exact.count, frame.states.count / 6 == frame.exact.count,
              frame.states.count % 6 == 0 else { throw StateTileFailure.invalid("Incomplete render source.") }
        guard let origin = frame.metadata.firstIndex(where: { $0.id == reference }), frame.exact[origin] else { return NativeProjection() }
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
