package so.toosh.app.net;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ForegroundInfo;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

import so.toosh.app.data.Settings;
import so.toosh.app.data.SmsStore;
import so.toosh.app.sms.Notifications;

/**
 * Upload scheduling with WorkManager: persisted across reboots and process death, runs only with a network
 * connection, retries with exponential backoff, and is independent of whether any app screen is open.
 */
public final class Sync {
    private static final String UPLOAD = "toosh-upload";
    private static final String PERIODIC = "toosh-periodic";
    /** Replaced in instrumentation tests. */
    public static volatile Api.Transport transport = Api.HTTP;
    public static volatile boolean scheduling = true;

    private Sync() {}

    public static void uploadSoon(Context context) {
        if (!scheduling) return;
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(UploadWorker.class)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(UPLOAD, ExistingWorkPolicy.APPEND_OR_REPLACE, req);
    }

    /** Every 15 minutes: retry anything due and report contact to the server. */
    public static void schedulePeriodic(Context context) {
        if (!scheduling) return;
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(UploadWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    public static String smsPermission(Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED ? "GRANTED" : "DENIED";
    }

    public static class UploadWorker extends Worker {
        public UploadWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

        @NonNull @Override public Result doWork() {
            Context c = getApplicationContext();
            Settings settings = new Settings(c);
            SmsStore store = SmsStore.get(c);
            Uploader.Result r = Uploader.run(c, store, settings, transport);
            Uploader.heartbeat(c, store, settings, transport, smsPermission(c));
            if (r == Uploader.Result.RETRY_LATER) return Result.retry();
            return Result.success();
        }

        /** Android 8-11 run expedited work as a short foreground task; the notice shows no financial data. */
        @NonNull @Override public ForegroundInfo getForegroundInfo() {
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                return new ForegroundInfo(2001, Notifications.syncing(getApplicationContext()), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            }
            return new ForegroundInfo(2001, Notifications.syncing(getApplicationContext()));
        }
    }
}
