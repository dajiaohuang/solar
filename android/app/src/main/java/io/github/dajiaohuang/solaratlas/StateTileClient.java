package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Minimal protocol client. It has no fallback endpoint and never fabricates a state. */
public final class StateTileClient {
    private static final String CONTENT_TYPE = "application/vnd.solar.state-tile+binary";
    private StateTileClient() {}

    /**
     * Service-owned cancellation lets a caller close an in-flight connection
     * immediately. Thread interruption remains a fallback for callers that do
     * not need an explicit lifecycle.
     */
    interface Cancellation {
        void check() throws IOException;
        void register(HttpURLConnection connection) throws IOException;
        void unregister(HttpURLConnection connection);
    }

    public static StateTileDecoder.DecodedTile fetchTile(String baseUrl, String planHash, int sequence,
                                                         int tileCount, String catalogHash,
                                                         String inventoryHash, StateTileCache cache)
            throws IOException {
        return fetchTile(baseUrl, planHash, sequence, tileCount, catalogHash, inventoryHash, cache, null);
    }

    public static StateTileDecoder.DecodedTile fetchTile(String baseUrl, String planHash, int sequence,
                                                         int tileCount, String catalogHash,
                                                         String inventoryHash, StateTileCache cache,
                                                         String cacheKey)
            throws IOException {
        return fetchTile(baseUrl, planHash, sequence, tileCount, catalogHash, inventoryHash, cache, cacheKey, null);
    }

    static StateTileDecoder.DecodedTile fetchTile(String baseUrl, String planHash, int sequence,
                                                  int tileCount, String catalogHash,
                                                  String inventoryHash, StateTileCache cache,
                                                  String cacheKey, Cancellation cancellation)
            throws IOException {
        if (!isHash(planHash) || !isHash(catalogHash) || sequence < 0 || sequence >= tileCount) {
            throw new StateTileDecoder.ProtocolException("invalid tile request identity");
        }
        HttpURLConnection connection = null;
        try {
            if (cancellation != null) cancellation.check();
            URL url = new URL(baseUrl.replaceAll("/+\\z", "") + "/v1/state/tiles");
            connection = (HttpURLConnection) url.openConnection();
            if (cancellation != null) cancellation.register(connection);
            connection.setRequestMethod("POST");
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(30_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", CONTENT_TYPE);
            byte[] request = ("{\"planId\":\"" + planHash + "\",\"sequence\":" + sequence + "}").getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(request.length);
            try (java.io.OutputStream output = connection.getOutputStream()) {
                output.write(request);
            }
            if (cancellation != null) cancellation.check();
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("state tile HTTP " + status);
            String contentType = connection.getHeaderField("Content-Type");
            if (contentType == null || !contentType.split(";", 2)[0].trim().equals(CONTENT_TYPE)) throw new StateTileDecoder.ProtocolException("state tile content type mismatch");
            long declared = connection.getContentLengthLong();
            if (declared <= 0 || declared > StateTileDecoder.MAX_TILE_BYTES) throw new StateTileDecoder.ProtocolException("state tile Content-Length is invalid");
            byte[] raw = readExact(connection.getInputStream(), (int) declared, cancellation);
            if (cancellation != null) cancellation.check();
            StateTileDecoder.DecodedTile decoded = StateTileDecoder.decode(raw, planHash, catalogHash, inventoryHash, sequence, tileCount);
            String etag = connection.getHeaderField("ETag");
            requireStrongEtag(etag, decoded.payloadSha256);
            if (cancellation != null) cancellation.check();
            if (cache != null) {
                try { cache.putByRequestKey(cacheKey == null ? decoded.payloadSha256 : cacheKey, raw); }
                catch (IOException ignored) { /* A full cache never discards a verified live observation. */ }
            }
            if (cancellation != null) cancellation.check();
            return decoded;
        } finally {
            if (cancellation != null && connection != null) cancellation.unregister(connection);
            if (connection != null) connection.disconnect();
        }
    }

    public static StateTileDecoder.DecodedTile readCachedTile(StateTileCache cache, String payloadHash,
                                                               String planHash, String catalogHash,
                                                               String inventoryHash, int sequence, int tileCount)
            throws IOException {
        byte[] raw = cache.get(payloadHash);
        if (raw == null) return null;
        return StateTileDecoder.decode(raw, planHash, catalogHash, inventoryHash, sequence, tileCount);
    }

    static byte[] readExact(InputStream input, int declaredBytes, Cancellation cancellation) throws IOException {
        try (InputStream source = input) {
            if (declaredBytes <= 0 || declaredBytes > StateTileDecoder.MAX_TILE_BYTES) throw new StateTileDecoder.ProtocolException("invalid response byte count");
            if (Thread.currentThread().isInterrupted()) throw new IOException("state tile fetch cancelled");
            if (cancellation != null) cancellation.check();
            // One final allocation, without geometric buffer growth and a second
            // full-size toByteArray copy on memory-constrained devices.
            byte[] result = new byte[declaredBytes];
            int offset = 0;
            while (offset < result.length) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("state tile fetch cancelled");
                if (cancellation != null) cancellation.check();
                int count = source.read(result, offset, Math.min(16 * 1024, result.length - offset));
                if (count < 0) throw new StateTileDecoder.ProtocolException("truncated response Content-Length");
                if (count == 0) throw new IOException("response stream made no progress");
                offset += count;
            }
            if (cancellation != null) cancellation.check();
            if (source.read() != -1) throw new StateTileDecoder.ProtocolException("response exceeds Content-Length");
            return result;
        }
    }

    static void requireStrongEtag(String value, String payloadHash) throws StateTileDecoder.ProtocolException {
        if (value == null || !value.trim().equals("\"" + payloadHash + "\"")) throw new StateTileDecoder.ProtocolException("state tile ETag mismatch");
    }

    private static boolean isHash(String value) {
        if (value == null || value.length() != 64) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (!(c >= '0' && c <= '9' || c >= 'a' && c <= 'f')) return false;
        }
        return true;
    }
}
