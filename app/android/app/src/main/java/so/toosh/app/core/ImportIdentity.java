package so.toosh.app.core;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Stable import identity of an SMS on this phone: sender, network timestamp and exact text. The live receiver and
 * the inbox import compute the same value for the same SMS, so the local queue (UNIQUE) and the server (idempotent
 * ingest) both see one message. Retries reuse the stored value; nothing is regenerated.
 */
public final class ImportIdentity {
    private ImportIdentity() {}

    public static String clientMessageId(String sender, long smsTimestampMillis, String body) {
        String input = EvcFilter.normalizeSender(sender) + "\n" + smsTimestampMillis + "\n" + (body == null ? "" : body);
        return "sms-" + sha256(input).substring(0, 48);
    }

    public static String sha256(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
