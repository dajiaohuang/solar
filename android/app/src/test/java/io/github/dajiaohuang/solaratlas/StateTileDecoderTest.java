package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;

import org.junit.Test;

public class StateTileDecoderTest {
    private static final String PLAN = repeat('a');
    private static final String CATALOG = repeat('b');

    @Test
    public void decodesStrictHeaderProvenanceAndFloat64State() throws Exception {
        byte[] raw = tile("naif:399", true, false, 12.5);
        StateTileDecoder.DecodedTile decoded = StateTileDecoder.decode(raw, PLAN, CATALOG, null, 0, 1);
        assertEquals("naif:399", decoded.metadata.get(0).id);
        assertEquals("spk-original", decoded.metadata.get(0).model);
        assertEquals(12.5, decoded.states[0], 0);
        assertEquals(6, decoded.states.length);
    }

    @Test
    public void rejectsChecksumApproximationAndNonUtf8Metadata() throws Exception {
        byte[] checksum = tile("naif:399", true, false, 1);
        checksum[checksum.length - 1] ^= 1;
        expectProtocol(checksum, "checksum");
        expectProtocol(tile("naif:399", false, true, 1), "approximate");
        byte[] invalidUtf8 = tile("naif:399", true, false, 1);
        int metadataOffset = littleInt(invalidUtf8, 40);
        invalidUtf8[metadataOffset] = (byte) 0xc3;
        expectProtocol(invalidUtf8, "checksum");
    }

    @Test
    public void cacheVerifiesPayloadHashEvictsByByteQuotaAndSurvivesReopen() throws Exception {
        File directory = Files.createTempDirectory("solar-tile-cache").toFile();
        try {
            byte[] first = tile("naif:399", true, false, 1);
            byte[] second = tile("naif:301", true, false, 2);
            String firstHash = StateTileDecoder.payloadHash(first);
            String secondHash = StateTileDecoder.payloadHash(second);
            StateTileCache cache = new StateTileCache(directory, Math.max(first.length, second.length));
            cache.put(firstHash, first);
            assertArrayEquals(first, cache.get(firstHash));
            cache.put(secondHash, second);
            assertNotNull(cache.get(secondHash));
            if (first.length + second.length > Math.max(first.length, second.length)) assertEquals(null, cache.get(firstHash));
            StateTileCache reopened = new StateTileCache(directory, Math.max(first.length, second.length));
            assertNotNull(reopened.get(secondHash));
            byte[] corrupt = reopened.get(secondHash);
            corrupt[corrupt.length - 1] ^= 1;
            Files.write(new File(directory, secondHash + ".tile").toPath(), corrupt);
            assertEquals(null, reopened.get(secondHash));
        } finally {
            delete(directory);
        }
    }

    @Test
    public void stopsBeforeParsingAnyUndeclaredMetadataRow() throws Exception {
        byte[] raw = tile("naif:399", true, false, 1, "not-json\n");
        try {
            StateTileDecoder.decode(raw, PLAN, CATALOG, null, 0, 1);
            throw new AssertionError("undeclared metadata was accepted");
        } catch (StateTileDecoder.ProtocolException expected) {
            assertEquals("metadata row count mismatch", expected.getMessage());
        }
    }

    static byte[] tile(String id, boolean exact, boolean approximate, double value) throws Exception {
        return tile(id, exact, approximate, value, "");
    }

    private static byte[] tile(String id, boolean exact, boolean approximate, double value, String extraMetadata) throws Exception {
        String metadata = exact
                ? "{\"id\":\"" + id + "\",\"source\":\"jpl\",\"datasetVersion\":\"fixture\",\"datasetSha256\":\"" + CATALOG + "\",\"kernelSha256\":\"" + repeat('c') + "\",\"model\":\"spk-original\",\"centerId\":\"naif:0\",\"validityStartEt\":0,\"validityEndEt\":0,\"validityPresent\":false,\"stateEvidence\":\"fixture-kernel\",\"evidenceWindowStartEt\":0,\"evidenceWindowEndEt\":0,\"evidenceWindowPresent\":false,\"missingReason\":\"\",\"identityStatus\":\"\",\"sourceRecord\":false}\n"
                : "{\"id\":\"" + id + "\",\"missingReason\":\"approximate-state-not-allowed\"}\n";
        byte[] metadataBytes = (metadata + extraMetadata).getBytes(StandardCharsets.UTF_8);
        int bitmapLength = 1;
        int metadataOffset = StateTileDecoder.HEADER_BYTES;
        int exactOffset = metadataOffset + metadataBytes.length;
        int approximateOffset = exactOffset + bitmapLength;
        int missingOffset = approximateOffset + bitmapLength;
        int statesOffset = (missingOffset + bitmapLength + 7) & ~7;
        byte[] raw = new byte[statesOffset + 48];
        System.arraycopy(metadataBytes, 0, raw, metadataOffset, metadataBytes.length);
        if (exact) raw[exactOffset] = 1;
        if (approximate) raw[approximateOffset] = 1;
        if (!exact && !approximate) raw[missingOffset] = 1;
        ByteBuffer header = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
        header.put(new byte[]{'S', 'L', 'R', 'T', 'I', 'L', 'E', 0});
        header.putShort(8, (short) 1); header.putShort(10, (short) 200);
        header.putInt(12, 0); header.putInt(16, 1); header.putInt(20, 0); header.putInt(24, 1);
        header.putShort(28, (short) 6); header.putShort(30, (short) 3); header.putDouble(32, 2461287.5);
        header.putInt(40, metadataOffset); header.putInt(44, metadataBytes.length); header.putInt(48, exactOffset); header.putInt(52, bitmapLength);
        header.putInt(56, approximateOffset); header.putInt(60, missingOffset); header.putInt(64, statesOffset); header.putInt(68, 48);
        putHex(header, 72, PLAN); putHex(header, 104, CATALOG);
        for (int i = 0; i < 6; i++) header.putDouble(statesOffset + i * 8, exact ? value + i : 0);
        String hash = StateTileDecoder.payloadHash(rawWithoutHash(raw));
        putHex(header, 168, hash);
        return raw;
    }

    private static byte[] rawWithoutHash(byte[] raw) throws Exception {
        byte[] payload = Arrays.copyOfRange(raw, StateTileDecoder.HEADER_BYTES, raw.length);
        return concat(new byte[StateTileDecoder.HEADER_BYTES], payload);
    }

    private static byte[] concat(byte[] first, byte[] second) { byte[] out = new byte[first.length + second.length]; System.arraycopy(first, 0, out, 0, first.length); System.arraycopy(second, 0, out, first.length, second.length); return out; }
    private static void putHex(ByteBuffer buffer, int offset, String value) { for (int i = 0; i < 32; i++) buffer.put(offset + i, (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16)); }
    private static int littleInt(byte[] value, int offset) { return (value[offset] & 255) | ((value[offset + 1] & 255) << 8) | ((value[offset + 2] & 255) << 16) | ((value[offset + 3] & 255) << 24); }
    private static void expectProtocol(byte[] raw, String message) throws Exception { try { StateTileDecoder.decode(raw, PLAN, CATALOG, null, 0, 1); throw new AssertionError("expected protocol error: " + message); } catch (StateTileDecoder.ProtocolException expected) { } }
    private static String repeat(char value) { char[] values = new char[64]; Arrays.fill(values, value); return new String(values); }
    private static void delete(File file) { if (!file.isDirectory()) { file.delete(); return; } File[] children = file.listFiles(); if (children != null) for (File child : children) delete(child); file.delete(); }
}
