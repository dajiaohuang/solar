package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.assertThrows;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public final class OrbitCovarianceModelAxesTest {
    private static Map<String, Object> model(String kind, int index) {
        Map<String, Object> result = new HashMap<>();
        result.put("kind", kind);
        result.put("n", index);
        return result;
    }

    @Test public void acceptsEstimatedAxesInIndexOrderWithConsideredGaps() throws Exception {
        List<String> labels = List.of("e", "q", "tp", "node", "peri", "i", "A1", "A2");
        Map<String, Map<String, Object>> models = new HashMap<>();
        models.put("A1", model("EST", 1));
        models.put("considered", model("CON", 2));
        models.put("A2", model("EST", 3));
        models.put("fixed", model("SET", 0));
        OrbitCovarianceReport.validateModelParameterAxes(labels, models);
    }

    @Test public void rejectsCovarianceLabelsInTheWrongSourceOrder() {
        List<String> labels = List.of("e", "q", "tp", "node", "peri", "i", "A2", "A1");
        Map<String, Map<String, Object>> models = new HashMap<>();
        models.put("A1", model("EST", 1));
        models.put("A2", model("EST", 2));
        assertThrows(IOException.class, () -> OrbitCovarianceReport.validateModelParameterAxes(labels, models));
    }
}
