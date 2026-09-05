package io.github.dajiaohuang.solaratlas;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Minimal protocol client. It has no fallback endpoint and never fabricates a state. */
public final class StateTileClient {
    private static final String CONTENT_TYPE = "application/vnd.solar.state-tile+binary";
    private StateTileClient() {}

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
        if (!isHash(planHash) || !isHash(catalogHash) || sequence < 0 || sequence >= tileCount) {
            throw new StateTileDecoder.ProtocolException("invalid tile request identity");
        }
        HttpURLConnection connection = null;
        try {
            URL url = new URL(baseUrl.replaceAll("/+\\z", "") + "/v1/state/tiles");
            connection = (HttpURLConnection) url.openConnection();
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
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("state tile HTTP " + status);
            String contentType = connection.getHeaderField("Content-Type");
            if (contentType == null || !contentType.split(";", 2)[0].trim().equals(CONTENT_TYPE)) throw new StateTileDecoder.ProtocolException("state tile content type mismatch");
            long declared = connection.getContentLengthLong();
            if (declared <= 0 || declared > StateTileDecoder.MAX_TILE_BYTES) throw new StateTileDecoder.ProtocolException("state tile Content-Length is invalid");
            byte[] raw = readBounded(connection.getInputStream(), StateTileDecoder.MAX_TILE_BYTES);
            StateTileDecoder.DecodedTile decoded = StateTileDecoder.decode(raw, planHash, catalogHash, inventoryHash, sequence, tileCount);
            String etag = connection.getHeaderField("ETag");
            if (etag == null || !stripQuotes(etag).equals(decoded.payloadSha256)) throw new StateTileDecoder.ProtocolException("state tile ETag mismatch");
            if (cache != null) {
                try { cache.putByRequestKey(cacheKey == null ? decoded.payloadSha256 : cacheKey, raw); }
                catch (IOException ignored) { /* A full cache never discards a verified live observation. */ }
            }
            return decoded;
        } finally {
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

    private static byte[] readBounded(InputStream input, int maxBytes) throws IOException {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(maxBytes, 64 * 1024))) {
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int count;
            while ((count = source.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("state tile fetch cancelled");
                if (count > maxBytes - total) throw new StateTileDecoder.ProtocolException("state tile exceeds 64 MiB");
                output.write(buffer, 0, count);
                total += count;
            }
            return output.toByteArray();
        }
    }

    private static String stripQuotes(String value) {
        String trimmed = value.trim();
        if (trimmed.startsWith("W/")) trimmed = trimmed.substring(2).trim();
        if (trimmed.length() >= 2 && trimmed.charAt(0) == '"' && trimmed.charAt(trimmed.length() - 1) == '"') return trimmed.substring(1, trimmed.length() - 1);
        return trimmed;
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
