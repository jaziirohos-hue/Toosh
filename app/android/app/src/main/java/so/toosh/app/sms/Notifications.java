package so.toosh.app.sms;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import so.toosh.app.MainActivity;

/**
 * Notifications never contain amounts, balances, names, numbers or SMS text, and are hidden on the lock screen.
 */
public final class Notifications {
    public static final String CHANNEL_MESSAGES = "toosh_messages";
    public static final String CHANNEL_SYNC = "toosh_sync";
    private Notifications() {}

    public static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel messages = new NotificationChannel(CHANNEL_MESSAGES, "Fariimaha EVC Plus", NotificationManager.IMPORTANCE_DEFAULT);
        messages.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(messages);
        NotificationChannel sync = new NotificationChannel(CHANNEL_SYNC, "Isku-xirka xogta", NotificationManager.IMPORTANCE_MIN);
        nm.createNotificationChannel(sync);
    }

    private static boolean allowed(Context c) {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private static PendingIntent open(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static void post(Context c, int id, String title, String text) {
        if (!allowed(c)) return;
        ensureChannels(c);
        NotificationCompat.Builder publicVersion = new NotificationCompat.Builder(c, CHANNEL_MESSAGES)
            .setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle("Toosh");
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL_MESSAGES)
            .setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle(title).setContentText(text)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(publicVersion.build())
            .setContentIntent(open(c)).setAutoCancel(true);
        try { NotificationManagerCompat.from(c).notify(id, b.build()); } catch (SecurityException ignored) { }
    }

    public static void newMessage(Context c) { post(c, 1001, "Fariin cusub oo EVC Plus ah", "Waa la kaydiyay. Fur Toosh si aad u aragto."); }
    public static void needsReview(Context c, int count) { post(c, 1002, "Fariin u baahan kala saarid", count == 1 ? "1 fariin ayaa sugaysa kala saarid." : count + " fariimood ayaa sugaya kala saarid."); }

    public static android.app.Notification syncing(Context c) {
        ensureChannels(c);
        return new NotificationCompat.Builder(c, CHANNEL_SYNC).setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Toosh").setContentText("Fariimaha waa la dirayaa").setPriority(NotificationCompat.PRIORITY_MIN).build();
    }
}
