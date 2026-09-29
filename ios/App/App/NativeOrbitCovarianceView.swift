import SwiftUI
import UniformTypeIdentifiers

private struct OrbitCovarianceDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var bytes: Data
    init(bytes: Data) { self.bytes = bytes }
    init(configuration: ReadConfiguration) throws { bytes = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: bytes) }
}

struct NativeOrbitCovarianceView: View {
    let address: String
    @Environment(\.scenePhase) private var scenePhase
    @State private var expanded = false
    @State private var original: Data?
    @State private var gm = ""
    @State private var gmSource = ""
    @State private var propagate = false
    @State private var adopt = false
    @State private var relativity = false
    @State private var radiation = false
    @State private var compareRefinement = false
    @State private var ensemble = false
    @State private var eventMode = false
    @State private var eventStart = ""
    @State private var eventEnd = ""
    @State private var eventTarget = ""
    @State private var eventDistance = ""
    @State private var eventStep = ""
    @State private var eventTolerance = ""
    @State private var eventEvaluations = ""
    @State private var eventLimit = ""
    @State private var sourceOffsets = ""
    @State private var epoch = ""
    @State private var duration = ""
    @State private var exclusions = Array(repeating: "", count: 11)
    @State private var pressure = ""
    @State private var area = ""
    @State private var mass = ""
    @State private var reflectivity = ""
    @State private var radiationSource = ""
    @State private var importing = false
    @State private var exporting = false
    @State private var document = OrbitCovarianceDocument(bytes: Data())
    @State private var report: NativeOrbitCovarianceReport?
    @State private var propagationReport: NativeOrbitPropagationReport?
    @State private var ensembleReport: NativeOrbitEnsembleReport?
    @State private var eventReport: NativeOrbitEventReport?
    @State private var displayedEventRequest: NativeOrbitEventRequest?
    @State private var selectedEventDraw = 0
    @State private var exportName = "solar-orbit-covariance"
    @State private var work: Task<Void, Never>?
    @State private var workIdentity: UUID?
    @State private var busy = false
    @State private var workDeadline: Task<Void, Never>?
    @State private var generation = UUID()
    @State private var message = ""
    @State private var exportMessage = ""
    private var zh: Bool { Locale.preferredLanguages.first?.hasPrefix("zh") == true }
    private func copy(_ en: String, _ cn: String) -> String { zh ? cn : en }
    private var searchingEvents: Bool { propagate && ensemble && eventMode }
    private var actionTitle: String {
        if busy { return copy("Cancel", "取消") }
        if searchingEvents { return copy("Search supplied-draw events", "搜索输入样本的事件") }
        if propagate { return ensemble ? copy("Propagate ensemble", "传播集合") : copy("Propagate", "传播") }
        return copy("Convert at solution epoch", "转换解算历元坐标")
    }

