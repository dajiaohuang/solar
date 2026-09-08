package io.github.dajiaohuang.solaratlas;

import java.util.Collections;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SortedMap;
import java.util.TreeMap;

/** Pinned source-population evidence, never a live rendered-frame count. */
public final class CoverageReport {
    public static final String TIME_SCALE = "TDB seconds past J2000";
    public static final String FRAME = "ECLIPJ2000";
    public final String catalogVersion, catalogHash, inventoryHash, reportHash, sourceHash, mappingHash, satelliteHash;
    public final long sourceRecords, mappedRecords, unresolvedRecords, explicitTargets, availableTargets, dependencyCovered, dependencyGaps;
    public final double auditEt, windowStartEt, windowEndEt;
    public final SortedMap<String, Long> unresolvedReasons;
    public final List<CoverageBucket> coverage;

    public static final class CoverageBucket {
        public final String datasetVersion, source, model, frame;
        public final long exact, approximate, missing;
        public final double auditEt;
        private CoverageBucket(Map<String, Object> value, String catalogVersion, double reportAuditEt) throws StateTileDecoder.ProtocolException {
            datasetVersion = text(value.get("datasetVersion"), false, 512);
            source = text(value.get("source"), false, 512);
            model = text(value.get("model"), false, 512);
            frame = text(value.get("frame"), false, 512);
            auditEt = finite(value.get("auditEt"));
            exact = count(value.get("exact")); approximate = count(value.get("approximate")); missing = count(value.get("missing"));
            require(datasetVersion.equals(catalogVersion) && FRAME.equals(frame) && auditEt == reportAuditEt
                    && sum(exact, approximate, missing) != null, "invalid coverage status bucket");
        }
    }

    private CoverageReport(Map<String, Object> value, Map<String, Object> manifest) throws StateTileDecoder.ProtocolException {
        require("solar.api/v1".equals(manifest.get("apiVersion")), "manifest API mismatch");
        catalogVersion = string(manifest, "catalogVersion");
        require(!catalogVersion.trim().isEmpty(), "manifest catalog version missing");
        catalogHash = hash(manifest, "catalogManifestSha256");
        inventoryHash = hash(manifest, "inventoryManifestSha256");
        require("solar.api/v1".equals(value.get("apiVersion"))
                && "source-identity-and-dependency-window-audit".equals(value.get("purpose"))
                && "full".equals(value.get("profile")) && Boolean.TRUE.equals(value.get("sourceBytesVerified"))
                && TIME_SCALE.equals(value.get("timeScale")) && FRAME.equals(value.get("frame")), "coverage contract mismatch");
        require(catalogVersion.equals(value.get("catalogVersion"))
                && catalogHash.equals(hash(value, "catalogManifestSha256"))
                && inventoryHash.equals(hash(value, "inventoryManifestSha256")), "coverage dataset mismatch");
        reportHash = hash(value, "reportSha256"); sourceHash = hash(value, "sourceSnapshotSha256");
        mappingHash = hash(value, "identityMappingSha256"); satelliteHash = hash(value, "satelliteCatalogSha256");
        Map<String, Object> counts = object(value.get("counts"));
        sourceRecords = count(counts.get("sourceRecords")); mappedRecords = count(counts.get("mappedSourceRecords"));
        unresolvedRecords = count(counts.get("unresolvedSourceRecords")); explicitTargets = count(counts.get("explicitNaifTargets"));
        availableTargets = count(counts.get("availableTargetsAtAuditEpoch"));
        require(mappedRecords <= sourceRecords && unresolvedRecords == sourceRecords - mappedRecords
                && explicitTargets <= mappedRecords && availableTargets <= explicitTargets, "inconsistent coverage counts");
        Map<String, Object> windows = object(value.get("windowCounts"));
        dependencyCovered = count(windows.get("dependencyCoveredTargets")); dependencyGaps = count(windows.get("targetsWithDependencyGaps"));
        require(windows.containsKey("numericallyCertifiedWholeWindowTargets") && windows.get("numericallyCertifiedWholeWindowTargets") == null
                && dependencyCovered <= explicitTargets && dependencyGaps == explicitTargets - dependencyCovered, "invalid coverage window counts");
        Map<String, Object> reasons = object(value.get("unresolvedReasons"));
        require(reasons.size() <= 128, "too many coverage reasons");
        SortedMap<String, Long> parsedReasons = new TreeMap<>();
        long remaining = unresolvedRecords;
        for (Map.Entry<String, Object> entry : reasons.entrySet()) {
            require(entry.getKey().matches("[a-z0-9][a-z0-9-]{0,127}"), "invalid coverage reason");
            long total = count(entry.getValue()); require(total <= remaining, "inconsistent coverage reasons");
            remaining -= total; parsedReasons.put(entry.getKey(), total);
        }
        require(remaining == 0, "incomplete coverage reasons");
        unresolvedReasons = Collections.unmodifiableSortedMap(parsedReasons);
        auditEt = finite(value.get("auditEt"));
        Object rawCoverage = value.get("coverage");
        require(rawCoverage instanceof List && !((List<?>) rawCoverage).isEmpty() && ((List<?>) rawCoverage).size() <= 256, "invalid coverage status buckets");
        List<CoverageBucket> parsedCoverage = new ArrayList<>(); Set<String> coverageKeys = new HashSet<>(); long coverageTotal = 0;
        for (Object entry : (List<?>) rawCoverage) {
            CoverageBucket bucket = new CoverageBucket(object(entry), catalogVersion, auditEt);
            String key = bucket.datasetVersion + "\u0000" + bucket.source + "\u0000" + bucket.model + "\u0000" + Double.toString(bucket.auditEt) + "\u0000" + bucket.frame;
            require(coverageKeys.add(key), "repeated coverage status bucket");
            Long next = sum(coverageTotal, bucket.exact, bucket.approximate, bucket.missing);
            require(next != null, "coverage status bucket total overflow"); coverageTotal = next;
            parsedCoverage.add(bucket);
        }
        require(coverageTotal == sourceRecords, "coverage status buckets do not reconcile");
        coverage = Collections.unmodifiableList(parsedCoverage);
        Map<String, Object> window = object(value.get("requestedWindow"));
        windowStartEt = finite(window.get("startEt")); windowEndEt = finite(window.get("endEt"));
        require(TIME_SCALE.equals(window.get("timeScale")) && windowStartEt <= windowEndEt, "invalid coverage window");
        // The independent audit epoch is not required to lie inside this window.
    }

