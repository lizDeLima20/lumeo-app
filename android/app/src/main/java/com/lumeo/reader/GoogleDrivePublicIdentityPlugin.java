package com.lumeo.reader;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.MessageDigest;

/** Exposes only public caller identity required by Google Cloud Android API-key restrictions. */
@CapacitorPlugin(name = "GoogleDrivePublicIdentity")
public class GoogleDrivePublicIdentityPlugin extends Plugin {
    @PluginMethod
    public void callerIdentity(PluginCall call) {
        try {
            PackageManager manager = getContext().getPackageManager();
            PackageInfo info;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info = manager.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
            } else {
                info = manager.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
            }
            Signature[] signatures = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.signingInfo.getApkContentsSigners() : info.signatures;
            if (signatures == null || signatures.length == 0) throw new IllegalStateException("signature_unavailable");
            byte[] digest = MessageDigest.getInstance("SHA-1").digest(signatures[0].toByteArray());
            // X-Android-Cert takes the raw SHA-1 digest as Base16 without separators.
            // The Cloud Console displays the same fingerprint with colons, but those
            // separators must not be sent in the HTTP request header.
            StringBuilder fingerprint = new StringBuilder(digest.length * 2);
            for (int index = 0; index < digest.length; index++) {
                fingerprint.append(String.format(java.util.Locale.US, "%02X", digest[index] & 0xff));
            }
            JSObject result = new JSObject();
            result.put("packageName", getContext().getPackageName());
            result.put("sha1", fingerprint.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível verificar a assinatura do aplicativo.", "DRIVE_PUBLIC_IDENTITY_UNAVAILABLE", error);
        }
    }
}
