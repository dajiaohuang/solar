package io.github.dajiaohuang.solaratlas;

import android.content.ContentResolver;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** Process-wide bounded writer for snapshots explicitly selected for export. */
final class NativeReportExport {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ThreadPoolExecutor WRITER = new ThreadPoolExecutor(1, 1, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(2), action -> {
                Thread thread = new Thread(action, "solar-report-export");
                thread.setDaemon(true); return thread;
            });
    static { WRITER.allowCoreThreadTimeOut(true); }

    // Ownership of this fresh snapshot transfers on admission. A rejected job
    // never opens/truncates its destination. Accepted writes are not superseded.
    static boolean submit(ContentResolver resolver, Uri destination, byte[] snapshot, Consumer<Boolean> completion) {
        if (snapshot == null || snapshot.length == 0 || snapshot.length > 8 * 1024 * 1024) return false;
        try {
            WRITER.execute(() -> {
                boolean saved = false;
                try (OutputStream output = resolver.openOutputStream(destination, "wt")) {
                    if (output == null) throw new IOException("Export destination unavailable");
                    for (int offset = 0; offset < snapshot.length; offset += 65536) {
                        output.write(snapshot, offset, Math.min(65536, snapshot.length - offset));
                    }
                    output.flush(); saved = true;
                } catch (IOException | RuntimeException error) { saved = false; }
                final boolean success = saved;
                // The completion notification does not retain the byte payload.
                MAIN.post(() -> completion.accept(success));
            });
            return true;
        } catch (RejectedExecutionException full) { return false; }
    }
}
