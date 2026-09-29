import Foundation

/// A bounded page of source assertions, not deduplicated bodies or exact states.
struct NativeSourceIdentityPage: Sendable {
    static let size = 50
    static let maxBytes = 256 * 1024
    static let maxManifestBytes = 8 * 1024 * 1024
    static let maxSafeInteger: UInt64 = 9_007_199_254_740_991

    struct Row: Decodable, Identifiable, Sendable {
        let id: String
        let name: String?
        let designation: String?
        let category: String
        let source: String
        let sourceRow: UInt64
        let identityStatus: String
        let ephemerisStatus: String
        let parentId: String?
        let parentResolution: String?
        let centerId: String?
        let centerResolution: String?
        let confirmation: String?
        let geometryStatus: String?
        let naifId: UInt64?
        let aliases: [String]?
        let identityEvidence: [String]?
    }

    private struct Manifest: Decodable, Equatable, Sendable {
        let apiVersion: String
        let catalogVersion: String
        let catalogManifestSha256: String
        let inventoryManifestSha256: String
    }

    private struct Payload: Decodable {
        let apiVersion: String
        let catalogVersion: String
        let inventoryManifestSha256: String
        let sourceRecords: Bool
        let identityAssertions: Bool
        let uniqueBodySemantics: String
        let totalRecords: UInt64
        let limit: Int
        let items: [Row]
        let nextPageToken: String?

        private enum CodingKeys: String, CodingKey {
            case apiVersion, catalogVersion, inventoryManifestSha256, sourceRecords
            case identityAssertions, uniqueBodySemantics, totalRecords, limit, items, nextPageToken
        }

        init(from decoder: Decoder) throws {
            try Task.checkCancellation()
            let fields = try decoder.container(keyedBy: CodingKeys.self)
            apiVersion = try fields.decode(String.self, forKey: .apiVersion)
            catalogVersion = try fields.decode(String.self, forKey: .catalogVersion)
            inventoryManifestSha256 = try fields.decode(String.self, forKey: .inventoryManifestSha256)
            sourceRecords = try fields.decode(Bool.self, forKey: .sourceRecords)
            identityAssertions = try fields.decode(Bool.self, forKey: .identityAssertions)
            uniqueBodySemantics = try fields.decode(String.self, forKey: .uniqueBodySemantics)
            totalRecords = try fields.decode(UInt64.self, forKey: .totalRecords)
            limit = try fields.decode(Int.self, forKey: .limit)
            nextPageToken = try fields.decodeIfPresent(String.self, forKey: .nextPageToken)
            var entries = try fields.nestedUnkeyedContainer(forKey: .items)
            var rows: [Row] = []
            while !entries.isAtEnd {
                try Task.checkCancellation()
                guard rows.count < NativeSourceIdentityPage.size else { throw NativeSourceIdentityFailure.invalid }
                rows.append(try entries.decode(Row.self))
            }
            try Task.checkCancellation()
            items = rows
        }
    }

    let rows: [Row]
    let totalRecords: UInt64
    let next: String
    let query: String
    let base: URL
    private let manifest: Manifest
    var catalogVersion: String { manifest.catalogVersion }
    var catalogHash: String { manifest.catalogManifestSha256 }
    var inventoryHash: String { manifest.inventoryManifestSha256 }

