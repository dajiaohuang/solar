import SwiftUI
import UniformTypeIdentifiers

private struct StellarDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var bytes: Data
    init(bytes: Data) { self.bytes = bytes }
    init(configuration: ReadConfiguration) throws { bytes = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: bytes) }
}

struct NativeStellarMotionView: View {
    let address: String
    @Environment(\.scenePhase) private var scenePhase
    @State private var expanded = false
    @State private var manifest: Data?
    @State private var rows: Data?
    @State private var sourceId = "65212004581252736"
    @State private var epoch = "2026"
    @State private var adoptRV = false
    @State private var covariance = false
    @State private var importing = false
    @State private var importingManifest = true
    @State private var exporting = false
    @State private var document = StellarDocument(bytes: Data())
    @State private var report: NativeStellarMotionReport?
    @State private var work: Task<Void, Never>?
    @State private var importDeadline: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var message = ""
    private var zh: Bool { Locale.preferredLanguages.first?.hasPrefix("zh") == true }
    private func copy(_ en: String, _ cn: String) -> String { zh ? cn : en }

    var body: some View {
        Section {
            Button(copy("Gaia stellar motion", "Gaia 恒星运动")) { expanded.toggle() }.accessibilityIdentifier("stellar.disclosure")
            if expanded {
                Text(copy("Import the original Gaia manifest.json and rows.csv. J2016 TCB single-star propagation; measured radial velocity is required.", "导入 Gaia 原始 manifest.json 与 rows.csv。从 J2016 TCB 传播单星运动；必须提供实测径向速度。"))
                Button(copy("Import manifest.json", "导入 manifest.json")) { importingManifest = true; importing = true }.accessibilityIdentifier("stellar.manifest")
                Button(copy("Import rows.csv", "导入 rows.csv")) { importingManifest = false; importing = true }.accessibilityIdentifier("stellar.rows")
                Text("manifest.json: \(manifest?.count ?? 0) B · rows.csv: \(rows?.count ?? 0) B").accessibilityIdentifier("stellar.files")
                field(copy("Exact Gaia source ID", "精确 Gaia 来源编号"), $sourceId, "id")
                field(copy("Target TCB Julian year (1916–2116)", "目标 TCB 儒略年（1916–2116）"), $epoch, "epoch")
                Toggle(copy("Adopt spectroscopic RV as astrometric RV", "采用光谱径向速度近似天体测量径向速度"), isOn: $adoptRV).accessibilityIdentifier("stellar.rv")
                Toggle(copy("Formal covariance with independent RV error", "形式协方差：假设径向速度误差独立"), isOn: $covariance).accessibilityIdentifier("stellar.covariance")
                Button(work == nil ? copy("Calculate stellar motion", "计算恒星运动") : copy("Cancel", "取消")) { if work == nil { calculate() } else { clear() } }
                    .disabled(work == nil && (manifest == nil || rows == nil || !adoptRV)).accessibilityIdentifier("stellar.load")
                Text(message).accessibilityIdentifier("stellar.status")
                if let report = report {
                    Text(readout(report)).textSelection(.enabled).accessibilityIdentifier("stellar.result")
                    Text(copy("Uniform single-star model with light-time and relativistic terms. No binary acceleration, systematics, observer corrections or distance inference. Formal errors are local first-order estimates under the chosen assumptions; they do not certify physical accuracy.", "含光行时与相对论项的匀速单星模型。不含双星加速度、系统误差、观测者修正或距离推断。形式误差仅为所选假设下的局部一阶估计，不是物理精度认证。"))
                    Button(copy("Save result and original sources", "保存结果与原始来源")) { document = StellarDocument(bytes: report.originalResponse); exporting = true }.accessibilityIdentifier("stellar.export")
                }
            }
        }
        .onChange(of: [address, sourceId, epoch]) { _ in clear() }
        .onChange(of: adoptRV) { _ in clear() }
        .onChange(of: covariance) { _ in clear() }
        .onChange(of: expanded) { if !$0 { clear() } }
        .onChange(of: scenePhase) { if $0 != .active { clear() } }
        .onDisappear { clear() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data]) { outcome in
            switch outcome { case .success(let url): importFile(url, isManifest: importingManifest)
            case .failure(let error): message = String(describing: error) }
        }
        .fileExporter(isPresented: $exporting, document: document, contentType: .json, defaultFilename: "solar-stellar-motion") { outcome in
            switch outcome { case .success: message = copy("Source-bearing result saved.", "已保存包含原始来源的结果。")
            case .failure(let error): message = String(describing: error) }
        }
    }

    private func field(_ name: String, _ binding: Binding<String>, _ id: String) -> some View {
        VStack(alignment: .leading) {
            Text(name).font(.caption).foregroundStyle(.secondary)
            TextField(name, text: binding).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("stellar.\(id)")
        }
    }
    private func clear() { generation = UUID(); work?.cancel(); finish(); report = nil; message = "" }
    private func finish() { work = nil; importDeadline?.cancel(); importDeadline = nil }
    private func importFile(_ url: URL, isManifest: Bool) {
        clear(); if isManifest { manifest = nil } else { rows = nil }
        let token = generation; message = copy("Reading original file…", "正在读取原始文件…")
        importDeadline = Task { @MainActor in
            do { try await Task.sleep(nanoseconds: 25_000_000_000) } catch { return }
            guard token == generation else { return }
            clear(); message = copy("File import timed out. Retry when the provider is available.", "文件导入超时，请在文件提供方可用后重试。")
        }
        work = Task { @MainActor in
            do {
                let bytes = try await StellarSourceReader.shared.read(url, limit: isManifest ? NativeStellarMotionRequest.maxManifestBytes : NativeStellarMotionRequest.maxRowsBytes)
                guard !Task.isCancelled, token == generation else { return }
                if isManifest { manifest = bytes } else { rows = bytes }
                finish(); message = copy("Original file loaded.", "原始文件已载入。")
            } catch { guard token == generation else { return }; finish(); message = String(describing: error) }
        }
    }
    private func calculate() {
        clear()
        guard let manifest = manifest, let rows = rows, let year = Double(epoch),
              let base = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)) else { message = copy("Invalid source files, year or backend.", "来源文件、年份或后端无效。"); return }
        let token = generation
        do {
            let input = try NativeStellarMotionRequest(manifest: manifest, rows: rows, sourceId: sourceId.trimmingCharacters(in: .whitespacesAndNewlines), epoch: year,
                radialVelocityPolicy: adoptRV ? NativeStellarMotionRequest.rvPolicy : "", covariancePolicy: covariance ? NativeStellarMotionRequest.independentRVPolicy : nil)
            let service = try NativeStellarMotionService(base: base)
            message = copy("Calculating…", "正在计算…")
            work = Task { @MainActor in
                do {
                    let result = try await service.load(input)
                    guard !Task.isCancelled, token == generation else { return }
                    report = result; work = nil; message = "Gaia DR3 \(result.sourceId) · J\(result.epoch) TCB"
                } catch { guard token == generation else { return }; work = nil; message = String(describing: error) }
            }
        } catch { message = String(describing: error) }
    }
    private func readout(_ report: NativeStellarMotionReport) -> String {
        let labels = ["RA (deg)", "Dec (deg)", "Parallax (mas)", "pmra (mas/yr)", "pmdec (mas/yr)", "RV (km/s)"]
        var lines = zip(labels, report.state).map { "\($0): " + String(format: "%.12g", locale: Locale(identifier: "en_US_POSIX"), $1) }
        if let sigma = report.formalStandardDeviations {
            lines.append(copy("Formal standard deviations", "形式标准差"))
            let units = ["delta-alpha*cos(delta) (mas)", "delta-dec (mas)", "parallax (mas)", "pmra (mas/yr)", "pmdec (mas/yr)", "RV (km/s)"]
            lines += zip(units, sigma).map { "\($0): " + String(format: "%.6g", locale: Locale(identifier: "en_US_POSIX"), $1) }
        }
        return lines.joined(separator: "\n")
    }
}
