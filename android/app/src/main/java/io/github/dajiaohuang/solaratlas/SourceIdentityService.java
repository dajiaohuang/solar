package io.github.dajiaohuang.solaratlas;

import java.io.Closeable;
import java.io.IOException;
import java.net.URLEncoder;

/** One bounded, cancellable source page; never walks the full inventory implicitly. */
public final class SourceIdentityService implements Closeable {
    private final CoverageService transport;
    private final String base;
    private volatile boolean cancelled;
    public SourceIdentityService(String address) throws IOException {
        transport = new CoverageService(address); base = address.trim().replaceAll("/+\\z", "");
    }
    public SourceIdentityPage load(String input, SourceIdentityPage previous) throws IOException {
        String query = SourceIdentityPage.text(input, true, 256).trim();
        if (previous != null) SourceIdentityPage.require(base.equals(previous.base) && query.equals(previous.query) && !previous.next.isEmpty(), "Cursor belongs to another query or backend");
        byte[] manifest = transport.receive("v1/catalog/manifest", 8 * 1024 * 1024);
        if (previous != null) previous.requireManifest(manifest);
        String path = "v1/identities?q=" + URLEncoder.encode(query, "UTF-8") + "&limit=" + SourceIdentityPage.SIZE;
        if (previous != null) path += "&pageToken=" + URLEncoder.encode(previous.next, "UTF-8");
        SourceIdentityPage page = SourceIdentityPage.decode(transport.receive(path, 256 * 1024), manifest, base, query);
        SourceIdentityPage.require(previous == null || page.next.isEmpty() || !page.next.equals(previous.next), "Source cursor did not advance");
        if (cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Source query cancelled");
        return page;
    }
    @Override public void close() { cancelled = true; transport.close(); }
}
