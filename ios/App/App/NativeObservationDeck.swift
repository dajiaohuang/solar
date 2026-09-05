import SwiftUI
import SceneKit
import UIKit

@MainActor
final class ObservationModel: ObservableObject {
    @Published var frame: NativeStateFrame?
    @Published var message = "Configure your full-version backend in Advanced to load verified states."
    @Published var loading = false
    @Published var coverage: NativeCoverageReport?
    @Published var coverageLoading = false
    @Published var coverageMessage = "Load source coverage when you need an audit summary."
    private var request: Task<Void, Never>?
    private var coverageRequest: Task<Void, Never>?
    private var coverageGeneration = 0
    private var requestGate = NativeObservationRequestGate()
    private var cache: StateTileCache?

    func cancel() {
        requestGate.cancel()
        request?.cancel(); request = nil
        if loading { message = "Loading cancelled. No partial observation was published." }
        loading = false
        clearCoverage()
    }

    func clearCoverage() {
        coverageGeneration += 1
        coverageRequest?.cancel(); coverageRequest = nil
        coverage = nil; coverageLoading = false
    }

    func referenceChanged(_ reference: String) {
        if requestGate.shouldCancel(reference: reference) { cancel() }
    }

    func load(address: String, ids: [String], epoch: String, reference: String) {
        cancel(); frame = nil
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              let jd = Double(epoch), jd.isFinite else {
            message = "Enter a backend HTTPS address and a finite Julian date in TDB."
            return
        }
        let current = requestGate.begin(reference: reference)
        loading = true; message = "Loading verified states…"
        request = Task {
            do {
                if cache == nil { cache = try StateTileCache() }
                guard let cache = cache else { return }
                let service = try StateTileService(base: url, cache: cache)
                let result = try await service.load(ids: ids, epochJd: jd)
                try Task.checkCancellation()
                guard requestGate.isCurrent(current) else { return }
                frame = result
                let exact = result.exact.reduce(0) { $0 + ($1 ? 1 : 0) }
                message = "\(exact) verified states · \(result.exact.count - exact) data gaps"
            } catch {
                guard requestGate.isCurrent(current) else { return }
                message = error.localizedDescription
            }
            if requestGate.isCurrent(current) { loading = false; request = nil }
        }
    }

    func loadCoverage(address: String) {
        clearCoverage()
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            coverageMessage = "Enter an HTTPS backend address to load source coverage."
            return
        }
        coverageLoading = true
        coverageMessage = "Loading source coverage…"
        let generation = coverageGeneration
        coverageRequest = Task {
            do {
                let result = try await NativeCoverageService(base: url).load()
                try Task.checkCancellation()
                guard generation == coverageGeneration else { return }
                coverage = result; coverageMessage = "Source coverage loaded."
            } catch is CancellationError {
                // Cancellation clears the report and leaves the disclosure actionable.
            } catch {
                guard generation == coverageGeneration else { return }
                coverage = nil; coverageMessage = error.localizedDescription
            }
            if generation == coverageGeneration { coverageLoading = false; coverageRequest = nil }
        }
    }
}

private struct NativePreset: Identifiable {
    let id: String
    let title: String
    let reference: String
    let ids: [String]
    static let all: [NativePreset] = [
        .init(id: "planets", title: "Planets · Sun reference", reference: "naif:10", ids: [10, 199, 299, 399, 499, 599, 699, 799, 899].map { "naif:\($0)" }),
        .init(id: "earth", title: "Earth and Moon", reference: "naif:399", ids: ["naif:399", "naif:301", "naif:10"]),
        .init(id: "mars", title: "Mars, Phobos and Deimos", reference: "naif:499", ids: ["naif:499", "naif:401", "naif:402"]),
        .init(id: "jupiter", title: "Jupiter and Galilean moons", reference: "naif:599", ids: [599, 501, 502, 503, 504].map { "naif:\($0)" }),
        .init(id: "saturn", title: "Saturn and major moons", reference: "naif:699", ids: [699, 601, 602, 603, 604, 605, 606, 607, 608].map { "naif:\($0)" }),
        .init(id: "uranus", title: "Uranus and major moons", reference: "naif:799", ids: [799, 701, 702, 703, 704, 705].map { "naif:\($0)" }),
        .init(id: "neptune", title: "Neptune and Triton", reference: "naif:899", ids: ["naif:899", "naif:801"])
    ]
}

