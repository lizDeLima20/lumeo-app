package com.lumeo.reader;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * The audiobook screen's bridge to {@link AudiobookPlaybackService}. The web layer gives the
 * queue (Drive URLs, titles, cover) and the Drive request headers; everything else - playing
 * on with the screen off, the notification and lock-screen controls, focus and headsets - is
 * the service's. The current state is sent back as "state" events (on every change, and every
 * second while playing) so the screen and the saved position follow the notification too.
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "NativeAudiobook")
public class NativeAudiobookPlugin extends Plugin {
    private static final String TAG = "NativeAudiobook";
    private final Handler main = new Handler(Looper.getMainLooper());
    private ListenableFuture<MediaController> connecting;
    private MediaController controller;
    private final List<Consumer<MediaController>> waiting = new ArrayList<>();
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (controller == null) return;
            emit();
            if (controller.isPlaying()) main.postDelayed(this, 1000);
        }
    };

    @Override
    public void load() { main.post(this::connect); }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(tick);
        if (controller != null) { controller.release(); controller = null; }
        else if (connecting != null) MediaController.releaseFuture(connecting);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void open(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) { call.reject("Nenhum capítulo para tocar.", "AUDIO_QUEUE_EMPTY"); return; }
        List<MediaItem> queue = new ArrayList<>();
        Map<String, Map<String, String>> perUrl = new HashMap<>();
        try {
            for (int index = 0; index < items.length(); index++) {
                JSONObject item = items.getJSONObject(index);
                String id = item.getString("id"), uri = item.getString("uri");
                if (!uri.startsWith("https://") && !uri.startsWith("file:")) throw new IllegalArgumentException("uri");
                MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                    .setTitle(item.optString("title", ""))
                    .setArtist(item.optString("collection", ""))
                    .setAlbumTitle(item.optString("collection", ""));
                // The chapter as the web layer knows it, so a reopened screen can show what the
                // service is playing even though its own queue was lost with the old WebView.
                Bundle extras = new Bundle();
                extras.putString("chapter", item.optString("chapter", ""));
                metadata.setExtras(extras);
                String artwork = item.optString("artworkUri", "");
                if (artwork.startsWith("https://")) metadata.setArtworkUri(Uri.parse(artwork));
                queue.add(new MediaItem.Builder().setMediaId(id).setUri(uri).setCustomCacheKey(id).setMediaMetadata(metadata.build()).build());
                JSONObject headers = item.optJSONObject("headers");
                if (headers != null) perUrl.put(uri, toMap(headers));
            }
        } catch (Exception error) {
            call.reject("Fila de capítulos inválida.", "AUDIO_QUEUE_INVALID");
            return;
        }
        JSObject common = call.getObject("headers", new JSObject());
        AudiobookMedia.setHeaders(toMap(common), perUrl);
        final int start = Math.max(0, Math.min(queue.size() - 1, call.getInt("index", 0)));
        final long position = Math.max(0, call.getLong("positionMs", 0L));
        final float speed = call.getFloat("speed", 1f);
        final boolean play = Boolean.TRUE.equals(call.getBoolean("play", true));
        withController(player -> {
            player.setMediaItems(queue, start, position);
            player.setPlaybackSpeed(speed);
            player.prepare();
            player.setPlayWhenReady(play);
            Log.i(TAG, "audiobook.load items=" + queue.size() + " index=" + start);
            call.resolve(state(player));
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        withController(player -> {
            // After "close" in the notification, or the end of the last chapter, start again.
            if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
            if (player.getPlaybackState() == Player.STATE_ENDED) player.seekToDefaultPosition();
            player.play(); call.resolve(state(player));
        });
    }
    @PluginMethod public void pause(PluginCall call) { withController(player -> { player.pause(); call.resolve(state(player)); }); }
    @PluginMethod public void next(PluginCall call) { withController(player -> { if (player.hasNextMediaItem()) player.seekToNextMediaItem(); call.resolve(state(player)); }); }
    @PluginMethod public void previous(PluginCall call) { withController(player -> { if (player.hasPreviousMediaItem()) player.seekToPreviousMediaItem(); call.resolve(state(player)); }); }
    @PluginMethod public void stop(PluginCall call) { withController(player -> { player.pause(); player.stop(); call.resolve(state(player)); }); }

    @PluginMethod
    public void seekTo(PluginCall call) {
        final long position = Math.max(0, call.getLong("positionMs", 0L));
        withController(player -> { player.seekTo(position); call.resolve(state(player)); });
    }

    @PluginMethod
    public void seekBy(PluginCall call) {
        final long delta = call.getLong("deltaMs", 0L);
        withController(player -> {
            long duration = player.getDuration();
            long target = Math.max(0, player.getCurrentPosition() + delta);
            if (duration != C.TIME_UNSET) target = Math.min(target, duration);
            player.seekTo(target); call.resolve(state(player));
        });
    }

    @PluginMethod
    public void setSpeed(PluginCall call) {
        final float speed = call.getFloat("speed", 1f);
        withController(player -> { player.setPlaybackSpeed(speed); call.resolve(state(player)); });
    }

    @PluginMethod
    public void getState(PluginCall call) { withController(player -> call.resolve(state(player))); }

    private void connect() {
        if (controller != null || connecting != null) return;
        SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), AudiobookPlaybackService.class));
        connecting = new MediaController.Builder(getContext(), token).buildAsync();
        connecting.addListener(() -> {
            try {
                controller = connecting.get();
                controller.addListener(new Player.Listener() {
                    @Override public void onEvents(@NonNull Player player, @NonNull Player.Events events) {
                        emit();
                        main.removeCallbacks(tick);
                        if (player.isPlaying()) main.postDelayed(tick, 1000);
                    }
                });
                List<Consumer<MediaController>> ready = new ArrayList<>(waiting); waiting.clear();
                for (Consumer<MediaController> action : ready) action.accept(controller);
                emit();
            } catch (Exception error) {
                Log.w(TAG, "audiobook.connect failed " + error.getClass().getSimpleName());
                connecting = null;
                List<Consumer<MediaController>> failed = new ArrayList<>(waiting); waiting.clear();
                for (Consumer<MediaController> ignored : failed) Log.w(TAG, "audiobook.command dropped");
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    /** Runs on the main thread, once the session is connected. */
    private void withController(Consumer<MediaController> action) {
        main.post(() -> {
            if (controller != null) { action.accept(controller); return; }
            waiting.add(action);
            connect();
        });
    }

    private void emit() {
        if (controller == null) return;
        notifyListeners("state", state(controller));
    }

    private JSObject state(Player player) {
        JSObject result = new JSObject();
        MediaItem item = player.getCurrentMediaItem();
        result.put("id", item == null ? null : item.mediaId);
        Bundle extras = item == null ? null : item.mediaMetadata.extras;
        result.put("chapter", extras == null ? null : extras.getString("chapter"));
        result.put("index", player.getCurrentMediaItemIndex());
        result.put("count", player.getMediaItemCount());
        result.put("playing", player.isPlaying());
        result.put("playWhenReady", player.getPlayWhenReady());
        int playbackState = player.getPlaybackState();
        result.put("buffering", playbackState == Player.STATE_BUFFERING);
        result.put("ended", playbackState == Player.STATE_ENDED);
        result.put("idle", playbackState == Player.STATE_IDLE);
        result.put("positionMs", Math.max(0, player.getCurrentPosition()));
        long duration = player.getDuration();
        result.put("durationMs", duration == C.TIME_UNSET ? 0 : duration);
        result.put("speed", player.getPlaybackParameters().speed);
        result.put("cachedPercent", item == null ? -1 : AudiobookMedia.cachedPercent(getContext(), item.mediaId));
        PlaybackException error = player.getPlayerError();
        if (error != null) result.put("error", error.getErrorCodeName());
        return result;
    }

    private static Map<String, String> toMap(JSONObject object) {
        Map<String, String> result = new HashMap<>();
        if (object == null) return result;
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) { String key = keys.next(); String value = object.optString(key, ""); if (!value.isEmpty()) result.put(key, value); }
        return result;
    }
}
