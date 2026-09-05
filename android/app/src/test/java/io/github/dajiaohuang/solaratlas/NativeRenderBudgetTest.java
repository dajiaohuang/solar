package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.*;
import org.junit.Test;

public class NativeRenderBudgetTest {
    private static NativeRenderBudget.Window window(double p95, double missed) {
        return new NativeRenderBudget.Window(60, 16, p95, missed);
    }

    @Test public void modesHaveIndependentCandidateLimits() {
        NativeRenderBudget spatial = new NativeRenderBudget(true), planar = new NativeRenderBudget(false);
        assertEquals(100_000, spatial.limit()); assertEquals(250_000, spatial.maximum);
        assertEquals(250_000, planar.limit()); assertEquals(500_000, planar.maximum);
        assertTrue(spatial.sample(window(40, 0.3), 100_000, 1));
        assertEquals(75_000, spatial.limit()); assertEquals(250_000, planar.limit());
    }

    @Test public void growsSlowlyOnlyWhenAvailableStatesExerciseTheCurrentBudget() {
        NativeRenderBudget budget = new NativeRenderBudget(true);
        for (int i = 0; i < 100; i++) assertFalse(budget.sample(window(16.7, 0), 3, i));
        for (int i = 0; i < 3; i++) assertFalse(budget.sample(window(16.7, 0), 100_000, i));
        assertTrue(budget.sample(window(16.7, 0), 100_000, 4));
        assertEquals(115_000, budget.limit());
        for (int i = 0; i < 10; i++) assertFalse(budget.sample(window(40, 0.3), 200_000, 5 + i));
        assertTrue(budget.sample(window(40, 0.3), 200_000, 5_000_000_005L));
        assertEquals(85_000, budget.limit());
    }

    @Test public void twoSlowWindowsReduceAndMixedOrResetEvidenceCannotAccumulate() {
        NativeRenderBudget budget = new NativeRenderBudget(true);
        assertFalse(budget.sample(window(22, 0.1), 200_000, 1));
        budget.resetEvidence();
        assertFalse(budget.sample(window(22, 0.1), 200_000, 2));
        assertFalse(budget.sample(window(18, 0), 200_000, 3));
        assertFalse(budget.sample(window(22, 0.1), 200_000, 4));
        assertTrue(budget.sample(window(22, 0.1), 200_000, 5));
        assertEquals(75_000, budget.limit());
    }

    @Test public void pressureBypassesCooldownAndRecoveryRequiresFreshEvidence() {
        NativeRenderBudget budget = new NativeRenderBudget(false);
        assertTrue(budget.sample(window(40, 0.3), 500_000, 1));
        assertTrue(budget.thermal(3, 2)); assertEquals(25_000, budget.limit());
        for (int i = 0; i < 10; i++) assertFalse(budget.sample(window(16, 0), 500_000, 10_000_000_000L + i));
        assertFalse(budget.thermal(0, 20_000_000_000L));
        for (int i = 0; i < 3; i++) assertFalse(budget.sample(window(16, 0), 500_000, 20_000_000_001L + i));
        assertTrue(budget.sample(window(16, 0), 500_000, 20_000_000_004L));
        assertEquals(30_000, budget.limit());
        assertTrue(budget.memoryPressure(20_000_000_005L)); assertEquals(25_000, budget.limit());
    }

    @Test public void repeatedMemoryWarningsAtMinimumResetGrowthEvidenceAndCooldown() {
        NativeRenderBudget budget = new NativeRenderBudget(true);
        assertTrue(budget.memoryPressure(1));
        for (int i = 0; i < 3; i++) assertFalse(budget.sample(window(16, 0), 100_000, 6_000_000_000L + i));
        assertFalse(budget.memoryPressure(7_000_000_000L));
        assertEquals(NativeRenderBudget.Reason.MEMORY, budget.reason());
        assertFalse(budget.sample(window(16, 0), 100_000, 11_999_999_999L));
        for (int i = 0; i < 3; i++) assertFalse(budget.sample(window(16, 0), 100_000, 12_000_000_000L + i));
        assertEquals(25_000, budget.limit());
        assertTrue(budget.sample(window(16, 0), 100_000, 12_000_000_003L));
        assertEquals(30_000, budget.limit());
    }

    @Test public void repeatedWindowsNeverEscapeModeBoundsOrAcceptInvalidMetrics() {
        NativeRenderBudget budget = new NativeRenderBudget(true);
        long now = 1;
        for (int i = 0; i < 500; i++) { now += 6_000_000_000L; budget.sample(window(16, 0), 1_000_000, now); }
        assertEquals(250_000, budget.limit());
        assertTrue(budget.thermal(2, ++now)); assertEquals(100_000, budget.limit());
        for (int i = 0; i < 20; i++) { now += 6_000_000_000L; assertFalse(budget.sample(window(16, 0), 1_000_000, now)); }
        budget.thermal(0, ++now);
        for (int i = 0; i < 50; i++) { now += 6_000_000_000L; budget.sample(window(60, 0.5), 1_000_000, now); }
        assertEquals(25_000, budget.limit());
        for (NativeRenderBudget.Window bad : new NativeRenderBudget.Window[]{null, window(Double.NaN, 0), window(16, -1), window(16, Double.POSITIVE_INFINITY), new NativeRenderBudget.Window(1, 16, 16, 0)}) {
            assertFalse(budget.sample(bad, 1_000_000, now + 10_000_000_000L));
        }
    }

    @Test public void samplerIgnoresIdleAndWarmupAndMeasuresMissedSlots() {
        NativeRenderBudget.Sampler sampler = new NativeRenderBudget.Sampler();
        for (int i = 0; i < 100; i++) assertNull(sampler.frame(1_000_000_000L * (i + 1), false));
        long now = 101_000_000_000L;
        assertNull(sampler.frame(now, true));
        assertNull(sampler.frame(now += 1_000_000_000L, true));
        assertNull(sampler.frame(now += 1_000_000_000L, true));
        NativeRenderBudget.Window result = null;
        for (int i = 0; i < 30; i++) result = sampler.frame(now += 34_000_000L, true);
        assertNotNull(result); assertEquals(30, result.samples);
        assertEquals(34, result.p50Ms, 0); assertEquals(34, result.p95Ms, 0);
        assertEquals(0.5, result.droppedRatio, 0);
        assertNull(sampler.frame(now + 10_000_000_000L, false));
        assertNull(sampler.frame(now + 20_000_000_000L, true));
        sampler.reset(); assertNull(sampler.frame(now - 1, true));
    }
}
