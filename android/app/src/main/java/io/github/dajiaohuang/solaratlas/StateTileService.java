package io.github.dajiaohuang.solaratlas;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Consumer;

/** Manifest/plan/tile orchestration with memory-admitted bounded tile concurrency. */
public final class StateTileService implements Closeable {
    private static final String API_VERSION = "solar.api/v1";
    private static final int MAX_PLAN_BYTES = 8 * 1024 * 1024;
    private static final int MAX_AGGREGATE_ROWS = 2_000_000;
    private static final long MAX_RESIDENT_STATE_BYTES = 1536L * 1024L * 1024L;
    private static final int TILE_SIZE = 16_384;
    private static final int MAX_CONCURRENT_TILES = 2;
    private final String baseUrl;
    private final StateTileCache cache;
    private final RequestControl requestControl = new RequestControl();
    private final ExecutorService tileWorkers = Executors.newFixedThreadPool(MAX_CONCURRENT_TILES, task -> {
        Thread thread = new Thread(task, "solar-state-tile");
        thread.setDaemon(true);
        return thread;
    });

    public StateTileService(String address, File cacheDirectory) throws IOException {
        this(address, new StateTileCache(cacheDirectory));
    }

    public StateTileService(String address, StateTileCache sharedCache) throws IOException {
        if (address == null) throw new StateTileDecoder.ProtocolException("backend address is required");
        String trimmed = address.trim();
        try {
            URL parsed = new URL(trimmed);
            if (!"https".equalsIgnoreCase(parsed.getProtocol()) || parsed.getHost().isEmpty() || parsed.getUserInfo() != null || parsed.getQuery() != null || parsed.getRef() != null) {
                throw new StateTileDecoder.ProtocolException("backend must be HTTPS without credentials, query or fragment");
            }
        } catch (java.net.MalformedURLException error) { throw new StateTileDecoder.ProtocolException("backend address is invalid"); }
        baseUrl = trimmed.replaceAll("/+\\z", "");
        if (sharedCache == null) throw new StateTileDecoder.ProtocolException("tile cache is unavailable");
        cache = sharedCache;
    }

    /** Cancel all work owned by this service, including a blocked HTTP read. */
    public void cancel() { requestControl.cancel(); tileWorkers.shutdownNow(); }

    /**
     * A service is single-use from the UI's perspective. Closing is idempotent
     * and prevents a late worker from publishing a result after its owner has
     * left the screen.
     */
    @Override public void close() { cancel(); }

    private static final class RequestControl implements StateTileClient.Cancellation {
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final Set<HttpURLConnection> connections =
                Collections.newSetFromMap(new IdentityHashMap<>());

        @Override public void check() throws IOException {
            if (cancelled.get() || Thread.currentThread().isInterrupted()) {
                throw new IOException("state load cancelled");
            }
        }

        @Override public void register(HttpURLConnection connection) throws IOException {
            synchronized (connections) {
                if (cancelled.get()) {
                    connection.disconnect();
                    throw new IOException("state load cancelled");
                }
                connections.add(connection);
            }
        }

        @Override public void unregister(HttpURLConnection connection) {
            synchronized (connections) { connections.remove(connection); }
        }

        void cancel() {
            cancelled.set(true);
            HttpURLConnection[] active;
            synchronized (connections) {
                active = connections.toArray(new HttpURLConnection[0]);
                connections.clear();
            }
            for (HttpURLConnection connection : active) connection.disconnect();
        }
    }

    private static final class TileRequest {
        final String planId, catalogHash, inventoryHash;
        final int sequence, tileCount, ordinalStart, ordinalCount;
        final double epochJd;

        TileRequest(String planId, String catalogHash, String inventoryHash, int sequence, int tileCount,
                    int ordinalStart, int ordinalCount, double epochJd) {
            this.planId = planId; this.catalogHash = catalogHash; this.inventoryHash = inventoryHash;
            this.sequence = sequence; this.tileCount = tileCount; this.ordinalStart = ordinalStart;
            this.ordinalCount = ordinalCount; this.epochJd = epochJd;
        }