    var body: some View {
        Section {
            Button(copy("SBDB orbit covariance", "SBDB 轨道协方差")) { expanded.toggle() }.accessibilityIdentifier("orbit-covariance.disclosure")
            if expanded {
                Text(copy("Import original SBDB cov=mat JSON requested with full-prec=1. Coordinates use the heliocentric IAU76/80 J2000 ecliptic frame.", "导入以 full-prec=1 请求的原始 SBDB cov=mat JSON。坐标采用日心 IAU76/80 J2000 黄道坐标系。"))
                Button(copy("Import original SBDB JSON", "导入原始 SBDB JSON")) { importing = true }.accessibilityIdentifier("orbit-covariance.import")
                Text("SBDB JSON: \(original?.count ?? 0) B").accessibilityIdentifier("orbit-covariance.file")
                Toggle(copy("Propagate conditional covariance", "传播条件协方差"), isOn: $propagate).accessibilityIdentifier("orbit-covariance.propagate")
                if propagate { propagationInputs }
                else {
                    field(copy("Adopted solar GM (au³/day²)", "采用的太阳 GM（au³/day²）"), $gm, "gm")
                    field(copy("Adopted GM source / reference", "采用的 GM 来源或参考资料"), $gmSource, "gm-source")
                }
                Button(actionTitle) {
                    if !busy { calculate() } else { clear() }
                }.disabled(!busy && (original == nil || (propagate && !adopt))).accessibilityIdentifier("orbit-covariance.load")
                Text(message).accessibilityIdentifier("orbit-covariance.status")
                if !exportMessage.isEmpty {
                    Text(exportMessage).font(.callout).accessibilityIdentifier("orbit-covariance.export-status")
                }
                if let report = report {
                    Text(readout(report)).textSelection(.enabled).accessibilityIdentifier("orbit-covariance.result")
                    Text(copy("First-order coordinate conversion only; no future propagation or event probability. Export retains the full joint covariance and extra parameters. Source/receipt binding is not independent numerical validation, source authentication or physical accuracy evidence.", "仅进行一阶坐标转换，不传播到未来，也不提供事件概率。导出保留完整联合协方差及额外参数。来源和返回数据的一致性不等于独立数值验证、来源认证或物理精度证据。"))
                    Button(copy("Save result and original source", "保存结果与原始来源")) {
                        document = OrbitCovarianceDocument(bytes: report.originalResponse); exportName = "solar-orbit-covariance"; exporting = true
                    }.accessibilityIdentifier("orbit-covariance.export")
                }
                if let result = propagationReport {
                    Text(readout(result)).textSelection(.enabled).accessibilityIdentifier("orbit-covariance.propagation-result")
                    Text(copy("Conditional first-order uncertainty under the adopted forces. This does not reproduce the SBDB orbit-fit model or include ephemeris/force-parameter uncertainty; it is not an event probability. Receipt consistency is not independent numerical validation.", "采用指定力模型的条件一阶不确定性传播。它不复现 SBDB 轨道拟合模型，也不包含星历或力参数的不确定性，不是事件概率。返回数据的一致性不等于独立数值验证。"))
                    Button(copy("Save result and original source", "保存结果与原始来源")) {
                        document = OrbitCovarianceDocument(bytes: result.originalResponse); exportName = "solar-orbit-propagation"; exporting = true
                    }.accessibilityIdentifier("orbit-covariance.propagation-export")
                }
                if let result = ensembleReport {
                    Text(readout(result)).textSelection(.enabled).accessibilityIdentifier("orbit-covariance.ensemble-result")
                    Button(copy("Save ensemble and original source", "保存集合与原始来源")) {
                        document = OrbitCovarianceDocument(bytes: result.originalResponse); exportName = "solar-orbit-ensemble"; exporting = true
                    }.accessibilityIdentifier("orbit-covariance.ensemble-export")
                }
                if let result = eventReport, let request = displayedEventRequest {
                    eventResults(result, request: request)
                }
            }
        }
        .onChange(of: [address, gm, gmSource]) { _ in clear() }
        .onChange(of: [epoch, duration, pressure, area, mass, reflectivity, radiationSource, sourceOffsets] + exclusions) { _ in clear() }
        .onChange(of: [eventStart, eventEnd, eventTarget, eventDistance, eventStep, eventTolerance, eventEvaluations, eventLimit]) { _ in clear() }
        .onChange(of: [propagate, adopt, relativity, radiation, compareRefinement, ensemble, eventMode]) { _ in clear() }
        .onChange(of: expanded) { if !$0 { clear() } }
        .onChange(of: scenePhase) { if $0 != .active { clear() } }
        .onDisappear { clear() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data]) { outcome in
            switch outcome {
            case .success(let url): importFile(url)
            case .failure(let error): message = String(describing: error)
            }
        }
        .onChange(of: exporting) { if $0 { exportMessage = "" } }
        .fileExporter(isPresented: $exporting, document: document, contentType: .json, defaultFilename: exportName) { outcome in
            defer { document = OrbitCovarianceDocument(bytes: Data()) }
            switch outcome {
            case .success: exportMessage = exportName + copy(": selected snapshot saved.", "：已保存所选快照。")
            case .failure(let error): exportMessage = exportName + ": " + String(describing: error)
            }
        }
    }

    private var propagationInputs: some View {
        Group {
            Text(copy("Requires configured DE440 sources on the backend. Six orbital axes only; each exclusion distance must be explicitly supplied. Duration is limited to 365 days in either direction and to source coverage.", "后端需配置 DE440 来源。仅支持六个轨道参数，必须明确填写每个天体的排除距离。时长限定为前后各 365 天以内，且不能超出来源覆盖范围。"))
            Toggle(copy("Adopt the restricted DE440 force model", "采用受限 DE440 力模型"), isOn: $adopt).accessibilityIdentifier("orbit-covariance.adopt")
            field(copy("Source solution epoch (JD TDB)", "来源解算历元（JD TDB）"), $epoch, "epoch")
            if !searchingEvents { field(copy("Signed elapsed TDB seconds", "带符号的传播 TDB 秒数"), $duration, "duration") }
            ForEach(NativeOrbitPropagationRequest.forceIDs.indices, id: \.self) { index in
                field(copy("Exclusion distance (km), NAIF ", "排除距离（km），NAIF ") + String(NativeOrbitPropagationRequest.forceIDs[index]),
                      $exclusions[index], "exclusion-\(NativeOrbitPropagationRequest.forceIDs[index])")
            }
            Toggle(copy("Solar monopole 1PN correction", "太阳单极一阶后牛顿修正"), isOn: $relativity).accessibilityIdentifier("orbit-covariance.relativity")
            Group {
                Toggle(copy("Propagate supplied source-offset ensemble", "传播指定源参数偏移集合"), isOn: $ensemble).accessibilityIdentifier("orbit-covariance.ensemble")
                if ensemble { ensembleInputs }
                else {
                Toggle(copy("Compare tighter integration", "对照更严格的积分设置"), isOn: $compareRefinement).accessibilityIdentifier("orbit-covariance.refinement")
                Text(copy("Optional second integration with tenfold tighter tolerances and halved initial/maximum steps. Both runs share the backend's 20-second deadline. Differences are numerical sensitivity under the same model, not independent validation or physical uncertainty.", "可选的第二次积分采用十倍更严格的容差，初始和最大步长减半。两次积分共享后端 20 秒期限。差值反映同一模型下的数值敏感性，不是独立验证或物理不确定性。"))
                }
            }
            if !searchingEvents { Toggle(copy("Constant radial unshadowed SRP", "恒定径向、无遮挡太阳光压"), isOn: $radiation).accessibilityIdentifier("orbit-covariance.radiation") }
            if radiation && !searchingEvents {
                field(copy("Pressure at 1 au (N/m²)", "1 au 处光压（N/m²）"), $pressure, "pressure")
                field(copy("Area (m²)", "面积（m²）"), $area, "area")
                field(copy("Mass (kg)", "质量（kg）"), $mass, "mass")
                field(copy("Reflectivity coefficient", "反射系数"), $reflectivity, "reflectivity")
                field(copy("SRP parameter source / reference", "光压参数来源或参考资料"), $radiationSource, "radiation-source")
            }
        }
    }

    private func field(_ name: String, _ binding: Binding<String>, _ id: String) -> some View {
        VStack(alignment: .leading) {
            Text(name).font(.caption).foregroundStyle(.secondary)
            TextField(name, text: binding).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("orbit-covariance.\(id)")
        }
    }
    private var ensembleInputs: some View {
        VStack(alignment: .leading) {
            Text(copy("Supply a flat JSON array in the original SBDB covariance label order and units: six offsets per draw, 1 to 128 draws. These are supplied offsets, not automatically generated probability samples. Original source and offsets remain in the export.", "按原始 SBDB 协方差标签顺序和单位填写扁平 JSON 数组：每组六个偏移，共 1 至 128 组。这是指定偏移，不是自动生成的概率样本。导出保留原始来源和所有偏移。"))
            Text(copy("Source offsets (JSON array, at most 32768 UTF-16 units)", "源参数偏移（JSON 数组，最多 32768 个 UTF-16 单元）")).font(.caption)
            TextEditor(text: $sourceOffsets).frame(minHeight: 100, maxHeight: 180)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .accessibilityLabel(copy("Source offsets JSON", "源参数偏移 JSON"))
                .accessibilityIdentifier("orbit-covariance.offsets")
            Toggle(copy("Search distance-threshold events", "搜索距离阈值事件"), isOn: $eventMode).accessibilityIdentifier("orbit-covariance.event-mode")
            if eventMode { eventInputs }
        }
    }
    private var eventInputs: some View {
        VStack(alignment: .leading) {
            Text(copy("Enter a chronological window relative to the source epoch. Endpoint duration, SRP and covariance refinement do not apply. Target IDs: 10 Sun, 399 Earth, 301 Moon; 1 Mercury, 2 Venus, 4 Mars, 5 Jupiter, 6 Saturn, 7 Uranus, 8 Neptune, 9 Pluto system barycenters.", "输入相对于来源历元、按时间先后排列的窗口。此模式不使用端点时长、太阳光压或协方差细化。目标编号：10 太阳、399 地球、301 月球；1 水星、2 金星、4 火星、5 木星、6 土星、7 天王星、8 海王星、9 冥王星系统质心。"))
            field(copy("Start offset (TDB seconds)", "起始偏移（TDB 秒）"), $eventStart, "event-start")
            field(copy("End offset (TDB seconds)", "结束偏移（TDB 秒）"), $eventEnd, "event-end")
            field(copy("Target NAIF ID", "目标 NAIF 编号"), $eventTarget, "event-target")
            field(copy("Geometric center-distance threshold (km; not a physical radius)", "几何中心距离阈值（km；不是物理半径）"), $eventDistance, "event-distance")
            field(copy("Maximum scan step (seconds)", "最大扫描步长（秒）"), $eventStep, "event-step")
            field(copy("Localization tolerance (seconds; at most scan step)", "定位容差（秒；不超过扫描步长）"), $eventTolerance, "event-tolerance")
            field(copy("Maximum scalar calls per draw (1–2048)", "每组标量求值上限（1–2048）"), $eventEvaluations, "event-evaluations")
            field(copy("Maximum records per draw (1–128)", "每组记录上限（1–128）"), $eventLimit, "event-limit")
        }
    }
    private func eventResults(_ result: NativeOrbitEventReport, request: NativeOrbitEventRequest) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(eventSummary(result, request: request)).textSelection(.enabled).accessibilityIdentifier("orbit-covariance.event-summary")
            HStack {
                Button(copy("Previous draw", "上一组样本")) { selectedEventDraw -= 1 }
                    .disabled(selectedEventDraw <= 0).accessibilityIdentifier("orbit-covariance.event-previous")
                Button(copy("Next draw", "下一组样本")) { selectedEventDraw += 1 }
                    .disabled(selectedEventDraw + 1 >= result.draws.count).accessibilityIdentifier("orbit-covariance.event-next")
            }
            if result.draws.indices.contains(selectedEventDraw) {
                Text(eventDraw(result.draws[selectedEventDraw])).textSelection(.enabled).accessibilityIdentifier("orbit-covariance.event-draw")
            }
            Text(copy("Only sampled sign changes: tangencies and multiple crossings can be missed. No detections do not prove absence; failed or unresolved draws are not event-free. Numerical brackets exclude integration and physical uncertainty. This is simultaneous geometric distance, not apparent occultation, continuous collision detection or an event probability. All draws share the backend 20-second context and 250000 force calls. One draw is expanded at a time; export retains every draw. Receipt consistency is not independent numerical validation.", "仅搜索采样符号变化，可能漏掉相切和多次穿越。未检出不证明不存在；失败或未完成样本不等于无事件。数值区间不包含积分与物理不确定性。这是同时几何距离，不是视掩星、连续碰撞检测或事件概率。所有样本共享后端 20 秒上下文与 250000 次力求值。每次展开一组样本，导出保留全部样本。返回值一致性不是独立数值验证。"))
            Button(copy("Save all event draws and original source", "保存全部事件样本与原始来源")) {
                document = OrbitCovarianceDocument(bytes: result.originalResponse); exportName = "solar-orbit-events"; exporting = true
            }.accessibilityIdentifier("orbit-covariance.event-export")
        }
    }
    private func eventSummary(_ report: NativeOrbitEventReport, request: NativeOrbitEventRequest) -> String {
        var lines = [copy("Draws / searched / failed / unresolved: ", "样本 / 已搜索 / 失败 / 未完成：") + "\(report.draws.count) / \(report.searched) / \(report.failed) / \(report.unresolved)",
            copy("Force calls: ", "力求值：") + "\(report.forceEvaluations) / 250000",
            "JD TDB: \(request.force.referenceEpochTdb)",
            copy("Search offsets (TDB s): ", "搜索偏移（TDB 秒）：") + "[\(request.startSeconds), \(request.endSeconds)]",
            "NAIF \(request.targetNaifId) · \(request.distanceKm) km", "SBDB SHA-256: \(report.sourceSHA256)"]
        lines.append(copy("Adopted force evidence; checked receipt values, not independent authentication:", "采用的力模型证据；已核对的返回值，不是独立认证："))
        lines += report.forceEvidence
        lines.append(copy("Conditional first-detected timing: descriptive supplied-draw statistics, not event probabilities or confidence intervals. Earlier unclassified zeros exclude a draw. Different draws need not represent the same physical event. Numerical bounds exclude integration and physical errors; two draws do not establish adequate tail sampling. Export retains all selection/exclusion identities.", "条件首次检出时间：输入样本的描述统计，不是事件概率或置信区间。更早的未分类零点会排除该样本。不同样本不一定对应同一个物理事件。数值区间不包含积分和物理误差；两组样本不代表尾部采样充分。导出保留全部入选和排除身份。"))
        for summary in report.timing {
            lines.append(summary.direction == "decreasing" ? copy("First detected decreasing sign change", "首次检出的由正转负符号变化") : copy("First detected increasing sign change", "首次检出的由负转正符号变化"))
            lines.append(copy("Selected / total / failed / unresolved / not detected / ambiguous zero: ", "入选 / 总数 / 失败 / 未完成 / 未检出 / 零点歧义：") + "\(summary.selected) / \(summary.total) / \(summary.failed) / \(summary.unresolved) / \(summary.notDetected) / \(summary.ambiguousZero)")
            if summary.selected < 2 { lines.append(copy("Timing quantiles unavailable: fewer than two selected draws.", "时间分位数不可用：入选样本不足两组。")) }
            for q in summary.quantiles {
                lines.append("\(Int((q.fraction*100).rounded()))% · " + copy("rank ", "秩 ") + "\(q.rank) · "
                    + copy("TDB offset (s) / numerical bounds: ", "TDB 偏移（秒）/ 数值区间：")
                    + "\(q.elapsedTdbSeconds) · [\(q.localizationBounds[0]), \(q.localizationBounds[1])]")
            }
        }
        return lines.joined(separator: "\n")
    }
    private func eventDraw(_ draw: NativeOrbitEventReport.Draw) -> String {
        let status: String
        switch draw.status {
        case "searched": status = copy("Searched", "已搜索")
        case "failed": status = copy("Failed", "失败")
        default: status = copy("Unresolved", "未完成")
        }
        var lines = [copy("Source draw index (zero-based): ", "来源样本索引（从零开始）：") + String(draw.index),
            status + " · " + copy("Force calls: ", "力求值：") + String(draw.forceEvaluations)]
        if !draw.failure.isEmpty { lines.append("\(draw.stage) · \(draw.resource) · \(draw.failure)") }
        if let bracket = draw.failureBracket { lines.append(copy("Remaining numerical bracket (s): ", "剩余数值区间（秒）：") + "[\(bracket[0]), \(bracket[1])]") }
        if let p = draw.progress {
            lines.append(copy("Completed / attempted scalar calls / retained records: ", "已完成 / 已尝试标量求值 / 保留记录：") + "\(p.completed) / \(p.attempted) / \(p.retained)")
            lines.append(copy("Last attempted TDB offset (not a coverage frontier): ", "最后尝试的 TDB 偏移（不是覆盖边界）：") + "\(p.lastAttemptSeconds) s")
        }
        if draw.status == "searched" { lines.append(copy("Detected records: ", "检出记录：") + String(draw.events.count)) }
        for (index, event) in draw.events.enumerated() {
            let direction = event.kind == "sampled-zero" ? copy("Sampled zero; direction unclassified", "采样零点；方向未分类")
                : event.direction == "increasing" ? copy("Increasing sign change; exit candidate", "符号由负转正；离开阈值候选")
                : copy("Decreasing sign change; entry candidate", "符号由正转负；进入阈值候选")
            lines.append("\(index + 1) · \(direction)")
            lines.append(copy("Elapsed TDB seconds / numerical bracket: ", "TDB 秒偏移 / 数值区间：") + "\(event.elapsedTdbSeconds) · [\(event.localizationBracket[0]), \(event.localizationBracket[1])]")
        }
        return lines.joined(separator: "\n")
    }
    private func clear() { generation = UUID(); work?.cancel(); finish(); report = nil; propagationReport = nil; ensembleReport = nil; eventReport = nil; displayedEventRequest = nil; selectedEventDraw = 0; message = "" }
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
            // A cancelled predecessor still owns its transport/decode work
            // until it returns. Keep that barrier across clear and replacement.
            await predecessor?.value
            guard acceptWork(token: token, deadline: deadline, importing: importing) else { return }
            await operation(deadline)
        }
    }
    private func importFile(_ url: URL) {
        clear(); original = nil
        let token = generation
        message = copy("Reading original file…", "正在读取原始文件…")
        workDeadline = Task { @MainActor in
            do { try await Task.sleep(nanoseconds: 25_000_000_000) } catch { return }
            guard token == generation else { return }
            clear(); message = copy("File import timed out.", "文件导入超时。")
        }
        startWork(token: token) { deadline in
            do {
                let bytes = try await StellarSourceReader.shared.read(url, limit: NativeOrbitCovarianceRequest.maxSourceBytes)
                guard acceptWork(token: token, deadline: deadline, importing: true) else { return }
                original = bytes; finish(); message = copy("Original file loaded.", "原始文件已载入。")
            } catch { guard acceptWork(token: token, deadline: deadline, importing: true) else { return }; finish(); message = String(describing: error) }
        }
    }
    private func calculate() {
        clear()
        guard let original = original,
              let base = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            message = copy("Original file and backend address required.", "请提供原始文件和后端地址。")
            return
        }
        let token = generation
        do {
            let service = try NativeStellarMotionService(base: base)
            if propagate {
                var distances: [Int: Double] = [:]
                for (index, id) in NativeOrbitPropagationRequest.forceIDs.enumerated() {
                    distances[id] = try numeric(exclusions[index], copy("Exclusion distance", "排除距离") + " NAIF \(id)")
                }
                if searchingEvents {
                    let request = try NativeOrbitEventRequest(original: original, epoch: numeric(epoch, "JD TDB"),
                        start: numeric(eventStart, copy("Start", "起始")), end: numeric(eventEnd, copy("End", "结束")),
                        adopt: adopt, exclusions: distances, relativity: relativity, offsets: offsets(),
                        target: whole(eventTarget, "NAIF"), distance: numeric(eventDistance, copy("Distance", "距离")),
                        step: numeric(eventStep, copy("Scan step", "扫描步长")), tolerance: numeric(eventTolerance, copy("Tolerance", "容差")),
                        evaluations: whole(eventEvaluations, copy("Evaluation limit", "求值上限")), events: whole(eventLimit, copy("Record limit", "记录上限")))
                    message = copy("Searching events…", "正在搜索事件…")
                    startWork(token: token) { deadline in
                        do {
                            let result = try await service.loadEvents(request)
                            guard acceptWork(token: token, deadline: deadline) else { return }
                            eventReport = result; displayedEventRequest = request; selectedEventDraw = 0
                            finish(); message = "\(result.designation) · \(result.solutionId)"
                        } catch { guard acceptWork(token: token, deadline: deadline) else { return }; finish(); message = String(describing: error) }
                    }
                    return
                }
                let srp: NativeOrbitRadiationPressure?
                if radiation {
                    srp = try NativeOrbitRadiationPressure(pressure: numeric(pressure, copy("Pressure", "光压")), area: numeric(area, copy("Area", "面积")),
                        mass: numeric(mass, copy("Mass", "质量")), reflectivity: numeric(reflectivity, copy("Reflectivity", "反射系数")), source: radiationSource)
                } else { srp = nil }
                let request = try NativeOrbitPropagationRequest(original: original, epoch: numeric(epoch, "JD TDB"),
                    duration: numeric(duration, copy("Duration", "时长")), adoptRestrictedDE440: adopt,
                    exclusions: distances, solarRelativity: relativity, radiation: srp, compareRefinement: ensemble ? false : compareRefinement)
                if ensemble {
                    let ensembleRequest = try NativeOrbitEnsembleRequest(propagation: request, offsets: offsets())
                    message = copy("Propagating ensemble…", "正在传播集合…")
                    startWork(token: token) { deadline in
                        do {
                            let result = try await service.loadEnsemble(ensembleRequest)
                            guard acceptWork(token: token, deadline: deadline) else { return }
                            ensembleReport = result; finish(); message = "\(result.designation) · \(result.solutionId)"
                        } catch { guard acceptWork(token: token, deadline: deadline) else { return }; finish(); message = String(describing: error) }
                    }
                    return
                }
                message = copy("Propagating…", "正在传播…")
                startWork(token: token) { deadline in
                    do {
                        let result = try await service.loadPropagation(request)
                        guard acceptWork(token: token, deadline: deadline) else { return }
                        propagationReport = result; finish(); message = "\(result.designation) · \(result.solutionId)"
                    } catch { guard acceptWork(token: token, deadline: deadline) else { return }; finish(); message = String(describing: error) }
                }
                return
            }
            let request = try NativeOrbitCovarianceRequest(original: original, gm: numeric(gm, "GM"), source: gmSource)
            message = copy("Converting…", "正在转换…")
            startWork(token: token) { deadline in
                do {
                    let result = try await service.loadCovariance(request)
                    guard acceptWork(token: token, deadline: deadline) else { return }
                    report = result; finish(); message = "\(result.designation) · \(result.solutionId)"
                } catch { guard acceptWork(token: token, deadline: deadline) else { return }; finish(); message = String(describing: error) }
            }
        } catch { message = String(describing: error) }
    }
    private func offsets() throws -> [Double] {
        guard sourceOffsets.utf16.count <= 32768 else {
            throw StateTileFailure.invalid(copy("Source offsets exceed 32768 UTF-16 units; input has not been truncated.", "源参数偏移超过 32768 个 UTF-16 单元；输入未被截断。"))
        }
        let values = try JSONDecoder().decode([Double].self, from: Data(sourceOffsets.utf8))
        guard values.count >= 6, values.count <= 768, values.count % 6 == 0, values.allSatisfy({ $0.isFinite }) else {
            throw StateTileFailure.invalid(copy("Enter 1 to 128 complete six-axis draws as finite JSON numbers.", "请以有限 JSON 数值填写 1 至 128 组完整六轴偏移。"))
        }
        return values
    }
    private func readout(_ report: NativeOrbitEnsembleReport) -> String {
        let axes = ["x [au]", "y [au]", "z [au]", "vx [au/d]", "vy [au/d]", "vz [au/d]"]
        var lines = [copy("Reference JD TDB: ", "参考 JD TDB：") + String(report.referenceEpochTdb),
                     copy("Elapsed TDB seconds: ", "传播 TDB 秒数：") + String(report.durationSeconds),
                     copy("Draws / failed / force evaluations: ", "样本数 / 失败数 / 力求值次数：") + "\(report.states.count) / \(report.failedCount) / \(report.forceEvaluations) (250000 max)"]
        if let mean = report.mean, let sigmas = report.sigmas {
            lines.append(copy("Descriptive endpoint mean · sample standard deviation", "端点描述性均值 · 样本标准差"))
            for i in 0..<6 { lines.append("\(axes[i]): \(mean[i]) · σ \(sigmas[i])") }
            if let covariance = report.covariance {
                lines.append(copy("Full sample covariance · divisor: ", "完整样本协方差 · 分母：") + String(report.states.count-1))
                lines.append(copy("Entry units are row units multiplied by column units. Finite-batch descriptive statistics, not confidence regions or physical error bounds.", "各项单位为行单位乘列单位。这是有限样本的描述统计，不是置信区域或物理误差界。"))
                for i in 0..<6 {
                    for j in 0..<6 { lines.append("\(axes[i]) × \(axes[j]): \(covariance[i][j])") }
                }
            }
        } else {
            lines.append(report.failedCount > 0
                ? copy("Moments unavailable because at least one draw failed; successful draws are not silently substituted.", "至少一组失败，统计不可用；不会仅用成功样本替代完整集合。")
                : copy("Moments unavailable: at least two draws are required.", "统计不可用：至少需要两组样本。"))
        }
        lines += forceReadout(report.forceEvidence)
        for index in report.states.indices {
            lines.append(copy("Source draw index (zero-based): ", "来源样本索引（从零开始）：") + String(index))
            lines.append(copy("Force evaluations for this draw: ", "此样本的力求值次数：") + String(report.forceEvaluationsByDraw[index]))
            if let state = report.states[index] {
                for i in 0..<6 { lines.append("\(axes[i]): \(state[i])") }
            } else if let failure = report.failures[index] { lines.append(failure) }
        }
        lines += ["SBDB SHA-256: \(report.sourceSHA256)", copy("Heliocentric IAU76/80 J2000 ecliptic endpoints under fixed adopted forces. All draws share the backend 20-second context and 250000 force-evaluation budget. No extra fitted force axes, continuous collision detection, calibrated event probabilities or physical error bounds. Zero-duration agreement is not convergence evidence. Receipt consistency is not independent numerical validation. Export retains full integration diagnostics and covariance statistics.", "固定采用力模型下的日心 IAU76/80 J2000 黄道端点。所有样本共享后端 20 秒上下文期限和 250000 次力求值预算。不支持额外拟合力参数、连续碰撞检测，也不提供校准事件概率或物理误差界。零时长一致不是收敛证据。返回值一致性不是独立数值验证。导出保留完整积分诊断和协方差统计。")]
        return lines.joined(separator: "\n")
    }
    private func forceReadout(_ evidence: [String]) -> [String] {
        [copy("Adopted force model and sources", "采用的力模型与来源"),
         copy("Checked receipt values, not independent source authentication. The integration frame differs from the heliocentric endpoint frame; exclusion distances are not continuous collision detection.", "以下为已核对的返回值，不是独立来源认证。积分坐标系不同于日心终点坐标系；排除距离不代表连续碰撞检测。")] + evidence
    }
    private func numeric(_ text: String, _ label: String) throws -> Double {
        guard let value = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)), value.isFinite else {
            throw StateTileFailure.invalid(label + copy(": finite number required.", "：请填写有限数值。"))
        }
        return value
    }
    private func whole(_ text: String, _ label: String) throws -> Int {
        let value = try numeric(text, label)
        guard value >= 0, value <= 2147483647, value == floor(value) else {
            throw StateTileFailure.invalid(label + copy(": nonnegative integer required.", "：请填写非负整数。"))
        }
        return Int(value)
    }
    private func readout(_ report: NativeOrbitPropagationReport) -> String {
        let labels = ["x", "y", "z", "vx", "vy", "vz"]
        let sourcePE = report.sourcePlanetaryEphemeris ?? "—", sourceSB = report.sourceSmallBodyEphemeris ?? "—"
        var lines = [copy("Reference JD TDB: ", "参考 JD TDB：") + String(report.referenceEpochTdb),
                     copy("Elapsed TDB seconds: ", "传播 TDB 秒数：") + String(report.durationSeconds), report.model,
                     copy("SBDB source-fit PE / SB: ", "SBDB 源拟合星历 PE / SB：") + "\(sourcePE) / \(sourceSB)",
                     copy("Adopted integration kernel: ", "本次采用传播核：") + report.integrationKernel]
        lines += forceReadout(report.forceEvidence)
        for i in 0..<6 {
            let unit = i < 3 ? "au" : "au/d"
            lines.append("\(labels[i]) [\(unit)]: \(report.nominal[i]) · σ \(report.sigmas[i])")
        }
        lines += [copy("Accepted / rejected steps / evaluations: ", "接受步数 / 拒绝步数 / 求值次数：")
                  + "\(report.accepted) / \(report.rejected) / \(report.evaluations)", "SBDB SHA-256: \(report.sourceSHA256)"]
        let smallest = report.smallestAcceptedStep.map { String($0) } ?? copy("No accepted steps", "无接受步")
        lines += [copy("Smallest / largest accepted step (s): ", "最小 / 最大接受步长（s）：") + smallest + " / \(report.largestAcceptedStep)",
                  copy("Maximum accepted local error ratio / relative tolerance: ", "最大接受局部误差比 / 相对容差：") + "\(report.maxAcceptedErrorRatio) / \(report.relativeTolerance)",
                  copy("The ratio is the maximum component-normalized embedded local error estimate across accepted steps. It is not a global error bound, source uncertainty or physical accuracy. Absolute tolerances and state-transition layout are retained in the export. Zero duration has no accepted steps; zero diagnostics do not establish accuracy.", "误差比是接受步中按分量归一化的嵌入式局部误差估计最大值，不是全局误差界、来源不确定性或物理精度。导出保留绝对容差及状态转移矩阵布局。零时长没有接受步，诊断值为零不代表精度已验证。")]
        if let comparison = report.refinement {
            lines.append(copy("Tighter integration: nominal · σ · |Δσ|", "更严格的积分：标称值 · σ · |Δσ|"))
            for i in 0..<6 {
                let unit = i < 3 ? "au" : "au/d"
                lines.append("\(labels[i]) [\(unit)]: \(comparison.nominal[i]) · \(comparison.sigmas[i]) · \(comparison.marginalSigmaAbsoluteDifference[i])")
            }
            lines += [copy("Refined accepted / rejected steps / evaluations: ", "对照积分接受步数 / 拒绝步数 / 求值次数：")
                      + "\(comparison.accepted) / \(comparison.rejected) / \(comparison.evaluations)",
                      copy("Refined maximum local error ratio / relative tolerance: ", "对照积分最大局部误差比 / 相对容差：")
                      + "\(comparison.maxAcceptedErrorRatio) / \(comparison.relativeTolerance)",
                      copy("Same-model differences are not a global error bound or independent validation. Zero-duration agreement is not convergence evidence. Export retains both full covariance matrices and integration diagnostics.", "同一模型的差值不是全局误差界或独立验证。零时长结果一致不构成收敛证据。导出保留两组完整协方差矩阵与积分诊断。"),
                      comparison.limitation]
        }
        lines += report.limitations
        return lines.joined(separator: "\n")
    }
    private func readout(_ report: NativeOrbitCovarianceReport) -> String {
        func number(_ value: Double) -> String { String(format: "%.12g", locale: Locale(identifier: "en_US_POSIX"), value) }
        var lines = ["JD TDB: \(report.epochTdb)", report.model, report.conicClass,
            copy("Nominal coordinates and formal marginal standard deviations", "标称坐标与形式边际标准差")]
        for i in report.labels.indices {
            let unit = report.units[i] ?? copy("unit unspecified", "单位未声明")
            lines.append("\(report.labels[i]) [\(unit)]: \(number(report.nominal[i])) · σ \(number(report.sigmas[i]))")
        }
        lines += ["GM (au³/d²): \(report.gm.au3PerDay2)", report.gm.source, "SBDB SHA-256: \(report.sourceSHA256)"]
        lines += report.limitations
        return lines.joined(separator: "\n")
    }
}
