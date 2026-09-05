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
    @Published var coverageMessage = CoverageCopy.empty
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
        coverageMessage = CoverageCopy.empty
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
            coverageMessage = CoverageCopy.badAddress
            return
        }
        coverageLoading = true
        coverageMessage = CoverageCopy.loading
        let generation = coverageGeneration
        coverageRequest = Task {
            do {
                let result = try await NativeCoverageService(base: url).load()
                try Task.checkCancellation()
                guard generation == coverageGeneration else { return }
                coverage = result; coverageMessage = CoverageCopy.loaded
            } catch is CancellationError {
                // Cancellation clears the report and leaves the disclosure actionable.
            } catch is NativeCoverageUnavailable {
                guard generation == coverageGeneration else { return }
                coverage = nil; coverageMessage = CoverageCopy.unavailable
            } catch {
                guard generation == coverageGeneration else { return }
                coverage = nil; coverageMessage = CoverageCopy.failure
            }
            if generation == coverageGeneration { coverageLoading = false; coverageRequest = nil }
        }
    }
}

private enum CoverageCopy {
    static var isChinese: Bool { Locale.current.language.languageCode?.identifier == "zh" }
    private static var zh: Bool { isChinese }
    static var empty: String { zh ? "需要审计摘要时加载来源覆盖。" : "Load source coverage when you need an audit summary." }
    static var badAddress: String { zh ? "输入 HTTPS 后端地址以加载来源覆盖。" : "Enter an HTTPS backend address to load source coverage." }
    static var loading: String { zh ? "正在加载来源覆盖…" : "Loading source coverage…" }
    static var loaded: String { zh ? "来源覆盖已加载。" : "Source coverage loaded." }
    static var unavailable: String { zh ? "来源覆盖不可用；后端未发布报告。不可用不代表覆盖数量为零。" : "Source coverage is unavailable; no report was published. Unavailable does not mean zero coverage." }
    static var failure: String { zh ? "无法加载覆盖，请检查 HTTPS 后端后重试。" : "Coverage could not be loaded. Check the HTTPS backend and try again." }
    static var title: String { zh ? "来源覆盖" : "Source coverage" }
    static var audit: String { zh ? "来源身份与依赖窗口审计" : "Source identity and dependency-window audit" }
    static var load: String { zh ? "加载覆盖" : "Load coverage" }
    static var reload: String { zh ? "重新加载覆盖" : "Reload coverage" }
    static var cancel: String { zh ? "取消" : "Cancel" }
    static var reasons: String { zh ? "原因与哈希" : "Reasons and hashes" }
    static var expanded: String { zh ? "已展开" : "Expanded" }
    static var collapsed: String { zh ? "已收起" : "Collapsed" }
    static var counts: (UInt64, UInt64, UInt64) -> String { { a, b, c in zh ? "来源记录：\(a) · 已映射：\(b) · 未解析：\(c)" : "Source records: \(a) · mapped: \(b) · unresolved: \(c)" } }
    static var targets: (UInt64, UInt64) -> String { { a, b in zh ? "显式目标：\(a) · 审计时可用：\(b)" : "Explicit targets: \(a) · available at audit: \(b)" } }
    static var dependency: (UInt64, UInt64) -> String { { a, b in zh ? "依赖窗口：\(a) 个完整 · \(b) 个有缺口" : "Dependency window: \(a) covered · \(b) gaps" } }
    static var auditWindow: (Double, Double, Double, String) -> String { { a, s, e, scale in zh ? "审计 ET：\(a) · 窗口：\(s)–\(e)（\(scale)）" : "Audit ET: \(a) · Window: \(s)–\(e) (\(scale))" } }
    static var caveat: String { zh ? "尚未建立全窗口数值认证。同一天体可能有多条来源记录或别名。依赖可用性不代表数值精度认证；这些统计不是当前显示的天体数量。" : "No whole-window numerical certification. Several source records or aliases can identify the same body. Dependency availability does not certify numerical accuracy; these are not current displayed-body counts." }
    static var version: (String) -> String { { zh ? "版本：\($0)" : "Version: \($0)" } }
    static var hash: (String, String) -> String { { label, value in "\(label): \(value)" } }
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
    @State private var coverageExpanded = false
    @State private var coverageDetailsExpanded = false

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
                Section(CoverageCopy.title) {
                    // Keep every audit item a separate List row. A single nested
                    // disclosure row can clip its controls and propagate its
                    // accessibility identifier to the contained load button.
                    Button {
                        coverageExpanded.toggle()
                        coverageDetailsExpanded = false
                    } label: {
                        HStack {
                            Text(CoverageCopy.audit)
                            Spacer()
                            Image(systemName: coverageExpanded ? "chevron.down" : "chevron.right").accessibilityHidden(true)
                        }
                    }
                    .accessibilityIdentifier("coverage.disclosure")
                    .accessibilityValue(coverageExpanded ? CoverageCopy.expanded : CoverageCopy.collapsed)
                    if coverageExpanded {
                        Text(model.coverageMessage).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("coverage.status")
                        Button {
                            coverageDetailsExpanded = false
                            if model.coverageLoading { model.clearCoverage() } else { model.loadCoverage(address: address) }
                        } label: {
                            Label(model.coverageLoading ? CoverageCopy.cancel : (model.coverage == nil ? CoverageCopy.load : CoverageCopy.reload), systemImage: model.coverageLoading ? "xmark.circle" : "arrow.clockwise")
                        }.accessibilityIdentifier("coverage.load")
                        if let report = model.coverage {
                            Text(CoverageCopy.counts(report.counts.sourceRecords, report.counts.mappedSourceRecords, report.counts.unresolvedSourceRecords)).accessibilityIdentifier("coverage.counts")
                            Text(CoverageCopy.targets(report.counts.explicitNaifTargets, report.counts.availableTargetsAtAuditEpoch)).accessibilityIdentifier("coverage.targets")
                            Text(CoverageCopy.dependency(report.windowCounts.dependencyCoveredTargets, report.windowCounts.targetsWithDependencyGaps)).accessibilityIdentifier("coverage.windowCounts")
                            Text(CoverageCopy.auditWindow(report.auditEt, report.requestedWindow.startEt, report.requestedWindow.endEt, report.timeScale) + " · ECLIPJ2000").accessibilityIdentifier("coverage.audit")
                            Text(CoverageCopy.caveat).accessibilityIdentifier("coverage.caveat")
                            Button { coverageDetailsExpanded.toggle() } label: {
                                HStack {
                                    Text(CoverageCopy.reasons)
                                    Spacer()
                                    Image(systemName: coverageDetailsExpanded ? "chevron.down" : "chevron.right").accessibilityHidden(true)
                                }
                            }
                            .accessibilityIdentifier("coverage.details")
                            .accessibilityValue(coverageDetailsExpanded ? CoverageCopy.expanded : CoverageCopy.collapsed)
                            if coverageDetailsExpanded {
                                ForEach(report.unresolvedReasons.keys.sorted(), id: \.self) { reason in Text("\(reason): \(report.unresolvedReasons[reason] ?? 0)") }
                                Text(CoverageCopy.version(report.catalogVersion)).textSelection(.enabled)
                                Text(CoverageCopy.hash(CoverageCopy.isChinese ? "报告 SHA-256" : "Report SHA-256", report.reportSha256)).textSelection(.enabled)
                                Text(CoverageCopy.hash(CoverageCopy.isChinese ? "目录 SHA-256" : "Catalog SHA-256", report.catalogManifestSha256)).textSelection(.enabled)
                                Text(CoverageCopy.hash(CoverageCopy.isChinese ? "清单 SHA-256" : "Inventory SHA-256", report.inventoryManifestSha256)).textSelection(.enabled)
                                Text(CoverageCopy.hash(CoverageCopy.isChinese ? "来源快照 SHA-256" : "Source snapshot SHA-256", report.sourceSnapshotSha256)).textSelection(.enabled)
                                Text(CoverageCopy.hash(CoverageCopy.isChinese ? "身份映射 SHA-256" : "Identity mapping SHA-256", report.identityMappingSha256)).textSelection(.enabled)
                                Text(CoverageCopy.hash(CoverageCopy.isChinese ? "卫星目录 SHA-256" : "Satellite catalog SHA-256", report.satelliteCatalogSha256)).textSelection(.enabled)
                            }
                        }
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
            .onChange(of: coverageExpanded) { expanded in if !expanded { model.clearCoverage() } }
            .onChange(of: reference) { value in model.referenceChanged(value) }
            .onDisappear { model.cancel() }
        }
    }
}

