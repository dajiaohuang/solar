package io.github.dajiaohuang.solaratlas;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Manifest/plan/tile orchestration with bounded sequential backpressure. */
public final class StateTileService {
    private static final String API_VERSION = "solar.api/v1";
    private static final int MAX_PLAN_BYTES = 8 * 1024 * 1024;
    private static final int MAX_AGGREGATE_ROWS = 2_000_000;
    private static final long MAX_RESIDENT_STATE_BYTES = 1536L * 1024L * 1024L;
    private static final int TILE_SIZE = 16_384;
    private final String baseUrl;
    private final StateTileCache cache;

    public StateTileService(String address, File cacheDirectory) throws IOException {
        this(address, new StateTileCache(cacheDirectory));
    }

    public StateTileService(String address, StateTileCache sharedCache) throws IOException {
        if (address == null) throw new StateTileDecoder.ProtocolException("backend address is required");
        String trimmed = address.trim();
        try {
            URL parsed = new URL(trimmed);
            if (!"https".equalsIgnoreCase(parsed.getProtocol()) || parsed.getHost().isEmpty() || parsed.getUserInfo() != null || parsed.getQuery() != null || parsed.getRef() != null) {
                throw new StateTileDecoder.ProtocolException("backend must be HTTPS without credentials, query or fragment");
            }
        } catch (java.net.MalformedURLException error) { throw new StateTileDecoder.ProtocolException("backend address is invalid"); }
        baseUrl = trimmed.replaceAll("/+\\z", "");
        if (sharedCache == null) throw new StateTileDecoder.ProtocolException("tile cache is unavailable");
        cache = sharedCache;
    }

    public static final class Frame {
        public final double epochJd;
        public final String catalogHash;
        public final String inventoryHash;
        public final List<StateTileDecoder.Metadata> metadata;
        public final double[] states;
        public final boolean[] exact;

        private Frame(double epochJd, String catalogHash, String inventoryHash, List<StateTileDecoder.Metadata> metadata, double[] states, boolean[] exact) {
            this.epochJd = epochJd; this.catalogHash = catalogHash; this.inventoryHash = inventoryHash;
            this.metadata = List.copyOf(metadata); this.states = states; this.exact = exact;
        }
    }

    public Frame load(List<String> inputIds, double epochJd) throws IOException {
        checkCancelled();
        if (!Double.isFinite(epochJd) || inputIds == null || inputIds.isEmpty() || inputIds.size() > MAX_AGGREGATE_ROWS) throw new StateTileDecoder.ProtocolException("finite TDB epoch and bounded IDs are required");
        List<String> ids = normalizeIds(inputIds);
        Map<String, Object> manifest = object(receive("v1/catalog/manifest", null, false));
        String catalogHash = hashField(manifest, "catalogManifestSha256");
        String inventoryHash = optionalHash(manifest, "inventoryManifestSha256");
        require(string(manifest, "apiVersion").equals(API_VERSION), "manifest API version mismatch");
        String catalogVersion = string(manifest, "catalogVersion");
        require(!catalogVersion.isEmpty(), "manifest catalog version is missing");
        StateAccumulator accumulator = new StateAccumulator(ids.size(), MAX_RESIDENT_STATE_BYTES);
        for (int start = 0; start < ids.size(); start += StateTileDecoder.MAX_ROWS) {
            checkCancelled();
            List<String> chunk = new ArrayList<>(ids.subList(start, Math.min(ids.size(), start + StateTileDecoder.MAX_ROWS)));
            String request = "{\"ids\":" + stringsJson(chunk) + ",\"epochJd\":" + Double.toString(epochJd) + ",\"timeScale\":\"TDB\",\"frame\":\"ECLIPJ2000\",\"precision\":\"exact\",\"fieldMask\":[\"position\",\"velocity\"],\"tileSize\":" + TILE_SIZE + "}";
            Map<String, Object> plan = object(receive("v1/state/plan", request, false));
            validatePlan(plan, chunk, epochJd, catalogVersion, catalogHash, inventoryHash);
            String planId = string(plan, "planId");
            int tileCount = integer(plan, "tileCount"), exactCount = integer(plan, "exactCount");
            List<?> tileValues = list(plan, "tiles");
            int decodedExact = 0, ordinal = 0;
            for (int sequence = 0; sequence < tileValues.size(); sequence++) {
                checkCancelled();
                Map<String, Object> descriptor = object(tileValues.get(sequence));
                int descriptorSequence = integer(descriptor, "sequence");
                int descriptorStart = integer(descriptor, "ordinalStart");
                int descriptorCount = integer(descriptor, "ordinalCount");
                require(descriptorSequence == sequence && descriptorStart == ordinal && descriptorCount > 0 && descriptorCount <= chunk.size() - ordinal, "plan tile ordering is invalid");
                String requestKey = sha256((planId + ":" + sequence).getBytes(StandardCharsets.UTF_8));
                byte[] cached = cache.getByRequestKey(requestKey);
                StateTileDecoder.DecodedTile tile = cached == null
                        ? StateTileClient.fetchTile(baseUrl, planId, sequence, tileCount, catalogHash, inventoryHash, cache, requestKey)
                        : StateTileDecoder.decode(cached, planId, catalogHash, inventoryHash, sequence, tileCount);
                require(tile.recordCount == descriptorCount && tile.ordinalStart == descriptorStart && tile.epochJd == epochJd, "tile descriptor mismatch");
                decodedExact += accumulator.append(tile, ids, start + ordinal);
                ordinal += descriptorCount;
            }
            require(ordinal == chunk.size() && decodedExact == exactCount, "incomplete plan or precision count mismatch");
        }
        return accumulator.finish(epochJd, catalogHash, inventoryHash);
    }