struct ObservationDeckView: View {
    @StateObject private var model = ObservationModel()
    @AppStorage("native.backend.address") private var address = ""
    @AppStorage("native.onboarding.complete") private var onboarded = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var tutorial = false
    @State private var mode3D = true
    @State private var selected = "planets"
    @State private var epoch = "2461287.5"
    @State private var customIDs = ""
    @State private var reference = "naif:10"

    private var preset: NativePreset { NativePreset.all.first { $0.id == selected } ?? NativePreset.all[0] }
    private var coverageTitle: String { Locale.current.language.languageCode?.identifier == "zh" ? "来源覆盖" : "Source coverage" }

    private func load() {
        let supplied = customIDs.split { $0.isWhitespace || $0 == "," }.map(String.init)
        var seen = Set<String>()
        let ids = ((supplied.isEmpty ? preset.ids : supplied) + [reference]).filter { !$0.isEmpty && seen.insert($0).inserted }
        model.load(address: address, ids: ids, epoch: epoch, reference: reference)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Observation Deck") {
                    if !onboarded {
                        Text("Explore a verified solar-system observation. Missing data remains visible as a gap.")
                        HStack {
                            Button("Start tutorial") { tutorial = true; onboarded = true }
                            Spacer()
                            Button("Explore directly") { onboarded = true }
                        }
                        .buttonStyle(.borderless)
                    }
                    NativeStateViewport(frame: model.frame, reference: reference, mode3D: mode3D)
                        .frame(height: 280)
                        // A parent label replaces the count/error Text's accessible
                        // label. Keep its actual content and describe the mode as a hint.
                        .accessibilityHint(mode3D ? "Three-dimensional verified states" : "Two-dimensional verified states")
                    Text(model.message).font(.callout).foregroundStyle(.secondary)
                        .accessibilityIdentifier("observation.status")
                    if let frame = model.frame {
                        Text("TDB JD \(String(format: "%.9f", frame.epochJd)) · ECLIPJ2000")
                            .font(.caption).textSelection(.enabled)
                    }
                    HStack {
                        Button {
                            if model.loading { model.cancel() } else { load() }
                        } label: {
                            Label(model.loading ? "Cancel" : "Load observation", systemImage: model.loading ? "xmark.circle" : "arrow.clockwise")
                        }
                        .accessibilityIdentifier("observation.load")
                        Spacer()
                        Button(mode3D ? "Switch to 2D" : "Switch to 3D") { mode3D.toggle() }
                            .accessibilityIdentifier("observation.mode")
                    }
                    .buttonStyle(.borderless)
                }
                Section(coverageTitle) {
                    DisclosureGroup {
                        Text(model.coverageMessage).font(.callout).foregroundStyle(.secondary)
                            .accessibilityIdentifier("coverage.status")
                        Button {
                            if model.coverageLoading { model.clearCoverage() } else { model.loadCoverage(address: address) }
                        } label: {
                            Label(model.coverageLoading ? (Locale.current.language.languageCode?.identifier == "zh" ? "取消" : "Cancel") : (model.coverage == nil ? (Locale.current.language.languageCode?.identifier == "zh" ? "加载覆盖" : "Load coverage") : (Locale.current.language.languageCode?.identifier == "zh" ? "重新加载覆盖" : "Reload coverage")), systemImage: model.coverageLoading ? "xmark.circle" : "arrow.clockwise")
                        }
                        .accessibilityIdentifier("coverage.load")
                        if let report = model.coverage {
                            Text("\(report.counts.sourceRecords) source records · \(report.counts.mappedSourceRecords) mapped · \(report.counts.unresolvedSourceRecords) unresolved")
                            Text("\(report.counts.explicitNaifTargets) explicit targets · \(report.counts.availableTargetsAtAuditEpoch) available at audit")
                            Text("Window: \(report.requestedWindow.startEt)–\(report.requestedWindow.endEt) \(report.timeScale)")
                            DisclosureGroup("Reasons and hashes") {
                                ForEach(report.unresolvedReasons.keys.sorted(), id: \.self) { reason in Text("\(reason): \(report.unresolvedReasons[reason] ?? 0)") }
                                Text("Catalog SHA-256: \(report.catalogManifestSha256)").textSelection(.enabled)
                                Text("Inventory SHA-256: \(report.inventoryManifestSha256)").textSelection(.enabled)
                                Text("Source snapshot SHA-256: \(report.sourceSnapshotSha256)").textSelection(.enabled)
                            }
                        }
                    } label: { Text(Locale.current.language.languageCode?.identifier == "zh" ? "来源身份与依赖窗口审计" : "Source identity and dependency-window audit") }
                    .accessibilityIdentifier("coverage.disclosure")
                }
                Section("Preset scenes") {
                    ForEach(NativePreset.all) { item in
                        Button {
                            selected = item.id; reference = item.reference; customIDs = ""
                            if !address.isEmpty { load() } else { model.cancel(); model.frame = nil }
                        } label: {
                            HStack {
                                Text(item.title)
                                Spacer()
                                if selected == item.id { Image(systemName: "checkmark").accessibilityLabel("Selected") }
                            }
                        }
                        .accessibilityIdentifier("preset.\(item.id)")
                    }
                }
                DisclosureGroup("Advanced") {
                    TextField("Full-version backend HTTPS address", text: $address)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    TextField("Julian date (TDB)", text: $epoch)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.numbersAndPunctuation)
                    TextField("Reference body ID", text: $reference)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Body IDs, separated by commas", text: $customIDs, axis: .vertical)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().lineLimit(2...5)
                        .accessibilityIdentifier("observation.ids")
                    Text("Enter audited catalog or source IDs. Requests are partitioned without dropping IDs. The reference body must have a verified state at the same epoch.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("Open tutorial") { tutorial = true }
                    if let frame = model.frame {
                        Text("Catalog SHA-256: \(frame.catalogHash)").font(.caption).textSelection(.enabled)
                    }
                }
                .accessibilityIdentifier("observation.advanced")
                if let frame = model.frame {
                    DisclosureGroup("State evidence and data gaps (\(frame.metadata.count))") {
                        ForEach(frame.metadata.indices, id: \.self) { index in
                            let row = frame.metadata[index]
                            VStack(alignment: .leading, spacing: 4) {
                                Text(row.id).font(.headline)
                                Text(frame.exact[index] ? "Verified · \(row.model) · \(row.source)" : "Missing · \(row.missingReason)")
                                    .font(.caption).foregroundStyle(.secondary)
                                if frame.exact[index] { Text(row.datasetSha256).font(.caption2).textSelection(.enabled) }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Solar Atlas")
            .sheet(isPresented: $tutorial) {
                NavigationStack {
                    List {
                        Text("1. Choose a preset scene. Each scene states its reference body.")
                        Text("2. Configure your full-version backend under Advanced, then load an observation. No public backend is bundled.")
                        Text("3. Drag to rotate the 3D view and pinch to zoom. Points keep a fixed screen size. Switch to 2D to inspect the ecliptic projection.")
                        Text("4. Expand State evidence to inspect sources and missing-data reasons. The epoch is entered explicitly as a TDB Julian date.")
                        Text("The first native build supports verified current states. Offline launch works, but loading an observation currently requires the manifest and plan from the backend; cached tiles avoid repeated downloads.")
                    }
                    .navigationTitle("First observation")
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { tutorial = false } } }
                }
            }
            .onChange(of: scenePhase) { phase in if phase != .active { model.cancel() } }
            .onChange(of: address) { _ in model.clearCoverage() }
            .onChange(of: reference) { value in model.referenceChanged(value) }
            .onDisappear { model.cancel() }
        }
    }
}

