import SwiftUI
import UIKit
import UniformTypeIdentifiers
import OSLog

private struct StellarDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var bytes: Data
    init(bytes: Data) { self.bytes = bytes }
    init(configuration: ReadConfiguration) throws { bytes = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: bytes) }
}

/// Import immutable source bytes through the system's copy operation. Opening
/// in place requires resolving a provider bookmark in the receiving app; the
/// retained simulator failure selected the document but failed that resolution
/// before SwiftUI's fileImporter could deliver a URL.
private struct StellarSourcePicker: UIViewControllerRepresentable {
    let completion: (URL?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data], asCopy: true)
        picker.allowsMultipleSelection = false
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        private let completion: (URL?) -> Void
        private var completed = false

        init(completion: @escaping (URL?) -> Void) { self.completion = completion }

        private func finish(_ url: URL?) {
            guard !completed else { return }
            completed = true
            completion(url)
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            finish(urls.count == 1 ? urls.first : nil)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(nil) }
    }
}

struct NativeStellarMotionView: View {
    private static let importLog = Logger(subsystem: "io.github.dajiaohuang.solaratlas.stellar-import", category: "lifecycle")
    let address: String
    @Environment(\.scenePhase) private var scenePhase
    @State private var expanded = false
    @State private var manifest: Data?
    @State private var rows: Data?
    @State private var sourceId = "65212004581252736"
    @State private var epoch = "2026"
    @State private var adoptRV = false
    @State private var covariance = false
    @State private var stationMode = false
    @State private var utc = ""
    @State private var longitude = ""
    @State private var latitude = ""
    @State private var height = ""
    @State private var refraction = false
    @State private var pressure = ""
    @State private var temperature = ""
    @State private var humidity = ""
    @State private var wavelength = ""
    @State private var importing = false
    @State private var importingManifest = true
    @State private var exporting = false
    @State private var document = StellarDocument(bytes: Data())
    @State private var report: NativeStellarMotionReport?
    @State private var observerReport: NativeStellarObserverReport?
    @State private var exportFilename = "solar-stellar-motion"
    @State private var work: Task<Void, Never>?
    @State private var workIdentity: UUID?
    @State private var busy = false
    @State private var workDeadline: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var message = ""
    @State private var exportMessage = ""
    private var zh: Bool { Locale.preferredLanguages.first?.hasPrefix("zh") == true }
    private func copy(_ en: String, _ cn: String) -> String { zh ? cn : en }