    /** Single final primitive allocation; budget is an estimate, not a process RSS cap. */
    static final class StateAccumulator {
        private final double[] states;
        private final boolean[] exact;
        private final List<StateTileDecoder.Metadata> metadata;
        private final long budget;
        private long residentBytes;
        private int size;
        private boolean finished;

        StateAccumulator(int rows, long budget) throws StateTileDecoder.ProtocolException {
            checkCancelled();
            require(rows > 0 && rows <= MAX_AGGREGATE_ROWS, "invalid native state row capacity");
            // Reserve six doubles, one flag and both metadata reference arrays (up to
            // eight bytes/reference), including the immutable list made by Frame.
            residentBytes = 96L + rows * ((long) StateTileDecoder.STRIDE * Double.BYTES + 1L + 16L);
            require(residentBytes <= budget, "observation exceeds native state memory budget");
            this.budget = budget;
            states = new double[rows * StateTileDecoder.STRIDE];
            exact = new boolean[rows];
            metadata = new ArrayList<>(rows);
        }

        int append(StateTileDecoder.DecodedTile tile, List<String> ids, int start) throws StateTileDecoder.ProtocolException {
            checkCancelled();
            require(!finished && start == size && tile.recordCount > 0 && tile.recordCount <= exact.length - size,
                    "native state assembly ordering is invalid");
            require(ids.size() == exact.length, "native state request size mismatch");
            long nextBytes = residentBytes;
            for (int row = 0; row < tile.recordCount; row++) {
                if ((row & 1023) == 0) checkCancelled();
                StateTileDecoder.Metadata value = tile.metadata.get(row);
                require(value.id.equals(ids.get(start + row)), "tile body identity mismatch");
                long bytes = metadataBytes(value);
                require(bytes <= budget - nextBytes, "observation exceeds native state memory budget");
                nextBytes += bytes;
            }
            checkCancelled();
            System.arraycopy(tile.states, 0, states, start * StateTileDecoder.STRIDE, tile.states.length);
            int exactCount = 0;
            for (int row = 0; row < tile.recordCount; row++) {
                if ((row & 1023) == 0) checkCancelled();
                boolean isExact = (tile.exactBitmap[row / 8] & (1 << (row % 8))) != 0;
                exact[start + row] = isExact;
                if (isExact) exactCount++;
            }
            metadata.addAll(tile.metadata);
            size += tile.recordCount;
            residentBytes = nextBytes;
            return exactCount;
        }

        Frame finish(double epochJd, String catalogHash, String inventoryHash) throws StateTileDecoder.ProtocolException {
            checkCancelled();
            require(!finished && size == exact.length, "incomplete native state assembly");
            finished = true;
            return new Frame(epochJd, catalogHash, inventoryHash, metadata, states, exact);
        }
    }

