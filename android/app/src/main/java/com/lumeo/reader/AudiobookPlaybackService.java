package com.lumeo.reader;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.cache.CacheWriter;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.CommandButton;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Audiobook playback that outlives the screen: the Lumeo window can be left or the phone
 * locked, and the chapter keeps playing in a foreground service. Android shows its controls in
 * the notification shade, on the lock screen, on headset and Bluetooth buttons and on watches
 * or cars - all from this one MediaSession.
 *
 * The notification offers, in order: back 15 s, previous chapter, play/pause, next chapter,
 * forward 15 s and close. Audio focus is honoured (a call pauses the chapter) and unplugging
 * headphones pauses it. While a chapter plays it is also written in full to the device, so it
 * can be heard again offline.
 */
@OptIn(markerClass = UnstableApi.class)
public class AudiobookPlaybackService extends MediaSessionService {
    private static final String TAG = "AudiobookPlayback";
    static final String COMMAND_REWIND = "com.lumeo.reader.audiobook.REWIND_15";
    static final String COMMAND_FORWARD = "com.lumeo.reader.audiobook.FORWARD_15";
    static final String COMMAND_CLOSE = "com.lumeo.reader.audiobook.CLOSE";
    private static final String CHANNEL_ID = "lumeo_audiobook_playback";
    private static final int NOTIFICATION_ID = 7_310;

    private ExoPlayer player;
    private MediaSession session;
    private final ExecutorService cacheExecutor = Executors.newSingleThreadExecutor();
    private CacheWriter writer;
    private String writerKey;

