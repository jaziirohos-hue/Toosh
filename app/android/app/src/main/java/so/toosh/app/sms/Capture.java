package so.toosh.app.sms;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;

import androidx.core.content.ContextCompat;

import java.util.List;

import so.toosh.app.core.EvcFilter;
import so.toosh.app.core.ImportIdentity;
import so.toosh.app.core.SimRouter;
import so.toosh.app.core.SmsAssembler;
import so.toosh.app.data.Settings;
import so.toosh.app.data.SmsStore;

/** Filters, routes and stores one assembled SMS. Used by the live receiver and the inbox import. */
public final class Capture {
    public enum Result { STORED, DUPLICATE, NOT_RELEVANT, NOT_CONFIGURED }

    private Capture() {}

    public static Result store(Context context, SmsStore store, Settings settings, SmsAssembler.Message m, long receivedAt, String importMethod) {
        String account = settings.accountId();
        List<SimRouter.Mapping> mappings = settings.mappings();
        // Capture starts only after this phone was set up as a source for a signed-in account.
        if (account == null || mappings.isEmpty()) return Result.NOT_CONFIGURED;
        if (!EvcFilter.isRelevant(m.sender, m.body, settings.strictFilter())) return Result.NOT_RELEVANT;
        Integer slot = slotFor(context, m.subscriptionId);
        SimRouter.Route route = SimRouter.route(m.subscriptionId, slot, mappings, activeSimCount(context));
        SmsStore.Row r = new SmsStore.Row();
        r.clientMessageId = ImportIdentity.clientMessageId(m.sender, m.smsTimestampMillis, m.body);
        r.accountId = account;
        r.evcNumberId = route.kind == SimRouter.Kind.MATCHED ? route.mapping.evcNumberId : null;
        r.sender = m.sender; r.body = m.body; r.smsTimestamp = m.smsTimestampMillis > 0 ? m.smsTimestampMillis : receivedAt;
        r.receivedAt = receivedAt; r.subscriptionId = m.subscriptionId; r.simSlot = slot;
        r.importMethod = importMethod; r.parts = m.parts;
        r.state = route.kind == SimRouter.Kind.MATCHED ? "PENDING" : route.kind == SimRouter.Kind.OTHER_SIM ? "OTHER_SIM" : "UNMATCHED";
        return store.insert(r) ? Result.STORED : Result.DUPLICATE;
    }

    private static boolean canReadPhoneState(Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED;
    }

    public static Integer slotFor(Context context, Integer subscriptionId) {
        if (subscriptionId == null || subscriptionId < 0 || !canReadPhoneState(context)) return null;
        try {
            SubscriptionManager sm = context.getSystemService(SubscriptionManager.class);
            SubscriptionInfo info = sm == null ? null : sm.getActiveSubscriptionInfo(subscriptionId);
            return info == null ? null : info.getSimSlotIndex();
        } catch (SecurityException e) { return null; }
    }

    /** Number of active SIMs, or 0 when unknown (no permission). */
    public static int activeSimCount(Context context) {
        if (!canReadPhoneState(context)) return 0;
        try {
            SubscriptionManager sm = context.getSystemService(SubscriptionManager.class);
            return sm == null ? 0 : sm.getActiveSubscriptionInfoCount();
        } catch (SecurityException e) { return 0; }
    }

    public static boolean subscriptionsSupported() { return Build.VERSION.SDK_INT >= 22; }
}
