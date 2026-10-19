package com.lumeo.reader;

import android.content.Context;
import android.net.Uri;

import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.datasource.cache.Cache;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.ContentMetadata;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;

import java.io.File;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * What the audiobook player and its plugin share in this process: the chapters kept on the
 * device, and how a chapter is read from Google Drive.
 *
 * A chapter is streamed from Drive and written to a private cache as it is read, so it starts
 * at once and is then available offline. The cache is never evicted automatically (a chapter
 * once kept stays kept); it lives in the app's private files, so it goes only with the app.
 * The Drive request headers (the public API key with this app's identity, or a session token,
 * plus a file's resource key) are given by the web layer; they are kept only in memory.
 */
@OptIn(markerClass = UnstableApi.class)
final class AudiobookMedia {
    private static SimpleCache cache;
    private static final Map<String, String> commonHeaders = new ConcurrentHashMap<>();
    /** Extra headers per Drive URL (a resource key belongs to one file). */
    private static final Map<String, Map<String, String>> fileHeaders = new ConcurrentHashMap<>();

    private AudiobookMedia() {}

    static synchronized Cache cache(Context context) {
        if (cache == null) {
            File directory = new File(context.getApplicationContext().getFilesDir(), "lumeo-audiobook-cache");
            cache = new SimpleCache(directory, new NoOpCacheEvictor(), new StandaloneDatabaseProvider(context.getApplicationContext()));
        }
        return cache;
    }

    static void setHeaders(Map<String, String> common, Map<String, Map<String, String>> perUrl) {
        commonHeaders.clear();
        if (common != null) commonHeaders.putAll(common);
        if (perUrl != null) fileHeaders.putAll(perUrl);
    }

    /** Reads through the cache; on a miss, from Drive with the headers for that file. */
    static CacheDataSource.Factory dataSourceFactory(Context context) {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(30_000)
            .setReadTimeoutMs(30_000)
            .setUserAgent("Lumeo-Android");
        ResolvingDataSource.Factory withHeaders = new ResolvingDataSource.Factory(http, dataSpec -> {
            Map<String, String> headers = new HashMap<>(commonHeaders);
            Map<String, String> extra = fileHeaders.get(dataSpec.uri.toString());
            if (extra != null) headers.putAll(extra);
            return headers.isEmpty() ? dataSpec : dataSpec.withAdditionalHeaders(headers);
        });
        return new CacheDataSource.Factory()
            .setCache(cache(context))
            .setUpstreamDataSourceFactory(withHeaders)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    }

    /** Share of a chapter kept on the device, 0-100, or -1 when its size is not known yet. */
    static int cachedPercent(Context context, String key) {
        Cache value = cache(context);
        long length = ContentMetadata.getContentLength(value.getContentMetadata(key));
        if (length <= 0) return -1;
        long cached = value.getCachedBytes(key, 0, length);
        return (int) Math.max(0, Math.min(100, cached * 100 / length));
    }

    static boolean fullyCached(Context context, String key) {
        return cachedPercent(context, key) >= 100;
    }

    static DataSpec specFor(String uri, String key) {
        return new DataSpec.Builder().setUri(Uri.parse(uri)).setKey(key).build();
    }
}
