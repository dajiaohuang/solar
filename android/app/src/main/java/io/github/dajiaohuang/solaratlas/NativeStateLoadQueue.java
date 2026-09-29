package io.github.dajiaohuang.solaratlas;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** One allocation-heavy state load, with at most one latest pending replacement. */
final class NativeStateLoadQueue implements AutoCloseable {
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(1),action->{Thread thread=new Thread(action,"solar-state-load");thread.setDaemon(true);return thread;});
    private Future<?> latest;
    synchronized Future<?> start(Runnable action) {
        cancel();
        latest=executor.submit(action);
        return latest;
    }
    synchronized void cancel() {
        if(latest!=null)latest.cancel(true);
        executor.getQueue().clear();
        latest=null;
        // A cancelled running action still owns the executor thread until its
        // finally blocks complete. Replacement cannot begin allocating early.
    }
    @Override public synchronized void close(){cancel();executor.shutdownNow();}
}
