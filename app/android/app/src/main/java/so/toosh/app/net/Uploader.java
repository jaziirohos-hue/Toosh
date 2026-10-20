package so.toosh.app.net;

import android.content.Context;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import so.toosh.app.BuildConfig;
import so.toosh.app.core.UploadPolicy;
import so.toosh.app.data.Settings;
import so.toosh.app.data.SmsStore;
import so.toosh.app.sms.Notifications;

/**
 * Sends queued messages in batches, oldest first. Each message keeps the identity it was stored with, so a retry
 * after a lost response is answered "duplicate" by the server and nothing is counted twice.
 */
public final class Uploader {
    public enum Result { DONE, RETRY_LATER, AUTH_STOPPED, NOTHING_TO_DO }

    private Uploader() {}

    static String iso(long millis) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(millis));
    }

    public static Result run(Context context, SmsStore store, Settings settings, Api.Transport transport) {
        String token = settings.token();
        String account = settings.accountId();
        if (token == null || account == null) return Result.NOTHING_TO_DO;
        if (settings.authProblem()) return Result.AUTH_STOPPED;
        store.releaseStaleClaims();
        int pendingReview = 0;
        boolean any = false;
        for (int round = 0; round < 20; round++) {
            long now = System.currentTimeMillis();
            List<SmsStore.Row> batch = store.claimDue(account, now, 50);
            if (batch.isEmpty()) break;
            any = true;
            Api.Response res;
            try {
                JSONArray items = new JSONArray();
                for (SmsStore.Row r : batch) {
                    JSONObject o = new JSONObject();
                    o.put("clientMessageId", r.clientMessageId); o.put("evcNumberId", r.evcNumberId); o.put("sender", r.sender);
                    o.put("body", r.body == null ? "" : r.body); o.put("smsTimestamp", iso(r.smsTimestamp)); o.put("receivedAt", iso(r.receivedAt));
                    o.put("simSubscriptionId", r.subscriptionId == null ? JSONObject.NULL : r.subscriptionId);
                    o.put("simSlot", r.simSlot == null ? JSONObject.NULL : r.simSlot);
                    o.put("importMethod", r.importMethod); o.put("partsCount", r.parts);
                    items.put(o);
                }
                res = transport.send("POST", settings.apiBase() + "/api/v1/ingest/messages", token, new JSONObject().put("messages", items).toString());
            } catch (Exception e) {
                // No connection or timeout: not the message's fault; try again when the network allows.
                store.release(batch, true, now + UploadPolicy.backoffMillis(batch.get(0).attempts + 1), "Internet lama heli karo");
                settings.setLastAttempt(now, "Internet lama heli karo");
                return Result.RETRY_LATER;
            }
            switch (UploadPolicy.forStatus(res.status)) {
                case APPLY_RESULTS:
                    try {
                        JSONArray results = new JSONObject(res.body).getJSONArray("results");
                        for (int i = 0; i < results.length(); i++) {
                            JSONObject r = results.getJSONObject(i);
                            String id = r.getString("clientMessageId");
                            String status = r.getString("status");
                            if ("created".equals(status) || "duplicate".equals(status)) {
                                store.markSynced(id, r.getString("messageId"));
                                if ("created".equals(status) && "PENDING".equals(r.optString("classification"))) pendingReview++;
                            } else store.markRejected(id, r.optString("code", "REJECTED"));
                        }
                        // Anything the server did not mention goes back to the queue.
                        store.release(batch, false, now, null);
                        settings.setLastUpload(System.currentTimeMillis());
                    } catch (Exception e) {
                        store.release(batch, true, now + UploadPolicy.backoffMillis(batch.get(0).attempts + 1), "Jawaab aan la fahmin");
                        return Result.RETRY_LATER;
                    }
                    break;
                case STOP_AUTH:
                    store.release(batch, false, now, "Aaladdan waa laga saaray akoonka");
                    settings.setAuthProblem(true);
                    settings.setLastAttempt(now, "Aaladdan waa laga saaray akoonka ama fadhigu wuu dhacay. Dib u gal.");
                    return Result.AUTH_STOPPED;
                case RETRY:
                    store.release(batch, true, now + UploadPolicy.backoffMillis(batch.get(0).attempts + 1), "Server-ka khalad (" + res.status + ")");
                    settings.setLastAttempt(now, "Server-ka ayaa mashquul ah (" + res.status + "). Waa la isku dayi doonaa.");
                    return Result.RETRY_LATER;
                default:
                    store.release(batch, true, now + UploadPolicy.backoffMillis(6), "Codsi la diiday (" + res.status + ")");
                    settings.setLastAttempt(now, "Codsiga waa la diiday (" + res.status + ").");
                    return Result.RETRY_LATER;
            }
        }
        if (pendingReview > 0 && settings.notifyPending()) Notifications.needsReview(context, pendingReview);
        return any ? Result.DONE : Result.NOTHING_TO_DO;
    }

    /** Reports this phone's state. "Contact" for the server; separate from a successful data upload. */
    public static void heartbeat(Context context, SmsStore store, Settings settings, Api.Transport transport, String smsPermission) {
        String token = settings.token();
        if (token == null || settings.authProblem()) return;
        try {
            String account = settings.accountId();
            JSONObject o = new JSONObject();
            o.put("smsPermission", smsPermission);
            o.put("queuePending", store.count(account, "PENDING") + store.count(account, "UPLOADING"));
            o.put("queueFailed", store.count(account, "FAILED"));
            o.put("appVersion", BuildConfig.VERSION_NAME);
            o.put("model", (Build.MANUFACTURER + " " + Build.MODEL).trim());
            if (settings.lastError() != null) o.put("lastError", settings.lastError());
            Api.Response r = transport.send("POST", settings.apiBase() + "/api/v1/devices/me/heartbeat", token, o.toString());
            if (r.status == 401) settings.setAuthProblem(true);
        } catch (Exception ignored) { /* best effort */ }
    }
}
