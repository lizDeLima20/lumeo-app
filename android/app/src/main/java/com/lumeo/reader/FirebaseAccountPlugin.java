package com.lumeo.reader;

import android.app.Activity;
import android.os.CancellationSignal;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.GoogleAuthProvider;

/**
 * The Lumeo account: Firebase Authentication with Google.
 *
 * Google's account picker is Android's own (Credential Manager), since Google refuses its
 * sign-in pages inside a WebView. The Google ID token it returns signs in to Firebase, which
 * keeps the session on the device. The first sign-in with an account creates it in Firebase,
 * so "entrar" and "cadastrar" are the same step.
 *
 * Firebase comes from android/app/google-services.json. A debug-only build may specify a
 * separate public Web client ID for a controlled sign-in experiment.
 */
@CapacitorPlugin(name = "FirebaseAccount")
public class FirebaseAccountPlugin extends Plugin {
    private static final String TAG = "FirebaseAccount";

    @PluginMethod
    public void current(PluginCall call) {
        if (!configured()) { call.resolve(state(null)); return; }
        call.resolve(state(FirebaseAuth.getInstance().getCurrentUser()));
    }

    @PluginMethod
    public void signInWithGoogle(PluginCall call) {
        Activity activity = getActivity();
        if (!configured() || activity == null) { call.reject("Firebase não está configurado neste app.", "NOT_CONFIGURED"); return; }
        String webClientId = webClientId();
        if (webClientId == null) { call.reject("O google-services.json não tem o cliente Web do login com Google.", "NO_WEB_CLIENT"); return; }
        Log.i(TAG, "google.credential started");
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(webClientId).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager.create(activity).getCredentialAsync(activity, request, new CancellationSignal(), ContextCompat.getMainExecutor(activity),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Log.i(TAG, "google.credential returned");
                    signInToFirebase(call, response.getCredential());
                }

                @Override
                public void onError(@NonNull GetCredentialException error) {
                    Log.w(TAG, "google.credential failed type=" + error.getClass().getSimpleName());
                    if (error instanceof GetCredentialCancellationException) call.reject("O Google não concluiu a entrada. Tente novamente; se o problema continuar, verifique a configuração do login.", "CANCELLED");
                    else if (error instanceof NoCredentialException) call.reject("Nenhuma conta Google neste celular.", "NO_ACCOUNT");
                    else call.reject("Não foi possível entrar com o Google.", "GOOGLE_FAILED");
                }
            });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        if (configured()) FirebaseAuth.getInstance().signOut();
        Activity activity = getActivity();
        if (activity == null) { call.resolve(state(null)); return; }
        // Also forgets the account chosen in Google's picker, so the next sign-in asks again.
        CredentialManager.create(activity).clearCredentialStateAsync(new ClearCredentialStateRequest(), new CancellationSignal(), ContextCompat.getMainExecutor(activity),
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override public void onResult(Void result) { call.resolve(state(null)); }
                @Override public void onError(@NonNull ClearCredentialException error) { call.resolve(state(null)); }
            });
    }

    private void signInToFirebase(PluginCall call, Credential credential) {
        if (!(credential instanceof CustomCredential) || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
            call.reject("O Google não devolveu uma conta.", "GOOGLE_FAILED");
            return;
        }
        String idToken;
        try { idToken = GoogleIdTokenCredential.createFrom(((CustomCredential) credential).getData()).getIdToken(); }
        catch (Exception error) { call.reject("O Google não devolveu uma conta.", "GOOGLE_FAILED"); return; }
        Log.i(TAG, "google.id_token received; firebase.signin started");
        FirebaseAuth.getInstance().signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                Log.i(TAG, "firebase.signin ok");
                call.resolve(state(FirebaseAuth.getInstance().getCurrentUser()));
            } else {
                Exception error = task.getException();
                Log.w(TAG, "firebase.signin failed type=" + (error == null ? "unknown" : error.getClass().getSimpleName())
                    + " code=" + (error instanceof FirebaseAuthException ? ((FirebaseAuthException) error).getErrorCode() : "unknown"));
                call.reject("O Firebase recusou o login. Confira o login com Google no Firebase.", "FIREBASE_FAILED");
            }
        });
    }

    private boolean configured() {
        try { return !FirebaseApp.getApps(getContext()).isEmpty(); } catch (Exception error) { return false; }
    }

    /** The alternate client is generated only for debug builds; never log either ID. */
    private String webClientId() {
        int testId = getContext().getResources().getIdentifier("lumeo_test_web_client_id", "string", getContext().getPackageName());
        int id = getContext().getResources().getIdentifier("default_web_client_id", "string", getContext().getPackageName());
        String defaultId = id == 0 ? "" : getContext().getString(id).trim();
        String testClient = testId == 0 ? "" : getContext().getString(testId).trim();
        if (!testClient.isEmpty()) {
            Log.i(TAG, "google.client debug_override differs_from_firebase=" + !testClient.equals(defaultId));
            return testClient;
        }
        Log.i(TAG, "google.client firebase_default present=" + !defaultId.isEmpty());
        return defaultId.isEmpty() ? null : defaultId;
    }

    private JSObject state(FirebaseUser user) {
        JSObject result = new JSObject();
        result.put("configured", configured());
        if (user != null) {
            JSObject account = new JSObject();
            account.put("uid", user.getUid());
            account.put("email", user.getEmail());
            account.put("displayName", user.getDisplayName());
            account.put("photoUrl", user.getPhotoUrl() == null ? null : user.getPhotoUrl().toString());
            result.put("user", account);
        }
        return result;
    }
}
