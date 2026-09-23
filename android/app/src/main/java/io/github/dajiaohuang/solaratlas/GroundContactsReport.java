package io.github.dajiaohuang.solaratlas;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Source-bearing CN sphere contacts. Numerical brackets are not physical errors. */
public final class GroundContactsReport {
    public static final int MAX_BYTES = 1024 * 1024;
    private static final String PCK_HASH = "3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1";
    public static final class Request {
        public final String startUTC, endUTC;
        public final double longitude, latitude, height;
        public final int foreground, background;
        public Request(String start, String end, double lon, double lat, double h, int front, int back) throws StateTileDecoder.ProtocolException {
            require(start != null && end != null && start.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z") && end.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z"), "Explicit UTC start and end required");
            require(Double.isFinite(lon) && lon >= -180 && lon <= 180 && Double.isFinite(lat) && lat >= -90 && lat <= 90 && Double.isFinite(h), "Invalid station coordinates");
            require(front > 0 && back > 0 && front != back && front != 399 && back != 399, "Distinct non-Earth NAIF targets required");
            startUTC = start; endUTC = end; longitude = lon; latitude = lat; height = h; foreground = front; background = back;
        }
        public byte[] bytes() {
            // UTC strings were restricted above; numeric formatting is locale independent.
            return ("{\"startUtc\":\""+startUTC+"\",\"endUtc\":\""+endUTC+"\",\"station\":{\"longitudeDeg\":"+longitude+",\"latitudeDeg\":"+latitude+",\"heightMeters\":"+height+"},\"foregroundId\":"+foreground+",\"backgroundId\":"+background+",\"aberration\":\"CN\"}").getBytes(StandardCharsets.UTF_8);
        }
    }
    public static final class Contact {
        public final String boundary, direction, utc, bracketStartUTC, bracketEndUTC;
        public final double elapsed, low, high;
        Contact(Map<String,Object> c, double duration) throws StateTileDecoder.ProtocolException {
            boundary = text(c.get("boundary")); direction = text(c.get("direction")); utc = utc(c.get("utc"));
            require(Arrays.asList("external", "internal").contains(boundary) && Arrays.asList("enter", "exit", "sampled-zero").contains(direction), "Invalid contact classification");
            elapsed = number(c.get("elapsedTaiSeconds")); List<?> b = list(c.get("bracketSeconds"), 2); require(b.size() == 2, "Invalid bracket");
            low = number(b.get(0)); high = number(b.get(1));
            List<?> times = list(c.get("bracketUtc"), 2); require(times.size() == 2, "Invalid UTC bracket");
            bracketStartUTC = utc(times.get(0)); bracketEndUTC = utc(times.get(1));
            require(low >= 0 && low <= elapsed && elapsed <= high && high <= duration && high-low <= .05+1e-9 && bracketStartUTC.compareTo(utc) <= 0 && bracketEndUTC.compareTo(utc) >= 0, "Unbounded contact bracket");
        }
    }
    public final List<Contact> contacts;
    public final String catalogHash, eopHash, eopRetrievedAt, startGeometry, endGeometry;
    public final int evaluations;
    public final double duration;
    private final byte[] original;

    public static GroundContactsReport decode(byte[] bytes, Request request) throws StateTileDecoder.ProtocolException {
        require(bytes != null && bytes.length > 0 && bytes.length <= MAX_BYTES, "Ground contact response size invalid");
        return new GroundContactsReport(bytes, request);
    }
    private GroundContactsReport(byte[] bytes, Request request) throws StateTileDecoder.ProtocolException {
        Map<String,Object> value = object(StateTileDecoder.parseJson(bytes)), r = object(value.get("result")), echo = object(r.get("request")), station = object(echo.get("station"));
        require("solar.api/v1".equals(value.get("apiVersion")) && !text(value.get("catalogVersion")).isEmpty(), "Contact API mismatch");
        catalogHash = hash(value.get("catalogManifestSha256"));
        require("earth-station-cn-spherical-contacts-v1".equals(r.get("model")) && "CN".equals(echo.get("aberration")) && request.startUTC.equals(echo.get("startUtc")) && request.endUTC.equals(echo.get("endUtc"))
                && number(echo.get("foregroundId")) == request.foreground && number(echo.get("backgroundId")) == request.background
                && number(station.get("longitudeDeg")) == request.longitude && number(station.get("latitudeDeg")) == request.latitude && number(station.get("heightMeters")) == request.height, "Contact request identity mismatch");
        require(PCK_HASH.equals(r.get("radiusSourceSha256")) && "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc".equals(r.get("radiusSourceUrl")), "PCK source mismatch");
        Map<String,Object> eop = object(r.get("earthOrientation")); eopHash = hash(eop.get("sha256")); eopRetrievedAt = text(eop.get("retrievedAt"));
        require("https://data.iers.org/products/eop/rapid/standard/finals2000A.all".equals(eop.get("sourceUrl")) && eopRetrievedAt.matches("\\d{4}-\\d{2}-\\d{2}T.*Z"), "IERS source mismatch");
        duration = number(r.get("durationSeconds")); double count = number(r.get("evaluations"));
        require(duration >= 1 && duration <= 86401 && count >= 1 && count <= 8192 && count == Math.rint(count), "Contact budget mismatch"); evaluations = (int) count;
        Map<String,Object> contract = object(r.get("contract"));
        require(Boolean.TRUE.equals(r.get("possibleMissedEvents")) && "TAI-elapsed-SI-seconds".equals(contract.get("timeAxis")) && "sampled-sign-changes-only".equals(contract.get("coverage"))
                && number(contract.get("stepSeconds")) == 30 && number(contract.get("toleranceSeconds")) == .05 && number(contract.get("maxEvaluations")) == 8192 && number(contract.get("maxContacts")) == 512
                && contract.containsKey("physicalTimingUncertaintySeconds") && contract.get("physicalTimingUncertaintySeconds") == null, "Contact scientific contract mismatch");
        startGeometry = geometry(object(r.get("startGeometry"))); endGeometry = geometry(object(r.get("endGeometry")));
        Set<String> expected = new HashSet<>(Arrays.asList("naif:399", "naif:10", "naif:"+request.foreground, "naif:"+request.background));
        for (Object entry : list(r.get("sources"), 4)) {
            Map<String,Object> s = object(entry);
            require(expected.remove(text(s.get("bodyId"))) && !text(s.get("source")).isEmpty() && number(s.get("startJdTdb")) <= number(s.get("endJdTdb")), "Missing or repeated SPK source"); hash(s.get("kernelSha256"));
        }
        require(expected.isEmpty(), "Incomplete SPK sources");
        for (Object warning : list(r.get("warnings"), 128)) text(warning);
        List<Contact> parsed = new ArrayList<>(); double previous = 0;
        for (Object entry : list(r.get("contacts"), 512)) {
            Contact contact = new Contact(object(entry), duration); require(contact.elapsed >= previous, "Unordered contacts"); previous = contact.elapsed; parsed.add(contact);
        }
        contacts = Collections.unmodifiableList(parsed); original = bytes.clone();
    }
    // Preserve additional server fields verbatim; only validated fields above are displayed.
    public byte[] exportBytes() { return original.clone(); }
    private static String geometry(Map<String,Object> g) throws StateTileDecoder.ProtocolException {
        double s = number(g.get("separationRadians")), a = number(g.get("foregroundAngularRadiusRadians")), b = number(g.get("backgroundAngularRadiusRadians")), e = number(g.get("externalGapRadians")), i = number(g.get("internalGapRadians"));
        String kind = text(g.get("classification"));
        require(s >= 0 && s <= Math.PI && a > 0 && a < Math.PI/2 && b > 0 && b < Math.PI/2 && Math.abs(e-(s-a-b)) <= 1e-12 && Math.abs(i-(s-Math.abs(a-b))) <= 1e-12 && kind.equals(e >= 0 ? "none" : i > 0 ? "partial" : a >= b ? "total" : "annular"), "Inconsistent sphere geometry"); return kind;
    }
    @SuppressWarnings("unchecked") static Map<String,Object> object(Object v) throws StateTileDecoder.ProtocolException { require(v instanceof Map, "Contact object expected"); return (Map<String,Object>) v; }
    static List<?> list(Object v, int max) throws StateTileDecoder.ProtocolException { require(v instanceof List && ((List<?>) v).size() <= max, "Contact list exceeds bounds"); return (List<?>) v; }
    static String text(Object v) throws StateTileDecoder.ProtocolException { require(v instanceof String && ((String)v).length() <= 4096, "Contact text invalid"); return (String)v; }
    static double number(Object v) throws StateTileDecoder.ProtocolException { require(v instanceof Number && Double.isFinite(((Number)v).doubleValue()), "Contact number invalid"); return ((Number)v).doubleValue(); }
    private static String hash(Object v) throws StateTileDecoder.ProtocolException { String s = text(v); require(s.matches("[a-f0-9]{64}"), "Contact source hash invalid"); return s; }
    private static String utc(Object v) throws StateTileDecoder.ProtocolException { String s = text(v); require(s.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z"), "Contact UTC invalid"); return s; }
    static void require(boolean valid, String reason) throws StateTileDecoder.ProtocolException { if (!valid) throw new StateTileDecoder.ProtocolException(reason); }
}