    var body: some View {
        Section {
            Button(copy("Gaia stellar motion", "Gaia 恒星运动")) { expanded.toggle() }.accessibilityIdentifier("stellar.disclosure")
            if expanded {
                Text(copy("Import the original Gaia manifest.json and rows.csv. J2016 TCB single-star propagation; measured radial velocity is required.", "导入 Gaia 原始 manifest.json 与 rows.csv。从 J2016 TCB 传播单星运动；必须提供实测径向速度。"))
                Button(copy("Import manifest.json", "导入 manifest.json")) { Self.importLog.notice("Manifest import requested"); importingManifest = true; importing = true }.accessibilityIdentifier("stellar.manifest")
                Button(copy("Import rows.csv", "导入 rows.csv")) { Self.importLog.notice("Rows import requested"); importingManifest = false; importing = true }.accessibilityIdentifier("stellar.rows")
                Text("manifest.json: \(manifest?.count ?? 0) B · rows.csv: \(rows?.count ?? 0) B").accessibilityIdentifier("stellar.files")
                field(copy("Exact Gaia source ID", "精确 Gaia 来源编号"), $sourceId, "id")
                Toggle(copy("Observe from a ground station", "从地面站点观测"), isOn: $stationMode).accessibilityIdentifier("stellar.station-mode")
                if stationMode { stationInputs }
                else { field(copy("Target TCB Julian year (1916–2116)", "目标 TCB 儒略年（1916–2116）"), $epoch, "epoch") }
                Toggle(copy("Adopt spectroscopic RV as astrometric RV", "采用光谱径向速度近似天体测量径向速度"), isOn: $adoptRV).accessibilityIdentifier("stellar.rv")
                if !stationMode { Toggle(copy("Formal covariance with independent RV error", "形式协方差：假设径向速度误差独立"), isOn: $covariance).accessibilityIdentifier("stellar.covariance") }
                Button(!busy ? (stationMode ? copy("Calculate station direction", "计算站点方向") : copy("Calculate stellar motion", "计算恒星运动")) : copy("Cancel", "取消")) { if !busy { calculate() } else { clear() } }
                    .disabled(!busy && (manifest == nil || rows == nil || !adoptRV)).accessibilityIdentifier("stellar.load")
                Text(message).accessibilityIdentifier("stellar.status")
                if !exportMessage.isEmpty {
                    Text(exportMessage).font(.callout).accessibilityIdentifier("stellar.export-status")
                }
                if let report = report {
                    Text(readout(report)).textSelection(.enabled).accessibilityIdentifier("stellar.result")
                    Text(copy("Uniform single-star model with light-time and relativistic terms. No binary acceleration, systematics, observer corrections or distance inference. Formal errors are local first-order estimates under the chosen assumptions; they do not certify physical accuracy.", "含光行时与相对论项的匀速单星模型。不含双星加速度、系统误差、观测者修正或距离推断。形式误差仅为所选假设下的局部一阶估计，不是物理精度认证。"))
                    Button(copy("Save result and original sources", "保存结果与原始来源")) { save(report.originalResponse, filename: "solar-stellar-motion") }.accessibilityIdentifier("stellar.export")
                }
                if let observerReport = observerReport {
                    Text(readout(observerReport)).textSelection(.enabled).accessibilityIdentifier("stellar.observer-result")
                    Button(copy("Save result and original sources", "保存结果与原始来源")) { save(observerReport.originalResponse, filename: "solar-stellar-observer") }.accessibilityIdentifier("stellar.export")
                }
            }
        }
        .onChange(of: [address, sourceId, epoch, utc, longitude, latitude, height, pressure, temperature, humidity, wavelength]) { _ in clear() }
        .onChange(of: stationMode) { _ in clear() }
        .onChange(of: refraction) { _ in clear() }
        .onChange(of: adoptRV) { _ in clear() }
        .onChange(of: covariance) { _ in clear() }
        .onChange(of: expanded) { if !$0 { clear() } }
        .onChange(of: scenePhase) { if $0 != .active { Self.importLog.notice("Scene left active state"); clear() } }
        .onChange(of: importing) { shown in Self.importLog.notice("Importer presentation binding: \(shown)") }
        .onDisappear { Self.importLog.notice("Stellar section disappeared"); clear() }
        .sheet(isPresented: $importing) {
            StellarSourcePicker { url in
                importing = false
                guard let url else { Self.importLog.notice("Source selection cancelled"); return }
                Self.importLog.notice("Importer completion delivered a copied URL")
                importFile(url, isManifest: importingManifest)
            }
        }
        .onChange(of: exporting) { if $0 { exportMessage = "" } }
        .fileExporter(isPresented: $exporting, document: document, contentType: .json, defaultFilename: exportFilename) { outcome in
            defer { document = StellarDocument(bytes: Data()) }
            switch outcome { case .success: exportMessage = exportFilename + copy(": selected snapshot saved.", "：已保存所选快照。")
            case .failure(let error): exportMessage = exportFilename + ": " + String(describing: error) }
        }
    }

    private var stationInputs: some View {
        Group {
            Text(copy("UTC determines the propagation epoch. Requires backend SPK and IERS coverage. Coordinates use WGS84; no station or weather defaults are assumed.", "UTC 决定传播历元；需要后端 SPK 与 IERS 覆盖。站点采用 WGS84，不预设站点或天气。"))
            field("UTC (YYYY-MM-DDTHH:mm:ssZ)", $utc, "utc")
            field(copy("Longitude, east positive (deg)", "经度，东经为正（度）"), $longitude, "longitude")
            field(copy("Geodetic latitude (deg)", "大地纬度（度）"), $latitude, "latitude")
            field(copy("WGS84 ellipsoid height (m)", "WGS84 椭球高（米）"), $height, "height")
            Toggle(copy("Include atmospheric refraction", "加入大气折射"), isOn: $refraction).accessibilityIdentifier("stellar.refraction")
            if refraction {
                field(copy("Pressure (hPa)", "气压（hPa）"), $pressure, "pressure")
                field(copy("Temperature (°C)", "温度（°C）"), $temperature, "temperature")
                field(copy("Relative humidity (0–1)", "相对湿度（0–1）"), $humidity, "humidity")
                field(copy("Wavelength (µm)", "波长（µm）"), $wavelength, "wavelength")
                Text(copy("Refraction is omitted below 5° airless altitude. This model does not establish visibility or physical accuracy.", "无大气高度低于 5° 时不输出折射方向。此模型不判定可见性，也不保证物理精度。"))
            }
        }
    }

