package io.github.dajiaohuang.solaratlas;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Source rows are assertions, not deduplicated bodies or verified states. */
public final class SourceIdentityPage {
    public static final int SIZE = 50;
    public final List<Row> rows;
    public final long totalRecords;
    public final String next, query, base, catalogVersion, catalogHash, inventoryHash;

    public static final class Row {
        public final String id, name, category, source, identityStatus, ephemerisStatus;
        public final long sourceRow;
        Row(Map<String, Object> row) throws StateTileDecoder.ProtocolException {
            id = text(row.get("id"), false, 512); name = text(row.get("name"), true, 512);
            category = text(row.get("category"), false, 512); source = text(row.get("source"), false, 512);
            identityStatus = text(row.get("identityStatus"), false, 512);
            ephemerisStatus = text(row.get("ephemerisStatus"), false, 512); sourceRow = integer(row.get("sourceRow"));
        }
    }

    private SourceIdentityPage(Map<String, Object> page, Map<String, Object> manifest, String base, String query) throws StateTileDecoder.ProtocolException {
        this.base = base; this.query = query;
        catalogVersion = text(manifest.get("catalogVersion"), false, 512);
        catalogHash = hash(manifest.get("catalogManifestSha256")); inventoryHash = hash(manifest.get("inventoryManifestSha256"));
        require("solar.api/v1".equals(manifest.get("apiVersion")) && "solar.api/v1".equals(page.get("apiVersion"))
                && catalogVersion.equals(page.get("catalogVersion")) && inventoryHash.equals(page.get("inventoryManifestSha256")), "Identity manifest mismatch");
        require(Boolean.TRUE.equals(page.get("sourceRecords")) && Boolean.TRUE.equals(page.get("identityAssertions"))
                && "not-deduplicated".equals(page.get("uniqueBodySemantics")), "Identity semantics missing");
        totalRecords = integer(page.get("totalRecords"));
        require(integer(page.get("limit")) == SIZE && page.get("items") instanceof List, "Identity page bounds invalid");
        List<?> values = (List<?>) page.get("items");
        require(values.size() <= SIZE && values.size() <= totalRecords, "Identity page exceeds row budget");
        List<Row> decoded = new ArrayList<>(); Set<String> ids = new HashSet<>();
        for (Object value : values) { Row row = new Row(object(value)); require(ids.add(row.id), "Duplicate source ID"); decoded.add(row); }
        rows = List.copyOf(decoded); next = text(page.get("nextPageToken"), true, 4096);
        require(next.isEmpty() || !rows.isEmpty(), "Empty identity page cannot advance");
    }

    static SourceIdentityPage decode(byte[] raw, byte[] manifest, String base, String query) throws StateTileDecoder.ProtocolException {
        return new SourceIdentityPage(object(StateTileDecoder.parseJson(raw)), object(StateTileDecoder.parseJson(manifest)), base, query);
    }

    void requireManifest(byte[] raw) throws StateTileDecoder.ProtocolException {
        Map<String, Object> manifest = object(StateTileDecoder.parseJson(raw));
        require("solar.api/v1".equals(manifest.get("apiVersion")) && catalogVersion.equals(manifest.get("catalogVersion"))
                && catalogHash.equals(manifest.get("catalogManifestSha256")) && inventoryHash.equals(manifest.get("inventoryManifestSha256")), "Inventory changed; restart browsing");
    }

    static String text(Object value, boolean optional, int max) throws StateTileDecoder.ProtocolException {
        if (optional && value == null) return "";
        require(value instanceof String, "Invalid identity text"); String text = (String) value;
        require((optional || !text.isEmpty()) && text.length() <= max, "Identity text exceeds limit");
        for (int i = 0; i < text.length(); i++) require(text.charAt(i) >= 32 && text.charAt(i) != 127, "Invalid identity control character");
        return text;
    }
    private static String hash(Object value) throws StateTileDecoder.ProtocolException {
        String result = text(value, false, 64); require(result.matches("[0-9a-f]{64}"), "Invalid identity hash"); return result;
    }
    private static long integer(Object value) throws StateTileDecoder.ProtocolException {
        require(value instanceof Number, "Invalid identity number"); double number = ((Number) value).doubleValue();
        require(Double.isFinite(number) && number >= 0 && number <= 9_007_199_254_740_991d && number == Math.rint(number), "Invalid identity integer"); return (long) number;
    }
    @SuppressWarnings("unchecked") private static Map<String, Object> object(Object value) throws StateTileDecoder.ProtocolException {
        require(value instanceof Map, "Identity object required"); return (Map<String, Object>) value;
    }
    static void require(boolean condition, String message) throws StateTileDecoder.ProtocolException { if (!condition) throw new StateTileDecoder.ProtocolException(message); }
}
