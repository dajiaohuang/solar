package io.github.dajiaohuang.solaratlas;

import java.util.Arrays;

/** Display-only policy. Never changes the verified source frame or exact counts.
 * Candidate limits are not physical-device smoothness guarantees. */
final class NativeRenderBudget {
    static final int MINIMUM = 25_000;
    private static final long COOLDOWN_NS = 5_000_000_000L;
    final int initial, maximum;
    private int limit, slow, fast, thermal;
    private long lastAdjustment = Long.MIN_VALUE;
    enum Reason { INITIAL, SLOW, HEADROOM, THERMAL, MODERATE_THERMAL, MEMORY }
    private Reason reason = Reason.INITIAL;

    NativeRenderBudget(boolean mode3d) {
        initial = mode3d ? 100_000 : 250_000;
        maximum = mode3d ? 250_000 : 500_000;
        limit = initial;
    }

    int limit() { return limit; }
    Reason reason() { return reason; }
    void resetEvidence() { slow = 0; fast = 0; }
    boolean memoryPressure(long now) {
        boolean changed = limit != MINIMUM;
        limit = MINIMUM; lastAdjustment = now; reason = Reason.MEMORY;
        resetEvidence();
        return changed;
    }

    boolean thermal(int status, long now) {
        thermal = status;
        resetEvidence();
        if (status >= 3) return change(MINIMUM, now, Reason.THERMAL);
        if (status >= 2) return change(Math.min(limit, initial), now, Reason.MODERATE_THERMAL);
        // Recovery never restores an unmeasured high limit immediately.
        return false;
    }

    boolean sample(Window window, int available, long now) {
        if (window == null || available <= 0 || window.samples < 12 ||
                !Double.isFinite(window.p50Ms) || !Double.isFinite(window.p95Ms) ||
                !Double.isFinite(window.droppedRatio) || window.p50Ms <= 0 ||
                window.p95Ms < window.p50Ms || window.droppedRatio < 0 || window.droppedRatio > 1) {
            resetEvidence(); return false;
        }
        if (thermal >= 3) return change(MINIMUM, now, Reason.THERMAL);
        if (lastAdjustment != Long.MIN_VALUE && (now < lastAdjustment || now - lastAdjustment < COOLDOWN_NS)) return false;
        boolean pressured = window.p95Ms > 18.5 || window.droppedRatio > 0.05;
        boolean healthy = thermal < 2 && available >= limit && window.p95Ms <= 16.7 && window.droppedRatio < 0.02;
        slow = pressured ? slow + 1 : 0;
        fast = healthy ? fast + 1 : 0;
        if (slow >= 2 || window.p95Ms > 33.3 || window.droppedRatio > 0.2) {
            return change(Math.max(MINIMUM, (limit * 3 / 4 / 5000) * 5000), now, Reason.SLOW);
        }
        if (fast >= 4) {
            return change(Math.min(maximum, ((limit + limit / 8 + 4999) / 5000) * 5000), now, Reason.HEADROOM);
        }
        return false;
    }

    private boolean change(int value, long now, Reason why) {
        if (value == limit) return false;
        limit = value; lastAdjustment = now; reason = why; resetEvidence(); return true;
    }

    static final class Window {
        final int samples;
        final double p50Ms, p95Ms, droppedRatio;
        Window(int samples, double p50Ms, double p95Ms, double droppedRatio) {
            this.samples = samples; this.p50Ms = p50Ms; this.p95Ms = p95Ms; this.droppedRatio = droppedRatio;
        }
    }

    /** GL callback intervals while continuously drawing an active gesture,
     * not GPU timer queries or compositor-presented-frame measurements. */
    static final class Sampler {
        private final double[] intervals = new double[120];
        private int count, warmup;
        private long previous;
        private double elapsed;

        void reset() { count = 0; warmup = 0; previous = 0; elapsed = 0; }

        Window frame(long now, boolean active) {
            if (!active || now <= previous || now <= 0) { reset(); return null; }
            if (previous == 0) { previous = now; return null; }
            double milliseconds = (now - previous) / 1_000_000.0;
            previous = now;
            if (warmup++ < 2) return null;
            intervals[count++] = milliseconds; elapsed += milliseconds;
            if (count < intervals.length && (count < 12 || elapsed < 1000)) return null;
            double[] sorted = Arrays.copyOf(intervals, count);
            Arrays.sort(sorted);
            double dropped = 0;
            for (double interval : sorted) dropped += Math.max(0, Math.round(interval / (1000.0 / 60)) - 1);
            Window result = new Window(count, sorted[(count - 1) / 2], sorted[(int) Math.ceil(count * 0.95) - 1], dropped / (count + dropped));
            count = 0; elapsed = 0;
            return result;
        }
    }
}
