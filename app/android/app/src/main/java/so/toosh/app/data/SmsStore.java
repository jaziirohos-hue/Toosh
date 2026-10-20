package so.toosh.app.data;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Durable local copy of every captured EVC Plus SMS and its upload state. A row is written before any upload is
 * attempted and is never deleted by the app, so nothing is lost when the phone is offline, the server is down,
 * or the process is killed.
 *
 * States (sync status, separate from classification which the server decides):
 *   PENDING   waiting to upload (offline/queued)        UPLOADING  claimed by the uploader
 *   FAILED    last attempt failed; retried with backoff  SYNCED     stored on the server (server id kept)
 *   UNMATCHED SIM uncertain; the person picks the number OTHER_SIM  arrived on a SIM no registered number uses
 *   REJECTED  the server refused it permanently (reason kept, shown in the app)
 */
public final class SmsStore extends SQLiteOpenHelper {
    public interface Listener { void onChanged(); }
    private static final CopyOnWriteArrayList<Listener> LISTENERS = new CopyOnWriteArrayList<>();
    private static volatile SmsStore instance;

    public static final class Row {
        public String localId, clientMessageId, accountId, evcNumberId, sender, body, importMethod, state, lastError, serverMessageId;
        public long smsTimestamp, receivedAt, nextAttemptAt, syncedAt;
        public Integer subscriptionId, simSlot;
        public int parts, attempts;
    }

    public static SmsStore get(Context context) {
        if (instance == null) synchronized (SmsStore.class) { if (instance == null) instance = new SmsStore(context.getApplicationContext(), "toosh_sms.db"); }
        return instance;
    }

    /** Separate database file for instrumentation tests. */
    public static SmsStore forTesting(Context context, String name) { return new SmsStore(context.getApplicationContext(), name); }

    private SmsStore(Context context, String name) { super(context, name, null, 1); }