    private void validatePlan(Map<String, Object> plan, List<String> ids, double epochJd, String catalogVersion, String catalogHash, String inventoryHash) throws StateTileDecoder.ProtocolException {
        require(string(plan, "apiVersion").equals(API_VERSION) && string(plan, "catalogVersion").equals(catalogVersion) && string(plan, "catalogManifestSha256").equals(catalogHash), "plan/catalog identity mismatch");
        require(same(optionalHash(plan, "inventoryManifestSha256"), inventoryHash), "plan/inventory identity mismatch");
        require(string(plan, "requestIdsSha256").equals(requestHash(ids)) && isHash(string(plan, "planId")), "plan request identity mismatch");
        require(number(plan, "epochJd") == epochJd && string(plan, "timeScale").equals("TDB") && string(plan, "frame").equals("ECLIPJ2000") && string(plan, "precision").equals("exact"), "plan numeric contract mismatch");
        require(string(plan, "stateOriginId").equals("naif:0") && string(plan, "distanceUnit").equals("km") && string(plan, "velocityUnit").equals("km/s") && integer(plan, "stride") == 6, "plan origin/unit mismatch");
        List<?> fields = list(plan, "fieldMask"); require(fields.size() == 2 && "position".equals(fields.get(0)) && "velocity".equals(fields.get(1)), "plan field mask mismatch");
        int bodyCount = integer(plan, "bodyCount"), tileCount = integer(plan, "tileCount"), exactCount = integer(plan, "exactCount"), approximateCount = integer(plan, "approximateCount"), missingCount = integer(plan, "missingCount");
        require(bodyCount == ids.size() && tileCount > 0 && tileCount <= bodyCount && tileCount <= StateTileDecoder.MAX_ROWS && exactCount >= 0 && missingCount >= 0 && approximateCount == 0 && exactCount + missingCount == bodyCount, "plan counts are invalid");
        require(list(plan, "tiles").size() == tileCount, "plan tile inventory is invalid");
    }

