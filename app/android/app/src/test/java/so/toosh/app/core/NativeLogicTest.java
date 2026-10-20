package so.toosh.app.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** JVM tests for the native SMS logic. The relevance vectors are shared with the TypeScript implementation. */
public class NativeLogicTest {

    @Test public void relevanceMatchesTheSharedVectors() throws Exception {
        File f = new File("../../../shared/test/relevance-vectors.json");
        assertTrue("vectors file found at " + f.getAbsolutePath(), f.exists());
        JSONArray vectors = new JSONArray(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
        assertTrue(vectors.length() >= 8);
        for (int i = 0; i < vectors.length(); i++) {
            JSONObject v = vectors.getJSONObject(i);
            assertEquals(v.toString(), v.getBoolean("relevant"), EvcFilter.isRelevant(v.getString("sender"), v.getString("body"), v.getBoolean("strict")));
        }
    }

    @Test public void multipartPartsAreJoinedInOrderPerSender() {
        String part1 = "[-EVCPlus-] $3.90 ayaad uwareejisay Qof Tusaale(615551288), Tar: 19/10/26 18:40:41 ";
        String part2 = "Haraagaagu waa $51.59. Ka qeyb gal tartanka www.example.com";
        List<SmsAssembler.Part> parts = Arrays.asList(
            new SmsAssembler.Part("192", part1, 1000L, 1),
            new SmsAssembler.Part("192", part2, 1000L, 1),
            new SmsAssembler.Part("+252615551288", "salaan", 2000L, 1));
        List<SmsAssembler.Message> out = SmsAssembler.assemble(parts);
        assertEquals(2, out.size());
        assertEquals(part1 + part2, out.get(0).body);
        assertEquals(2, out.get(0).parts);
        assertEquals(1000L, out.get(0).smsTimestampMillis);
        assertEquals("salaan", out.get(1).body);
    }

    @Test public void sameSmsHasTheSameIdentityLiveAndImported() {
        String body = "[-EVCPLUS-] waxaad $3 ka heshay 615998822, Tar: 19/10/26 18:40:41 haraagagu waa $54.585.";
        String live = ImportIdentity.clientMessageId("192", 1760888441000L, body);
        assertEquals(live, ImportIdentity.clientMessageId(" 192 ", 1760888441000L, body));
        assertNotEquals("a second real payment one second later is a different SMS", live, ImportIdentity.clientMessageId("192", 1760888442000L, body));
        assertTrue(live.matches("^sms-[0-9a-f]{48}$"));
    }

    @Test public void dualSimRoutingNeverGuesses() {
        SimRouter.Mapping sim1 = new SimRouter.Mapping(1, 0, "num-a", "acc");
        SimRouter.Mapping sim2 = new SimRouter.Mapping(2, 1, "num-b", "acc");
        assertEquals("num-a", SimRouter.route(1, 0, Arrays.asList(sim1, sim2), 2).mapping.evcNumberId);
        assertEquals("num-b", SimRouter.route(2, null, Arrays.asList(sim1, sim2), 2).mapping.evcNumberId);
        assertEquals(SimRouter.Kind.UNMATCHED, SimRouter.route(null, null, Arrays.asList(sim1, sim2), 2).kind);
        assertEquals("slot used when subscription is missing", "num-b", SimRouter.route(null, 1, Arrays.asList(sim1, sim2), 2).mapping.evcNumberId);
        // Only SIM 1 registered; an EVC SMS on SIM 2 belongs to some other number.
        assertEquals(SimRouter.Kind.OTHER_SIM, SimRouter.route(2, 1, Collections.singletonList(sim1), 2).kind);
        // Single-SIM phone, Android did not report the subscription: unambiguous.
        assertEquals("num-a", SimRouter.route(null, null, Collections.singletonList(sim1), 1).mapping.evcNumberId);
        // Two SIMs, one registered, subscription unknown: ask the person.
        assertEquals(SimRouter.Kind.UNMATCHED, SimRouter.route(null, null, Collections.singletonList(sim1), 2).kind);
        assertNull(SimRouter.route(1, 0, Collections.emptyList(), 1).mapping);
    }

    @Test public void uploadOutcomesAndBackoff() {
        assertEquals(UploadPolicy.Outcome.APPLY_RESULTS, UploadPolicy.forStatus(200));
        assertEquals(UploadPolicy.Outcome.STOP_AUTH, UploadPolicy.forStatus(401));
        assertEquals(UploadPolicy.Outcome.STOP_AUTH, UploadPolicy.forStatus(403));
        for (int s : new int[]{0, 408, 429, 500, 503}) assertEquals(UploadPolicy.Outcome.RETRY, UploadPolicy.forStatus(s));
        assertEquals(UploadPolicy.Outcome.FAIL_REQUEST, UploadPolicy.forStatus(400));
        assertEquals(30_000L, UploadPolicy.backoffMillis(1));
        assertEquals(60_000L, UploadPolicy.backoffMillis(2));
        assertEquals(30 * 60_000L, UploadPolicy.backoffMillis(50));
        assertFalse(UploadPolicy.backoffMillis(3) < UploadPolicy.backoffMillis(2));
    }
}
