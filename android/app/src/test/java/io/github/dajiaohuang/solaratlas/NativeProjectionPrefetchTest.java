package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.Test;

/** Pure lifecycle checks for the single cancellable projection prefetch. */
public final class NativeProjectionPrefetchTest {
    @Test public void cancellationInterruptsTheOwnedWorker() throws Exception {
        NativeProjectionPrefetch prefetch = new NativeProjectionPrefetch();
        CountDownLatch started = new CountDownLatch(1);
        AtomicBoolean interrupted = new AtomicBoolean();
        Thread worker = prefetch.start(() -> {
            started.countDown();
            try { Thread.sleep(TimeUnit.MINUTES.toMillis(1)); }
            catch (InterruptedException expected) { interrupted.set(true); }
        }, "projection-prefetch-test");
        assertTrue(started.await(2, TimeUnit.SECONDS));
        prefetch.cancel();
        worker.join(2_000);
        assertTrue("prefetch worker did not observe cancellation", interrupted.get());
    }

    @Test public void replacingAWorkerCancelsThePreviousOne() throws Exception {
        NativeProjectionPrefetch prefetch = new NativeProjectionPrefetch();
        CountDownLatch started = new CountDownLatch(1);
        AtomicBoolean interrupted = new AtomicBoolean();
        Thread first = prefetch.start(() -> {
            started.countDown();
            try { Thread.sleep(TimeUnit.MINUTES.toMillis(1)); }
            catch (InterruptedException expected) { interrupted.set(true); }
        }, "projection-prefetch-first");
        assertTrue(started.await(2, TimeUnit.SECONDS));
        Thread second = prefetch.start(() -> { }, "projection-prefetch-second");
        first.join(2_000); second.join(2_000);
        assertTrue("replaced prefetch worker remained alive", !first.isAlive());
        assertTrue(interrupted.get());
    }

    @Test public void replacementWaitsBeforeRunningAllocationWork() throws Exception {
        NativeProjectionPrefetch prefetch = new NativeProjectionPrefetch();
        CountDownLatch firstStarted = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        CountDownLatch secondStarted = new CountDownLatch(1);
        prefetch.start(() -> {
            firstStarted.countDown();
            try { releaseFirst.await(2, TimeUnit.SECONDS); }
            catch (InterruptedException expected) {
                try { releaseFirst.await(2, TimeUnit.SECONDS); }
                catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            }
        }, "projection-prefetch-held");
        assertTrue(firstStarted.await(2, TimeUnit.SECONDS));
        Thread second = prefetch.start(secondStarted::countDown, "projection-prefetch-replacement");
        assertTrue("replacement started before the old worker exited", !secondStarted.await(100, TimeUnit.MILLISECONDS));
        releaseFirst.countDown();
        assertTrue(secondStarted.await(2, TimeUnit.SECONDS));
        second.join(2_000);
    }

    @Test public void closingPreventsNewPrefetchWork() {
        NativeProjectionPrefetch prefetch = new NativeProjectionPrefetch();
        prefetch.close();
        assertThrows(IllegalStateException.class, () -> prefetch.start(() -> { }, "closed"));
    }
}
