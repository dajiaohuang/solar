package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertThrows;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Collections;

import org.junit.Test;

public class StateAccumulatorTest {
    private static final String PLAN = "a".repeat(64);
    private static final String CATALOG = "b".repeat(64);

    private static StateTileDecoder.DecodedTile tile(String id, boolean exact, double value) throws Exception {
        return StateTileDecoder.decode(StateTileDecoderTest.tile(id, exact, false, value), PLAN, CATALOG, null, 0, 1);
    }

    @Test
    public void assemblesExactAndMissingRowsInRequestOrderWithoutFinalNumericCopy() throws Exception {
        StateTileService.StateAccumulator accumulator = new StateTileService.StateAccumulator(3, 64 * 1024);
        List<String> ids = List.of("naif:399", "unknown", "naif:301");
        assertEquals(1, accumulator.append(tile(ids.get(0), true, 12.5), ids, 0));
        assertEquals(0, accumulator.append(tile(ids.get(1), false, 0), ids, 1));
        assertEquals(1, accumulator.append(tile(ids.get(2), true, -42), ids, 2));
        Field storage = StateTileService.StateAccumulator.class.getDeclaredField("states");
        storage.setAccessible(true);
        Object originalArray = storage.get(accumulator);
        StateTileService.Frame frame = accumulator.finish(2461287.5, CATALOG, null);
        assertSame(originalArray, frame.states);
        assertArrayEquals(new double[]{12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 0, 0, 0, 0, 0, 0, -42, -41, -40, -39, -38, -37}, frame.states, 0);
        assertArrayEquals(new boolean[]{true, false, true}, frame.exact);
        for (int row = 0; row < ids.size(); row++) assertEquals(ids.get(row), frame.metadata.get(row).id);
        assertEquals("approximate-state-not-allowed", frame.metadata.get(1).missingReason);
        assertThrows(StateTileDecoder.ProtocolException.class, () -> accumulator.finish(2461287.5, CATALOG, null));
        assertThrows(StateTileDecoder.ProtocolException.class, () -> accumulator.append(tile(ids.get(0), true, 0), ids, 0));
    }

    @Test
    public void preservesEveryFloat64BitAndOwnsItsCopyOfTheDecodedTile() throws Exception {
        StateTileService.StateAccumulator accumulator = new StateTileService.StateAccumulator(1, 64 * 1024);
        StateTileDecoder.DecodedTile decoded = tile("naif:399", true, 1);
        long[] bits = {0x8000000000000000L, 1L, 0x0010000000000000L, 0x7fefffffffffffffL, 0x3ff0000000000001L, 0xbff0000000000001L};
        for (int i = 0; i < bits.length; i++) decoded.states[i] = Double.longBitsToDouble(bits[i]);
        accumulator.append(decoded, List.of("naif:399"), 0);
        decoded.states[0] = 99;
        StateTileService.Frame frame = accumulator.finish(2461287.5, CATALOG, null);
        for (int i = 0; i < bits.length; i++) assertEquals(bits[i], Double.doubleToRawLongBits(frame.states[i]));
    }

    @Test
    public void keepsGlobalOffsetsAcrossMultiplePlanSizedGroups() throws Exception {
        // Repeating one decoded fixture stresses assembly offsets, not unique coverage.
        int rows = StateTileDecoder.MAX_ROWS * 2 + 2;
        StateTileService.StateAccumulator accumulator = new StateTileService.StateAccumulator(rows, 128L * 1024 * 1024);
        StateTileDecoder.DecodedTile decoded = tile("naif:399", true, 17);
        List<String> ids = Collections.nCopies(rows, "naif:399");
        for (int start = 0; start < rows; start += StateTileDecoder.MAX_ROWS) {
            int count = Math.min(StateTileDecoder.MAX_ROWS, rows - start);
            for (int ordinal = 0; ordinal < count; ordinal++) assertEquals(1, accumulator.append(decoded, ids, start + ordinal));
        }
        StateTileService.Frame frame = accumulator.finish(2461287.5, CATALOG, null);
        assertEquals(rows * 6, frame.states.length);
        for (int row : new int[]{0, StateTileDecoder.MAX_ROWS - 1, StateTileDecoder.MAX_ROWS, rows - 1}) {
            assertEquals(17, frame.states[row * 6], 0);
            assertEquals(22, frame.states[row * 6 + 5], 0);
            assertEquals(true, frame.exact[row]);
        }
    }

    @Test
    public void validatesCapacityAndReservesPrimitiveMemoryBeforeAllocation() {
        for (int rows : new int[]{0, -1, 2_000_001, Integer.MAX_VALUE}) {
            assertThrows(StateTileDecoder.ProtocolException.class, () -> new StateTileService.StateAccumulator(rows, Long.MAX_VALUE));
        }
        // 2M rows reserve 130,000,096 bytes before any primitive allocation.
        assertThrows(StateTileDecoder.ProtocolException.class, () -> new StateTileService.StateAccumulator(2_000_000, 130_000_095L));
        assertThrows(StateTileDecoder.ProtocolException.class, () -> new StateTileService.StateAccumulator(1, -1));
    }

    @Test
    public void rejectsWrongIdsOrderingOverflowIncompleteAndMetadataBudget() throws Exception {
        StateTileService.StateAccumulator accumulator = new StateTileService.StateAccumulator(1, 64 * 1024);
        StateTileDecoder.DecodedTile decoded = tile("naif:399", true, 1);
        assertThrows(StateTileDecoder.ProtocolException.class, () -> accumulator.append(decoded, List.of("naif:301"), 0));
        assertThrows(StateTileDecoder.ProtocolException.class, () -> accumulator.append(decoded, List.of("naif:399"), 1));
        assertThrows(StateTileDecoder.ProtocolException.class, () -> accumulator.append(decoded, List.of("naif:399", "naif:301"), 0));
        assertThrows(StateTileDecoder.ProtocolException.class, () -> accumulator.finish(2461287.5, CATALOG, null));
        StateTileService.StateAccumulator tight = new StateTileService.StateAccumulator(1, 161);
        assertThrows(StateTileDecoder.ProtocolException.class, () -> tight.append(decoded, List.of("naif:399"), 0));
        accumulator.append(decoded, List.of("naif:399"), 0);
        assertThrows(StateTileDecoder.ProtocolException.class, () -> accumulator.append(decoded, List.of("naif:399"), 1));
    }

    @Test
    public void cancellationPreventsAllocationAppendAndPublication() throws Exception {
        StateTileService.StateAccumulator accumulator = new StateTileService.StateAccumulator(1, 64 * 1024);
        StateTileDecoder.DecodedTile decoded = tile("naif:399", true, 1);
        try {
            Thread.currentThread().interrupt();
            assertThrows(StateTileDecoder.ProtocolException.class, () -> new StateTileService.StateAccumulator(1, 64 * 1024));
            assertThrows(StateTileDecoder.ProtocolException.class, () -> accumulator.append(decoded, List.of("naif:399"), 0));
        } finally { Thread.interrupted(); }
        accumulator.append(decoded, List.of("naif:399"), 0);
        try {
            Thread.currentThread().interrupt();
            assertThrows(StateTileDecoder.ProtocolException.class, () -> accumulator.finish(2461287.5, CATALOG, null));
        } finally { Thread.interrupted(); }
    }
}
