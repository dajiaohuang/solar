package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;

import org.junit.Assume;
import org.junit.Test;

/** Cross-runtime golden check; the Go fixture generator is the only state source. */
public class StateTileGoldenFixtureTest {
    private static final int MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
    private static final int MAX_TILE_BYTES = StateTileDecoder.MAX_TILE_BYTES;

    @Test public void decodesGoGeneratedTilesAndMatchesIEEE754Bits() throws Exception {
        String configured = System.getProperty("SOLAR_STATE_TILE_FIXTURE_DIR");
        if (configured == null || configured.trim().isEmpty()) configured = System.getenv("SOLAR_STATE_TILE_FIXTURE_DIR");
        Assume.assumeTrue("SOLAR_STATE_TILE_FIXTURE_DIR is not configured", configured != null && !configured.trim().isEmpty());
        Path root = Path.of(configured).toAbsolutePath().normalize();
        assertTrue("configured fixture directory is absent", Files.isDirectory(root));

        Map<String, Object> manifest = object(StateTileDecoder.parseJson(read(root.resolve("manifest.json"), MAX_MANIFEST_BYTES)));
        assertEquals("solar.state-tile-fixture/v1", string(manifest, "format"));
        String catalogHash = string(manifest, "catalogManifestSha256");
        String inventoryHash = optionalString(manifest, "inventoryManifestSha256");
        Map<String, Object> catalog = object(StateTileDecoder.parseJson(read(root.resolve("catalog-manifest.json"), MAX_MANIFEST_BYTES)));
        Map<String, Object> plan = object(StateTileDecoder.parseJson(read(root.resolve("plan.json"), MAX_MANIFEST_BYTES)));
        assertEquals(catalogHash, string(catalog, "catalogManifestSha256"));
        assertEquals(inventoryHash, optionalString(catalog, "inventoryManifestSha256"));
        assertEquals(catalogHash, string(plan, "catalogManifestSha256"));
        assertEquals(inventoryHash, optionalString(plan, "inventoryManifestSha256"));
        assertEquals("TDB", string(plan, "timeScale"));
        assertEquals("ECLIPJ2000", string(plan, "frame"));
        assertEquals("km", string(plan, "distanceUnit"));
        assertEquals("km/s", string(plan, "velocityUnit"));
        assertEquals("naif:0", string(plan, "stateOriginId"));
        assertEquals("exact", string(plan, "precision"));
        String planId = string(plan, "planId");
        int tileCount = integer(plan, "tileCount");
        List<?> tiles = list(manifest, "tiles");
        assertEquals(tileCount, tiles.size());
        List<?> descriptors = list(plan, "tiles");
        assertEquals(tileCount, descriptors.size());
        List<String> actualIds = new ArrayList<>();
        int exactCount = 0;
        for (Object rawDescriptor : tiles) {
            Map<String, Object> descriptor = object(rawDescriptor);
            int sequence = integer(descriptor, "sequence");
            assertEquals("tile-" + sequence + ".bin", string(descriptor, "file"));
            Map<String, Object> planned = object(descriptors.get(sequence));
            assertEquals(sequence, integer(planned, "sequence"));
            assertEquals(actualIds.size(), integer(planned, "ordinalStart"));
            Path tilePath = root.resolve(string(descriptor, "file")).normalize();
            assertTrue("fixture tile escapes fixture root", tilePath.startsWith(root));
            byte[] raw = read(tilePath, MAX_TILE_BYTES);
            assertEquals(integer(descriptor, "bytes"), raw.length);
            assertEquals(string(descriptor, "sha256"), sha256(raw));
            assertEquals(string(descriptor, "payloadSha256"), StateTileDecoder.payloadHash(raw));
            StateTileDecoder.DecodedTile decoded = StateTileDecoder.decode(raw, planId, catalogHash, inventoryHash, sequence, tileCount);
            List<?> expectedRows = list(descriptor, "expectedRows");
            assertEquals(integer(descriptor, "recordCount"), decoded.recordCount);
            assertEquals(integer(planned, "ordinalCount"), decoded.recordCount);
            assertEquals(expectedRows.size(), decoded.recordCount);
            assertEquals(integer(descriptor, "ordinalStart"), decoded.ordinalStart);
            assertEquals(actualIds.size(), decoded.ordinalStart);
            assertEquals(((Number) manifest.get("epochJd")).doubleValue(), decoded.epochJd, 0);
            assertEquals(((Number) plan.get("epochJd")).doubleValue(), decoded.epochJd, 0);
            for (int row = 0; row < decoded.recordCount; row++) {
                Map<String, Object> expected = object(expectedRows.get(row));
                assertEquals(string(expected, "id"), decoded.metadata.get(row).id);
                actualIds.add(decoded.metadata.get(row).id);
                assertTrue("unexpected status", "exact".equals(string(expected, "status")) || "missing".equals(string(expected, "status")));
                boolean exact = "exact".equals(string(expected, "status"));
                if (exact) exactCount++;
                assertEquals(exact, (decoded.exactBitmap[row / 8] & (1 << (row % 8))) != 0);
                List<?> expectedBits = list(expected, "stateIEEE754BitsLE");
                assertEquals(StateTileDecoder.STRIDE, expectedBits.size());
                for (int component = 0; component < StateTileDecoder.STRIDE; component++) {
                    long expectedValue = Long.parseUnsignedLong(string(expectedBits, component), 16);
                    long actualValue = Double.doubleToRawLongBits(decoded.states[row * StateTileDecoder.STRIDE + component]);
                    assertEquals("row " + row + " component " + component, expectedValue, actualValue);
                }
            }
        }
        assertEquals(list(manifest, "ids"), actualIds);
        assertEquals(integer(plan, "bodyCount"), actualIds.size());
        assertEquals(integer(plan, "exactCount"), exactCount);
        assertEquals(integer(plan, "missingCount"), actualIds.size() - exactCount);
        assertEquals(0, integer(plan, "approximateCount"));
    }

    private static byte[] read(Path path, int limit) throws IOException {
        long length = Files.size(path);
        if (length < 1 || length > limit) throw new IOException("fixture file exceeds bound: " + path);
        return Files.readAllBytes(path);
    }

    private static String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder result = new StringBuilder(64);
        for (byte value : digest) result.append(String.format("%02x", value & 255));
        return result.toString();
    }

    @SuppressWarnings("unchecked") private static Map<String, Object> object(Object value) { if (!(value instanceof Map)) throw new AssertionError("JSON object expected"); return (Map<String, Object>) value; }
    @SuppressWarnings("unchecked") private static List<?> list(Map<String, Object> value, String key) { return list(value.get(key)); }
    private static List<?> list(Object value) { if (!(value instanceof List)) throw new AssertionError("JSON array expected"); return (List<?>) value; }
    private static String string(Map<String, Object> value, String key) { Object result = value.get(key); if (!(result instanceof String)) throw new AssertionError("JSON string expected: " + key); return (String) result; }
    private static String optionalString(Map<String, Object> value, String key) { Object result = value.get(key); if (result == null) return null; return string(value, key); }
    private static int integer(Map<String, Object> value, String key) { double result = ((Number) value.get(key)).doubleValue(); if (result < 0 || result != Math.rint(result) || result > Integer.MAX_VALUE) throw new AssertionError("invalid integer: " + key); return (int) result; }
    private static String string(List<?> value, int index) { Object result = value.get(index); if (!(result instanceof String)) throw new AssertionError("JSON string expected"); return (String) result; }
}