    public static CoverageReport decode(byte[] summary, byte[] manifest) throws StateTileDecoder.ProtocolException {
        require(summary != null && summary.length > 0 && summary.length <= 64 * 1024, "coverage summary size invalid");
        require(manifest != null && manifest.length > 0 && manifest.length <= 8 * 1024 * 1024, "coverage manifest size invalid");
        return new CoverageReport(object(StateTileDecoder.parseJson(summary)), object(StateTileDecoder.parseJson(manifest)));
    }

    @SuppressWarnings("unchecked") private static Map<String, Object> object(Object value) throws StateTileDecoder.ProtocolException {
        require(value instanceof Map, "coverage object expected"); return (Map<String, Object>) value;
    }
    private static String string(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException {
        require(value.get(key) instanceof String, "coverage string expected"); return (String) value.get(key);
    }
    private static String text(Object value, boolean optional, int max) throws StateTileDecoder.ProtocolException {
        if (optional && value == null) return "";
        require(value instanceof String, "coverage string expected"); String result = (String) value;
        require((optional || !result.isEmpty()) && result.length() <= max, "coverage string exceeds limit");
        for (int i = 0; i < result.length(); i++) require(result.charAt(i) >= 32 && result.charAt(i) != 127, "coverage string has control character");
        return result;
    }
    private static String hash(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException {
        String result = string(value, key); require(result.matches("[a-f0-9]{64}"), "coverage hash invalid"); return result;
    }
    private static double finite(Object value) throws StateTileDecoder.ProtocolException {
        require(value instanceof Number, "coverage number expected"); double result = ((Number) value).doubleValue();
        require(Double.isFinite(result), "coverage number must be finite"); return result;
    }
    private static long count(Object value) throws StateTileDecoder.ProtocolException {
        double result = finite(value); require(result >= 0 && result <= 9_007_199_254_740_991d && result == Math.rint(result), "coverage count invalid");
        return (long) result;
    }
    private static Long sum(long... values) {
        long total = 0;
        for (long value : values) { if (value < 0 || Long.MAX_VALUE - total < value || total + value > 9_007_199_254_740_991L) return null; total += value; }
        return total;
    }
    private static void require(boolean valid, String reason) throws StateTileDecoder.ProtocolException {
        if (!valid) throw new StateTileDecoder.ProtocolException(reason);
    }
}
