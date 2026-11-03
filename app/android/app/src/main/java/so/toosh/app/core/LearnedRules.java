package so.toosh.app.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Message formats the person taught Toosh ("Bar Toosh"). Mirrors matchRule() in shared/src/rules.ts: same sender
 * (normalised), and the whole SMS (whitespace collapsed) fits the pattern. Both are checked against
 * shared/test/rule-vectors.json. Only money in/out formats make the phone keep an SMS; "not money" formats never do.
 */
public final class LearnedRules {
    public static final class Rule {
        public final String id, sender, direction;
        final Pattern pattern;
        Rule(String id, String sender, String direction, Pattern pattern) { this.id = id; this.sender = sender; this.direction = direction; this.pattern = pattern; }
    }

    private LearnedRules() {}

    /** Parses the list the app sends ({id, sender, pattern, direction}); a rule whose pattern does not compile is skipped. */
    public static List<Rule> parse(String json) {
        if (json == null || json.isEmpty()) return Collections.emptyList();
        List<Rule> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                try {
                    out.add(new Rule(o.getString("id"), EvcFilter.normalizeSender(o.getString("sender")), o.getString("direction"),
                        Pattern.compile(o.getString("pattern"), Pattern.CASE_INSENSITIVE)));
                } catch (Exception ignored) { /* skip a pattern this phone cannot use */ }
            }
        } catch (Exception ignored) { return Collections.emptyList(); }
        return out;
    }

    public static String normalizeBody(String body) { return body == null ? "" : body.replaceAll("\\s+", " ").trim(); }

    /** The first rule for this sender whose pattern fits the whole SMS, or null. */
    public static Rule match(List<Rule> rules, String sender, String body) {
        if (rules.isEmpty() || body == null) return null;
        String s = EvcFilter.normalizeSender(sender);
        String text = normalizeBody(body);
        if (text.length() > 2000) return null;
        for (Rule r : rules) if (r.sender.equals(s) && r.pattern.matcher(text).matches()) return r;
        return null;
    }

    /** True when a taught money-in/out format says the phone should keep this SMS. */
    public static boolean keeps(List<Rule> rules, String sender, String body) {
        Rule r = match(rules, sender, body);
        return r != null && ("IN".equals(r.direction) || "OUT".equals(r.direction));
    }
}
