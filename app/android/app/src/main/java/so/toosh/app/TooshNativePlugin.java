package so.toosh.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.Executor;

import so.toosh.app.core.SimRouter;
import so.toosh.app.data.SmsStore;
import so.toosh.app.net.Sync;
import so.toosh.app.sms.InboxImport;

/** Bridge between the web UI (app/src/lib/native.ts) and the native SMS layer. */
@CapacitorPlugin(name = "TooshNative", permissions = {
    @Permission(alias = "sms", strings = {Manifest.permission.RECEIVE_SMS}),
    @Permission(alias = "readSms", strings = {Manifest.permission.READ_SMS}),
    @Permission(alias = "phone", strings = {Manifest.permission.READ_PHONE_STATE}),
    @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"}),
})
public class TooshNativePlugin extends Plugin {
    private so.toosh.app.data.Settings settings;
    private SmsStore store;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable emit = () -> notifyListeners("queueChanged", status());
    private final SmsStore.Listener listener = () -> { main.removeCallbacks(emit); main.postDelayed(emit, 300); };

    @Override public void load() {
        settings = new so.toosh.app.data.Settings(getContext());
        store = SmsStore.get(getContext());
        SmsStore.addListener(listener);
    }
    @Override protected void handleOnDestroy() { SmsStore.removeListener(listener); }

    // ---- permissions ---------------------------------------------------------------------------------------------
    private String permissionName(String alias) {
        switch (alias) {
            case "sms": return Manifest.permission.RECEIVE_SMS;
            case "readSms": return Manifest.permission.READ_SMS;
            case "phone": return Manifest.permission.READ_PHONE_STATE;
            default: return "android.permission.POST_NOTIFICATIONS";
        }
    }
    private SharedPreferences asked() { return getContext().getSharedPreferences("toosh_permissions", Context.MODE_PRIVATE); }

