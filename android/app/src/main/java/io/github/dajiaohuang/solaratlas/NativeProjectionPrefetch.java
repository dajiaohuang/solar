package io.github.dajiaohuang.solaratlas;

/**
 * Owns the single background projection preparation task.  Projection
 * preparation is a display-only prefetch of the verified frame. Mode/activity
 * cancellation interrupts work; successors wait for its cooperative cleanup.
 */
final class NativeProjectionPrefetch implements AutoCloseable {
    private Thread worker;
    // Separate allocation ownership from the latest requested thread. Cancelling
    // a waiter must not erase the still-running predecessor's drain barrier.
    private Thread active;
    private boolean closed;

    synchronized Thread start(Runnable action, String name) {
        if (closed) throw new IllegalStateException("projection prefetch is closed");
        cancelLocked();
        Thread[] holder = new Thread[1];
        Thread next = new Thread(() -> {
            try {
                synchronized (NativeProjectionPrefetch.this) {
                    while (active != null) NativeProjectionPrefetch.this.wait();
                    if (closed || worker != holder[0] || Thread.currentThread().isInterrupted()) return;
                    active = holder[0];
                }
                action.run();
            } catch (InterruptedException expected) {
                Thread.currentThread().interrupt();
            } finally {
                synchronized (NativeProjectionPrefetch.this) {
                    if (active == holder[0]) {
                        active = null;
                        NativeProjectionPrefetch.this.notifyAll();
                    }
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
        if (active != null) active.interrupt();
        if (worker != null && worker != active) worker.interrupt();
        worker = null;
        // active is released only by that thread's finally block. A new start
        // therefore cannot overlap it, even after a separate cancel() call.
    }
}
