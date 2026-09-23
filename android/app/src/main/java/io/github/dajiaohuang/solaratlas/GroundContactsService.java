package io.github.dajiaohuang.solaratlas;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/** One bounded HTTPS POST. The owning UI supplies a total deadline and stale-result guard. */
public final class GroundContactsService implements Closeable {
    private final URL endpoint;
    private volatile boolean cancelled;
    private HttpURLConnection active;
    public GroundContactsService(String address) throws IOException {
        URL url = new URL(address.trim());
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getHost().isEmpty() || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null) throw new IOException("HTTPS backend without credentials, query or fragment required");
        endpoint = new URL(address.trim().replaceAll("/+\\z", "")+"/v1/observation/contacts");
    }
    public GroundContactsReport load(GroundContactsReport.Request request) throws IOException {
        check(); HttpURLConnection connection = (HttpURLConnection) endpoint.openConnection();
        synchronized (this) { if (cancelled) { connection.disconnect(); throw new IOException("Contact search cancelled"); } active = connection; }
        try {
            connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
            connection.setConnectTimeout(10_000); connection.setReadTimeout(25_000);
            connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("Accept", "application/json");
            byte[] payload = request.bytes(); connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream output = connection.getOutputStream()) { check(); output.write(payload); }
            check(); int status = connection.getResponseCode();
            String type = connection.getContentType(); long length = connection.getContentLengthLong();
            GroundContactsReport.require(type != null && "application/json".equalsIgnoreCase(type.split(";", 2)[0].trim()) && length >= 1 && length <= GroundContactsReport.MAX_BYTES, "Contact response type or length invalid");
            byte[] bytes = readBody(status >= 400 ? connection.getErrorStream() : connection.getInputStream(), (int)length);
            if (status != 200) {
                Map<String,Object> error = GroundContactsReport.object(GroundContactsReport.object(StateTileDecoder.parseJson(bytes)).get("error"));
                throw new IOException("HTTP "+status+" · "+GroundContactsReport.text(error.get("code"))+": "+GroundContactsReport.text(error.get("message")));
            }
            GroundContactsReport result = GroundContactsReport.decode(bytes, request); check(); return result;
        } finally {
            synchronized (this) { if (active == connection) active = null; }
            connection.disconnect();
        }
    }
    byte[] readBody(InputStream input, int expected) throws IOException {
        GroundContactsReport.require(input != null && expected > 0 && expected <= GroundContactsReport.MAX_BYTES, "Contact body size invalid");
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream(expected)) {
            check(); byte[] chunk = new byte[Math.min(expected, 16384)]; int total = 0, count;
            while ((count = source.read(chunk)) != -1) { check(); GroundContactsReport.require(count <= expected-total, "Contact body exceeds declared length"); output.write(chunk, 0, count); total += count; }
            check(); GroundContactsReport.require(total == expected, "Contact body incomplete"); return output.toByteArray();
        }
    }
    private void check() throws IOException { if (cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Contact search cancelled"); }
    @Override public void close() {
        HttpURLConnection connection;
        synchronized (this) { cancelled = true; connection = active; active = null; }
        if (connection != null) connection.disconnect();
    }
}
