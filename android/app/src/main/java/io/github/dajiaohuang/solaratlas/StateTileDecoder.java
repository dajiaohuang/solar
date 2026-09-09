package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Strict decoder for the Go statewire v1 envelope. No scientific values are generated here. */
public final class StateTileDecoder {
    public static final int HEADER_BYTES = 200;
    public static final int STRIDE = 6;
    public static final int FIELD_MASK = 3;
    public static final int MAX_ROWS = 32768;
    public static final int MAX_TILE_BYTES = 64 * 1024 * 1024;
    private static final byte[] MAGIC = new byte[]{'S', 'L', 'R', 'T', 'I', 'L', 'E', 0};
    private static final String[] REQUIRED_METADATA_FIELDS = new String[]{
            "id", "source", "datasetVersion", "datasetSha256", "kernelSha256", "model", "centerId",
            "validityStartEt", "validityEndEt", "validityPresent", "stateEvidence",
            "evidenceWindowStartEt", "evidenceWindowEndEt", "evidenceWindowPresent", "missingReason",
            "identityStatus", "sourceRecord"
    };

    private StateTileDecoder() {}

    public static final class ProtocolException extends IOException {
        public ProtocolException(String message) { super(message); }
    }

    public static final class Metadata {
        public final String id;
        public final String source;
        public final String datasetVersion;
        public final String datasetSha256;
        public final String kernelSha256;
        public final String model;
        public final String centerId;
        public final String stateEvidence;
        public final String missingReason;
        public final String identityStatus;
        public final boolean sourceRecord;
        public final double validityStartEt;
        public final double validityEndEt;
        public final boolean validityPresent;
        public final double evidenceWindowStartEt;
        public final double evidenceWindowEndEt;
        public final boolean evidenceWindowPresent;

        private Metadata(Map<String, Object> values) throws ProtocolException {
            for (String key : REQUIRED_METADATA_FIELDS) if (!values.containsKey(key)) throw new ProtocolException("metadata field is missing: " + key);
            id = requiredString(values, "id");
            source = string(values, "source");
            datasetVersion = string(values, "datasetVersion");
            datasetSha256 = string(values, "datasetSha256");
            kernelSha256 = string(values, "kernelSha256");
            model = string(values, "model");
            centerId = string(values, "centerId");
            stateEvidence = string(values, "stateEvidence");
            missingReason = string(values, "missingReason");
            identityStatus = string(values, "identityStatus");
            sourceRecord = bool(values, "sourceRecord");
            validityPresent = bool(values, "validityPresent");
            validityStartEt = number(values, "validityStartEt");
            validityEndEt = number(values, "validityEndEt");
            evidenceWindowPresent = bool(values, "evidenceWindowPresent");
            evidenceWindowStartEt = number(values, "evidenceWindowStartEt");
            evidenceWindowEndEt = number(values, "evidenceWindowEndEt");
            if (validityPresent && (!finite(validityStartEt) || !finite(validityEndEt) || validityEndEt < validityStartEt)) {
                throw new ProtocolException("invalid metadata validity window");
            }
            if (evidenceWindowPresent && (!finite(evidenceWindowStartEt) || !finite(evidenceWindowEndEt) || evidenceWindowEndEt < evidenceWindowStartEt)) {
                throw new ProtocolException("invalid metadata evidence window");
            }
        }

        private static String string(Map<String, Object> values, String key) throws ProtocolException {
            Object value = values.get(key);
            if (value == null) return "";
            if (!(value instanceof String)) throw new ProtocolException("metadata field is not a string: " + key);
            return (String) value;
        }

        private static String requiredString(Map<String, Object> values, String key) throws ProtocolException {
            String value = string(values, key);
            if (value.trim().isEmpty()) throw new ProtocolException("metadata identity is empty");
            return value;
        }

        private static boolean bool(Map<String, Object> values, String key) throws ProtocolException {
            Object value = values.get(key);
            if (value == null) return false;
            if (!(value instanceof Boolean)) throw new ProtocolException("metadata field is not boolean: " + key);
            return (Boolean) value;
        }

        private static double number(Map<String, Object> values, String key) throws ProtocolException {
            Object value = values.get(key);
            if (value == null) return 0;
            if (!(value instanceof Number)) throw new ProtocolException("metadata field is not numeric: " + key);
            return ((Number) value).doubleValue();
        }
    }

