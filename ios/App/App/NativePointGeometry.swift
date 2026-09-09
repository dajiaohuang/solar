import Foundation
import SceneKit
import UIKit

/// Shared by the native deck and pixel regression tests. Input is derived
/// render-space data; authoritative state vectors remain Float64 elsewhere.
enum NativePointGeometry {
    static func make(points: [SCNVector3]) -> SCNGeometry {
        let source = SCNGeometrySource(vertices: points)
        let indices = Array(0..<UInt32(points.count))
        let indexData = indices.withUnsafeBytes { Data($0) }
        let element = SCNGeometryElement(data: indexData, primitiveType: .point,
                                        primitiveCount: points.count, bytesPerIndex: MemoryLayout<UInt32>.size)
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
