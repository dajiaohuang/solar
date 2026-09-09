package io.github.dajiaohuang.solaratlas;

/**
 * Owns the single background projection preparation task.  Projection
 * preparation is a display-only prefetch of the verified frame; it may never
 * outlive the mode or activity that requested it.
 */
final class NativeProjectionPrefetch implements AutoCloseable {
    private Thread worker;
    private boolean closed;

    synchronized Thread start(Runnable action, String name) {
        if (closed) throw new IllegalStateException("projection prefetch is closed");
        Thread previous = worker;
        if (previous != null) previous.interrupt();
        Thread[] holder = new Thread[1];
        Thread next = new Thread(() -> {
            try {
                // A replacement may be requested while the old projection is
                // still unwinding.  Do not let both workers retain full
                // display buffers at once; the replacement waits before it
                // enters the allocation-heavy action.
                if (previous != null && previous != Thread.currentThread()) previous.join();
                if (Thread.currentThread().isInterrupted()) return;
                action.run();
            } catch (InterruptedException expected) {
                Thread.currentThread().interrupt();
            } finally {
                synchronized (NativeProjectionPrefetch.this) {
                    if (worker == holder[0]) worker = null;
                }
            }
        }, name);
        holder[0] = next;
        worker = next;
        next.start();
        return next;
    }

    synchronized void cancel() { cancelLocked(); }

    @Override public synchronized void close() {
        closed = true;
        cancelLocked();
    }

    private void cancelLocked() {
        if (worker != null) worker.interrupt();
        worker = null;
    }
}
