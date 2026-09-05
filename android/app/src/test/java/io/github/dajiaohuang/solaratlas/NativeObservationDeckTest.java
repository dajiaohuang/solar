package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.*;

import java.lang.reflect.Constructor;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CancellationException;
import org.junit.Test;

/** Pure buffer preparation checks; these do not claim GLES/device execution. */
public class NativeObservationDeckTest {
    private static StateTileService.Frame frame(double[] states, boolean[] exact) throws Exception {
        List<StateTileDecoder.Metadata> rows = new ArrayList<>();
        for (String id : new String[]{"body", "origin"}) {
            byte[] raw = StateTileDecoderTest.tile(id, true, false, 1);
            rows.addAll(StateTileDecoder.decode(raw, repeat('a'), repeat('b'), null, 0, 1).metadata);
        }
        // Only tests bypass the service constructor; production frames still
        // originate from the fully validated manifest/plan/tile service.
        Constructor<StateTileService.Frame> constructor = StateTileService.Frame.class.getDeclaredConstructor(
                double.class, String.class, String.class, List.class, double[].class, boolean[].class);
        constructor.setAccessible(true);
        return constructor.newInstance(2461287.5, repeat('b'), null, rows, states, exact);
    }

    @Test public void preservesSmallRelativeDisplacementsAndFitsAllRotatedDepths() throws Exception {
        double[] states = {1e12 + 1, 1e12 + 1, 1e12 + 1, 0, 0, 0, 1e12, 1e12, 1e12, 0, 0, 0};
        double[] original = states.clone();
        NativeObservationDeck.PreparedPoints points = NativeObservationDeck.prepare(frame(states, new boolean[]{true, true}), "origin", true);
        assertEquals(2, points.displayedCount);
        assertTrue(points.referenceAvailable);
        for (int axis = 0; axis < 3; axis++) assertEquals(0, points.positions.get(axis), 0);
        double x = points.positions.get(3), y = points.positions.get(4), z = points.positions.get(5);
        assertEquals(0.95 / Math.sqrt(3), x, 1e-7);
        assertEquals(x, y, 0); assertEquals(y, z, 0);
        for (int pitch = -89; pitch <= 89; pitch += 7) {
            for (int yaw = 0; yaw <= 360; yaw += 7) {
                double rx = Math.toRadians(pitch), ry = Math.toRadians(yaw);
                double rotatedZ = Math.sin(rx) * y + Math.cos(rx) * (-Math.sin(ry) * x + Math.cos(ry) * z);
                assertTrue("valid point crosses clip depth", Math.abs(rotatedZ) < 1);
            }
        }
        assertArrayEquals(original, states, 0);
    }

    @Test public void planarBuffersHaveNoDepthAndMissingOriginsStayUnavailable() throws Exception {
        StateTileService.Frame frame = frame(new double[]{1, 1, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0}, new boolean[]{true, true});
        NativeObservationDeck.PreparedPoints planar = NativeObservationDeck.prepare(frame, "origin", false);
        assertFalse(planar.mode3d);
        assertEquals(0, planar.positions.get(5), 0);
        assertEquals(0.95 / Math.sqrt(2), planar.positions.get(3), 1e-7);
        frame.exact[1] = false;
        NativeObservationDeck.PreparedPoints absent = NativeObservationDeck.prepare(frame, "origin", true);
        assertFalse(absent.referenceAvailable); assertEquals(0, absent.displayedCount); assertNull(absent.positions);
    }

    @Test public void rejectsRelativeOverflowAndHonorsCancellationBeforeAllocating() throws Exception {
        StateTileService.Frame frame = frame(new double[]{Double.MAX_VALUE, 0, 0, 0, 0, 0, -Double.MAX_VALUE, 0, 0, 0, 0, 0}, new boolean[]{true, true});
        try { NativeObservationDeck.prepare(frame, "origin", true); fail("overflow accepted"); }
        catch (IllegalArgumentException expected) { assertTrue(expected.getMessage().contains("numeric range")); }
        Thread.currentThread().interrupt();
        try { NativeObservationDeck.prepare(frame, "origin", true); fail("cancelled preparation ran"); }
        catch (CancellationException expected) { assertTrue(Thread.currentThread().isInterrupted()); }
        finally { Thread.interrupted(); }
    }

    private static String repeat(char value) { char[] chars = new char[64]; java.util.Arrays.fill(chars, value); return new String(chars); }
}