private struct ProjectionKey: Hashable {
    let frame: UUID?
    let reference: String
    let mode3D: Bool
}

private struct NativeStateViewport: View {
    let frame: NativeStateFrame?
    let reference: String
    let mode3D: Bool

    @State private var projection = NativeProjection()
    @State private var projectedKey: ProjectionKey?
    @State private var projectionError: String?
    private var key: ProjectionKey { ProjectionKey(frame: frame?.identity, reference: reference, mode3D: mode3D) }

    var body: some View {
        let positions = projectedKey == key ? projection.points : []
        ZStack(alignment: .bottomLeading) {
            Color.black
            if positions.isEmpty {
                Text(projectionError ?? "No verified states to display\nLoad a scene with an available reference body.")
                    .multilineTextAlignment(.center).foregroundStyle(.white.opacity(0.8)).padding()
            } else if mode3D {
                NativePointScene(projection: projection)
            } else {
                Canvas { context, size in
                    let scale = min(size.width, size.height) / 12
                    for point in positions {
                        let rect = CGRect(x: size.width / 2 + CGFloat(point.x) * scale - 2, y: size.height / 2 - CGFloat(point.y) * scale - 2, width: 4, height: 4)
                        context.fill(Path(ellipseIn: rect), with: .color(.white))
                    }
                }
            }
            if !positions.isEmpty {
                Text("\(positions.count)/\(projection.candidates) displayed · \(mode3D ? "250,000" : "500,000") display limit")
                    .font(.caption2).foregroundStyle(.white).padding(8).background(.black.opacity(0.7))
                    .accessibilityIdentifier("observation.displayed")
            }
        }.clipShape(RoundedRectangle(cornerRadius: 12))
        .task(id: key) {
            let expected = key
            projectionError = nil
            let source = frame, sourceReference = reference, renderLimit = mode3D ? 250_000 : 500_000
            let worker = Task.detached(priority: .userInitiated) {
                try NativeProjection.make(frame: source, reference: sourceReference, limit: renderLimit)
            }
            do {
                let result = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                try Task.checkCancellation()
                projection = result; projectedKey = expected
            } catch is CancellationError {
                // SwiftUI restarts the task only when the observation/reference/mode changes.
            } catch { projectionError = error.localizedDescription }
        }
    }
}

