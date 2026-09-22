package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import org.junit.Test;

public class StateTileTransportTest {
    @Test public void exactLengthRejectsBothTruncationAndOverflow() throws Exception {
        byte[] raw = new byte[] {1, 2, 3};
        assertArrayEquals(raw, StateTileClient.readExact(new ByteArrayInputStream(raw), 3, null));
        assertThrows(IOException.class, () -> StateTileClient.readExact(new ByteArrayInputStream(raw), 2, null));
        assertThrows(IOException.class, () -> StateTileClient.readExact(new ByteArrayInputStream(raw), 4, null));
        assertThrows(IOException.class, () -> StateTileClient.readExact(new ByteArrayInputStream(raw), 0, null));
    }

    @Test public void cancellationClosesTheStreamDuringTransfer() {
        boolean[] closed = {false};
        ByteArrayInputStream source = new ByteArrayInputStream(new byte[64 * 1024]) {
            @Override public void close() { closed[0] = true; }
        };
        StateTileClient.Cancellation cancellation = new StateTileClient.Cancellation() {
            int checks;
            @Override public void check() throws IOException { if (++checks == 3) throw new IOException("cancelled"); }
            @Override public void register(HttpURLConnection connection) { }
            @Override public void unregister(HttpURLConnection connection) { }
        };
        assertThrows(IOException.class, () -> StateTileClient.readExact(source, 64 * 1024, cancellation));
        assertEquals(48 * 1024, source.available());
        assertTrue(closed[0]);
    }

    @Test public void payloadIdentityRequiresAStrongQuotedEtag() throws Exception {
        String hash = "a".repeat(64);
        StateTileClient.requireStrongEtag("\"" + hash + "\"", hash);
        for (String invalid : new String[] {null, hash, "W/\"" + hash + "\"", "\"" + "b".repeat(64) + "\""}) {
            assertThrows(IOException.class, () -> StateTileClient.requireStrongEtag(invalid, hash));
        }
    }
}