    public static final class DecodedTile {
        public final int sequence;
        public final int tileCount;
        public final long ordinalStart;
        public final int recordCount;
        public final double epochJd;
        public final List<Metadata> metadata;
        public final byte[] exactBitmap;
        public final byte[] approximateBitmap;
        public final byte[] missingBitmap;
        public final double[] states;
        public final String planHash;
        public final String catalogManifestSha256;
        public final String inventoryManifestSha256;
        public final String payloadSha256;

        private DecodedTile(int sequence, int tileCount, long ordinalStart, int recordCount, double epochJd,
                            List<Metadata> metadata, byte[] exactBitmap, byte[] approximateBitmap,
                            byte[] missingBitmap, double[] states, String planHash,
                            String catalogManifestSha256, String inventoryManifestSha256, String payloadSha256) {
            this.sequence = sequence;
            this.tileCount = tileCount;
            this.ordinalStart = ordinalStart;
            this.recordCount = recordCount;
            this.epochJd = epochJd;
            this.metadata = metadata;
            this.exactBitmap = exactBitmap;
            this.approximateBitmap = approximateBitmap;
            this.missingBitmap = missingBitmap;
            this.states = states;
            this.planHash = planHash;
            this.catalogManifestSha256 = catalogManifestSha256;
            this.inventoryManifestSha256 = inventoryManifestSha256;
            this.payloadSha256 = payloadSha256;
        }
    }