    public static void addListener(Listener l) { LISTENERS.add(l); }
    public static void removeListener(Listener l) { LISTENERS.remove(l); }
    private static void changed() { for (Listener l : LISTENERS) l.onChanged(); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE messages (local_id TEXT PRIMARY KEY, client_message_id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL, " +
            "evc_number_id TEXT, sender TEXT NOT NULL, body_enc TEXT NOT NULL, sms_ts INTEGER NOT NULL, received_at INTEGER NOT NULL, " +
            "sub_id INTEGER, sim_slot INTEGER, import_method TEXT NOT NULL, parts INTEGER NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, " +
            "next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, server_message_id TEXT, created_at INTEGER NOT NULL, synced_at INTEGER)");
        db.execSQL("CREATE INDEX messages_state ON messages(state, next_attempt_at)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { /* future migrations keep existing rows */ }

    /** Inserts once per SMS identity. Returns true when the SMS was new. */
    public boolean insert(Row r) {
        ContentValues v = new ContentValues();
        v.put("local_id", UUID.randomUUID().toString());
        v.put("client_message_id", r.clientMessageId);
        v.put("account_id", r.accountId);
        v.put("evc_number_id", r.evcNumberId);
        v.put("sender", r.sender);
        v.put("body_enc", Crypto.encrypt(r.body));
        v.put("sms_ts", r.smsTimestamp);
        v.put("received_at", r.receivedAt);
        if (r.subscriptionId != null) v.put("sub_id", r.subscriptionId);
        if (r.simSlot != null) v.put("sim_slot", r.simSlot);
        v.put("import_method", r.importMethod);
        v.put("parts", r.parts);
        v.put("state", r.state);
        v.put("created_at", System.currentTimeMillis());
        long id = getWritableDatabase().insertWithOnConflict("messages", null, v, SQLiteDatabase.CONFLICT_IGNORE);
        if (id != -1) changed();
        return id != -1;
    }

    /** Clears claims left by a process that was killed mid-upload. */
    public void releaseStaleClaims() {
        ContentValues v = new ContentValues(); v.put("state", "PENDING");
        if (getWritableDatabase().update("messages", v, "state = 'UPLOADING'", null) > 0) changed();
    }

    /** Claims up to {@code limit} due messages of the signed-in account, oldest first. */
    public synchronized List<Row> claimDue(String accountId, long now, int limit) {
        SQLiteDatabase db = getWritableDatabase();
        List<Row> rows = new ArrayList<>();
        db.beginTransaction();
        try {
            try (Cursor c = db.query("messages", null, "account_id = ? AND evc_number_id IS NOT NULL AND state IN ('PENDING','FAILED') AND next_attempt_at <= ?",
                new String[]{accountId, String.valueOf(now)}, null, null, "sms_ts ASC", String.valueOf(limit))) {
                while (c.moveToNext()) rows.add(read(c));
            }
            for (Row r : rows) {
                ContentValues v = new ContentValues(); v.put("state", "UPLOADING");
                db.update("messages", v, "local_id = ?", new String[]{r.localId});
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        if (!rows.isEmpty()) changed();
        return rows;
    }

    public void markSynced(String clientMessageId, String serverId) {
        ContentValues v = new ContentValues();
        v.put("state", "SYNCED"); v.put("server_message_id", serverId); v.put("synced_at", System.currentTimeMillis()); v.putNull("last_error");
        getWritableDatabase().update("messages", v, "client_message_id = ?", new String[]{clientMessageId});
        changed();
    }
    public void markRejected(String clientMessageId, String code) {
        ContentValues v = new ContentValues(); v.put("state", "REJECTED"); v.put("last_error", code);
        getWritableDatabase().update("messages", v, "client_message_id = ?", new String[]{clientMessageId});
        changed();
    }
    /** Puts claimed rows back: retry later with backoff (FAILED) or as soon as possible (PENDING, e.g. no network). */
    public void release(List<Row> rows, boolean countAttempt, long nextAttemptAt, String error) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (Row r : rows) {
                ContentValues v = new ContentValues();
                v.put("state", countAttempt ? "FAILED" : "PENDING");
                v.put("attempts", r.attempts + (countAttempt ? 1 : 0));
                v.put("next_attempt_at", nextAttemptAt);
                v.put("last_error", error);
                db.update("messages", v, "local_id = ? AND state = 'UPLOADING'", new String[]{r.localId});
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        changed();
    }
    public void retryFailedNow() {
        ContentValues v = new ContentValues(); v.put("state", "PENDING"); v.put("next_attempt_at", 0);
        getWritableDatabase().update("messages", v, "state = 'FAILED'", null);
        changed();
    }
    /** The person chose the number for messages whose SIM was uncertain. Messages from a known other SIM are not reassigned. */
    public int assign(List<String> localIds, String evcNumberId, String accountId) {
        int n = 0;
        for (String id : localIds) {
            ContentValues v = new ContentValues(); v.put("evc_number_id", evcNumberId); v.put("state", "PENDING"); v.put("next_attempt_at", 0);
            n += getWritableDatabase().update("messages", v, "local_id = ? AND state = 'UNMATCHED' AND account_id = ?", new String[]{id, accountId});
        }
        if (n > 0) changed();
        return n;
    }

    public int count(String accountId, String state) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT count(*) FROM messages WHERE account_id = ? AND state = ?", new String[]{accountId == null ? "" : accountId, state})) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    public List<Row> list(String accountId, boolean unsyncedOnly, int limit) {
        List<Row> rows = new ArrayList<>();
        String where = "account_id = ?" + (unsyncedOnly ? " AND state NOT IN ('SYNCED')" : "");
        try (Cursor c = getReadableDatabase().query("messages", null, where, new String[]{accountId == null ? "" : accountId}, null, null, "sms_ts DESC", String.valueOf(limit))) {
            while (c.moveToNext()) rows.add(read(c));
        }
        return rows;
    }

    public Row byClientId(String clientMessageId) {
        try (Cursor c = getReadableDatabase().query("messages", null, "client_message_id = ?", new String[]{clientMessageId}, null, null, null)) {
            return c.moveToFirst() ? read(c) : null;
        }
    }

    private static Row read(Cursor c) {
        Row r = new Row();
        r.localId = c.getString(c.getColumnIndexOrThrow("local_id"));
        r.clientMessageId = c.getString(c.getColumnIndexOrThrow("client_message_id"));
        r.accountId = c.getString(c.getColumnIndexOrThrow("account_id"));
        r.evcNumberId = c.getString(c.getColumnIndexOrThrow("evc_number_id"));
        r.sender = c.getString(c.getColumnIndexOrThrow("sender"));
        r.body = Crypto.decrypt(c.getString(c.getColumnIndexOrThrow("body_enc")));
        r.smsTimestamp = c.getLong(c.getColumnIndexOrThrow("sms_ts"));
        r.receivedAt = c.getLong(c.getColumnIndexOrThrow("received_at"));
        int sub = c.getColumnIndexOrThrow("sub_id"); r.subscriptionId = c.isNull(sub) ? null : c.getInt(sub);
        int slot = c.getColumnIndexOrThrow("sim_slot"); r.simSlot = c.isNull(slot) ? null : c.getInt(slot);
        r.importMethod = c.getString(c.getColumnIndexOrThrow("import_method"));
        r.parts = c.getInt(c.getColumnIndexOrThrow("parts"));
        r.state = c.getString(c.getColumnIndexOrThrow("state"));
        r.attempts = c.getInt(c.getColumnIndexOrThrow("attempts"));
        r.nextAttemptAt = c.getLong(c.getColumnIndexOrThrow("next_attempt_at"));
        r.lastError = c.getString(c.getColumnIndexOrThrow("last_error"));
        r.serverMessageId = c.getString(c.getColumnIndexOrThrow("server_message_id"));
        int synced = c.getColumnIndexOrThrow("synced_at"); r.syncedAt = c.isNull(synced) ? 0 : c.getLong(synced);
        return r;
    }
}
