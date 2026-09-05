package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.junit.Test;

public class CoverageServiceTest {
    @Test public void requiresHttpsWithoutCredentialsOrUrlState() throws Exception {
        for (String url : new String[] {"http://example.test", "https://name:password@example.test", "https://example.test?x=1", "https://example.test#fragment", "https:///"})
            assertThrows(IOException.class, () -> new CoverageService(url));
        assertThrows(CoverageService.UnavailableException.class, () -> new CoverageService(" "));
        try (CoverageService service = new CoverageService(" https://example.test/prefix/ ")) {
            assertArrayEquals(new byte[] {1, 2, 3}, service.readBody(new ByteArrayInputStream(new byte[] {1, 2, 3}), 3, 3));
        }
    }

    @Test public void boundsDeclaredAndActualBytesAndClosesInput() throws Exception {
        try (CoverageService service = new CoverageService("https://example.test")) {
            assertThrows(IOException.class, () -> service.readBody(new ByteArrayInputStream(new byte[] {1}), 0, 3));
            assertThrows(IOException.class, () -> service.readBody(new ByteArrayInputStream(new byte[] {1}), 4, 3));
            assertThrows(IOException.class, () -> service.readBody(new ByteArrayInputStream(new byte[] {1}), 2, 3));
            assertThrows(IOException.class, () -> service.readBody(new ByteArrayInputStream(new byte[] {1, 2, 3}), 2, 3));
            class TrackedInput extends ByteArrayInputStream {
                boolean closed;
                TrackedInput() { super(new byte[] {1, 2, 3}); }
                @Override public void close() { closed = true; }
            }
            TrackedInput input = new TrackedInput();
            assertThrows(IOException.class, () -> service.readBody(input, 2, 3));
            assertTrue(input.closed);
        }
    }

    @Test public void cancellationRejectsBothBeforeAndDuringReading() throws Exception {
        CoverageService service = new CoverageService("https://example.test");
        service.close();
        assertThrows(IOException.class, () -> service.readBody(new ByteArrayInputStream(new byte[] {1}), 1, 1));
        try (CoverageService active = new CoverageService("https://example.test")) {
            ByteArrayInputStream interrupted = new ByteArrayInputStream(new byte[] {1}) {
                @Override public synchronized int read(byte[] buffer, int offset, int length) {
                    active.close(); return super.read(buffer, offset, length);
                }
            };
            assertThrows(IOException.class, () -> active.readBody(interrupted, 1, 1));
        }
        try (CoverageService active = new CoverageService("https://example.test")) {
            Thread.currentThread().interrupt();
            try { assertThrows(IOException.class, () -> active.readBody(new ByteArrayInputStream(new byte[] {1}), 1, 1)); }
            finally { Thread.interrupted(); }
        }
    }
}