    /** GRANTED, NOT_ASKED, DENIED (can ask again) or PERMANENTLY_DENIED (only Settings can change it). */
    private String state(String alias) {
        if ("notifications".equals(alias) && Build.VERSION.SDK_INT < 33) return "GRANTED";
        String p = permissionName(alias);
        if (ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED) return "GRANTED";
        if (!asked().getBoolean(alias, false)) return "NOT_ASKED";
        if (getActivity() != null && ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), p)) return "DENIED";
        return "PERMANENTLY_DENIED";
    }
    private void request(PluginCall call, String alias) {
        String s = state(alias);
        if ("GRANTED".equals(s) || "PERMANENTLY_DENIED".equals(s)) { call.resolve(new JSObject().put("state", s)); return; }
        asked().edit().putBoolean(alias, true).apply();
        requestPermissionForAlias(alias, call, "permissionResult");
    }
    @PermissionCallback private void permissionResult(PluginCall call) {
        String alias = call.getMethodName().equals("requestSmsPermission") ? "sms" : call.getMethodName().equals("requestReadSmsPermission") ? "readSms"
            : call.getMethodName().equals("requestPhoneStatePermission") ? "phone" : "notifications";
        String s = state(alias);
        if ("sms".equals(alias) && "GRANTED".equals(s)) Sync.uploadSoon(getContext());
        call.resolve(new JSObject().put("state", s));
        listener.onChanged();
    }
    @PluginMethod public void requestSmsPermission(PluginCall call) { request(call, "sms"); }
    @PluginMethod public void requestReadSmsPermission(PluginCall call) { request(call, "readSms"); }
    @PluginMethod public void requestPhoneStatePermission(PluginCall call) { request(call, "phone"); }
    @PluginMethod public void requestNotificationPermission(PluginCall call) { request(call, "notifications"); }
    @PluginMethod public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    // ---- session and status ----------------------------------------------------------------------------------------
    @PluginMethod public void getSession(PluginCall call) {
        call.resolve(new JSObject().put("token", settings.token()).put("accountId", settings.accountId()));
    }
    @PluginMethod public void setSession(PluginCall call) {
        String token = call.getString("token");
        settings.setSession(token, call.getString("accountId"), call.getString("apiBase"), call.getString("deviceId"));
        if (token != null) { Sync.schedulePeriodic(getContext()); Sync.uploadSoon(getContext()); }
        call.resolve();
    }

    private static String iso(long millis) {
        if (millis <= 0) return null;
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(millis));
    }
    private boolean online() {
        ConnectivityManager cm = getContext().getSystemService(ConnectivityManager.class);
        if (cm == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private JSObject status() {
        String account = settings.accountId();
        JSObject q = new JSObject();
        q.put("pending", store.count(account, "PENDING"));
        q.put("uploading", store.count(account, "UPLOADING"));
        q.put("failed", store.count(account, "FAILED") + store.count(account, "REJECTED"));
        q.put("unmatched", store.count(account, "UNMATCHED") + store.count(account, "OTHER_SIM"));
        q.put("synced", store.count(account, "SYNCED"));
        JSArray mappings = new JSArray();
        for (SimRouter.Mapping m : settings.mappings()) {
            mappings.put(new JSObject().put("subscriptionId", m.subscriptionId).put("simSlot", m.simSlot).put("evcNumberId", m.evcNumberId).put("accountId", m.accountId));
        }
        JSObject s = new JSObject();
        s.put("smsPermission", state("sms")); s.put("readSmsPermission", state("readSms"));
        s.put("phoneStatePermission", state("phone")); s.put("notificationPermission", state("notifications"));
        s.put("queue", q);
        s.put("lastUploadAt", iso(settings.lastUploadAt())); s.put("lastAttemptAt", iso(settings.lastAttemptAt()));
        s.put("lastError", settings.lastError()); s.put("authProblem", settings.authProblem()); s.put("online", online());
        s.put("deviceModel", (Build.MANUFACTURER + " " + Build.MODEL).trim()); s.put("androidVersion", Build.VERSION.RELEASE);
        s.put("appVersion", BuildConfig.VERSION_NAME); s.put("mappings", mappings);
        s.put("strictFilter", settings.strictFilter()); s.put("notifyNew", settings.notifyNew()); s.put("notifyPending", settings.notifyPending());
        s.put("importDoneAt", iso(settings.importDoneAt()));
        return s;
    }
    @PluginMethod public void getStatus(PluginCall call) { call.resolve(status()); }

    // ---- SIMs and mappings -----------------------------------------------------------------------------------------
    @PluginMethod public void listSims(PluginCall call) {
        JSArray sims = new JSArray();
        if (!"GRANTED".equals(state("phone"))) { call.resolve(new JSObject().put("sims", sims)); return; }
        try {
            SubscriptionManager sm = getContext().getSystemService(SubscriptionManager.class);
            List<SubscriptionInfo> list = sm == null ? null : sm.getActiveSubscriptionInfoList();
            if (list != null) for (SubscriptionInfo info : list) {
                String number = null;
                try { number = info.getNumber(); } catch (Exception ignored) { }
                sims.put(new JSObject().put("subscriptionId", info.getSubscriptionId()).put("simSlot", info.getSimSlotIndex())
                    .put("carrierName", info.getCarrierName() == null ? null : info.getCarrierName().toString())
                    .put("displayName", info.getDisplayName() == null ? null : info.getDisplayName().toString())
                    .put("number", number == null || number.isEmpty() ? null : number));
            }
        } catch (SecurityException ignored) { }
        call.resolve(new JSObject().put("sims", sims));
    }

    @PluginMethod public void setSourceMappings(PluginCall call) {
        JSArray arr = call.getArray("mappings", new JSArray());
        List<SimRouter.Mapping> list = new ArrayList<>();
        try {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                if (!o.optString("accountId").equals(settings.accountId())) continue;
                list.add(new SimRouter.Mapping(o.isNull("subscriptionId") ? null : o.getInt("subscriptionId"), o.isNull("simSlot") ? null : o.getInt("simSlot"),
                    o.getString("evcNumberId"), o.getString("accountId")));
            }
        } catch (Exception e) { call.reject("Invalid mappings"); return; }
        settings.setMappings(list);
        if (call.getBoolean("strictFilter") != null) settings.setStrictFilter(call.getBoolean("strictFilter"));
        Sync.schedulePeriodic(getContext());
        listener.onChanged();
        call.resolve();
    }

    @PluginMethod public void setPreferences(PluginCall call) {
        if (call.getBoolean("notifyNew") != null) settings.setNotifyNew(call.getBoolean("notifyNew"));
        if (call.getBoolean("notifyPending") != null) settings.setNotifyPending(call.getBoolean("notifyPending"));
        if (call.getBoolean("strictFilter") != null) settings.setStrictFilter(call.getBoolean("strictFilter"));
        listener.onChanged();
        call.resolve();
    }

    // ---- queue ------------------------------------------------------------------------------------------------------
    @PluginMethod public void startInitialImport(PluginCall call) {
        if (!"GRANTED".equals(state("readSms"))) { call.reject("READ_SMS permission is required"); return; }
        int days = call.getInt("days", 30);
        new Thread(() -> {
            try {
                InboxImport.Counts c = InboxImport.run(getContext(), days);
                call.resolve(new JSObject().put("scanned", c.scanned).put("queued", c.queued).put("duplicates", c.duplicates));
            } catch (Exception e) { call.reject("Import failed"); }
        }, "toosh-import").start();
    }

    @PluginMethod public void getLocalMessages(PluginCall call) {
        int limit = Math.max(1, Math.min(call.getInt("limit", 50), 200));
        JSArray out = new JSArray();
        for (SmsStore.Row r : store.list(settings.accountId(), call.getBoolean("unsyncedOnly", true), limit)) {
            out.put(new JSObject().put("localId", r.localId).put("clientMessageId", r.clientMessageId).put("sender", r.sender).put("body", r.body)
                .put("smsTimestamp", iso(r.smsTimestamp)).put("receivedAt", iso(r.receivedAt)).put("simSubscriptionId", r.subscriptionId)
                .put("simSlot", r.simSlot).put("evcNumberId", r.evcNumberId).put("importMethod", r.importMethod).put("partsCount", r.parts)
                .put("state", "OTHER_SIM".equals(r.state) ? "UNMATCHED" : "REJECTED".equals(r.state) ? "FAILED" : r.state)
                .put("attempts", r.attempts).put("lastError", r.lastError).put("serverMessageId", r.serverMessageId));
        }
        call.resolve(new JSObject().put("messages", out));
    }

    @PluginMethod public void assignUnmatched(PluginCall call) {
        String number = call.getString("evcNumberId");
        boolean known = false;
        for (SimRouter.Mapping m : settings.mappings()) if (m.evcNumberId.equals(number)) known = true;
        if (!known) { call.reject("Unknown number"); return; }
        List<String> ids = new ArrayList<>();
        try { JSONArray a = call.getArray("localIds"); for (int i = 0; i < a.length(); i++) ids.add(a.getString(i)); } catch (Exception e) { call.reject("Invalid ids"); return; }
        int n = store.assign(ids, number, settings.accountId());
        if (n > 0) Sync.uploadSoon(getContext());
        call.resolve(new JSObject().put("updated", n));
    }

    @PluginMethod public void retryFailed(PluginCall call) {
        settings.setAuthProblem(false);
        store.retryFailedNow();
        Sync.uploadSoon(getContext());
        call.resolve();
    }
    @PluginMethod public void syncNow(PluginCall call) { Sync.uploadSoon(getContext()); call.resolve(); }

    // ---- app lock ---------------------------------------------------------------------------------------------------
    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    @PluginMethod public void canAuthenticate(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        call.resolve(new JSObject().put("available", r == BiometricManager.BIOMETRIC_SUCCESS));
    }

    @PluginMethod public void authenticate(PluginCall call) {
        if (BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS) != BiometricManager.BIOMETRIC_SUCCESS) {
            call.resolve(new JSObject().put("success", false).put("error", "Taleefanka qufulkiisa (PIN ama faraha) ma daarna."));
            return;
        }
        FragmentActivity activity = getActivity();
        Executor executor = ContextCompat.getMainExecutor(getContext());
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(activity, executor, new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) { call.resolve(new JSObject().put("success", true).put("error", null)); }
                @Override public void onAuthenticationError(int code, CharSequence message) { call.resolve(new JSObject().put("success", false).put("error", message.toString())); }
            });
            prompt.authenticate(new BiometricPrompt.PromptInfo.Builder().setTitle(call.getString("title", "Toosh"))
                .setSubtitle(call.getString("subtitle", "")).setAllowedAuthenticators(AUTHENTICATORS).build());
        });
    }
}
