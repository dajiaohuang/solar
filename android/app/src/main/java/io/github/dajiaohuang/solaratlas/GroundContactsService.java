package io.github.dajiaohuang.solaratlas;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** One active bounded HTTPS POST. The UI also supplies timed cancellation and a stale-result guard. */
public final class GroundContactsService implements Closeable {
    private final URL endpoint;
    private volatile boolean cancelled;
    private volatile boolean expired;
    private volatile Long deadlineNanos;
    private boolean running;
    private HttpURLConnection active;
    public GroundContactsService(String address) throws IOException {
        URL url = new URL(address.trim());
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getHost().isEmpty() || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null) throw new IOException("HTTPS backend without credentials, query or fragment required");
        endpoint = new URL(address.trim().replaceAll("/+\\z", "")+"/v1/observation/contacts");
    }
    public GroundContactsReport load(GroundContactsReport.Request request) throws IOException {
        synchronized (this) {
            check();
            GroundContactsReport.require(!running, "Contact search already running");
            running = true; deadlineNanos = System.nanoTime() + 25_000_000_000L;
        }
        HttpURLConnection connection = null;
        ScheduledThreadPoolExecutor timer = null;
        ScheduledFuture<?> deadline = null;
        try {
            timer = new ScheduledThreadPoolExecutor(1, action -> {
                Thread thread = new Thread(action, "solar-contact-deadline");
                thread.setDaemon(true); return thread;
            });
            deadline = timer.schedule(() -> { expired = true; close(); },
                    Math.max(0L, deadlineNanos - System.nanoTime()), TimeUnit.NANOSECONDS);
            check(); byte[] payload = request.bytes(); check();
            connection = (HttpURLConnection) endpoint.openConnection();
            synchronized (this) { check(); active = connection; }
            connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
            connection.setConnectTimeout(10_000); connection.setReadTimeout(25_000);
            connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("Accept", "application/json");
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream output = connection.getOutputStream()) { check(); output.write(payload); }
            check(); int status = connection.getResponseCode(); check();
            String type = connection.getContentType(); long length = connection.getContentLengthLong();
            GroundContactsReport.require(type != null && "application/json".equalsIgnoreCase(type.split(";", 2)[0].trim()) && length >= 1 && length <= GroundContactsReport.MAX_BYTES, "Contact response type or length invalid");
            byte[] bytes = readBody(status >= 400 ? connection.getErrorStream() : connection.getInputStream(), (int)length);
            if (status != 200) {
                Map<String,Object> error = GroundContactsReport.object(GroundContactsReport.object(StateTileDecoder.parseJson(bytes)).get("error"));
                throw new IOException("HTTP "+status+" · "+GroundContactsReport.text(error.get("code"))+": "+GroundContactsReport.text(error.get("message")));
            }
            check(); GroundContactsReport result = GroundContactsReport.decode(bytes, request); check(); return result;
        } finally {
            if (deadline != null) deadline.cancel(false);
            if (timer != null) timer.shutdownNow();
            synchronized (this) { if (active == connection) active = null; running = false; deadlineNanos = null; }
            if (connection != null) connection.disconnect();
        }
    }
    byte[] readBody(InputStream input, int expected) throws IOException {
        GroundContactsReport.require(input != null && expected > 0 && expected <= GroundContactsReport.MAX_BYTES, "Contact body size invalid");
        try (InputStream source = input) {
            check(); byte[] output = new byte[expected]; int total = 0;
            while (total < expected) {
                check(); int count = source.read(output, total, Math.min(expected - total, 16384)); check();
                if (count < 0) break;
                if (count == 0) {
                    check(); int value = source.read(); check();
                    if (value < 0) break;
                    output[total++] = (byte)value; continue;
                }
                GroundContactsReport.require(count <= expected-total, "Contact body exceeds declared length");
                total += count;
            }
            check(); GroundContactsReport.require(total == expected, "Contact body incomplete");
            int extra = source.read(); check();
            GroundContactsReport.require(extra < 0, "Contact body exceeds declared length");
            return output;
        }
    }
    private void check() throws IOException {
        Long limit = deadlineNanos;
        if (expired || limit != null && System.nanoTime() - limit >= 0) throw new IOException("Contact search deadline exceeded");
        if (cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Contact search cancelled");
    }
    @Override public void close() {
        HttpURLConnection connection;
        synchronized (this) { cancelled = true; connection = active; active = null; }
        if (connection != null) connection.disconnect();
    }
}
