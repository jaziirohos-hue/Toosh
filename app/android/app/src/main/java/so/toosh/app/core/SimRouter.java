package so.toosh.app.core;

import java.util.List;

/**
 * Decides which registered EVC number an incoming SMS belongs to, from the SIM subscription Android reports.
 * When the mapping is uncertain the message is held as UNMATCHED and the person chooses; Toosh never guesses
 * on a phone with more than one active SIM.
 */
public final class SimRouter {
    public static final class Mapping {
        public final Integer subscriptionId; public final Integer simSlot; public final String evcNumberId; public final String accountId;
        public Mapping(Integer subscriptionId, Integer simSlot, String evcNumberId, String accountId) {
            this.subscriptionId = subscriptionId; this.simSlot = simSlot; this.evcNumberId = evcNumberId; this.accountId = accountId;
        }
    }

    public enum Kind { MATCHED, UNMATCHED, OTHER_SIM }

    public static final class Route {
        public final Kind kind; public final Mapping mapping;
        Route(Kind kind, Mapping mapping) { this.kind = kind; this.mapping = mapping; }
    }

    private SimRouter() {}

    /**
     * @param subscriptionId reported subscription id, or null/negative when Android does not say
     * @param simSlot reported slot, or null
     * @param activeSims number of active SIMs on the phone (0 when unknown)
     */
    public static Route route(Integer subscriptionId, Integer simSlot, List<Mapping> mappings, int activeSims) {
        if (mappings == null || mappings.isEmpty()) return new Route(Kind.UNMATCHED, null);
        boolean subKnown = subscriptionId != null && subscriptionId >= 0;
        if (subKnown) {
            for (Mapping m : mappings) if (m.subscriptionId != null && m.subscriptionId.equals(subscriptionId)) return new Route(Kind.MATCHED, m);
            // A known SIM that no registered number uses: its messages must never be counted for another number.
            boolean anyHasSub = false;
            for (Mapping m : mappings) if (m.subscriptionId != null) anyHasSub = true;
            if (anyHasSub) return new Route(Kind.OTHER_SIM, null);
        }
        if (simSlot != null && simSlot >= 0) {
            for (Mapping m : mappings) if (m.simSlot != null && m.simSlot.equals(simSlot)) return new Route(Kind.MATCHED, m);
        }
        if (mappings.size() == 1 && activeSims <= 1) return new Route(Kind.MATCHED, mappings.get(0));
        return new Route(Kind.UNMATCHED, null);
    }
}
