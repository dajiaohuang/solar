package io.github.dajiaohuang.solaratlas;

import android.os.Handler;
import android.os.Looper;

/** Owns one pending result; the Looper notification never captures its payload. */
final class NativeUiResultSlot implements AutoCloseable {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable notification = this::deliver;
    private Runnable pending;
    private long generation;
    private boolean queued,closed;

    // Owners call reset/close on the UI thread, serialized with delivery.
    synchronized long reset() { generation++;pending=null;return generation; }
    synchronized void offer(long token,Runnable result) {
        if(closed || token!=generation)return;
        pending=result;
        if(!queued){queued=true;if(!main.post(notification)){queued=false;pending=null;}}
    }
    private void deliver() {
        Runnable result;
        synchronized(this){queued=false;result=closed?null:pending;pending=null;}
        if(result!=null)result.run();
    }
    @Override public synchronized void close(){closed=true;generation++;pending=null;main.removeCallbacks(notification);queued=false;}
}