private struct ProjectionKey: Hashable {
    let frame: UUID?
    let reference: String
    let mode3D: Bool
    let active: Bool
}

private struct NativeStateViewport: View {
    let frame: NativeStateFrame?
    let reference: String
    let mode3D: Bool

    @Environment(\.scenePhase) private var scenePhase
    @State private var pressure = NativeDisplayPressure()
    // Reading thermalState before subscription enables Foundation notifications.
    @State private var thermalState = ProcessInfo.processInfo.thermalState
    @State private var projection = NativeProjection()
    @State private var projectedKey: ProjectionKey?
    @State private var projectionError: String?
    private var key: ProjectionKey { ProjectionKey(frame: frame?.identity, reference: reference, mode3D: mode3D, active: scenePhase == .active) }
    private var limit: Int { pressure.limit(mode3D: mode3D) }

    private func applyThermal() {
        thermalState = ProcessInfo.processInfo.thermalState
        let value: NativeDisplayPressure.Thermal
        switch thermalState {
        case .nominal: value = .nominal
        case .fair: value = .fair
        case .serious: value = .serious
        case .critical: value = .critical
        @unknown default: value = .serious
        }
        pressure.thermalChanged(value, now: ProcessInfo.processInfo.systemUptime)
    }

    private var pressureMessage: String {
        let zh = CoverageCopy.isChinese
        switch pressure.reason {
        case .initial: return zh ? "初始显示预算；尚无帧率自适应或真机性能保证。" : "Initial display budget; frame-time adaptation and device performance are not verified."
        case .thermal: return zh ? "温度压力已降低显示预算；科学状态未删除，冷却不会立即恢复上限。" : "Thermal pressure lowered the display budget; scientific states retained. Cooling does not restore the limit."
        case .memory: return zh ? "内存警告已降低显示预算；科学状态未删除。" : "Memory warning lowered the display budget; scientific states retained."
        }
    }

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
            if frame != nil && projectedKey == key {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(positions.count)/\(projection.candidates) displayed · \(limit.formatted(.number.locale(Locale(identifier: "en_US")))) display limit")
                        .accessibilityIdentifier("observation.displayed")
                    Text(pressureMessage).accessibilityIdentifier("observation.pressure")
                }.font(.caption2).foregroundStyle(.white).padding(8).background(.black.opacity(0.7))
            }
        }.clipShape(RoundedRectangle(cornerRadius: 12))
        .task(id: key) {
            let expected = key
            projectionError = nil
            guard expected.active else { projection = NativeProjection(); projectedKey = nil; return }
            applyThermal()
            let source = frame, sourceReference = reference, renderLimit = limit
            let worker = Task.detached(priority: .userInitiated) {
                try NativeProjection.make(frame: source, reference: sourceReference, limit: renderLimit)
            }
            do {
                let result = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                try Task.checkCancellation()
                // A pressure warning may arrive while the detached task runs.
                // Clamp against the current policy, not the captured old limit.
                projection = try result.limited(to: limit); projectedKey = expected
            } catch is CancellationError {
                // SwiftUI restarts for observation/reference/mode/activity changes.
            } catch { if !Task.isCancelled { projectionError = error.localizedDescription } }
        }
        .onChange(of: limit) { value in
            // No new detached task, full-state copy, scale or camera reset is
            // needed for pressure-only reductions. Scene identity stays mounted.
            if let reduced = try? projection.limited(to: value) { projection = reduced }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification).receive(on: RunLoop.main)) { _ in
            pressure.memoryWarning(now: ProcessInfo.processInfo.systemUptime)
        }
        .onReceive(NotificationCenter.default.publisher(for: ProcessInfo.thermalStateDidChangeNotification).receive(on: RunLoop.main)) { _ in applyThermal() }
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
        view.scene?.rootNode.childNode(withName: "verified-states", recursively: false)?.geometry = NativePointGeometry.make(points: points)
    }
    static func dismantleUIView(_ view: SCNView, coordinator: Coordinator) {
        view.isPlaying = false; view.scene = nil; view.pointOfView = nil
    }
}