private struct NativePointScene: UIViewRepresentable {
    let projection: NativeProjection
    final class Coordinator { var identity: UUID? }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.backgroundColor = .black
        view.allowsCameraControl = true
        view.rendersContinuously = false
        view.preferredFramesPerSecond = 60
        let scene = SCNScene()
        let camera = SCNNode(); camera.camera = SCNCamera(); camera.position = SCNVector3(0, 0, 16)
        camera.camera?.automaticallyAdjustsZRange = true
        scene.rootNode.addChildNode(camera)
        let cloud = SCNNode(); cloud.name = "verified-states"; scene.rootNode.addChildNode(cloud)
        view.scene = scene; view.pointOfView = camera
        return view
    }
    func updateUIView(_ view: SCNView, context: Context) {
        guard context.coordinator.identity != projection.identity else { return }
        context.coordinator.identity = projection.identity
        let points = projection.points.map { SCNVector3($0.x, $0.y, $0.z) }
        let source = SCNGeometrySource(vertices: points)
        let indices = Array(0..<UInt32(points.count))
        let indexData = indices.withUnsafeBytes { Data($0) }
        let element = SCNGeometryElement(data: indexData, primitiveType: .point, primitiveCount: points.count, bytesPerIndex: MemoryLayout<UInt32>.size)
        element.pointSize = 4; element.minimumPointScreenSpaceRadius = 2; element.maximumPointScreenSpaceRadius = 2
        let geometry = SCNGeometry(sources: [source], elements: [element])
        let material = SCNMaterial(); material.lightingModel = .constant; material.diffuse.contents = UIColor.white
        material.isDoubleSided = true; material.writesToDepthBuffer = false
        geometry.materials = [material]
        view.scene?.rootNode.childNode(withName: "verified-states", recursively: false)?.geometry = geometry
    }
    static func dismantleUIView(_ view: SCNView, coordinator: Coordinator) {
        view.isPlaying = false; view.scene = nil; view.pointOfView = nil
    }
}