        String requestKey() throws StateTileDecoder.ProtocolException {
            return sha256((planId + ":" + sequence).getBytes(StandardCharsets.UTF_8));
        }
    }

    private static final class TileResult {
        final int slot;
        final StateTileDecoder.DecodedTile tile;
        TileResult(int slot, StateTileDecoder.DecodedTile tile) { this.slot = slot; this.tile = tile; }
    }

    public static final class Frame {
        public final double epochJd;
        public final String catalogHash;
        public final String inventoryHash;
        public final List<StateTileDecoder.Metadata> metadata;
        public final double[] states;
        public final boolean[] exact;
        public final int exactCount;

        private Frame(double epochJd, String catalogHash, String inventoryHash, List<StateTileDecoder.Metadata> metadata, double[] states, boolean[] exact, int exactCount) {
            this.epochJd = epochJd; this.catalogHash = catalogHash; this.inventoryHash = inventoryHash;
            this.metadata = List.copyOf(metadata); this.states = states; this.exact = exact;
            this.exactCount = exactCount;
        }
    }

    public Frame load(List<String> inputIds, double epochJd) throws IOException {
        return load(inputIds, epochJd, null);
    }

    /** A directory selection must still match the current server inventory. */
    public Frame load(List<String> inputIds, double epochJd, SourceIdentityPage selectedPage) throws IOException {
        return load(inputIds, epochJd, selectedPage, null);
    }

