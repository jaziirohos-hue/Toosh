package so.toosh.app.data;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import so.toosh.app.core.SimRouter;

/**
 * Session, SIM mappings and preferences. The token is stored encrypted (Android Keystore); nothing here is logged.
 * Background workers read this directly, so uploads continue while the app UI is closed.
 */
public final class Settings {
    private static final String FILE = "toosh_settings";
    private final SharedPreferences prefs;

    public Settings(Context context) { prefs = context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE); }

    public synchronized void setSession(String token, String accountId, String apiBase, String deviceId) {
        SharedPreferences.Editor e = prefs.edit();
        if (token == null) {
            e.remove("token").remove("accountId").remove("deviceId").remove("mappings").putBoolean("authProblem", false);
        } else {
            e.putString("token", Crypto.encrypt(token)).putString("accountId", accountId).putString("deviceId", deviceId).putBoolean("authProblem", false);
            // A different account must never inherit the previous account's SIM mappings.
            if (accountId != null && !accountId.equals(prefs.getString("mappingsAccount", null))) e.remove("mappings");
        }
        if (apiBase != null) e.putString("apiBase", apiBase);
        // Written synchronously: the process may be killed right after sign-in or setup, and capture depends on it.
        e.commit();
    }

    public String token() { return Crypto.decrypt(prefs.getString("token", null)); }
    public String accountId() { return prefs.getString("accountId", null); }
    public String deviceId() { return prefs.getString("deviceId", null); }
    public String apiBase() { return prefs.getString("apiBase", ""); }
    public boolean signedIn() { return prefs.getString("token", null) != null; }

    public synchronized void setMappings(List<SimRouter.Mapping> mappings) {
        JSONArray arr = new JSONArray();
        try {
            for (SimRouter.Mapping m : mappings) {
                JSONObject o = new JSONObject();
                o.put("subscriptionId", m.subscriptionId == null ? JSONObject.NULL : m.subscriptionId);
                o.put("simSlot", m.simSlot == null ? JSONObject.NULL : m.simSlot);
                o.put("evcNumberId", m.evcNumberId);
                o.put("accountId", m.accountId);
                arr.put(o);
            }
        } catch (Exception ignored) { }
        prefs.edit().putString("mappings", arr.toString()).putString("mappingsAccount", accountId()).commit();
    }

    public List<SimRouter.Mapping> mappings() {
        List<SimRouter.Mapping> out = new ArrayList<>();
        String account = accountId();
        try {
            JSONArray arr = new JSONArray(prefs.getString("mappings", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                if (account == null || !account.equals(o.optString("accountId"))) continue;
                out.add(new SimRouter.Mapping(o.isNull("subscriptionId") ? null : o.getInt("subscriptionId"),
                    o.isNull("simSlot") ? null : o.getInt("simSlot"), o.getString("evcNumberId"), o.getString("accountId")));
            }
        } catch (Exception ignored) { }
        return out;
    }

    public boolean strictFilter() { return prefs.getBoolean("strictFilter", true); }
    public void setStrictFilter(boolean v) { prefs.edit().putBoolean("strictFilter", v).apply(); }
    public boolean notifyNew() { return prefs.getBoolean("notifyNew", false); }
    public void setNotifyNew(boolean v) { prefs.edit().putBoolean("notifyNew", v).apply(); }
    public boolean notifyPending() { return prefs.getBoolean("notifyPending", false); }
    public void setNotifyPending(boolean v) { prefs.edit().putBoolean("notifyPending", v).apply(); }

    public void setAuthProblem(boolean v) { prefs.edit().putBoolean("authProblem", v).apply(); }
    public boolean authProblem() { return prefs.getBoolean("authProblem", false); }
    public void setLastUpload(long at) { prefs.edit().putLong("lastUploadAt", at).putString("lastError", null).apply(); }
    public long lastUploadAt() { return prefs.getLong("lastUploadAt", 0); }
    public void setLastAttempt(long at, String error) { prefs.edit().putLong("lastAttemptAt", at).putString("lastError", error).apply(); }
    public long lastAttemptAt() { return prefs.getLong("lastAttemptAt", 0); }
    public String lastError() { return prefs.getString("lastError", null); }
    public static final long HEARTBEAT_EVERY_MS = 55L * 60 * 1000;
    public void setHeartbeat(long at, String permission) { prefs.edit().putLong("heartbeatAt", at).putString("heartbeatPermission", permission).apply(); }
    /** True when an hour has passed, the clock moved back, or the SMS permission changed since the last report. */
    public boolean heartbeatDue(long now, String permission) {
        long last = prefs.getLong("heartbeatAt", 0);
        return now - last >= HEARTBEAT_EVERY_MS || now < last || !permission.equals(prefs.getString("heartbeatPermission", null));
    }
    public void setImportDone(long at) { prefs.edit().putLong("importDoneAt", at).apply(); }
    public long importDoneAt() { return prefs.getLong("importDoneAt", 0); }
}