    public static DecodedTile decode(byte[] raw, String expectedPlanHash, String expectedCatalogHash,
                                     String expectedInventoryHash, Integer expectedSequence,
                                     Integer expectedTileCount) throws ProtocolException {
        if (raw == null || raw.length < HEADER_BYTES || raw.length > MAX_TILE_BYTES) throw new ProtocolException("tile size exceeds 64 MiB or header");
        for (int i = 0; i < MAGIC.length; i++) if (raw[i] != MAGIC[i]) throw new ProtocolException("magic mismatch");
        if (u16(raw, 8) != 1 || u16(raw, 10) != HEADER_BYTES) throw new ProtocolException("version/header mismatch");
        int sequence = checkedInt(u32(raw, 12), "sequence");
        int tileCount = checkedInt(u32(raw, 16), "tile count");
        long ordinalStart = u32(raw, 20);
        int recordCount = checkedInt(u32(raw, 24), "record count");
        int stride = u16(raw, 28);
        int fieldMask = u16(raw, 30);
        double epochJd = Double.longBitsToDouble(u64(raw, 32));
        long metadataOffset = u32(raw, 40), metadataLength = u32(raw, 44);
        long exactOffset = u32(raw, 48), bitmapLength = u32(raw, 52);
        long approximateOffset = u32(raw, 56), missingOffset = u32(raw, 60);
        long statesOffset = u32(raw, 64), statesLength = u32(raw, 68);
        if (recordCount < 1 || recordCount > MAX_ROWS || tileCount < 1 || sequence >= tileCount || stride != STRIDE || fieldMask != FIELD_MASK || !finite(epochJd)) {
            throw new ProtocolException("invalid numeric header fields");
        }
        if (expectedSequence != null && sequence != expectedSequence || expectedTileCount != null && tileCount != expectedTileCount) throw new ProtocolException("tile sequence/count mismatch");
        String planHash = hex(raw, 72, 32), catalogHash = hex(raw, 104, 32), inventoryHash = hex(raw, 136, 32), payloadHash = hex(raw, 168, 32);
        if (expectedPlanHash != null && !planHash.equals(expectedPlanHash) || expectedCatalogHash != null && !catalogHash.equals(expectedCatalogHash)) throw new ProtocolException("tile identity mismatch");
        String expectedInventory = expectedInventoryHash == null ? null : expectedInventoryHash;
        boolean hasInventory = !allZero(raw, 136, 32);
        if (hasInventory != (expectedInventory != null) || hasInventory && !inventoryHash.equals(expectedInventory)) throw new ProtocolException("tile inventory identity mismatch");
        long expectedBitmapLength = (recordCount + 7L) / 8L;
        if (metadataOffset != HEADER_BYTES || metadataLength < 2 || metadataOffset + metadataLength > raw.length || raw[(int) (metadataOffset + metadataLength - 1)] != '\n' ||
                exactOffset != metadataOffset + metadataLength || bitmapLength != expectedBitmapLength || approximateOffset != exactOffset + bitmapLength ||
                missingOffset != approximateOffset + bitmapLength || statesOffset < missingOffset + bitmapLength || statesOffset % 8 != 0 ||
                statesLength != recordCount * (long) STRIDE * 8L || statesOffset + statesLength != raw.length) throw new ProtocolException("invalid section offsets");
        if (!payloadHash.equals(computePayloadHash(raw))) throw new ProtocolException("payload checksum mismatch");

        List<Metadata> metadata = parseMetadata(raw, (int) metadataOffset, (int) metadataLength, recordCount);
        byte[] exact = slice(raw, exactOffset, bitmapLength), approximate = slice(raw, approximateOffset, bitmapLength), missing = slice(raw, missingOffset, bitmapLength);
        validateBitmapPadding(exact, recordCount); validateBitmapPadding(approximate, recordCount); validateBitmapPadding(missing, recordCount);
        Set<String> ids = new HashSet<>();
        double[] states = new double[recordCount * STRIDE];
        for (int row = 0; row < recordCount; row++) {
            Metadata item = metadata.get(row);
            if (!ids.add(item.id)) throw new ProtocolException("duplicate metadata identity");
            boolean isExact = bit(exact, row), isApproximate = bit(approximate, row), isMissing = bit(missing, row);
            if ((isExact ? 1 : 0) + (isApproximate ? 1 : 0) + (isMissing ? 1 : 0) != 1 || isApproximate) throw new ProtocolException("invalid exact-only status bitmap");
            if (isExact) {
                if (item.source.trim().isEmpty() || item.datasetVersion.trim().isEmpty() || !isHash(item.datasetSha256) || item.stateEvidence.trim().isEmpty() || item.centerId.trim().isEmpty() ||
                        !("spk-original".equals(item.model) || "source-kernel-state-at-audit-epoch".equals(item.model)) ||
                        "spk-original".equals(item.model) && !isHash(item.kernelSha256) || !item.missingReason.isEmpty()) throw new ProtocolException("invalid exact provenance");
                String expectedDatasetHash = item.sourceRecord ? expectedInventoryHash : expectedCatalogHash;
                if (expectedDatasetHash == null || !item.datasetSha256.equals(expectedDatasetHash)) throw new ProtocolException("exact dataset hash is not bound to this manifest");
                if ("source-kernel-state-at-audit-epoch".equals(item.model) && (!item.sourceRecord || item.identityStatus.trim().isEmpty())) throw new ProtocolException("snapshot source identity is missing");
                double epochEt = (epochJd - 2451545.0) * 86400.0;
                if (item.validityPresent && (epochEt < item.validityStartEt - 0.0001 || epochEt > item.validityEndEt + 0.0001)) throw new ProtocolException("state is outside validity window");
                if (item.evidenceWindowPresent && (epochEt < item.evidenceWindowStartEt - 0.0001 || epochEt > item.evidenceWindowEndEt + 0.0001)) throw new ProtocolException("state is outside evidence window");
            } else if (item.missingReason.trim().isEmpty()) throw new ProtocolException("missing state has no reason");
            for (int component = 0; component < STRIDE; component++) {
                long bits = u64(raw, statesOffset + (long) (row * STRIDE + component) * 8L);
                double value = Double.longBitsToDouble(bits);
                if (!finite(value) || isMissing && value != 0) throw new ProtocolException("invalid state value");
                states[row * STRIDE + component] = value;
            }
        }
        return new DecodedTile(sequence, tileCount, ordinalStart, recordCount, epochJd, metadata, exact, approximate, missing, states,
                planHash, catalogHash, hasInventory ? inventoryHash : null, payloadHash);
    }

    public static String payloadHash(byte[] raw) throws ProtocolException { return computePayloadHash(raw); }

    public static String headerPayloadHash(byte[] raw) throws ProtocolException {
        if (raw == null || raw.length < HEADER_BYTES) throw new ProtocolException("tile has no header");
        return hex(raw, 168, 32);
    }