    private byte[] receive(String path, String body, boolean binary) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(baseUrl + "/" + path).openConnection();
            connection.setRequestMethod(body == null ? "GET" : "POST"); connection.setConnectTimeout(10_000); connection.setReadTimeout(30_000); connection.setDoInput(true);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", binary ? "application/vnd.solar.state-tile+binary" : "application/json");
            if (body != null) { connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); byte[] request = body.getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(request.length); try (java.io.OutputStream output = connection.getOutputStream()) { output.write(request); } }
            int status = connection.getResponseCode(); if (status != HttpURLConnection.HTTP_OK) throw new IOException("backend HTTP " + status);
            long declared = connection.getContentLengthLong(); int limit = binary ? StateTileDecoder.MAX_TILE_BYTES : MAX_PLAN_BYTES;
            if (declared <= 0 || declared > limit) throw new StateTileDecoder.ProtocolException("backend response length is invalid");
            String type = connection.getHeaderField("Content-Type"); String expected = binary ? "application/vnd.solar.state-tile+binary" : "application/json";
            if (type == null || !type.split(";", 2)[0].trim().equalsIgnoreCase(expected)) throw new StateTileDecoder.ProtocolException("backend response type is invalid");
            return readBounded(connection.getInputStream(), limit);
        } finally { if (connection != null) connection.disconnect(); }
    }

    private static byte[] readBounded(InputStream input, int limit) throws IOException { try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(limit, 64 * 1024))) { byte[] buffer = new byte[16 * 1024]; int total = 0, count; while ((count = source.read(buffer)) != -1) { checkCancelled(); if (count > limit - total) throw new StateTileDecoder.ProtocolException("backend response exceeds limit"); output.write(buffer, 0, count); total += count; } return output.toByteArray(); } }
    private static List<String> normalizeIds(List<String> input) throws StateTileDecoder.ProtocolException { List<String> result = new ArrayList<>(input.size()); Set<String> seen = new HashSet<>(); for (String raw : input) { if (raw == null) throw new StateTileDecoder.ProtocolException("body ID is null"); String id = raw.trim(); if (id.isEmpty() || id.getBytes(StandardCharsets.UTF_8).length > 1024 || !seen.add(id)) throw new StateTileDecoder.ProtocolException("body IDs must be unique and bounded"); result.add(id); } return result; }
    private static String stringsJson(List<String> values) { StringBuilder out = new StringBuilder("["); for (int i = 0; i < values.size(); i++) { if (i > 0) out.append(','); out.append(jsonString(values.get(i))); } return out.append(']').toString(); }
    private static String jsonString(String value) { StringBuilder out = new StringBuilder("\""); for (int i = 0; i < value.length(); i++) { char c = value.charAt(i); if (c == '"' || c == '\\') out.append('\\').append(c); else if (c == '\b') out.append("\\b"); else if (c == '\f') out.append("\\f"); else if (c == '\n') out.append("\\n"); else if (c == '\r') out.append("\\r"); else if (c == '\t') out.append("\\t"); else if (c < 0x20) out.append(String.format("\\u%04x", (int) c)); else out.append(c); } return out.append('"').toString(); }
    private static String requestHash(List<String> ids) throws StateTileDecoder.ProtocolException { try { MessageDigest digest = MessageDigest.getInstance("SHA-256"); for (String id : ids) { byte[] bytes = id.getBytes(StandardCharsets.UTF_8); digest.update((byte) bytes.length); digest.update((byte) (bytes.length >>> 8)); digest.update((byte) (bytes.length >>> 16)); digest.update((byte) (bytes.length >>> 24)); digest.update(bytes); } return hex(digest.digest()); } catch (NoSuchAlgorithmException error) { throw new StateTileDecoder.ProtocolException("SHA-256 unavailable"); } }
    private static String sha256(byte[] bytes) throws StateTileDecoder.ProtocolException { try { return hex(MessageDigest.getInstance("SHA-256").digest(bytes)); } catch (NoSuchAlgorithmException error) { throw new StateTileDecoder.ProtocolException("SHA-256 unavailable"); } }
    private static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(bytes.length * 2); for (byte value : bytes) out.append(String.format("%02x", value & 255)); return out.toString(); }
    private static Map<String, Object> object(byte[] raw) throws StateTileDecoder.ProtocolException { return object(StateTileDecoder.parseJson(raw)); }
    @SuppressWarnings("unchecked") private static Map<String, Object> object(Object value) throws StateTileDecoder.ProtocolException { if (!(value instanceof Map)) throw new StateTileDecoder.ProtocolException("JSON object expected"); return (Map<String, Object>) value; }
    private static List<?> list(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { Object result = value.get(key); if (!(result instanceof List)) throw new StateTileDecoder.ProtocolException("JSON array expected: " + key); return (List<?>) result; }
    private static String string(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { Object result = value.get(key); if (!(result instanceof String)) throw new StateTileDecoder.ProtocolException("JSON string expected: " + key); return (String) result; }
    private static String hashField(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { String result = string(value, key); if (!isHash(result)) throw new StateTileDecoder.ProtocolException("invalid SHA-256: " + key); return result; }
    private static String optionalHash(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { Object raw = value.get(key); if (raw == null) return null; if (!(raw instanceof String) || !isHash((String) raw)) throw new StateTileDecoder.ProtocolException("invalid optional SHA-256: " + key); return (String) raw; }
    private static boolean same(String left, String right) { return left == null ? right == null : left.equals(right); }
    private static int integer(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { double result = number(value, key); if (result < 0 || result != Math.rint(result) || result > Integer.MAX_VALUE) throw new StateTileDecoder.ProtocolException("invalid integer: " + key); return (int) result; }
    private static double number(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { Object result = value.get(key); if (!(result instanceof Number) || !Double.isFinite(((Number) result).doubleValue())) throw new StateTileDecoder.ProtocolException("invalid number: " + key); return ((Number) result).doubleValue(); }
    private static boolean isHash(String value) { if (value == null || value.length() != 64) return false; for (int i = 0; i < value.length(); i++) { char c = value.charAt(i); if (!(c >= '0' && c <= '9' || c >= 'a' && c <= 'f')) return false; } return true; }
    private static long metadataBytes(StateTileDecoder.Metadata row) {
        return 512L + stringBytes(row.id) + stringBytes(row.source) + stringBytes(row.datasetVersion) + stringBytes(row.datasetSha256) + stringBytes(row.kernelSha256) + stringBytes(row.model) + stringBytes(row.centerId) + stringBytes(row.stateEvidence) + stringBytes(row.missingReason) + stringBytes(row.identityStatus);
    }
    private static long stringBytes(String value) { return value == null ? 0L : (long) value.length() * Character.BYTES; }
    private static void require(boolean condition, String message) throws StateTileDecoder.ProtocolException { if (!condition) throw new StateTileDecoder.ProtocolException(message); }
    private static void checkCancelled() throws StateTileDecoder.ProtocolException { if (Thread.currentThread().isInterrupted()) throw new StateTileDecoder.ProtocolException("state load cancelled"); }
}
