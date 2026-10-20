package so.toosh.app.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

import so.toosh.app.core.SmsAssembler;
import so.toosh.app.data.Settings;
import so.toosh.app.data.SmsStore;
import so.toosh.app.net.Sync;

/**
 * Receives new SMS (declared in the manifest, so it runs even when the app UI is closed). Relevant EVC Plus
 * messages are written to the encrypted local queue first, then an upload is scheduled. If the app has been
 * force-stopped by the user, Android does not deliver broadcasts until it is opened again.
 */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        final PendingResult pending = goAsync();
        final long receivedAt = System.currentTimeMillis();
        final Context app = context.getApplicationContext();
        final SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        final Integer subscriptionId = subscriptionFrom(intent.getExtras());
        new Thread(() -> {
            try {
                if (parts == null || parts.length == 0) { Log.i("Toosh", "sms broadcast without parts"); return; }
                List<SmsAssembler.Part> list = new ArrayList<>();
                for (SmsMessage p : parts) {
                    if (p == null) continue;
                    list.add(new SmsAssembler.Part(p.getDisplayOriginatingAddress(), p.getDisplayMessageBody(), p.getTimestampMillis(), subscriptionId));
                }
                Settings settings = new Settings(app);
                SmsStore store = SmsStore.get(app);
                boolean stored = false;
                for (SmsAssembler.Message m : SmsAssembler.assemble(list)) {
                    Capture.Result result = Capture.store(app, store, settings, m, receivedAt, "LIVE");
                    // Diagnostic only: the outcome and part count, never the sender, text or amounts.
                    Log.i("Toosh", "sms " + result + " parts=" + m.parts + " sub=" + (m.subscriptionId != null));
                    if (result == Capture.Result.STORED) stored = true;
                }
                if (stored) {
                    Sync.uploadSoon(app);
                    if (settings.notifyNew()) Notifications.newMessage(app);
                }
            } catch (RuntimeException e) {
                Log.e("Toosh", "sms capture failed: " + e.getClass().getSimpleName());
            } finally {
                pending.finish();
            }
        }, "toosh-sms").start();
    }

    /** Subscription id from the broadcast extras; the key differs between Android versions and manufacturers. */
    static Integer subscriptionFrom(Bundle extras) {
        if (extras == null) return null;
        for (String key : new String[]{"android.telephony.extra.SUBSCRIPTION_INDEX", "subscription", "sub_id", "subscription_id"}) {
            if (extras.containsKey(key)) {
                Object v = extras.get(key);
                if (v instanceof Integer && (Integer) v >= 0) return (Integer) v;
                if (v instanceof Long && (Long) v >= 0) return ((Long) v).intValue();
            }
        }
        return null;
    }
}
