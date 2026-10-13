package com.lumeo.reader;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;

import java.lang.ref.WeakReference;
import java.util.Collections;

/**
 * Native Google Identity authorization for Drive. The account selector and
 * consent UI are provided by Google Play services, never by the WebView.
 */
@CapacitorPlugin(name = "GoogleDriveAuthorization")
public class GoogleDriveAuthorizationPlugin extends Plugin {
    private static final int REQUEST_AUTHORIZE_DRIVE = 7419;
    private static WeakReference<GoogleDriveAuthorizationPlugin> active = new WeakReference<>(null);
    private PluginCall pending;

    @PluginMethod
    public void authorize(PluginCall call) {
        if (pending != null) {
            call.reject("GOOGLE_OAUTH_IN_PROGRESS");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("GOOGLE_OAUTH_UNAVAILABLE");
            return;
        }
        pending = call;
        active = new WeakReference<>(this);
        String scope = call.getString("scope", "https://www.googleapis.com/auth/drive.readonly");
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(scope)))
            .build();
        Identity.getAuthorizationClient(activity).authorize(request)
            .addOnSuccessListener(result -> launchOrResolve(activity, result))
            .addOnFailureListener(error -> rejectPending("GOOGLE_OAUTH_FAILED"));
    }

    private void launchOrResolve(Activity activity, AuthorizationResult result) {
        if (!result.hasResolution()) {
            resolve(result);
            return;
        }
        try {
            activity.startIntentSenderForResult(result.getPendingIntent().getIntentSender(), REQUEST_AUTHORIZE_DRIVE, null, 0, 0, 0);
        } catch (IntentSender.SendIntentException error) {
            rejectPending("GOOGLE_OAUTH_FAILED");
        }
    }

    /** Called by MainActivity because the Google resolution returns an IntentSender result. */
    public static boolean handleActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        GoogleDriveAuthorizationPlugin plugin = active.get();
        if (plugin == null || requestCode != REQUEST_AUTHORIZE_DRIVE) return false;
        if (resultCode != Activity.RESULT_OK || data == null) {
            plugin.rejectPending("GOOGLE_OAUTH_CANCELLED");
            return true;
        }
        try {
            plugin.resolve(Identity.getAuthorizationClient(plugin.getActivity()).getAuthorizationResultFromIntent(data));
        } catch (Exception error) {
            plugin.rejectPending("GOOGLE_OAUTH_ACCESS_DENIED");
        }
        return true;
    }

    private void resolve(AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.trim().isEmpty()) {
            rejectPending("GOOGLE_OAUTH_ACCESS_DENIED");
            return;
        }
        PluginCall call = pending;
        pending = null;
        active = new WeakReference<>(null);
        JSObject response = new JSObject();
        response.put("accessToken", token);
        call.resolve(response);
    }

    private void rejectPending(String code) {
        PluginCall call = pending;
        pending = null;
        active = new WeakReference<>(null);
        if (call != null) call.reject(code);
    }
}
