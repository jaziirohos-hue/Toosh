package so.toosh.app.sms;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;

import so.toosh.app.core.SmsAssembler;
import so.toosh.app.data.Settings;
import so.toosh.app.data.SmsStore;
import so.toosh.app.net.Sync;

import java.util.Collections;

/**
 * Explicit, one-off import of existing EVC Plus messages from the phone's inbox (needs READ_SMS, asked for only when
 * the person starts it). Multipart messages are already joined by the SMS provider. Messages captured live have the
 * same identity, so importing twice, or importing after live capture, never creates duplicates.
 */
public final class InboxImport {
    public static final class Counts { public int scanned, queued, duplicates; }

    private InboxImport() {}

    public static Counts run(Context context, int days) {
        Counts counts = new Counts();
        Settings settings = new Settings(context);
        SmsStore store = SmsStore.get(context);
        long since = System.currentTimeMillis() - Math.max(1, Math.min(days, 365)) * 86400000L;
        Uri inbox = Uri.parse("content://sms/inbox");
        String[] projection = null; // read every column so optional ones (sub_id, date_sent) are available where present
        try (Cursor c = context.getContentResolver().query(inbox, projection, "date >= ?", new String[]{String.valueOf(since)}, "date ASC")) {
            if (c == null) return counts;
            int address = c.getColumnIndex("address"), body = c.getColumnIndex("body"), date = c.getColumnIndex("date");
            int dateSent = c.getColumnIndex("date_sent"), sub = c.getColumnIndex("sub_id");
            while (c.moveToNext()) {
                counts.scanned++;
                long received = c.getLong(date);
                long sent = dateSent >= 0 ? c.getLong(dateSent) : 0;
                Integer subscription = sub >= 0 && !c.isNull(sub) && c.getInt(sub) >= 0 ? c.getInt(sub) : null;
                SmsAssembler.Message m = SmsAssembler.assemble(Collections.singletonList(
                    new SmsAssembler.Part(c.getString(address), c.getString(body), sent > 0 ? sent : received, subscription))).get(0);
                Capture.Result r = Capture.store(context, store, settings, m, received, "INITIAL_IMPORT");
                if (r == Capture.Result.STORED) counts.queued++;
                else if (r == Capture.Result.DUPLICATE) counts.duplicates++;
            }
        }
        settings.setImportDone(System.currentTimeMillis());
        if (counts.queued > 0) Sync.uploadSoon(context);
        return counts;
    }
}
