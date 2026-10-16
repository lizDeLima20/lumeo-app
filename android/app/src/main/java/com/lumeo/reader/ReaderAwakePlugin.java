package com.lumeo.reader;

import android.app.Activity;
import android.util.Log;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the screen on while a book or a comic is open, for the Lumeo window only.
 *
 * It sets FLAG_KEEP_SCREEN_ON on this Activity's window, which Android honours only while
 * the window is in front: no system setting is written, no wake-lock permission is needed,
 * and nothing outlives the reader - on another app, with the phone locked by its own button
 * or after the reader closes, the phone's own screen timeout applies again.
 */
@CapacitorPlugin(name = "ReaderAwake")
public class ReaderAwakePlugin extends Plugin {
    private static final String TAG = "ReaderAwake";

    /** Whether a reader is currently asking for the screen to stay on. */
    private boolean awake = false;

    @PluginMethod
    public void keep(PluginCall call) {
        awake = true;
        apply(call);
    }

    @PluginMethod
    public void release(PluginCall call) {
        awake = false;
        apply(call);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("awake", awake);
        call.resolve(result);
    }

    /** A recreated Activity (rotation, theme change) gets a new window: re-apply the flag. */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (awake) apply(null);
    }

    /** Leaving nothing behind: the flag goes with the window. */
    @Override
    protected void handleOnDestroy() {
        awake = false;
        super.handleOnDestroy();
    }

    private void apply(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            if (call != null) call.reject("NO_ACTIVITY");
            return;
        }
        final boolean on = awake;
        activity.runOnUiThread(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            Log.i(TAG, "reader.awake " + on);
            if (call != null) {
                JSObject result = new JSObject();
                result.put("awake", on);
                call.resolve(result);
            }
        });
    }
}
