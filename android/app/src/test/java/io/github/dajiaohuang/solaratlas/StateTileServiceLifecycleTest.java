package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.assertThrows;

import java.io.File;
import java.nio.file.Files;
import java.util.List;

import org.junit.Test;

/** Verifies that the native load owner has an explicit cancellation boundary. */
public class StateTileServiceLifecycleTest {
    @Test
    public void closePreventsAStaleWorkerFromStartingAnotherRequest() throws Exception {
        File directory = Files.createTempDirectory("solar-state-lifecycle").toFile();
        try {
            StateTileService service = new StateTileService("https://example.invalid", directory);
            service.close();
            assertThrows(StateTileDecoder.ProtocolException.class,
                    () -> service.load(List.of("naif:10"), 2461287.5));
        } finally {
            delete(directory);
        }
    }

    @Test
    public void cancellationIsCheckedBeforeOpeningTheTileEndpoint() {
        StateTileClient.Cancellation cancelled = new StateTileClient.Cancellation() {
            @Override public void check() throws java.io.IOException { throw new java.io.IOException("cancelled"); }
            @Override public void register(java.net.HttpURLConnection connection) { }
            @Override public void unregister(java.net.HttpURLConnection connection) { }
        };
        assertThrows(java.io.IOException.class, () -> StateTileClient.fetchTile(
                "https://example.invalid", "a".repeat(64), 0, 1,
                "b".repeat(64), null, null, null, cancelled));
    }

    private static void delete(File path) {
        File[] children = path.listFiles();
        if (children != null) for (File child : children) delete(child);
        if (!path.delete()) path.deleteOnExit();
    }
}
