import SwiftUI
import UniformTypeIdentifiers

private struct ContactDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var bytes: Data
    init(bytes: Data) { self.bytes = bytes }
    init(configuration: ReadConfiguration) throws { bytes = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: bytes) }
}

struct NativeGroundContactView: View {
    let address: String
    @Environment(\.scenePhase) private var scenePhase
    @State private var expanded = false
    @State private var start = "2024-04-08T17:00:00Z"
    @State private var end = "2024-04-08T21:00:00Z"
    @State private var longitude = "-96.797"
    @State private var latitude = "32.7767"
    @State private var height = "130"
    @State private var foreground = "301"
    @State private var background = "10"
    @State private var report: NativeGroundContacts?
    @State private var bytes: Data?
    @State private var message = ""
    @State private var work: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var exporting = false
    @State private var exportDocument = ContactDocument(bytes: Data())
    private var zh: Bool { Locale.preferredLanguages.first?.hasPrefix("zh") == true }
    private func copy(_ en: String, _ cn: String) -> String { zh ? cn : en }
    private var inputs: [String] { [address, start, end, longitude, latitude, height, foreground, background] }
    var body: some View {
        Section {
            Button(copy("Ground occultation and transit contacts", "地面掩星与凌日接触")) { expanded.toggle() }.accessibilityIdentifier("contacts.disclosure")
            if expanded {
                Text(copy("Dallas eclipse example. Set explicit UTC bounds and WGS84 station coordinates. CN reception with sourced equal-axis PCK spheres only.", "达拉斯日食示例。请明确设置 UTC 窗口及 WGS84 站点。仅使用 CN 接收模型与有来源的 PCK 等轴球体。"))
                field(copy("Start UTC", "开始 UTC"), $start, "start")
                field(copy("End UTC", "结束 UTC"), $end, "end")
                field(copy("Longitude degrees, east positive", "经度（度，东经为正）"), $longitude, "longitude")
                field(copy("Latitude degrees", "纬度（度）"), $latitude, "latitude")
                field(copy("Ellipsoidal height metres", "椭球高（米）"), $height, "height")
                field(copy("Foreground NAIF ID", "前景 NAIF 编号"), $foreground, "foreground")
                field(copy("Background NAIF ID", "背景 NAIF 编号"), $background, "background")
                Button(work == nil ? copy("Search ground contacts", "搜索地面接触") : copy("Cancel search", "取消搜索")) { if work == nil { search() } else { clear() } }.accessibilityIdentifier("contacts.load")
                Text(message).accessibilityIdentifier("contacts.status")
                if let result = report?.result {
                    Text(copy("Short or grazing events may be missed. Physical timing uncertainty is unknown; numerical brackets are not physical accuracy. No apparent limb aberration, deflection, terrain, refraction or visibility certification.", "可能漏掉短时或擦边事件。物理时间不确定性未知；数值区间不代表物理精度。不含边缘光行差、偏折、地形、折射或可见性认证。"))
                    ForEach(Array(result.contacts.enumerated()), id: \.offset) { _, c in
                        Text("\(c.boundary) · \(c.direction)\n\(c.utc)\n\(c.bracketUtc[0]) → \(c.bracketUtc[1])").textSelection(.enabled)
                    }
                    if result.contacts.isEmpty { Text(copy("No contacts does not prove no overlap; this search may lie inside an event.", "没有接触不代表没有重叠；搜索窗口可能位于事件内部。")) }
                    if let windows = result.sampledOverlapWindows {
                        Text(copy("Sample-inferred overlap windows. Unsampled gaps may split them; duration bounds are numerical, not physical uncertainty.", "采样推断的重叠窗口。未采样间隙可能分割区间；持续时间范围是数值范围，不是物理不确定性。"))
                        ForEach(Array(windows.enumerated()), id: \.offset) { index, window in
                            Text("\(window.boundary == "external" ? copy("Disk overlap", "圆盘重叠") : copy("Disk containment", "圆盘包含"))\n\(window.start.utc) → \(window.end.utc)\n\(window.durationSeconds, specifier: "%.3f") s [\(window.numericalDurationBoundsSeconds[0], specifier: "%.3f"), \(window.numericalDurationBoundsSeconds[1], specifier: "%.3f")]\n\(window.start.kind) / \(window.end.kind)").textSelection(.enabled).accessibilityIdentifier("contacts.window.\(index)")
                        }
                    }
                    Text("IERS \(result.earthOrientation.retrievedAt)\n\(result.earthOrientation.sha256)").textSelection(.enabled)
                    Button(copy("Save contacts and sources JSON", "保存接触与来源 JSON")) { if let bytes = bytes { exportDocument = ContactDocument(bytes: bytes); exporting = true } }.accessibilityIdentifier("contacts.export")
                }
            }
        }
        .onChange(of: inputs) { _ in clear() }
        .onChange(of: expanded) { if !$0 { clear() } }
        .onChange(of: scenePhase) { if $0 != .active { clear() } }
        .onDisappear { clear() }
        .fileExporter(isPresented: $exporting, document: exportDocument, contentType: .json, defaultFilename: "solar-ground-contacts") { outcome in
            switch outcome { case .success: message = copy("Contact source response saved.", "已保存接触来源响应。")
            case .failure(let error): message = String(describing: error) }
        }
    }
    private func field(_ label: String, _ value: Binding<String>, _ id: String) -> some View {
        VStack(alignment: .leading) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            TextField(label, text: value).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("contacts.\(id)")
        }
    }
    private func clear() { generation = UUID(); work?.cancel(); work = nil; report = nil; bytes = nil; message = "" }
    private func search() {
        clear()
        guard let base = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)), let lon = Double(longitude), let lat = Double(latitude), let h = Double(height), let front = Int(foreground), let back = Int(background) else { message = copy("Invalid backend or station inputs.", "后端或站点输入无效。"); return }
        let input = NativeGroundContactRequest(startUtc: start, endUtc: end, station: .init(longitudeDeg: lon, latitudeDeg: lat, heightMeters: h), foregroundId: front, backgroundId: back, aberration: "CN")
        let token = generation; message = copy("Searching…", "搜索中…")
        work = Task { @MainActor in
            do {
                let (result, raw) = try await NativeGroundContactService(base: base).load(input)
                guard !Task.isCancelled, generation == token else { return }
                report = result; bytes = raw; message = "\(result.result.contacts.count) contacts · \(result.result.evaluations) evaluations"; work = nil
            } catch {
                guard generation == token else { return }; work = nil; message = String(describing: error)
            }
        }
    }
}