    @Override
    public void onCreate() {
        super.onCreate();
        AudioAttributes speech = new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build();
        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(AudiobookMedia.dataSourceFactory(this)))
            .setAudioAttributes(speech, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setSeekBackIncrementMs(15_000)
            .setSeekForwardIncrementMs(15_000)
            // "Previous" always means the previous chapter, as on Lumeo's own screen.
            .setMaxSeekToPreviousPositionMs(0)
            .build();
        player.addListener(new Player.Listener() {
            @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) { keepCurrentChapter(); }
            @Override public void onPlaybackStateChanged(int state) { if (state == Player.STATE_READY) keepCurrentChapter(); }
        });

        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openApp = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        session = new MediaSession.Builder(this, player)
            .setId("lumeo-audiobooks")
            .setSessionActivity(openApp)
            .setCallback(new Callback())
            .setCustomLayout(ImmutableList.of(customButton(COMMAND_REWIND), customButton(COMMAND_FORWARD), customButton(COMMAND_CLOSE)))
            .build();
        Notifications notifications = new Notifications();
        notifications.setSmallIcon(R.drawable.ic_lumeo_audio_notification);
        setMediaNotificationProvider(notifications);
        Log.i(TAG, "audiobook.service created");
    }

    @Nullable
    @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) { return session; }

    /** Swiping Lumeo away from recent apps stops a paused chapter; a playing one goes on. */
    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        if (player == null || !player.getPlayWhenReady() || player.getMediaItemCount() == 0) stopSelf();
    }

    @Override
    public void onDestroy() {
        cancelWriter();
        cacheExecutor.shutdownNow();
        if (session != null) { session.release(); session = null; }
        if (player != null) { player.release(); player = null; }
        Log.i(TAG, "audiobook.service destroyed");
        super.onDestroy();
    }

    /** The chapter playing now is written to the device in full, in the background. */
    private void keepCurrentChapter() {
        if (player == null) return;
        MediaItem item = player.getCurrentMediaItem();
        if (item == null || item.localConfiguration == null) return;
        String uri = item.localConfiguration.uri.toString();
        String key = item.localConfiguration.customCacheKey != null ? item.localConfiguration.customCacheKey : uri;
        if (!uri.startsWith("http") || key.equals(writerKey) || AudiobookMedia.fullyCached(this, key)) return;
        cancelWriter();
        writerKey = key;
        CacheWriter next = new CacheWriter(AudiobookMedia.dataSourceFactory(this).createDataSource(), AudiobookMedia.specFor(uri, key), null, null);
        writer = next;
        cacheExecutor.execute(() -> {
            try { next.cache(); Log.i(TAG, "audiobook.chapter kept"); }
            catch (Exception error) { Log.w(TAG, "audiobook.chapter keep stopped " + error.getClass().getSimpleName()); }
            finally { if (writer == next) { writer = null; writerKey = null; } }
        });
    }

    private void cancelWriter() {
        CacheWriter current = writer;
        writer = null; writerKey = null;
        if (current != null) current.cancel();
    }

    private CommandButton customButton(String command) {
        int icon = COMMAND_REWIND.equals(command) ? R.drawable.ic_lumeo_audio_rewind : COMMAND_FORWARD.equals(command) ? R.drawable.ic_lumeo_audio_forward : R.drawable.ic_lumeo_audio_close;
        int label = COMMAND_REWIND.equals(command) ? R.string.audiobook_rewind : COMMAND_FORWARD.equals(command) ? R.string.audiobook_forward : R.string.audiobook_close;
        return new CommandButton.Builder()
            .setSessionCommand(new SessionCommand(command, Bundle.EMPTY))
            .setIconResId(icon)
            .setDisplayName(getString(label))
            .build();
    }

    private final class Callback implements MediaSession.Callback {
        @NonNull
        @Override
        public MediaSession.ConnectionResult onConnect(@NonNull MediaSession mediaSession, @NonNull MediaSession.ControllerInfo controller) {
            SessionCommands commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                .add(new SessionCommand(COMMAND_REWIND, Bundle.EMPTY))
                .add(new SessionCommand(COMMAND_FORWARD, Bundle.EMPTY))
                .add(new SessionCommand(COMMAND_CLOSE, Bundle.EMPTY))
                .build();
            return MediaSession.ConnectionResult.accept(commands, MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS);
        }

        @NonNull
        @Override
        public ListenableFuture<SessionResult> onCustomCommand(@NonNull MediaSession mediaSession, @NonNull MediaSession.ControllerInfo controller, @NonNull SessionCommand command, @NonNull Bundle args) {
            if (player != null) {
                switch (command.customAction) {
                    case COMMAND_REWIND: player.seekBack(); break;
                    case COMMAND_FORWARD: player.seekForward(); break;
                    case COMMAND_CLOSE:
                        // Close from the shade: the chapter stops and the notification goes away.
                        // The position is kept by the app, which hears that playback stopped.
                        player.pause(); player.stop(); cancelWriter();
                        break;
                    default: return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED));
                }
            }
            return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
        }
    }

    /** The shade's buttons in Lumeo's order; previous, play/pause and next stay in the compact view. */
    private final class Notifications extends DefaultMediaNotificationProvider {
        Notifications() { super(AudiobookPlaybackService.this, session -> NOTIFICATION_ID, CHANNEL_ID, R.string.audiobook_channel_name); }

        @NonNull
        @Override
        protected ImmutableList<CommandButton> getMediaButtons(@NonNull MediaSession mediaSession, @NonNull Player.Commands playerCommands,
                                                              @NonNull ImmutableList<CommandButton> customLayout, boolean showPauseButton) {
            return ImmutableList.of(
                customButton(COMMAND_REWIND),
                playerButton(Player.COMMAND_SEEK_TO_PREVIOUS, R.drawable.ic_lumeo_audio_previous, "Capítulo anterior", 0),
                playerButton(Player.COMMAND_PLAY_PAUSE, showPauseButton ? R.drawable.ic_lumeo_audio_pause : R.drawable.ic_lumeo_audio_play, showPauseButton ? "Pausar" : "Tocar", 1),
                playerButton(Player.COMMAND_SEEK_TO_NEXT, R.drawable.ic_lumeo_audio_next, "Próximo capítulo", 2),
                customButton(COMMAND_FORWARD),
                customButton(COMMAND_CLOSE));
        }

        private CommandButton playerButton(int command, int icon, String label, int compactIndex) {
            Bundle extras = new Bundle();
            extras.putInt(DefaultMediaNotificationProvider.COMMAND_KEY_COMPACT_VIEW_INDEX, compactIndex);
            return new CommandButton.Builder().setPlayerCommand(command).setIconResId(icon).setDisplayName(label).setExtras(extras).build();
        }
    }
}
