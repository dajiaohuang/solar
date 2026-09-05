package io.github.dajiaohuang.solaratlas;

import static org.junit.Assert.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.Assume;
import org.junit.Test;

public class CoverageReportTest {
    // Deliberately synthetic population; these tests do not add astronomy coverage.
    private static String hash(char value) { return String.valueOf(value).repeat(64); }
    private static byte[] bytes(String value) { return value.getBytes(StandardCharsets.UTF_8); }
    static String manifest() {
        return "{\"apiVersion\":\"solar.api/v1\",\"catalogVersion\":\"coverage-fixture\","
                + "\"catalogManifestSha256\":\"" + hash('b') + "\",\"inventoryManifestSha256\":\"" + hash('c') + "\"}";
    }
    static String summary() {
        return "{\"apiVersion\":\"solar.api/v1\",\"purpose\":\"source-identity-and-dependency-window-audit\","
                + "\"profile\":\"full\",\"sourceBytesVerified\":true,\"catalogVersion\":\"coverage-fixture\","
                + "\"catalogManifestSha256\":\"" + hash('b') + "\",\"inventoryManifestSha256\":\"" + hash('c') + "\","
                + "\"reportSha256\":\"" + hash('a') + "\",\"sourceSnapshotSha256\":\"" + hash('d') + "\","
                + "\"identityMappingSha256\":\"" + hash('e') + "\",\"satelliteCatalogSha256\":\"" + hash('f') + "\","
                + "\"auditEt\":500,\"timeScale\":\"TDB seconds past J2000\",\"frame\":\"ECLIPJ2000\","
                + "\"requestedWindow\":{\"startEt\":0,\"endEt\":1000,\"timeScale\":\"TDB seconds past J2000\"},"
                + "\"counts\":{\"sourceRecords\":10,\"mappedSourceRecords\":3,\"unresolvedSourceRecords\":7,"
                + "\"explicitNaifTargets\":2,\"availableTargetsAtAuditEpoch\":2},"
                + "\"windowCounts\":{\"dependencyCoveredTargets\":1,\"targetsWithDependencyGaps\":1,"
                + "\"numericallyCertifiedWholeWindowTargets\":null},"
                + "\"unresolvedReasons\":{\"no-explicit-naif-mapping\":6,\"unresolved-component\":1}}";
    }
    private static CoverageReport decode(String value) throws Exception { return CoverageReport.decode(bytes(value), bytes(manifest())); }
    private static void reject(String value) { assertThrows(StateTileDecoder.ProtocolException.class, () -> decode(value)); }

    @Test public void acceptsReconciledSourcePopulationAndPreservesIdentities() throws Exception {
        CoverageReport report = decode(summary());
        assertEquals(10, report.sourceRecords); assertEquals(3, report.mappedRecords);
        assertEquals(7, report.unresolvedRecords); assertEquals(2, report.explicitTargets);
        assertEquals(2, report.availableTargets); assertEquals(1, report.dependencyCovered); assertEquals(1, report.dependencyGaps);
        assertEquals(hash('a'), report.reportHash); assertEquals(hash('b'), report.catalogHash);
        assertEquals(hash('c'), report.inventoryHash); assertEquals(hash('d'), report.sourceHash);
        assertEquals(hash('e'), report.mappingHash); assertEquals(hash('f'), report.satelliteHash);
        assertEquals(500, report.auditEt, 0); assertEquals(0, report.windowStartEt, 0); assertEquals(1000, report.windowEndEt, 0);
        assertThrows(UnsupportedOperationException.class, () -> report.unresolvedReasons.put("fake", 1L));
    }

    @Test public void acceptsFractionalNegativeEtAndIndependentAuditEpoch() throws Exception {
        CoverageReport report = decode(summary().replace("\"auditEt\":500", "\"auditEt\":1000.125")
                .replace("\"startEt\":0", "\"startEt\":-20.5").replace("\"endEt\":1000", "\"endEt\":-10.25"));
        assertEquals(1000.125, report.auditEt, 0); assertEquals(-20.5, report.windowStartEt, 0); assertEquals(-10.25, report.windowEndEt, 0);
    }

    @Test public void acceptsEmptyOrZeroReasonsForNoUnresolvedRecords() throws Exception {
        String complete = summary().replace("\"sourceRecords\":10", "\"sourceRecords\":3")
                .replace("\"unresolvedSourceRecords\":7", "\"unresolvedSourceRecords\":0")
                .replace("\"no-explicit-naif-mapping\":6,\"unresolved-component\":1", "");
        assertTrue(decode(complete).unresolvedReasons.isEmpty());
        assertEquals(Long.valueOf(0), decode(complete.replace("\"unresolvedReasons\":{}", "\"unresolvedReasons\":{\"none\":0}")).unresolvedReasons.get("none"));
    }

