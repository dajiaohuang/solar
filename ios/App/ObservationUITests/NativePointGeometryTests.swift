import XCTest
import SceneKit
import UIKit
import Metal

/// Synthetic geometry test in the simulator runner, not an ephemeris oracle,
/// physical-device performance measurement or UIKit display-scale validation.
/// Compiles the same geometry source as App; never launches a synthetic app path.
@MainActor
final class NativePointGeometryTests: XCTestCase {
    private struct Pixels: Codable {
        let viewport: Int
        let distance: Float
        let width: Int
        let height: Int
        let brightCount: Int
        let peak: Int
        let totalLight: Int
    }

    private func measure(_ image: UIImage, viewport: Int, distance: Float) throws -> Pixels {
        let cg = try XCTUnwrap(image.cgImage)
        XCTAssertEqual(cg.width, viewport)
        XCTAssertEqual(cg.height, viewport)
        var bytes = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        try bytes.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: cg.width, height: cg.height,
                bitsPerComponent: 8, bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(cg, in: CGRect(x: 0, y: 0, width: CGFloat(cg.width), height: CGFloat(cg.height)))
        }
        var minX = cg.width, minY = cg.height, maxX = -1, maxY = -1
        var count = 0, peak = 0, total = 0
        for y in 0..<cg.height {
            for x in 0..<cg.width {
                let offset = (y * cg.width + x) * 4
                let light = min(Int(bytes[offset]), Int(bytes[offset + 1]), Int(bytes[offset + 2]))
                peak = max(peak, light); total += light
                if light >= 64 {
                    count += 1; minX = min(minX, x); maxX = max(maxX, x)
                    minY = min(minY, y); maxY = max(maxY, y)
                }
            }
        }
        return Pixels(viewport: viewport, distance: distance,
                      width: count == 0 ? 0 : maxX - minX + 1,
                      height: count == 0 ? 0 : maxY - minY + 1,
                      brightCount: count, peak: peak, totalLight: total)
    }

    func testFixedScreenPointsDoNotShrinkOrFadeWithDistance() throws {
        continueAfterFailure = false
        let device = try XCTUnwrap(MTLCreateSystemDefaultDevice(), "Metal rendering cannot be skipped")
        let renderer = SCNRenderer(device: device, options: nil)
        let scene = SCNScene()
        scene.background.contents = UIColor.black
        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 60
        // Fixed planes isolate point rasterization from automatic camera bounds.
        // This is not evidence for interactive camera clipping behavior.
        camera.camera?.zNear = 0.01
        camera.camera?.zFar = 100_000
        scene.rootNode.addChildNode(camera)
        let cloud = SCNNode(geometry: NativePointGeometry.make(points: [SCNVector3Zero]))
        scene.rootNode.addChildNode(cloud)
        renderer.scene = scene; renderer.pointOfView = camera
        defer { renderer.scene = nil; renderer.pointOfView = nil }

        var evidence: [Pixels] = []
        func snapshot(viewport: Int, distance: Float, name: String) throws -> Pixels {
            camera.position = SCNVector3(0, 0, distance)
            let image = renderer.snapshot(atTime: 0, with: CGSize(width: CGFloat(viewport), height: CGFloat(viewport)), antialiasingMode: .none)
            let attachment = XCTAttachment(image: image)
            attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
            return try measure(image, viewport: viewport, distance: distance)
        }

        // Output dimensions are pixels, not simulated UIKit backing scales.
        for viewport in [256, 512, 768] {
            var baseline: Pixels?
            for distance in [Float(16), 160, 1600] {
                let result = try snapshot(viewport: viewport, distance: distance,
                                          name: "synthetic-fixed-point-\(viewport)-z\(distance)")
                evidence.append(result)
                XCTAssertGreaterThanOrEqual(result.width, 3, "Point is too small or absent")
                XCTAssertGreaterThanOrEqual(result.height, 3)
                XCTAssertLessThanOrEqual(result.width, 16, "Point must stay screen-bounded")
                XCTAssertLessThanOrEqual(result.height, 16)
                XCTAssertGreaterThanOrEqual(result.peak, 240, "Opaque white point faded")
                if let near = baseline {
                    XCTAssertLessThanOrEqual(abs(result.width - near.width), 1)
                    XCTAssertLessThanOrEqual(abs(result.height - near.height), 1)
                    XCTAssertLessThanOrEqual(abs(result.brightCount - near.brightCount), max(2, near.brightCount / 5))
                    XCTAssertLessThanOrEqual(abs(result.peak - near.peak), 5)
                    XCTAssertLessThanOrEqual(abs(result.totalLight - near.totalLight), max(255, near.totalLight / 5))
                } else { baseline = result }
            }
        }

        // Negative control: the same world-size point without equal clamps
        // must become smaller. This catches a test that never moves the camera.
        let element = try XCTUnwrap(cloud.geometry?.elements.first)
        element.minimumPointScreenSpaceRadius = 1
        element.maximumPointScreenSpaceRadius = 128
        let near = try snapshot(viewport: 256, distance: 16, name: "synthetic-perspective-control-near")
        let far = try snapshot(viewport: 256, distance: 1600, name: "synthetic-perspective-control-far")
        evidence.append(contentsOf: [near, far])
        XCTAssertGreaterThan(near.width, far.width + 4, "Negative control did not exercise perspective shrinkage")

        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let json = String(decoding: try encoder.encode(evidence), as: UTF8.self)
        let attachment = XCTAttachment(string: json)
        attachment.name = "synthetic-point-pixel-measurements"
        attachment.lifetime = .keepAlways; add(attachment)
        print("SOLAR_POINT_PIXELS \(json)")
    }
}
