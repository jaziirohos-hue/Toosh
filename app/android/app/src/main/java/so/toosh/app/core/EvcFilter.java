package so.toosh.app.core;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Which SMS Toosh keeps. Mirrors shared/src/relevance.ts exactly; both are checked against
 * shared/test/relevance-vectors.json.
 *
 * strict: known EVC Plus sender AND EVC-looking text. relaxed: also any sender whose text carries the [-EVCPlus-] tag.
 * Anything else (personal SMS, OTPs, other services) is never stored or uploaded.
 */
public final class EvcFilter {
    public static final List<String> EVC_SENDERS = Arrays.asList("192", "321", "EVCPLUS", "EVC PLUS", "HORMUUD");
    private static final Pattern TAG = Pattern.compile("\\[\\s*-?\\s*evc\\s*-?\\s*plus\\s*-?\\s*\\]", Pattern.CASE_INSENSITIVE);
    private static final Pattern EVC_WORDS = Pattern.compile("\\b(evc\\s*-?\\s*plus|haraag\\w*|wareejis\\w*|ka\\s+heshay|ka\\s+hesay)\\b", Pattern.CASE_INSENSITIVE);

    private EvcFilter() {}

    public static String normalizeSender(String sender) {
        if (sender == null) return "";
        return sender.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9 ]", "").replaceAll("\\s+", " ");
    }

    public static boolean hasEvcTag(String body) {
        return body != null && TAG.matcher(body).find();
    }

    public static boolean isRelevant(String sender, String body, boolean strict) {
        if (body == null || body.trim().isEmpty()) return false;
        boolean known = EVC_SENDERS.contains(normalizeSender(sender));
        if (known && (hasEvcTag(body) || EVC_WORDS.matcher(body).find())) return true;
        return !strict && hasEvcTag(body);
    }
}
