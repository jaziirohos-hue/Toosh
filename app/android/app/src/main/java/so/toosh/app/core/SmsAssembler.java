package so.toosh.app.core;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Joins the parts of multipart SMS. Android delivers all parts of one concatenated SMS in a single SMS_RECEIVED
 * broadcast, in order; one broadcast can also carry several unrelated messages. Parts are grouped by sender and
 * subscription and joined in arrival order. The earliest part's network timestamp identifies the message.
 */
public final class SmsAssembler {
    public static final class Part {
        public final String sender; public final String body; public final long timestampMillis; public final Integer subscriptionId;
        public Part(String sender, String body, long timestampMillis, Integer subscriptionId) {
            this.sender = sender == null ? "" : sender; this.body = body == null ? "" : body;
            this.timestampMillis = timestampMillis; this.subscriptionId = subscriptionId;
        }
    }

    public static final class Message {
        public final String sender; public final String body; public final long smsTimestampMillis; public final Integer subscriptionId; public final int parts;
        Message(String sender, String body, long ts, Integer sub, int parts) {
            this.sender = sender; this.body = body; this.smsTimestampMillis = ts; this.subscriptionId = sub; this.parts = parts;
        }
    }

    private SmsAssembler() {}

    public static List<Message> assemble(List<Part> parts) {
        Map<String, List<Part>> groups = new LinkedHashMap<>();
        for (Part p : parts) {
            String key = p.sender + "\u0000" + p.subscriptionId;
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(p);
        }
        List<Message> out = new ArrayList<>();
        for (List<Part> group : groups.values()) {
            StringBuilder body = new StringBuilder();
            long ts = Long.MAX_VALUE;
            for (Part p : group) { body.append(p.body); if (p.timestampMillis > 0) ts = Math.min(ts, p.timestampMillis); }
            Part first = group.get(0);
            out.add(new Message(first.sender, body.toString(), ts == Long.MAX_VALUE ? 0 : ts, first.subscriptionId, group.size()));
        }
        return out;
    }
}