    @Test public void rejectsProvenanceIdentityAndCertificationMismatches() {
        for (String[] change : new String[][] {
                {"solar.api/v1", "solar.api/v0"}, {"source-identity-and-dependency-window-audit", "live-frame"},
                {"\"profile\":\"full\"", "\"profile\":\"pages\""}, {"\"sourceBytesVerified\":true", "\"sourceBytesVerified\":false"},
                {"coverage-fixture", "different-catalog"}, {hash('c'), hash('b')}, {hash('e'), "E".repeat(64)},
                {"ECLIPJ2000", "J2000"}, {"TDB seconds past J2000", "UTC"},
                {",\"numericallyCertifiedWholeWindowTargets\":null", ""},
                {"\"numericallyCertifiedWholeWindowTargets\":null", "\"numericallyCertifiedWholeWindowTargets\":0"}
        }) reject(summary().replace(change[0], change[1]));
        for (String altered : new String[] { manifest().replace("solar.api/v1", "other"), manifest().replace("coverage-fixture", " "), manifest().replace(hash('b'), "bad") }) {
            assertThrows(StateTileDecoder.ProtocolException.class, () -> CoverageReport.decode(bytes(summary()), bytes(altered)));
        }
    }

    @Test public void rejectsInvalidCountsReasonsAndWindows() {
        for (String invalid : new String[] {"-1", "10.5", "9007199254740992", "true", "\"10\"", "null", "1e309"}) {
            reject(summary().replace("\"sourceRecords\":10", "\"sourceRecords\":" + invalid));
        }
        for (String[] change : new String[][] {
                {"\"sourceRecords\":10", "\"sourceRecords\":9"}, {"\"explicitNaifTargets\":2", "\"explicitNaifTargets\":4"},
                {"\"availableTargetsAtAuditEpoch\":2", "\"availableTargetsAtAuditEpoch\":3"},
                {"\"dependencyCoveredTargets\":1", "\"dependencyCoveredTargets\":3"},
                {"\"targetsWithDependencyGaps\":1", "\"targetsWithDependencyGaps\":0"},
                {"\"no-explicit-naif-mapping\":6", "\"no-explicit-naif-mapping\":5"},
                {"\"no-explicit-naif-mapping\":6", "\"no-explicit-naif-mapping\":8"},
                {"unresolved-component", "bad reason"}, {"\"startEt\":0", "\"startEt\":1001"},
                {"\"auditEt\":500", "\"auditEt\":1e309"}, {"\"endEt\":1000", "\"endEt\":\"1000\""}
        }) reject(summary().replace(change[0], change[1]));
        StringBuilder reasons = new StringBuilder("\"no-explicit-naif-mapping\":6,\"unresolved-component\":1");
        for (int i = 0; i < 127; i++) reasons.append(",\"reason-").append(i).append("\":0");
        reject(summary().replace("\"no-explicit-naif-mapping\":6,\"unresolved-component\":1", reasons));
    }

    @Test public void rejectsEmptyAndOversizedDocuments() {
        for (byte[] invalid : new byte[][] {null, new byte[0], new byte[64 * 1024 + 1], bytes("[]")})
            assertThrows(StateTileDecoder.ProtocolException.class, () -> CoverageReport.decode(invalid, bytes(manifest())));
        for (byte[] invalid : new byte[][] {null, new byte[0], new byte[8 * 1024 * 1024 + 1], bytes("[]")})
            assertThrows(StateTileDecoder.ProtocolException.class, () -> CoverageReport.decode(bytes(summary()), invalid));
    }

    @Test public void validatesConfiguredRealGoCoverageFixture() throws Exception {
        String directory = System.getenv("SOLAR_COVERAGE_NATIVE_FIXTURE_DIR");
        Assume.assumeTrue("Optional real Go coverage fixture was not configured", directory != null && !directory.isBlank());
        byte[] summary = Files.readAllBytes(Path.of(directory, "summary.json"));
        CoverageReport report = CoverageReport.decode(summary, Files.readAllBytes(Path.of(directory, "manifest.json")));
        Map<?, ?> raw = (Map<?, ?>) StateTileDecoder.parseJson(summary);
        Map<?, ?> counts = (Map<?, ?>) raw.get("counts");
        assertEquals(((Number) counts.get("sourceRecords")).longValue(), report.sourceRecords);
        assertEquals(((Number) counts.get("explicitNaifTargets")).longValue(), report.explicitTargets);
        assertEquals(raw.get("reportSha256"), report.reportHash);
        assertTrue("Full source audit must not collapse to the built-in scene", report.sourceRecords > 66);
    }
}
