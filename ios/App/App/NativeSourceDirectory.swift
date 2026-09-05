import SwiftUI

@MainActor
final class NativeSourceDirectoryModel: ObservableObject {
    @Published private(set) var page: NativeSourceIdentityPage?
    @Published private(set) var loading = false
    @Published private(set) var message = SourceDirectoryCopy.empty
    private var request: Task<Void, Never>?
    private var generation = 0

    func clear() {
        generation += 1
        request?.cancel(); request = nil
        page = nil; loading = false; message = SourceDirectoryCopy.empty
    }

    func load(address: String, query: String, next: Bool = false) {
        let previous = next ? page : nil
        clear()
        guard !next || previous != nil else { return }
        guard let base = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            message = NativeSourceIdentityFailure.address.localizedDescription
            return
        }
        let current = generation
        loading = true; message = SourceDirectoryCopy.loading
        request = Task {
            do {
                let result = try await NativeSourceIdentityService(base: base).load(query: query, previous: previous)
                try Task.checkCancellation()
                guard current == generation else { return }
                page = result; message = SourceDirectoryCopy.loaded
            } catch {
                guard current == generation else { return }
                message = (error as? NativeSourceIdentityFailure)?.localizedDescription ?? SourceDirectoryCopy.failure
            }
            if current == generation { loading = false; request = nil }
        }
    }
}

/// Each control is a separate native List row, including the bounded record list.
/// Keep the deck dominant; opening this section does not fetch or calculate.
struct NativeSourceDirectorySection: View {
    @ObservedObject var model: NativeSourceDirectoryModel
    let address: String
    let select: (NativeSourceIdentityPage) -> Void
    @State private var expanded = false
    @State private var query = ""

    var body: some View {
        Section(SourceDirectoryCopy.title) {
            Button {
                expanded.toggle()
                if !expanded { model.clear() }
            } label: {
                HStack {
                    Text(SourceDirectoryCopy.browse)
                    Spacer()
                    Image(systemName: expanded ? "chevron.down" : "chevron.right").accessibilityHidden(true)
                }
            }
            .accessibilityIdentifier("identity.disclosure")
            .accessibilityValue(expanded ? SourceDirectoryCopy.expanded : SourceDirectoryCopy.collapsed)
            if expanded {
                TextField(SourceDirectoryCopy.query, text: Binding(get: { query }, set: { query = $0; model.clear() }))
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("identity.query")
                Text(model.message).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("identity.status")
                Button(model.loading ? SourceDirectoryCopy.cancel : SourceDirectoryCopy.load) {
                    if model.loading { model.clear() } else { model.load(address: address, query: query) }
                }.accessibilityIdentifier("identity.load")
                if let page = model.page {
                    Text(SourceDirectoryCopy.counts(page.rows.count, page.totalRecords)).accessibilityIdentifier("identity.counts")
                    Text(SourceDirectoryCopy.caveat).font(.callout).foregroundStyle(.secondary)
                    Text("\(SourceDirectoryCopy.hash): \(page.inventoryHash)")
                        .font(.caption).textSelection(.enabled).accessibilityIdentifier("identity.hash")
                    Button(SourceDirectoryCopy.select) {
                        select(page)
                        expanded = false; model.clear()
                    }.disabled(page.rows.isEmpty).accessibilityIdentifier("identity.select")
                    Button(SourceDirectoryCopy.next) { model.load(address: address, query: query, next: true) }
                        .disabled(page.next.isEmpty).accessibilityIdentifier("identity.next")
                    ForEach(page.rows) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.name?.isEmpty == false ? (row.name ?? row.id) : row.id).font(.headline)
                            Text(row.id).textSelection(.enabled)
                            Text("\(row.source) · \(row.category) · \(row.sourceRow)").font(.caption)
                            Text("\(row.identityStatus) · \(row.ephemerisStatus)").font(.caption).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("identity.row.\(row.id)")
                    }
                }
            }
        }
    }
}

enum SourceDirectoryCopy {
    private static var zh: Bool { Locale.current.language.languageCode?.identifier == "zh" }
    static var title: String { zh ? "来源目录" : "Source directory" }
    static var browse: String { zh ? "浏览并选择来源记录" : "Browse and select source records" }
    static var empty: String { zh ? "按需浏览来源记录，不会自动计算状态。" : "Browse source records on demand; browsing does not compute states." }
    static var loading: String { zh ? "正在加载来源记录…" : "Loading source records…" }
    static var loaded: String { zh ? "来源记录已加载。" : "Source records loaded." }
    static var failure: String { zh ? "来源目录无法加载，请检查后端并重试。" : "Source directory could not be loaded. Check the backend and try again." }
    static var query: String { zh ? "名称或原始来源 ID（可留空）" : "Name or original source ID (optional)" }
    static var load: String { zh ? "加载第一页" : "Load first page" }
    static var cancel: String { zh ? "取消" : "Cancel" }
    static var next: String { zh ? "下一页" : "Next page" }
    static var select: String { zh ? "选入本页，稍后加载" : "Select this page for a later load" }
    static var selected: String { zh ? "已选入本页原始 ID。点击“加载观测”以检查状态及缺口。" : "Original page IDs selected. Load an observation to check states and gaps." }
    static var edited: String { zh ? "观测参数已改变，请重新加载。" : "Observation inputs changed. Load again to update states." }
    static var expanded: String { zh ? "已展开" : "Expanded" }
    static var collapsed: String { zh ? "已收起" : "Collapsed" }
    static var hash: String { zh ? "目录 SHA-256" : "Inventory SHA-256" }
    static var caveat: String { zh ? "来源记录可能包含别名，不等于去重后的天体或已验证状态。浏览不会填补星历缺口。" : "Source records can include aliases; they are not deduplicated bodies or verified states. Browsing does not fill ephemeris gaps." }
    static func counts(_ count: Int, _ total: UInt64) -> String {
        zh ? "本页：\(count) · 来源记录总数：\(total)" : "This page: \(count) · total source records: \(total)"
    }
}
