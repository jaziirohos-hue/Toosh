package so.toosh.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.content.Context;
import android.os.Bundle;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.List;

import so.toosh.app.core.SimRouter;
import so.toosh.app.data.Settings;
import so.toosh.app.data.SmsStore;
import so.toosh.app.net.Api;
import so.toosh.app.sms.InboxImport;

/**
 * Real SMS on an Android emulator, against a real Toosh backend (run by CI on the host, reachable as 10.0.2.2).
 * The steps run one at a time from app/android/scripts/emulator-e2e.sh, with real modem SMS sent between them
 * through "adb emu sms send". Nothing here fakes the SMS path: Android delivers SMS_RECEIVED to SmsReceiver,
 * which stores and uploads exactly as on a phone.
 *
 *   -e step prepare        register an account, make this emulator the source phone of its number
 *   -e step verify         after N EVC SMS (+ noise): all stored once, multipart joined, uploaded, classified
 *   -e step offline        after an SMS sent with networking off: stored locally, not yet synced
 *   -e step reconnected    after networking is back: the offline SMS reached the server, no duplicates
 */
@RunWith(AndroidJUnit4.class)
public class RealSmsFlowTest {
    private static final String TAG = "TooshE2E";

    private Bundle args() { return InstrumentationRegistry.getArguments(); }
    private boolean step(String name) { return name.equals(args().getString("step")); }
    private Context target() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    private String apiBase() { String a = args().getString("apiBase"); return a == null ? "http://10.0.2.2:8787" : a; }
    private File stateFile() { return new File(target().getFilesDir(), "e2e-state.json"); }

    private JSONObject call(String method, String path, String token, JSONObject body) throws Exception {
        Api.Response r = Api.HTTP.send(method, apiBase() + path, token, body == null ? null : body.toString());
        assertTrue(method + " " + path + " -> " + r.status + " " + r.body, r.status >= 200 && r.status < 300);
        return new JSONObject(r.body);
    }

    @Test public void prepare() throws Exception {
        assumeTrue(step("prepare"));
        String phone = "61" + String.valueOf(System.currentTimeMillis()).substring(6);
        JSONObject device = new JSONObject().put("platform", "android").put("name", "Emulator").put("model", android.os.Build.MODEL);
        JSONObject reg = call("POST", "/api/v1/auth/register", null, new JSONObject().put("displayName", "Emulator Test").put("phone", phone)
            .put("password", "emulator test password").put("device", device));
        String token = reg.getString("token");
        String accountId = reg.getJSONObject("account").getString("id");
        String numberId = reg.getJSONArray("evcNumbers").getJSONObject(0).getString("id");

        SubscriptionManager sm = target().getSystemService(SubscriptionManager.class);
        List<SubscriptionInfo> subs = sm.getActiveSubscriptionInfoList();
        assertNotNull("emulator has an active SIM", subs);
        SubscriptionInfo sim = subs.get(0);
        call("POST", "/api/v1/evc-numbers/" + numberId + "/source", token, new JSONObject()
            .put("simSubscriptionId", sim.getSubscriptionId()).put("simSlot", sim.getSimSlotIndex()).put("simLabel", "SIM 1"));

        Settings settings = new Settings(target());
        settings.setSession(token, accountId, apiBase(), reg.getJSONObject("device").getString("id"));
        settings.setMappings(Collections.singletonList(new SimRouter.Mapping(sim.getSubscriptionId(), sim.getSimSlotIndex(), numberId, accountId)));
        Files.write(stateFile().toPath(), new JSONObject().put("token", token).put("numberId", numberId).put("accountId", accountId).toString().getBytes(StandardCharsets.UTF_8));
        Log.i(TAG, "prepared account with SIM subscription " + sim.getSubscriptionId());
    }

    private JSONObject state() throws Exception { return new JSONObject(new String(Files.readAllBytes(stateFile().toPath()), StandardCharsets.UTF_8)); }