    /** Publishes one fully verified prefix only when more than one request plan is needed. */
    public Frame load(List<String> inputIds, double epochJd, SourceIdentityPage selectedPage,
                      Consumer<Frame> onInitialPartial) throws IOException {
        checkLoadCancelled();
        if (!Double.isFinite(epochJd) || inputIds == null || inputIds.isEmpty() || inputIds.size() > MAX_AGGREGATE_ROWS) throw new StateTileDecoder.ProtocolException("finite TDB epoch and bounded IDs are required");
        List<String> ids = normalizeIds(inputIds);
        byte[] manifestBytes = receive("v1/catalog/manifest", null, false);
        if (selectedPage != null) {
            require(baseUrl.equals(selectedPage.base), "source selection belongs to another backend");
            selectedPage.requireManifest(manifestBytes);
        }
        Map<String, Object> manifest = object(manifestBytes);
        String catalogHash = hashField(manifest, "catalogManifestSha256");
        String inventoryHash = optionalHash(manifest, "inventoryManifestSha256");
        require(string(manifest, "apiVersion").equals(API_VERSION), "manifest API version mismatch");
        String catalogVersion = string(manifest, "catalogVersion");
        require(!catalogVersion.isEmpty(), "manifest catalog version is missing");
        int maxPlanIds = manifestLimit(manifest, "maxIds", StateTileDecoder.MAX_ROWS, StateTileDecoder.MAX_ROWS);
        int maxPlanBytes = manifestLimit(manifest, "maxPlanBytes", 1024 * 1024, MAX_PLAN_BYTES);
        List<List<String>> planChunks = chunkPlanIds(ids, epochJd, maxPlanIds, maxPlanBytes);
        StateAccumulator accumulator = new StateAccumulator(ids.size(), MAX_RESIDENT_STATE_BYTES);
        int start = 0;
        for (List<String> chunk : planChunks) {
            checkLoadCancelled();
            String request = statePlanRequest(chunk, epochJd);
            require(request.getBytes(StandardCharsets.UTF_8).length <= maxPlanBytes, "state plan request exceeds advertised byte budget");
            Map<String, Object> plan = object(receive("v1/state/plan", request, false));
            validatePlan(plan, chunk, epochJd, catalogVersion, catalogHash, inventoryHash);
            String planId = string(plan, "planId");
            int tileCount = integer(plan, "tileCount"), exactCount = integer(plan, "exactCount");
            List<?> tileValues = list(plan, "tiles");
            int decodedExact = 0, ordinal = 0, sequence = 0;
            while (sequence < tileValues.size()) {
                checkLoadCancelled();
                Map<String, Object> descriptor = object(tileValues.get(sequence));
                int descriptorSequence = integer(descriptor, "sequence");
                int descriptorStart = integer(descriptor, "ordinalStart");
                int descriptorCount = integer(descriptor, "ordinalCount");
                require(descriptorSequence == sequence && descriptorStart == ordinal && descriptorCount > 0 && descriptorCount <= chunk.size() - ordinal, "plan tile ordering is invalid");
                TileRequest first = new TileRequest(planId, catalogHash, inventoryHash, sequence, tileCount,
                        descriptorStart, descriptorCount, epochJd);
                TileRequest second = null;
                if (sequence + 1 < tileValues.size()) {
                    Map<String, Object> next = object(tileValues.get(sequence + 1));
                    int nextStart = descriptorStart + descriptorCount;
                    int nextCount = integer(next, "ordinalCount");
                    require(integer(next, "sequence") == sequence + 1 && integer(next, "ordinalStart") == nextStart
                            && nextCount > 0 && nextCount <= chunk.size() - nextStart,
                            "plan tile ordering is invalid");
                    second = new TileRequest(planId, catalogHash, inventoryHash, sequence + 1, tileCount,
                            nextStart, nextCount, epochJd);
                }
                boolean parallel = second != null && accumulator.hasTileWorkingRoom(descriptorCount, second.ordinalCount);
                if (!parallel) accumulator.requireTileWorkingRoom(descriptorCount);
                StateTileDecoder.DecodedTile[] tiles = parallel
                        ? fetchTilePair(first, second)
                        : new StateTileDecoder.DecodedTile[] { loadTile(first) };
                for (int offset = 0; offset < tiles.length; offset++) {
                    checkLoadCancelled();
                    TileRequest tileRequest = offset == 0 ? first : second;
                    StateTileDecoder.DecodedTile tile = tiles[offset];
                    require(tile.recordCount == tileRequest.ordinalCount && tile.ordinalStart == tileRequest.ordinalStart && tile.epochJd == epochJd, "tile descriptor mismatch");
                    decodedExact += accumulator.append(tile, ids, start + ordinal);
                    ordinal += tileRequest.ordinalCount;
                }
                sequence += tiles.length;
            }
            require(ordinal == chunk.size() && decodedExact == exactCount, "incomplete plan or precision count mismatch");
            if (start == 0 && start + chunk.size() < ids.size() && onInitialPartial != null) {
                Frame partial = accumulator.initialSnapshot(epochJd, catalogHash, inventoryHash);
                if (partial != null) onInitialPartial.accept(partial);
            }
            start += chunk.size();
        }
        checkLoadCancelled();
        Frame frame = accumulator.finish(epochJd, catalogHash, inventoryHash);
        checkLoadCancelled();
        return frame;
    }

