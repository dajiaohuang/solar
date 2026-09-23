package io.github.dajiaohuang.solaratlas;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import static org.junit.Assert.*;

public final class GroundContactsTest {
    private static GroundContactsReport.Request request() throws IOException { return new GroundContactsReport.Request("2024-04-08T17:00:00Z", "2024-04-08T21:00:00Z", -96.797, 32.7767, 130, 301, 10); }
    private static byte[] fixture() throws IOException {
        Path root = Paths.get("").toAbsolutePath();
        while (root != null) { Path file = root.resolve("tests/fixtures/ground-contacts-api-dallas.json"); if (Files.exists(file)) return Files.readAllBytes(file); root = root.getParent(); }
        throw new IOException("Real HTTP ground-contact fixture missing");
    }
    @Test public void originalHTTPResponseRetainsContactsAndSources() throws Exception {
        byte[] bytes = fixture(); GroundContactsReport r = GroundContactsReport.decode(bytes, request());
        assertEquals(4, r.contacts.size()); assertEquals(521, r.evaluations); assertEquals("2024-04-08T17:23:20.434570Z", r.contacts.get(0).utc);
        assertArrayEquals(bytes, r.exportBytes()); byte[] exported = r.exportBytes(); exported[0] = 0; assertArrayEquals(bytes, r.exportBytes());
        assertEquals("none", r.startGeometry); assertEquals("none", r.endGeometry);
        assertTrue(r.hasOverlapWindows); assertEquals(2, r.overlapWindows.size());
        assertEquals(9559.248046875, r.overlapWindows.get(0).duration, 0);
        assertEquals(236.07421875, r.overlapWindows.get(1).duration, 0);
    }
    @Test public void sourceContractAndRequestSubstitutionAreRejected() throws Exception {
        String raw = new String(fixture(), StandardCharsets.UTF_8);
        for (String[] edit : new String[][]{{"\"possibleMissedEvents\":true", "\"possibleMissedEvents\":false"}, {"\"latitudeDeg\":32.7767", "\"latitudeDeg\":0"}, {"\"toleranceSeconds\":0.05", "\"toleranceSeconds\":1"}, {"\"physicalTimingUncertaintySeconds\":null", "\"physicalTimingUncertaintySeconds\":0"}, {"3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1", "bdff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1"}, {"\"bodyId\":\"naif:399\"", "\"bodyId\":\"naif:10\""}, {"\"elapsedTaiSeconds\":1400.4345703125", "\"elapsedTaiSeconds\":-1"}}) {
            assertTrue("mutation must apply", raw.contains(edit[0]));
            try { GroundContactsReport.decode(raw.replace(edit[0], edit[1]).getBytes(StandardCharsets.UTF_8), request()); fail("accepted "+edit[0]); } catch (IOException expected) { }
        }
    }
    @Test public void explicitInputAndHttpsRequired() throws Exception {
        for (String url : new String[]{"http://example.com", "https://user@example.com", "https://example.com?key=x", "https://example.com#x"}) {
            try { new GroundContactsService(url); fail(url); } catch (IOException expected) { }
        }
        try { new GroundContactsReport.Request("2024-04-08", "2024-04-09", 0,0,0,301,10); fail(); } catch (IOException expected) { }
        try { new GroundContactsReport.Request(request().startUTC, request().endUTC, Double.NaN,0,0,301,10); fail(); } catch (IOException expected) { }
        try { new GroundContactsReport.Request(request().startUTC, request().endUTC, 0,0,0,301,301); fail(); } catch (IOException expected) { }
        assertNotNull(StateTileDecoder.parseJson(request().bytes()));
    }
    @Test public void overlapBoundsAndMatchingEdgesAreRequired() throws Exception {
        String raw = new String(fixture(), StandardCharsets.UTF_8);
        for (String[] edit : new String[][]{{"\"durationSeconds\":9559.248046875", "\"durationSeconds\":9558"}, {"9559.21875", "9550"}, {"\"kind\":\"bracketed-contact\"", "\"kind\":\"search-boundary\""}, {"\"kind\":\"bracketed-contact\"", "\"kind\":\"sampled-zero\""}}) {
            assertTrue(raw.contains(edit[0]));
            try { GroundContactsReport.decode(raw.replace(edit[0], edit[1]).getBytes(StandardCharsets.UTF_8), request()); fail("accepted "+edit[0]); } catch (IOException expected) { }
        }
        String legacy = raw.replaceFirst(",\"sampledOverlapWindows\":\\[.*?\\],\"evaluations\"", ",\"evaluations\"");
        assertNotEquals(raw, legacy);
        GroundContactsReport older = GroundContactsReport.decode(legacy.getBytes(StandardCharsets.UTF_8), request());
        assertFalse(older.hasOverlapWindows); assertTrue(older.overlapWindows.isEmpty()); assertEquals(4, older.contacts.size());
    }
    @Test public void boundedReadRejectsTruncationExtraBytesAndLateCancellation() throws Exception {
        byte[] bytes = fixture(); GroundContactsService service = new GroundContactsService("https://example.com");
        assertArrayEquals(bytes, service.readBody(new ByteArrayInputStream(bytes), bytes.length));
        for (int expected : new int[]{bytes.length-1, bytes.length+1, GroundContactsReport.MAX_BYTES+1}) {
            try { service.readBody(new ByteArrayInputStream(bytes), expected); fail(); } catch (IOException correct) { }
        }
        ByteArrayInputStream late = new ByteArrayInputStream(bytes) {
            @Override public synchronized int read(byte[] b, int off, int len) { int n = super.read(b,off,len); service.close(); return n; }
        };
        try { service.readBody(late, bytes.length); fail(); } catch (IOException expected) { assertTrue(expected.getMessage().contains("cancelled")); }
        try { service.load(request()); fail(); } catch (IOException expected) { assertTrue(expected.getMessage().contains("cancelled")); }
    }
}
