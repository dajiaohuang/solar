package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class SourceIdentityPageTest {
    private static byte[] bytes(String value) { return value.getBytes(StandardCharsets.UTF_8); }
    private static final String HASH = "a".repeat(64), INVENTORY = "b".repeat(64);
    private static String manifest() { return "{\"apiVersion\":\"solar.api/v1\",\"catalogVersion\":\"test\",\"catalogManifestSha256\":\"" + HASH + "\",\"inventoryManifestSha256\":\"" + INVENTORY + "\"}"; }
    private static String row() { return "{\"id\":\"sb:comet:1P\",\"name\":\"Halley\",\"category\":\"comet\",\"source\":\"synthetic-parser-fixture\",\"sourceRow\":1,\"identityStatus\":\"source-designation\",\"ephemerisStatus\":\"unmapped\"}"; }
    private static String page() { return "{\"apiVersion\":\"solar.api/v1\",\"catalogVersion\":\"test\",\"inventoryManifestSha256\":\"" + INVENTORY + "\",\"sourceRecords\":true,\"identityAssertions\":true,\"uniqueBodySemantics\":\"not-deduplicated\",\"totalRecords\":100,\"limit\":50,\"nextPageToken\":\"next\",\"items\":[" + row() + "]}"; }
    private static SourceIdentityPage decode(String value) throws Exception { return SourceIdentityPage.decode(bytes(value), bytes(manifest()), "https://example.test", "Halley"); }

    @Test public void preservesOriginalSourceIdsAndSeparatePopulationCount() throws Exception {
        SourceIdentityPage result = decode(page()); assertEquals(100, result.totalRecords); assertEquals(1, result.rows.size());
        assertEquals("sb:comet:1P", result.rows.get(0).id); assertEquals("unmapped", result.rows.get(0).ephemerisStatus);
        assertEquals(INVENTORY, result.inventoryHash); assertEquals("Halley", result.query);
        assertThrows(UnsupportedOperationException.class, () -> result.rows.clear());
    }
    @Test public void refusesFalseIdentitySemanticsUnsafeRowsAndUnboundedPages() {
        for (String value : new String[] {page().replace("not-deduplicated", "unique-bodies"), page().replace("\"sourceRecords\":true", "\"sourceRecords\":false"),
                page().replace("\"totalRecords\":100", "\"totalRecords\":0"), page().replace("\"limit\":50", "\"limit\":51"),
                page().replace(row(), row() + "," + row()), page().replace("\"sourceRow\":1", "\"sourceRow\":1.5"),
                page().replace("sb:comet:1P", "bad\\nID"), page().replace(row(), ""),
                page().replace(row(), String.join(",", java.util.Collections.nCopies(51, row()))), page().replace(INVENTORY, HASH)}) {
            assertThrows(StateTileDecoder.ProtocolException.class, () -> decode(value));
        }
    }
    @Test public void rejectsManifestDriftBeforeCursorOrStateUse() throws Exception {
        SourceIdentityPage result = decode(page()); result.requireManifest(bytes(manifest()));
        for (String value : new String[] {manifest().replace(HASH, INVENTORY), manifest().replace(INVENTORY, HASH),
                manifest().replace("test", "new"), manifest().replace("solar.api/v1", "wrong")})
            assertThrows(StateTileDecoder.ProtocolException.class, () -> result.requireManifest(bytes(value)));
    }
    @Test public void validatesBackendQueryAndCancellationBeforeNetwork() throws Exception {
        for (String address : new String[] {"", "http://example.test", "https://user:pass@example.test", "https://example.test?x=1", "https://example.test#x"})
            assertThrows(IOException.class, () -> new SourceIdentityService(address));
        try (SourceIdentityService service = new SourceIdentityService("https://example.test")) {
            assertThrows(IOException.class, () -> service.load("different-query", decode(page())));
            assertThrows(IOException.class, () -> service.load("x".repeat(257), null));
            service.close(); assertThrows(IOException.class, () -> service.load("", null));
        }
    }
}