    private List<SmsStore.Row> waitForSynced(int expected, long timeoutMs) throws Exception {
        Settings settings = new Settings(target());
        long end = System.currentTimeMillis() + timeoutMs;
        List<SmsStore.Row> rows;
        do {
            rows = SmsStore.get(target()).list(settings.accountId(), false, 200);
            int synced = 0;
            for (SmsStore.Row r : rows) if ("SYNCED".equals(r.state)) synced++;
            if (synced >= expected) return rows;
            Thread.sleep(1000);
        } while (System.currentTimeMillis() < end);
        StringBuilder sb = new StringBuilder();
        for (SmsStore.Row r : rows) sb.append(r.state).append('/').append(r.lastError).append(' ');
        throw new AssertionError("expected " + expected + " synced, got: " + sb + " lastError=" + settings.lastError());
    }

    @Test public void verify() throws Exception {
        assumeTrue(step("verify"));
        int expected = Integer.parseInt(args().getString("expect", "4"));
        String b64 = args().getString("longBodyB64");
        String longBody = b64 == null ? null : new String(android.util.Base64.decode(b64, android.util.Base64.DEFAULT), StandardCharsets.UTF_8);
        List<SmsStore.Row> rows = waitForSynced(expected, 120_000);
        assertEquals("only EVC Plus messages are stored, each once", expected, rows.size());
        boolean multipart = false;
        for (SmsStore.Row r : rows) {
            assertEquals("LIVE", r.importMethod);
            assertNotNull(r.subscriptionId);
            if (longBody != null && longBody.equals(r.body)) { multipart = true; Log.i(TAG, "long SMS arrived in " + r.parts + " parts, joined intact"); assertTrue("long SMS was multipart", r.parts >= 2); }
        }
        if (longBody != null) assertTrue("the long SMS was assembled exactly", multipart);

        JSONObject s = state();
        String token = s.getString("token");
        JSONObject page = call("GET", "/api/v1/messages?limit=100", token, null);
        JSONObject counts = page.getJSONObject("counts");
        Log.i(TAG, "server counts " + counts);
        assertEquals(expected, counts.getInt("all"));
        assertEquals(1, counts.getInt("out"));
        assertEquals(1, counts.getInt("in"));
        assertEquals(expected - 2, counts.getInt("pending"));
        JSONArray balances = call("GET", "/api/v1/balances", token, null).getJSONArray("balances");
        assertEquals("54.585", balances.getJSONObject(0).getString("amount"));

        // The initial import finds the same SMS in the phone inbox and adds nothing.
        InboxImport.Counts c = InboxImport.run(target(), 1);
        Log.i(TAG, "inbox import scanned=" + c.scanned + " queued=" + c.queued + " duplicates=" + c.duplicates);
        assertEquals(0, c.queued);
        assertEquals(expected, c.duplicates);
        assertEquals(expected, call("GET", "/api/v1/messages?limit=100", token, null).getJSONObject("counts").getInt("all"));
    }

    @Test public void offline() throws Exception {
        assumeTrue(step("offline"));
        int before = Integer.parseInt(args().getString("expect", "4"));
        Settings settings = new Settings(target());
        long end = System.currentTimeMillis() + 60_000;
        List<SmsStore.Row> rows;
        do { rows = SmsStore.get(target()).list(settings.accountId(), false, 200); if (rows.size() > before) break; Thread.sleep(1000); } while (System.currentTimeMillis() < end);
        assertEquals("the SMS received while offline is stored on the phone", before + 1, rows.size());
        int unsynced = 0;
        for (SmsStore.Row r : rows) if (!"SYNCED".equals(r.state)) unsynced++;
        assertEquals("and waits in the queue", 1, unsynced);
    }

    @Test public void reconnected() throws Exception {
        assumeTrue(step("reconnected"));
        int total = Integer.parseInt(args().getString("expect", "5"));
        waitForSynced(total, 180_000);
        JSONObject counts = call("GET", "/api/v1/messages?limit=100", state().getString("token"), null).getJSONObject("counts");
        assertEquals("uploaded once after reconnecting", total, counts.getInt("all"));
    }
}
