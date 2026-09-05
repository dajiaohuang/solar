package io.github.dajiaohuang.solaratlas;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** One cancelable on-demand manifest + summary request, independent of rendering. */
public final class CoverageService implements Closeable {
    public static final class UnavailableException extends IOException {
        public UnavailableException() { super("Coverage report is not configured"); }
    }
    private final String base;
    private volatile boolean cancelled;
    private HttpURLConnection active;

    public CoverageService(String address) throws IOException {
        if (address == null || address.trim().isEmpty()) throw new UnavailableException();
        URL url = new URL(address.trim());
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getHost().isEmpty() || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null) {
            throw new StateTileDecoder.ProtocolException("HTTPS backend without credentials, query or fragment required");
        }
        base = address.trim().replaceAll("/+\\z", "");
    }

    public CoverageReport load() throws IOException {
        byte[] manifest = receive("v1/catalog/manifest", 8 * 1024 * 1024);
        byte[] summary = receive("v1/coverage", 64 * 1024);
        checkCancelled();
        CoverageReport report = CoverageReport.decode(summary, manifest);
        checkCancelled();
        return report;
    }

    // Shared bounded HTTPS reader for the separate on-demand identity browser.
    byte[] receive(String path, int limit) throws IOException {
        checkCancelled();
        HttpURLConnection connection = (HttpURLConnection) new URL(base + "/" + path).openConnection();
        synchronized (this) { if (cancelled) { connection.disconnect(); throw new IOException("Coverage cancelled"); } active = connection; }
        try {
            connection.setRequestMethod("GET"); connection.setConnectTimeout(10_000); connection.setReadTimeout(30_000);
            connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-store"); connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status == 404 && path.equals("v1/coverage")) throw new UnavailableException();
            if (status != 200) throw new IOException("Coverage HTTP " + status);
            long length = connection.getContentLengthLong();
            String type = connection.getHeaderField("Content-Type");
            if (length < 1 || length > limit || type == null || !"application/json".equalsIgnoreCase(type.split(";", 2)[0].trim())) {
                throw new StateTileDecoder.ProtocolException("Coverage response type or length invalid");
            }
            return readBody(connection.getInputStream(), (int) length, limit);
        } finally {
            synchronized (this) { if (active == connection) active = null; }
            connection.disconnect();
        }
    }

    byte[] readBody(InputStream input, int expected, int limit) throws IOException {
        if (expected < 1 || expected > limit) throw new StateTileDecoder.ProtocolException("Coverage response length invalid");
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream(expected)) {
            checkCancelled();
            byte[] chunk = new byte[Math.min(expected, 16 * 1024)]; int total = 0, count;
            while ((count = source.read(chunk)) != -1) {
                checkCancelled();
                if (count > expected - total) throw new StateTileDecoder.ProtocolException("Coverage exceeds declared length");
                output.write(chunk, 0, count); total += count;
            }
            checkCancelled();
            if (total != expected) throw new StateTileDecoder.ProtocolException("Coverage response incomplete");
            return output.toByteArray();
        }
    }

    private void checkCancelled() throws IOException { if (cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Coverage cancelled"); }
    @Override public void close() {
        HttpURLConnection connection;
        synchronized (this) { cancelled = true; connection = active; active = null; }
        if (connection != null) connection.disconnect();
    }
}
