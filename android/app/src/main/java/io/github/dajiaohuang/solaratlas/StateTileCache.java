package io.github.dajiaohuang.solaratlas;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Comparator;

/** Atomic, byte-bounded tile cache. Keys are payload SHA-256 values, never URLs. */
public final class StateTileCache {
    public static final long MAX_CACHE_BYTES = 256L * 1024L * 1024L;
    private final File directory;
    private final long maxBytes;
    private long residentBytes;

    public StateTileCache(File directory) throws IOException { this(directory, MAX_CACHE_BYTES); }

    StateTileCache(File directory, long maxBytes) throws IOException {
        if (directory == null || maxBytes < 1 || maxBytes > MAX_CACHE_BYTES) throw new IllegalArgumentException("invalid tile cache limit");
        this.directory = directory;
        this.maxBytes = maxBytes;
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("cannot create tile cache directory");
        if (!directory.isDirectory()) throw new IOException("tile cache path is not a directory");
        reconcile();
    }

    public synchronized byte[] get(String payloadHash) throws IOException {
        validateKey(payloadHash);
        File file = file(payloadHash);
        if (!file.isFile()) return null;
        if (file.length() < StateTileDecoder.HEADER_BYTES || file.length() > StateTileDecoder.MAX_TILE_BYTES) { remove(file); return null; }
        byte[] bytes = read(file);
        if (!payloadHash.equals(StateTileDecoder.headerPayloadHash(bytes)) || !payloadHash.equals(StateTileDecoder.payloadHash(bytes))) { remove(file); return null; }
        if (!file.setLastModified(System.currentTimeMillis())) { /* LRU remains safe if timestamp updates are unavailable. */ }
        return bytes;
    }

    /** Reads a tile under a deterministic request key and still verifies its payload digest. */
    public synchronized byte[] getByRequestKey(String requestKey) throws IOException {
        validateKey(requestKey);
        File file = file(requestKey);
        if (!file.isFile()) return null;
        if (file.length() < StateTileDecoder.HEADER_BYTES || file.length() > StateTileDecoder.MAX_TILE_BYTES) { remove(file); return null; }
        byte[] bytes = read(file);
        if (!StateTileDecoder.headerPayloadHash(bytes).equals(StateTileDecoder.payloadHash(bytes))) { remove(file); return null; }
        file.setLastModified(System.currentTimeMillis());
        return bytes;
    }

    public synchronized void put(String payloadHash, byte[] bytes) throws IOException {
        validateKey(payloadHash);
        if (bytes == null || bytes.length < StateTileDecoder.HEADER_BYTES || bytes.length > StateTileDecoder.MAX_TILE_BYTES) throw new IOException("tile exceeds 64 MiB cache entry limit");
        if (!payloadHash.equals(StateTileDecoder.payloadHash(bytes))) throw new IOException("tile payload hash does not match cache key");
        putInternal(payloadHash, bytes);
    }

    public synchronized void putByRequestKey(String requestKey, byte[] bytes) throws IOException {
        validateKey(requestKey);
        if (bytes == null || bytes.length < StateTileDecoder.HEADER_BYTES || bytes.length > StateTileDecoder.MAX_TILE_BYTES) throw new IOException("tile exceeds 64 MiB cache entry limit");
        putInternal(requestKey, bytes);
    }

    private void putInternal(String key, byte[] bytes) throws IOException {
        File temporary = File.createTempFile(".tile-", ".tmp", directory);
        try {
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(bytes);
                output.flush();
                output.getFD().sync();
            }
            File destination = file(key);
            if (destination.exists()) {
                long oldSize = destination.length();
                if (!destination.delete()) throw new IOException("cannot replace cached tile");
                residentBytes = Math.max(0, residentBytes - oldSize);
            }
            if (!temporary.renameTo(destination)) throw new IOException("cannot atomically install cached tile");
            residentBytes += destination.length();
            trim();
        } finally {
            if (temporary.exists() && !temporary.delete()) { /* best effort cleanup */ }
        }
    }

    public synchronized long residentBytes() { return residentBytes; }

    private void reconcile() {
        residentBytes = 0;
        File[] files = directory.listFiles((dir, name) -> name.matches("[0-9a-f]{64}\\.tile"));
        if (files == null) return;
        for (File file : files) {
            if (file.length() < StateTileDecoder.HEADER_BYTES || file.length() > StateTileDecoder.MAX_TILE_BYTES) remove(file);
            else residentBytes += file.length();
        }
        trim();
    }

    private void trim() {
        File[] files = directory.listFiles((dir, name) -> name.matches("[0-9a-f]{64}\\.tile"));
        if (files == null) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File file : files) {
            if (residentBytes <= maxBytes) break;
            remove(file);
        }
    }

    private void remove(File file) {
        long size = file.length();
        if (file.delete()) residentBytes = Math.max(0, residentBytes - size);
    }

    private File file(String key) { return new File(directory, key + ".tile"); }
    private static byte[] read(File file) throws IOException { byte[] result = new byte[(int) file.length()]; try (FileInputStream input = new FileInputStream(file)) { int offset = 0; while (offset < result.length) { int n = input.read(result, offset, result.length - offset); if (n < 0) throw new IOException("truncated cached tile"); offset += n; } } return result; }
    private static void validateKey(String key) { if (key == null || key.length() != 64 || !key.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("cache key must be lowercase SHA-256"); }
}