    private StateTileDecoder.DecodedTile fetchTileWithRetry(String planId, int sequence, int tileCount,
                                                            String catalogHash, String inventoryHash,
                                                            String requestKey) throws IOException {
        IOException failure = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            checkLoadCancelled();
            try {
                return StateTileClient.fetchTile(baseUrl, planId, sequence, tileCount, catalogHash,
                        inventoryHash, cache, requestKey, requestControl);
            } catch (IOException error) {
                failure = error;
            }
        }
        throw failure == null ? new IOException("state tile fetch failed") : failure;
    }

    private StateTileDecoder.DecodedTile loadTile(TileRequest request) throws IOException {
        String requestKey = request.requestKey();
        byte[] cached;
        try { cached = cache.getByRequestKey(requestKey); }
        catch (IOException unavailable) { cached = null; }
        checkLoadCancelled();
        StateTileDecoder.DecodedTile tile;
        if (cached != null) {
            try {
                tile = StateTileDecoder.decode(cached, request.planId, request.catalogHash,
                        request.inventoryHash, request.sequence, request.tileCount);
            } catch (StateTileDecoder.ProtocolException corrupted) {
                // An interrupted decode does not establish corruption.
                checkLoadCancelled();
                // A request-key file can have a valid payload digest but stale
                // protocol metadata; recover once from the authoritative endpoint.
                cache.invalidate(requestKey);
                tile = fetchTileWithRetry(request.planId, request.sequence, request.tileCount,
                        request.catalogHash, request.inventoryHash, requestKey);
            }
        } else {
            tile = fetchTileWithRetry(request.planId, request.sequence, request.tileCount,
                    request.catalogHash, request.inventoryHash, requestKey);
        }
        checkLoadCancelled();
        require(tile.recordCount == request.ordinalCount && tile.ordinalStart == request.ordinalStart
                        && tile.epochJd == request.epochJd,
                "tile descriptor mismatch");
        return tile;
    }

    private StateTileDecoder.DecodedTile[] fetchTilePair(TileRequest first, TileRequest second) throws IOException {
        CompletionService<TileResult> completed = new ExecutorCompletionService<>(tileWorkers);
        List<Future<TileResult>> futures = new ArrayList<>(MAX_CONCURRENT_TILES);
        futures.add(completed.submit(() -> new TileResult(0, loadTile(first))));
        futures.add(completed.submit(() -> new TileResult(1, loadTile(second))));
        StateTileDecoder.DecodedTile[] result = new StateTileDecoder.DecodedTile[MAX_CONCURRENT_TILES];
        try {
            for (int i = 0; i < MAX_CONCURRENT_TILES; i++) {
                TileResult tile = completed.take().get();
                result[tile.slot] = tile.tile;
            }
            require(result[0] != null && result[1] != null, "state tile batch was incomplete");
            return result;
        } catch (InterruptedException interrupted) {
            cancelTileBatch(futures);
            Thread.currentThread().interrupt();
            throw new StateTileDecoder.ProtocolException("state tile fetch cancelled");
        } catch (ExecutionException failure) {
            cancelTileBatch(futures);
            Throwable cause = failure.getCause();
            if (cause instanceof IOException) throw (IOException) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw new IOException("state tile fetch failed", cause);
        } catch (IOException failure) {
            cancelTileBatch(futures);
            throw failure;
        }
    }

    private void cancelTileBatch(List<Future<TileResult>> futures) {
        for (Future<TileResult> future : futures) future.cancel(true);
        // A batch failure invalidates the single-use load; disconnect its peer
        // immediately so a blocked network read cannot outlive the failed plan.
        requestControl.cancel();
    }

    /** Single final primitive allocation; budget is an estimate, not a process RSS cap. */
    static final class StateAccumulator {
        private final double[] states;
        private final boolean[] exact;
        private final List<StateTileDecoder.Metadata> metadata;
        private final long budget;
        private long residentBytes;
        private int size;
        private int totalExactCount;
        private boolean finished;

        StateAccumulator(int rows, long budget) throws StateTileDecoder.ProtocolException {
            checkCancelled();
            require(rows > 0 && rows <= MAX_AGGREGATE_ROWS, "invalid native state row capacity");
            // Reserve six doubles, one flag and both metadata reference arrays (up to
            // eight bytes/reference), including the immutable list made by Frame.
            residentBytes = 96L + rows * ((long) StateTileDecoder.STRIDE * Double.BYTES + 1L + 16L);
            require(residentBytes <= budget, "observation exceeds native state memory budget");
            this.budget = budget;
            states = new double[rows * StateTileDecoder.STRIDE];
            exact = new boolean[rows];
            metadata = new ArrayList<>(rows);
        }

        int append(StateTileDecoder.DecodedTile tile, List<String> ids, int start) throws StateTileDecoder.ProtocolException {
            checkCancelled();
            require(!finished && start == size && tile.recordCount > 0 && tile.recordCount <= exact.length - size,
                    "native state assembly ordering is invalid");
            require(ids.size() == exact.length, "native state request size mismatch");
            long nextBytes = residentBytes;
            for (int row = 0; row < tile.recordCount; row++) {
                if ((row & 1023) == 0) checkCancelled();
                StateTileDecoder.Metadata value = tile.metadata.get(row);
                require(value.id.equals(ids.get(start + row)), "tile body identity mismatch");
                long bytes = metadataBytes(value);
                require(bytes <= budget - nextBytes, "observation exceeds native state memory budget");
                nextBytes += bytes;
            }
            checkCancelled();
            System.arraycopy(tile.states, 0, states, start * StateTileDecoder.STRIDE, tile.states.length);
            int exactCount = 0;
            for (int row = 0; row < tile.recordCount; row++) {
                if ((row & 1023) == 0) checkCancelled();
                boolean isExact = (tile.exactBitmap[row / 8] & (1 << (row % 8))) != 0;
                exact[start + row] = isExact;
                if (isExact) exactCount++;
            }
            metadata.addAll(tile.metadata);
            size += tile.recordCount;
            totalExactCount += exactCount;
            residentBytes = nextBytes;
            return exactCount;
        }

        void requireTileWorkingRoom(int rows) throws StateTileDecoder.ProtocolException {
            checkCancelled();
            require(!finished && rows > 0 && rows <= StateTileDecoder.MAX_ROWS,
                    "invalid tile working-set row bound");
            require(tileWorkingBytes(rows) <= budget - residentBytes,
                    "insufficient native state budget for tile read and decode workspace");
        }

        boolean hasTileWorkingRoom(int firstRows, int secondRows) throws StateTileDecoder.ProtocolException {
            checkCancelled();
            require(!finished && firstRows > 0 && firstRows <= StateTileDecoder.MAX_ROWS
                    && secondRows > 0 && secondRows <= StateTileDecoder.MAX_ROWS,
                    "invalid tile working-set row bound");
            long workingBytes = tileWorkingBytes(firstRows) + tileWorkingBytes(secondRows);
            return workingBytes <= budget - residentBytes;
        }

        private static long tileWorkingBytes(int rows) {
            // Admission allowance, not an allocator/RSS theorem: raw payload and
            // decode/string expansion, row objects/primitive buffers, one-row scratch.
            return 4L * StateTileDecoder.MAX_TILE_BYTES + rows * 1024L + 8L * 1024L * 1024L;
        }

        Frame finish(double epochJd, String catalogHash, String inventoryHash) throws StateTileDecoder.ProtocolException {
            checkCancelled();
            require(!finished && size == exact.length, "incomplete native state assembly");
            finished = true;
            return new Frame(epochJd, catalogHash, inventoryHash, metadata, states, exact, totalExactCount);
        }

        Frame initialSnapshot(double epochJd, String catalogHash, String inventoryHash) throws StateTileDecoder.ProtocolException {
            checkCancelled();
            require(!finished && size > 0 && size < exact.length,
                    "initial native state snapshot is not a strict verified prefix");
            // One early frame adds only the verified prefix's final-sized arrays
            // and one metadata reference list. Decline streaming when that
            // temporary resident copy would exceed the same conservative budget.
            long snapshotBytes = (long) size * (StateTileDecoder.STRIDE * Double.BYTES + 1L + 8L);
            if (snapshotBytes > budget - residentBytes) return null;
            residentBytes += snapshotBytes;
            double[] prefixStates = Arrays.copyOf(states, size * StateTileDecoder.STRIDE);
            boolean[] prefixExact = Arrays.copyOf(exact, size);
            return new Frame(epochJd, catalogHash, inventoryHash, metadata.subList(0, size),
                    prefixStates, prefixExact, totalExactCount);
        }
    }

    private void validatePlan(Map<String, Object> plan, List<String> ids, double epochJd, String catalogVersion, String catalogHash, String inventoryHash) throws StateTileDecoder.ProtocolException {
        require(string(plan, "apiVersion").equals(API_VERSION) && string(plan, "catalogVersion").equals(catalogVersion) && string(plan, "catalogManifestSha256").equals(catalogHash), "plan/catalog identity mismatch");
        require(same(optionalHash(plan, "inventoryManifestSha256"), inventoryHash), "plan/inventory identity mismatch");
        require(string(plan, "requestIdsSha256").equals(requestHash(ids)) && isHash(string(plan, "planId")), "plan request identity mismatch");
        require(number(plan, "epochJd") == epochJd && string(plan, "timeScale").equals("TDB") && string(plan, "frame").equals("ECLIPJ2000") && string(plan, "precision").equals("exact"), "plan numeric contract mismatch");
        require(string(plan, "stateOriginId").equals("naif:0") && string(plan, "distanceUnit").equals("km") && string(plan, "velocityUnit").equals("km/s") && integer(plan, "stride") == 6, "plan origin/unit mismatch");
        List<?> fields = list(plan, "fieldMask"); require(fields.size() == 2 && "position".equals(fields.get(0)) && "velocity".equals(fields.get(1)), "plan field mask mismatch");
        int bodyCount = integer(plan, "bodyCount"), tileCount = integer(plan, "tileCount"), exactCount = integer(plan, "exactCount"), approximateCount = integer(plan, "approximateCount"), missingCount = integer(plan, "missingCount");
        require(bodyCount == ids.size() && tileCount > 0 && tileCount <= bodyCount && tileCount <= StateTileDecoder.MAX_ROWS && exactCount >= 0 && missingCount >= 0 && approximateCount == 0 && exactCount + missingCount == bodyCount, "plan counts are invalid");
        require(list(plan, "tiles").size() == tileCount, "plan tile inventory is invalid");
    }

    private byte[] receive(String path, String body, boolean binary) throws IOException {
        HttpURLConnection connection = null;
        try {
            requestControl.check();
            connection = (HttpURLConnection) new URL(baseUrl + "/" + path).openConnection();
            requestControl.register(connection);
            connection.setRequestMethod(body == null ? "GET" : "POST"); connection.setConnectTimeout(10_000); connection.setReadTimeout(30_000); connection.setDoInput(true);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", binary ? "application/vnd.solar.state-tile+binary" : "application/json");
            if (body != null) { connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); byte[] request = body.getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(request.length); try (java.io.OutputStream output = connection.getOutputStream()) { output.write(request); } }
            requestControl.check();
            int status = connection.getResponseCode(); if (status != HttpURLConnection.HTTP_OK) throw new IOException("backend HTTP " + status);
            long declared = connection.getContentLengthLong(); int limit = binary ? StateTileDecoder.MAX_TILE_BYTES : MAX_PLAN_BYTES;
            if (declared <= 0 || declared > limit) throw new StateTileDecoder.ProtocolException("backend response length is invalid");
            String type = connection.getHeaderField("Content-Type"); String expected = binary ? "application/vnd.solar.state-tile+binary" : "application/json";
            if (type == null || !type.split(";", 2)[0].trim().equalsIgnoreCase(expected)) throw new StateTileDecoder.ProtocolException("backend response type is invalid");
            byte[] response = StateTileClient.readExact(connection.getInputStream(), (int) declared, requestControl);
            requestControl.check();
            return response;
        } finally {
            if (connection != null) requestControl.unregister(connection);
            if (connection != null) connection.disconnect();
        }
    }

    private static int manifestLimit(Map<String, Object> manifest, String key, int fallback, int maximum) throws StateTileDecoder.ProtocolException {
        Object rawLimits = manifest.get("limits");
        if (rawLimits == null) return fallback;
        Map<String, Object> limits = object(rawLimits);
        if (!limits.containsKey(key)) return fallback;
        int value = integer(limits, key);
        require(value > 0 && value <= maximum, "manifest plan limit is invalid: " + key);
        return value;
    }
    private static List<List<String>> chunkPlanIds(List<String> ids, double epochJd, int maxIds, int maxBytes) throws StateTileDecoder.ProtocolException {
        int fixedBytes = statePlanRequest(Collections.emptyList(), epochJd).getBytes(StandardCharsets.UTF_8).length;
        require(fixedBytes <= maxBytes, "state plan fixed fields exceed advertised byte budget");
        List<List<String>> chunks = new ArrayList<>();
        List<String> chunk = new ArrayList<>();
        int bytes = fixedBytes;
        for (String id : ids) {
            int idBytes = jsonStringByteLength(id);
            int addition = idBytes + (chunk.isEmpty() ? 0 : 1);
            if (!chunk.isEmpty() && (chunk.size() >= maxIds || bytes + addition > maxBytes)) {
                chunks.add(chunk); chunk = new ArrayList<>(); bytes = fixedBytes;
            }
            require(bytes + idBytes <= maxBytes, "body ID exceeds advertised state plan byte budget");
            chunk.add(id); bytes += idBytes + (chunk.size() > 1 ? 1 : 0);
        }
        if (!chunk.isEmpty()) chunks.add(chunk);
        return chunks;
    }
    private static String statePlanRequest(List<String> ids, double epochJd) {
        return "{\"ids\":" + stringsJson(ids) + ",\"epochJd\":" + Double.toString(epochJd) + ",\"timeScale\":\"TDB\",\"frame\":\"ECLIPJ2000\",\"precision\":\"exact\",\"fieldMask\":[\"position\",\"velocity\"],\"tileSize\":" + TILE_SIZE + "}";
    }
    private static int jsonStringByteLength(String value) {
        int bytes = 2;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '"' || c == '\\' || c == '\b' || c == '\f' || c == '\n' || c == '\r' || c == '\t') bytes += 2;
            else if (c < 0x20) bytes += 6;
            else if (Character.isHighSurrogate(c) && i + 1 < value.length() && Character.isLowSurrogate(value.charAt(i + 1))) { bytes += 4; i++; }
            else if (Character.isSurrogate(c)) bytes++;
            else if (c <= 0x7f) bytes++;
            else if (c <= 0x7ff) bytes += 2;
            else bytes += 3;
        }
        return bytes;
    }
    private static List<String> normalizeIds(List<String> input) throws StateTileDecoder.ProtocolException { List<String> result = new ArrayList<>(input.size()); Set<String> seen = new HashSet<>(); for (String raw : input) { if (raw == null) throw new StateTileDecoder.ProtocolException("body ID is null"); String id = raw.trim(); if (id.isEmpty() || id.getBytes(StandardCharsets.UTF_8).length > 1024 || !seen.add(id)) throw new StateTileDecoder.ProtocolException("body IDs must be unique and bounded"); result.add(id); } return result; }
    private static String stringsJson(List<String> values) { StringBuilder out = new StringBuilder("["); for (int i = 0; i < values.size(); i++) { if (i > 0) out.append(','); out.append(jsonString(values.get(i))); } return out.append(']').toString(); }
    private static String jsonString(String value) { StringBuilder out = new StringBuilder("\""); for (int i = 0; i < value.length(); i++) { char c = value.charAt(i); if (c == '"' || c == '\\') out.append('\\').append(c); else if (c == '\b') out.append("\\b"); else if (c == '\f') out.append("\\f"); else if (c == '\n') out.append("\\n"); else if (c == '\r') out.append("\\r"); else if (c == '\t') out.append("\\t"); else if (c < 0x20) out.append(String.format("\\u%04x", (int) c)); else out.append(c); } return out.append('"').toString(); }
    private static String requestHash(List<String> ids) throws StateTileDecoder.ProtocolException { try { MessageDigest digest = MessageDigest.getInstance("SHA-256"); for (String id : ids) { byte[] bytes = id.getBytes(StandardCharsets.UTF_8); digest.update((byte) bytes.length); digest.update((byte) (bytes.length >>> 8)); digest.update((byte) (bytes.length >>> 16)); digest.update((byte) (bytes.length >>> 24)); digest.update(bytes); } return hex(digest.digest()); } catch (NoSuchAlgorithmException error) { throw new StateTileDecoder.ProtocolException("SHA-256 unavailable"); } }
    private static String sha256(byte[] bytes) throws StateTileDecoder.ProtocolException { try { return hex(MessageDigest.getInstance("SHA-256").digest(bytes)); } catch (NoSuchAlgorithmException error) { throw new StateTileDecoder.ProtocolException("SHA-256 unavailable"); } }
    private static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(bytes.length * 2); for (byte value : bytes) out.append(String.format("%02x", value & 255)); return out.toString(); }
    private static Map<String, Object> object(byte[] raw) throws StateTileDecoder.ProtocolException { return object(StateTileDecoder.parseJson(raw)); }
    @SuppressWarnings("unchecked") private static Map<String, Object> object(Object value) throws StateTileDecoder.ProtocolException { if (!(value instanceof Map)) throw new StateTileDecoder.ProtocolException("JSON object expected"); return (Map<String, Object>) value; }
    private static List<?> list(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { Object result = value.get(key); if (!(result instanceof List)) throw new StateTileDecoder.ProtocolException("JSON array expected: " + key); return (List<?>) result; }
    private static String string(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { Object result = value.get(key); if (!(result instanceof String)) throw new StateTileDecoder.ProtocolException("JSON string expected: " + key); return (String) result; }
    private static String hashField(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { String result = string(value, key); if (!isHash(result)) throw new StateTileDecoder.ProtocolException("invalid SHA-256: " + key); return result; }
    private static String optionalHash(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { Object raw = value.get(key); if (raw == null) return null; if (!(raw instanceof String) || !isHash((String) raw)) throw new StateTileDecoder.ProtocolException("invalid optional SHA-256: " + key); return (String) raw; }
    private static boolean same(String left, String right) { return left == null ? right == null : left.equals(right); }
    private static int integer(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { double result = number(value, key); if (result < 0 || result != Math.rint(result) || result > Integer.MAX_VALUE) throw new StateTileDecoder.ProtocolException("invalid integer: " + key); return (int) result; }
    private static double number(Map<String, Object> value, String key) throws StateTileDecoder.ProtocolException { Object result = value.get(key); if (!(result instanceof Number) || !Double.isFinite(((Number) result).doubleValue())) throw new StateTileDecoder.ProtocolException("invalid number: " + key); return ((Number) result).doubleValue(); }
    private static boolean isHash(String value) { if (value == null || value.length() != 64) return false; for (int i = 0; i < value.length(); i++) { char c = value.charAt(i); if (!(c >= '0' && c <= '9' || c >= 'a' && c <= 'f')) return false; } return true; }
    private static long metadataBytes(StateTileDecoder.Metadata row) {
        return 520L + stringBytes(row.id) + stringBytes(row.source) + stringBytes(row.datasetVersion) + stringBytes(row.datasetSha256) + stringBytes(row.kernelSha256) + stringBytes(row.sourceChainSha256) + stringBytes(row.model) + stringBytes(row.centerId) + stringBytes(row.stateEvidence) + stringBytes(row.missingReason) + stringBytes(row.identityStatus);
    }
    private static long stringBytes(String value) { return value == null ? 0L : (long) value.length() * Character.BYTES; }
    private static void require(boolean condition, String message) throws StateTileDecoder.ProtocolException { if (!condition) throw new StateTileDecoder.ProtocolException(message); }
    private void checkLoadCancelled() throws StateTileDecoder.ProtocolException {
        if (Thread.currentThread().isInterrupted() || requestControl.cancelled.get()) {
            throw new StateTileDecoder.ProtocolException("state load cancelled");
        }
    }

    private static void checkCancelled() throws StateTileDecoder.ProtocolException { if (Thread.currentThread().isInterrupted()) throw new StateTileDecoder.ProtocolException("state load cancelled"); }
}
