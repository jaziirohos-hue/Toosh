package so.toosh.app;

import android.app.Application;

import so.toosh.app.data.Settings;
import so.toosh.app.data.SmsStore;
import so.toosh.app.net.Sync;
import so.toosh.app.sms.Notifications;

/** On every process start: recover interrupted uploads and keep the periodic retry scheduled. */
public class TooshApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Notifications.ensureChannels(this);
        if (new Settings(this).signedIn()) {
            SmsStore.get(this).releaseStaleClaims();
            Sync.schedulePeriodic(this);
            Sync.uploadSoon(this);
        }
    }
}