    private func save(_ bytes: Data, filename: String) {
        document = StellarDocument(bytes: bytes); exportFilename = filename; exporting = true
    }

    private func field(_ name: String, _ binding: Binding<String>, _ id: String) -> some View {
        VStack(alignment: .leading) {
            Text(name).font(.caption).foregroundStyle(.secondary)
            TextField(name, text: binding).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("stellar.\(id)")
        }
    }
    private func clear() { generation = UUID(); work?.cancel(); finish(); report = nil; observerReport = nil; message = "" }
    private func finish() { busy = false; workDeadline?.cancel(); workDeadline = nil }
    private func acceptWork(token: UUID, deadline: TimeInterval, importing: Bool = false) -> Bool {
        guard !Task.isCancelled, token == generation else { return false }
        guard ProcessInfo.processInfo.systemUptime < deadline else {
            clear()
            message = importing ? copy("File import timed out.", "文件导入超时。") : copy("Scientific calculation timed out.", "科学计算超时。")
            return false
        }
        return true
    }
    private func startWork(token: UUID, operation: @escaping @MainActor (TimeInterval) async -> Void) {
        let predecessor = work
        let owner = UUID()
        let deadline = ProcessInfo.processInfo.systemUptime + 25
        let importing = workDeadline != nil
        workIdentity = owner; busy = true
        if workDeadline == nil {
            workDeadline = Task { @MainActor in
                do { try await Task.sleep(nanoseconds: 25_000_000_000) } catch { return }
                guard token == generation, workIdentity == owner else { return }
                clear(); message = copy("Scientific calculation timed out.", "科学计算超时。")
            }
        }
        work = Task { @MainActor in
            defer {
                if workIdentity == owner {
                    work = nil; workIdentity = nil
                    if token == generation { finish() }
                }
            }
            await predecessor?.value
            guard acceptWork(token: token, deadline: deadline, importing: importing) else { return }
            await operation(deadline)
        }
    }
    private func importFile(_ url: URL, isManifest: Bool) {
        Self.importLog.notice("Bounded source read started")
        clear(); if isManifest { manifest = nil } else { rows = nil }
        let token = generation; message = copy("Reading original file…", "正在读取原始文件…")
        workDeadline = Task { @MainActor in
            do { try await Task.sleep(nanoseconds: 25_000_000_000) } catch { return }
            guard token == generation else { return }
            clear(); message = copy("File import timed out. Retry when the provider is available.", "文件导入超时，请在文件提供方可用后重试。")
        }
        startWork(token: token) { deadline in
            do {
                let bytes = try await StellarSourceReader.shared.read(url, limit: isManifest ? NativeStellarMotionRequest.maxManifestBytes : NativeStellarMotionRequest.maxRowsBytes)
                guard acceptWork(token: token, deadline: deadline, importing: true) else { return }
                if isManifest { manifest = bytes } else { rows = bytes }
                Self.importLog.notice("Bounded source read completed: \(bytes.count) bytes")
                finish(); message = copy("Original file loaded.", "原始文件已载入。")
            } catch { Self.importLog.error("Bounded source read failed or cancelled"); guard acceptWork(token: token, deadline: deadline, importing: true) else { return }; finish(); message = String(describing: error) }
        }
    }
    private func calculate() {
        clear()
        guard let manifest = manifest, let rows = rows,
              let base = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)) else { message = copy("Invalid source files or backend.", "来源文件或后端无效。"); return }
        let token = generation
        do {
            let service = try NativeStellarMotionService(base: base)
            let id = sourceId.trimmingCharacters(in: .whitespacesAndNewlines)
            let rvPolicy = adoptRV ? NativeStellarMotionRequest.rvPolicy : ""
            if stationMode {
                let station = try NativeStellarObserverRequest.Station(
                    longitudeDeg: numeric(longitude, copy("Longitude", "经度")),
                    latitudeDeg: numeric(latitude, copy("Latitude", "纬度")),
                    heightMeters: numeric(height, copy("Ellipsoid height", "椭球高")))
                let atmosphere: NativeStellarObserverRequest.Atmosphere?
                if refraction {
                    atmosphere = try NativeStellarObserverRequest.Atmosphere(
                        pressureHPa: numeric(pressure, copy("Pressure", "气压")),
                        temperatureC: numeric(temperature, copy("Temperature", "温度")),
                        relativeHumidity: numeric(humidity, copy("Relative humidity", "相对湿度")),
                        wavelengthMicrometers: numeric(wavelength, copy("Wavelength", "波长")))
                } else { atmosphere = nil }
                let input = try NativeStellarObserverRequest(manifest: manifest, rows: rows, sourceId: id,
                    radialVelocityPolicy: rvPolicy, utc: utc.trimmingCharacters(in: .whitespacesAndNewlines), station: station, atmosphere: atmosphere)
                message = copy("Calculating…", "正在计算…")
                startWork(token: token) { deadline in
                    do {
                        let result = try await service.loadObserver(input)
                        guard acceptWork(token: token, deadline: deadline) else { return }
                        observerReport = result; finish(); message = "Gaia DR3 \(result.sourceId) · \(result.utc)"
                    } catch { guard acceptWork(token: token, deadline: deadline) else { return }; finish(); message = String(describing: error) }
                }
            } else {
                let input = try NativeStellarMotionRequest(manifest: manifest, rows: rows, sourceId: id, epoch: numeric(epoch, copy("TCB year", "TCB 年份")),
                    radialVelocityPolicy: rvPolicy, covariancePolicy: covariance ? NativeStellarMotionRequest.independentRVPolicy : nil)
                message = copy("Calculating…", "正在计算…")
                startWork(token: token) { deadline in
                    do {
                        let result = try await service.load(input)
                        guard acceptWork(token: token, deadline: deadline) else { return }
                        report = result; finish(); message = "Gaia DR3 \(result.sourceId) · J\(result.epoch) TCB"
                    } catch { guard acceptWork(token: token, deadline: deadline) else { return }; finish(); message = String(describing: error) }
                }
            }
        } catch { message = String(describing: error) }
    }
    private func numeric(_ text: String, _ label: String) throws -> Double {
        guard let value = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)), value.isFinite else {
            throw StateTileFailure.invalid(label + copy(": enter a finite number.", "：请填写有限数值。"))
        }
        return value
    }

    private func readout(_ result: NativeStellarObserverReport) -> String {
        func number(_ value: Double) -> String { String(format: "%.12g", locale: Locale(identifier: "en_US_POSIX"), value) }
        func horizontal(_ values: [Double]) -> String {
            copy("Azimuth, north through east (deg): ", "方位角，从北向东（度）：") + number(values[0]) + "\n"
                + copy("Altitude (deg): ", "高度角（度）：") + number(values[1])
        }
        var lines = [copy("Apparent direction without atmosphere", "无大气视方向"), horizontal(result.airless),
            "CIRS RA / Dec (deg): \(number(result.cirsRaDeg)) / \(number(result.cirsDecDeg))"]
        if let refracted = result.refracted {
            lines += [copy("With atmospheric refraction", "加入大气折射后"), horizontal(refracted)]
        } else if result.refractionStatus == "outside-altitude-domain" {
            lines.append(copy("Refraction omitted: airless altitude below 5°.", "未输出折射方向：无大气高度低于 5°。"))
        } else { lines.append(copy("Atmospheric refraction not requested.", "未请求大气折射。")) }
        if result.solarDeflectionLimited { lines.append(copy("Solar deflection limiter active; near-Sun accuracy is restricted.", "太阳偏折限幅已启用，近太阳方向精度受限。")) }
        lines += [copy("BCRS coordinate direction before deflection and aberration", "偏折与光行差修正前的 BCRS 坐标方向"),
            "RA / Dec (deg): \(number(result.raDeg)) / \(number(result.decDeg))",
            "[\(result.coordinateDirection.map(number).joined(separator: ", "))]",
            "JD TDB: \(result.epochTdbParts.map(number).joined(separator: " + "))",
            copy("Solar elongation (deg): ", "太阳角距（度）：") + number(result.solarElongationDeg),
            "Catalog: \(result.catalogVersion)", "Catalog SHA-256: \(result.catalogManifestSha256)", "IERS SHA-256: \(result.earthOrientationSha256)",
            copy("Model limits and warnings", "模型限制与警告")]
        lines += result.notes
        return lines.joined(separator: "\n")
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