    init(validating data: Data, catalogManifest: Data, base: URL, query: String) throws {
        try Task.checkCancellation()
        self.base = try Self.validatedBase(base)
        try Self.validateQuery(query)
        self.query = query
        guard data.count <= Self.maxBytes else { throw NativeSourceIdentityFailure.invalid }
        manifest = try Self.decodeManifest(catalogManifest)
        let page = try JSONDecoder().decode(Payload.self, from: data)
        guard page.apiVersion == manifest.apiVersion, page.catalogVersion == manifest.catalogVersion,
              page.inventoryManifestSha256 == manifest.inventoryManifestSha256,
              page.sourceRecords, page.identityAssertions, page.uniqueBodySemantics == "not-deduplicated",
              page.totalRecords <= Self.maxSafeInteger, page.limit == Self.size,
              page.items.count <= Self.size, UInt64(page.items.count) <= page.totalRecords else {
            throw NativeSourceIdentityFailure.invalid
        }
        var ids = Set<String>()
        for row in page.items {
            try Task.checkCancellation()
            guard Self.validText(row.id), Self.validText(row.name ?? "", optional: true),
                  Self.validText(row.designation ?? "", optional: true),
                  Self.validText(row.category), Self.validText(row.source),
                  Self.validText(row.identityStatus), Self.validText(row.ephemerisStatus),
                  Self.validText(row.parentId ?? "", optional: true), Self.validText(row.parentResolution ?? "", optional: true),
                  Self.validText(row.centerId ?? "", optional: true), Self.validText(row.centerResolution ?? "", optional: true),
                  Self.validText(row.confirmation ?? "", optional: true), Self.validText(row.geometryStatus ?? "", optional: true),
                  row.sourceRow <= Self.maxSafeInteger, ids.insert(row.id).inserted,
                  row.naifId.map({ $0 <= Self.maxSafeInteger }) ?? true,
                  Self.validList(row.aliases), Self.validList(row.identityEvidence),
                  !row.id.contains(where: { $0.isWhitespace || $0 == "," }) else {
                // The custom-ID editor uses whitespace/comma delimiters. Reject
                // unrepresentable IDs instead of silently splitting or renaming.
                throw NativeSourceIdentityFailure.invalid
            }
        }
        let next = page.nextPageToken ?? ""
        guard Self.validText(next, optional: true, limit: 4096), next.isEmpty || !page.items.isEmpty else {
            throw NativeSourceIdentityFailure.invalid
        }
        try Task.checkCancellation()
        rows = page.items; totalRecords = page.totalRecords; self.next = next
    }

    func requireManifest(_ data: Data, base: URL) throws {
        guard try Self.validatedBase(base) == self.base, try Self.decodeManifest(data) == manifest else {
            throw NativeSourceIdentityFailure.changed
        }
    }

    static func validatedBase(_ base: URL) throws -> URL {
        guard base.scheme == "https", !(base.host ?? "").isEmpty, base.user == nil, base.password == nil,
              base.query == nil, base.fragment == nil else { throw NativeSourceIdentityFailure.address }
        var value = base.absoluteString
        while value.hasSuffix("/") { value.removeLast() }
        guard let normalized = URL(string: value) else { throw NativeSourceIdentityFailure.address }
        return normalized
    }

    static func validateQuery(_ query: String) throws {
        guard query.utf8.count <= 256, validText(query, optional: true, limit: 256) else {
            throw NativeSourceIdentityFailure.query
        }
    }

    private static func validText(_ value: String, optional: Bool = false, limit: Int = 512) -> Bool {
        (optional || !value.isEmpty) && value.utf16.count <= limit
            && value.unicodeScalars.allSatisfy { $0.value >= 32 && $0.value != 127 }
    }

    private static func validList(_ values: [String]?, maxItems: Int = 32) -> Bool {
        guard let values else { return true }
        return values.count <= maxItems && values.allSatisfy { validText($0) }
    }

    private static func decodeManifest(_ data: Data) throws -> Manifest {
        try Task.checkCancellation()
        guard data.count <= maxManifestBytes else { throw NativeSourceIdentityFailure.invalid }
        let value = try JSONDecoder().decode(Manifest.self, from: data)
        try Task.checkCancellation()
        guard value.apiVersion == "solar.api/v1", validText(value.catalogVersion),
              StateTileDecoder.isHash(value.catalogManifestSha256), StateTileDecoder.isHash(value.inventoryManifestSha256) else {
            throw NativeSourceIdentityFailure.invalid
        }
        return value
    }
}

enum NativeSourceIdentityFailure: LocalizedError {
    case invalid, changed, address, query, cursor
    var errorDescription: String? {
        let zh = Locale.current.language.languageCode?.identifier == "zh"
        switch self {
        case .invalid: return zh ? "来源目录响应无效，未发布任何记录。" : "Invalid source directory response; no records were published."
        case .changed: return zh ? "目录已改变，请重新浏览。" : "Inventory changed; restart browsing"
        case .address: return zh ? "请输入不含凭据、查询或片段的 HTTPS 后端地址。" : "Enter an HTTPS backend address without credentials, query or fragment."
        case .query: return zh ? "查询不得超过 256 个 UTF-8 字节或包含控制字符。" : "Queries must be at most 256 UTF-8 bytes without control characters."
        case .cursor: return zh ? "分页标记无效，请重新浏览。" : "Invalid source cursor; restart browsing."
        }
    }
}
