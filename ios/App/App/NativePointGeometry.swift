import Foundation
#if canImport(SceneKit) && canImport(UIKit)
import SceneKit
import UIKit
#endif

/// Shared by the native deck and pixel regression tests. Input is derived
/// render-space data; authoritative state vectors remain Float64 elsewhere.
struct NativePointPayload: Sendable {
    let vertices: Data
    let indices: Data
    let count: Int
    private enum PreparationError: Error { case capacityExceeded }

    static func prepare(projectedPoints: [SIMD3<Float>]) throws -> NativePointPayload {
        try Task.checkCancellation()
        try prepare(count: projectedPoints.count) { bytes in
            let stride = MemoryLayout<SIMD3<Float>>.stride
            for index in projectedPoints.indices {
                if index % 4096 == 0 { try Task.checkCancellation() }
                let point = projectedPoints[index], offset = index * stride
                bytes.storeBytes(of: point.x, toByteOffset: offset, as: Float.self)
                bytes.storeBytes(of: point.y, toByteOffset: offset + MemoryLayout<Float>.stride, as: Float.self)
                bytes.storeBytes(of: point.z, toByteOffset: offset + 2 * MemoryLayout<Float>.stride, as: Float.self)
            }
            return projectedPoints.count
        }
    }

    /// Build final GPU storage directly from the authoritative frame scan.
    /// The 3D projector uses this to avoid a full intermediate point array.
    static func prepare(count: Int, fillVertices: (UnsafeMutableRawBufferPointer) throws -> Int) throws -> NativePointPayload {
        try Task.checkCancellation()
        guard count >= 0, count <= 500_000 else { throw PreparationError.capacityExceeded }
        let vertexStride = MemoryLayout<SIMD3<Float>>.stride
        var vertices = Data(count: count * vertexStride)
        let written = try vertices.withUnsafeMutableBytes { (bytes: UnsafeMutableRawBufferPointer) in
            try fillVertices(bytes)
        }
        guard written == count else { throw PreparationError.capacityExceeded }
        let indexStride = MemoryLayout<UInt32>.size
        var indices = Data(count: count * indexStride)
        try indices.withUnsafeMutableBytes { (bytes: UnsafeMutableRawBufferPointer) in
            for index in 0..<count {
                if index % 4096 == 0 { try Task.checkCancellation() }
                bytes.storeBytes(of: UInt32(index), toByteOffset: index * indexStride, as: UInt32.self)
            }
        }
        try Task.checkCancellation()
        return NativePointPayload(vertices: vertices, indices: indices, count: count)
    }

    func limited(to limit: Int) throws -> NativePointPayload {
        try Task.checkCancellation()
        let vertexStride = MemoryLayout<SIMD3<Float>>.stride, indexStride = MemoryLayout<UInt32>.stride
        guard limit >= 0, limit <= count, vertices.count == count * vertexStride,
              indices.count == count * indexStride else { throw PreparationError.capacityExceeded }
        var boundedVertices = Data()
        boundedVertices.reserveCapacity(limit * vertexStride)
        boundedVertices.append(contentsOf: vertices.prefix(limit * vertexStride))
        var boundedIndices = Data(count: limit * indexStride)
        try boundedIndices.withUnsafeMutableBytes { (bytes: UnsafeMutableRawBufferPointer) in
            for index in 0..<limit {
                if index % 4096 == 0 { try Task.checkCancellation() }
                bytes.storeBytes(of: UInt32(index), toByteOffset: index * indexStride, as: UInt32.self)
            }
        }
        try Task.checkCancellation()
        return NativePointPayload(vertices: boundedVertices, indices: boundedIndices, count: limit)
    }
}

#if canImport(SceneKit) && canImport(UIKit)
enum NativePointGeometry {
    static func make(points: [SCNVector3]) -> SCNGeometry {
        let source = SCNGeometrySource(vertices: points)
        return make(source: source, count: points.count)
    }

    static func make(payload: NativePointPayload) -> SCNGeometry {
        // SIMD3 has padding: describe its actual stride rather than assuming
        // tightly packed triples or allocating an intermediate SCNVector3 array.
        let source = SCNGeometrySource(data: payload.vertices, semantic: .vertex,
            vectorCount: payload.count, usesFloatComponents: true,
            componentsPerVector: 3, bytesPerComponent: MemoryLayout<Float>.size,
            dataOffset: 0, dataStride: MemoryLayout<SIMD3<Float>>.stride)
        return make(source: source, count: payload.count, indexData: payload.indices)
    }

    private static func make(source: SCNGeometrySource, count: Int) -> SCNGeometry {
        precondition(count >= 0 && count <= Int(UInt32.max))
        // Fill the owned index data directly instead of retaining a second
        // full index array while copying it into Data.
        let indexStride = MemoryLayout<UInt32>.size
        var indexData = Data(count: count * indexStride)
        indexData.withUnsafeMutableBytes { (bytes: UnsafeMutableRawBufferPointer) in
            for index in 0..<count {
                bytes.storeBytes(of: UInt32(index), toByteOffset: index * indexStride, as: UInt32.self)
            }
        }
        return make(source: source, count: count, indexData: indexData)
    }

    private static func make(source: SCNGeometrySource, count: Int, indexData: Data) -> SCNGeometry {
        let element = SCNGeometryElement(data: indexData, primitiveType: .point,
                                        primitiveCount: count, bytesPerIndex: MemoryLayout<UInt32>.size)
        // Equal screen-space clamps prevent perspective shrinkage. Do not
        // multiply by distance or infer screen-scale units from world pointSize.
        // The snapshot regression measures actual output pixels independently.
        element.pointSize = 4
        element.minimumPointScreenSpaceRadius = 4
        element.maximumPointScreenSpaceRadius = 4
        let geometry = SCNGeometry(sources: [source], elements: [element])
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = UIColor.white
        material.isDoubleSided = true
        material.writesToDepthBuffer = false
        geometry.materials = [material]
        return geometry
    }
}
#endif