    static Object parseJson(byte[] raw) throws ProtocolException {
        if (raw == null) throw new ProtocolException("JSON body is empty");
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString();
            return new JsonParser(text).parse();
        } catch (CharacterCodingException error) { throw new ProtocolException("JSON is not valid UTF-8"); }
    }

    private static String computePayloadHash(byte[] raw) throws ProtocolException {
        if (raw == null || raw.length < HEADER_BYTES) throw new ProtocolException("tile has no payload");
        return digest(raw, HEADER_BYTES, raw.length - HEADER_BYTES);
    }

    private static List<Metadata> parseMetadata(byte[] raw, int offset, int length, int expectedRows) throws ProtocolException {
        List<Metadata> result = new ArrayList<>(expectedRows);
        int start = offset;
        int end = offset + length;
        while (start < end) {
            if (result.size() >= expectedRows) throw new ProtocolException("metadata row count mismatch");
            int newline = start;
            while (newline < end && raw[newline] != '\n') newline++;
            if (newline == end || newline - start > 1024 * 1024) throw new ProtocolException("invalid metadata line");
            int lineEnd = newline;
            if (lineEnd > start && raw[lineEnd - 1] == '\r') lineEnd--;
            if (lineEnd == start) throw new ProtocolException("empty metadata line");
            String line;
            try {
                line = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw, start, lineEnd - start)).toString();
            } catch (CharacterCodingException error) { throw new ProtocolException("metadata is not valid UTF-8"); }
            Object parsed = new JsonParser(line).parse();
            if (!(parsed instanceof Map)) throw new ProtocolException("metadata row is not an object");
            result.add(new Metadata((Map<String, Object>) parsed));
            start = newline + 1;
        }
        if (result.size() != expectedRows) throw new ProtocolException("metadata row count mismatch");
        return result;
    }

    static final class JsonParser {
        private final String text; private int position; private int nesting;
        JsonParser(String text) { this.text = text; }
        Object parse() throws ProtocolException { Object value = value(); whitespace(); if (position != text.length()) throw new ProtocolException("trailing metadata JSON"); return value; }
        private Object value() throws ProtocolException {
            whitespace(); if (position >= text.length()) throw new ProtocolException("truncated metadata JSON");
            char c = text.charAt(position);
            if (c == '"') return string();
            if (c == '{' || c == '[') {
                if (nesting++ >= 32) throw new ProtocolException("metadata nesting is too deep");
                try { return c == '{' ? object() : array(); } finally { nesting--; }
            }
            if (text.startsWith("true", position)) { position += 4; return Boolean.TRUE; }
            if (text.startsWith("false", position)) { position += 5; return Boolean.FALSE; }
            if (text.startsWith("null", position)) { position += 4; return null; }
            return number();
        }
        private Map<String, Object> object() throws ProtocolException { Map<String, Object> result = new HashMap<>(); position++; whitespace(); if (take('}')) return result; while (true) { whitespace(); if (position >= text.length() || text.charAt(position) != '"') throw new ProtocolException("metadata object key is invalid"); String key = string(); if (result.containsKey(key)) throw new ProtocolException("duplicate metadata key"); whitespace(); require(':'); Object value = value(); result.put(key, value); whitespace(); if (take('}')) return result; require(','); } }
        private List<Object> array() throws ProtocolException { List<Object> result = new ArrayList<>(); position++; whitespace(); if (take(']')) return result; while (true) { result.add(value()); whitespace(); if (take(']')) return result; require(','); } }
        private String string() throws ProtocolException { require('"'); StringBuilder result = new StringBuilder(); while (position < text.length()) { char c = text.charAt(position++); if (c == '"') return result.toString(); if (c < 0x20) throw new ProtocolException("control character in metadata string"); if (c != '\\') { result.append(c); continue; } if (position >= text.length()) throw new ProtocolException("truncated metadata escape"); char escaped = text.charAt(position++); switch (escaped) { case '"': case '\\': case '/': result.append(escaped); break; case 'b': result.append('\b'); break; case 'f': result.append('\f'); break; case 'n': result.append('\n'); break; case 'r': result.append('\r'); break; case 't': result.append('\t'); break; case 'u': result.append((char) hex4()); break; default: throw new ProtocolException("invalid metadata escape"); } } throw new ProtocolException("unterminated metadata string"); }
        private double number() throws ProtocolException { int start = position; if (position < text.length() && text.charAt(position) == '-') position++; digits(); if (position < text.length() && text.charAt(position) == '.') { position++; digits(); } if (position < text.length() && (text.charAt(position) == 'e' || text.charAt(position) == 'E')) { position++; if (position < text.length() && (text.charAt(position) == '+' || text.charAt(position) == '-')) position++; digits(); } try { double value = Double.parseDouble(text.substring(start, position)); if (!finite(value)) throw new ProtocolException("nonfinite metadata number"); return value; } catch (NumberFormatException error) { throw new ProtocolException("invalid metadata number"); } }
        private void digits() throws ProtocolException { int start = position; while (position < text.length() && Character.isDigit(text.charAt(position))) position++; if (start == position) throw new ProtocolException("metadata number has no digits"); }
        private int hex4() throws ProtocolException { if (position + 4 > text.length()) throw new ProtocolException("truncated unicode escape"); int value = 0; for (int i = 0; i < 4; i++) { int digit = Character.digit(text.charAt(position++), 16); if (digit < 0) throw new ProtocolException("invalid unicode escape"); value = value * 16 + digit; } return value; }
        private void whitespace() { while (position < text.length() && Character.isWhitespace(text.charAt(position))) position++; }
        private boolean take(char expected) { if (position < text.length() && text.charAt(position) == expected) { position++; return true; } return false; }
        private void require(char expected) throws ProtocolException { if (!take(expected)) throw new ProtocolException("invalid metadata JSON"); }
    }

    private static int checkedInt(long value, String field) throws ProtocolException { if (value > Integer.MAX_VALUE) throw new ProtocolException(field + " is too large"); return (int) value; }
    private static long u32(byte[] b, long offset) { int i = (int) offset; return (b[i] & 255L) | ((b[i + 1] & 255L) << 8) | ((b[i + 2] & 255L) << 16) | ((b[i + 3] & 255L) << 24); }
    private static int u16(byte[] b, long offset) { int i = (int) offset; return (b[i] & 255) | ((b[i + 1] & 255) << 8); }
    private static long u64(byte[] b, long offset) { int i = (int) offset; return (b[i] & 255L) | ((b[i + 1] & 255L) << 8) | ((b[i + 2] & 255L) << 16) | ((b[i + 3] & 255L) << 24) | ((b[i + 4] & 255L) << 32) | ((b[i + 5] & 255L) << 40) | ((b[i + 6] & 255L) << 48) | ((b[i + 7] & 255L) << 56); }
    private static byte[] slice(byte[] raw, long offset, long length) { byte[] result = new byte[(int) length]; System.arraycopy(raw, (int) offset, result, 0, (int) length); return result; }
    private static boolean bit(byte[] bitmap, int row) { return (bitmap[row / 8] & (1 << (row % 8))) != 0; }
    private static void validateBitmapPadding(byte[] bitmap, int rows) throws ProtocolException { for (int row = rows; row < bitmap.length * 8; row++) if (bit(bitmap, row)) throw new ProtocolException("bitmap has bits beyond record count"); }
    private static boolean finite(double value) { return !Double.isNaN(value) && !Double.isInfinite(value); }
    private static boolean isHash(String value) { if (value == null || value.length() != 64) return false; for (int i = 0; i < value.length(); i++) { char c = value.charAt(i); if (!(c >= '0' && c <= '9' || c >= 'a' && c <= 'f')) return false; } return true; }
    private static boolean allZero(byte[] value, int offset, int length) { for (int i = offset; i < offset + length; i++) if (value[i] != 0) return false; return true; }
    private static String hex(byte[] value, int offset, int length) { StringBuilder result = new StringBuilder(length * 2); for (int i = offset; i < offset + length; i++) result.append(String.format("%02x", value[i] & 255)); return result.toString(); }
    private static String digest(byte[] value, int offset, int length) throws ProtocolException { try { MessageDigest digest = MessageDigest.getInstance("SHA-256"); digest.update(value, offset, length); return hex(digest.digest(), 0, 32); } catch (NoSuchAlgorithmException error) { throw new ProtocolException("SHA-256 unavailable"); } }
}
