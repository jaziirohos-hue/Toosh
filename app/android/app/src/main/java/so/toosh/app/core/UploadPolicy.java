package so.toosh.app.core;

/**
 * What to do after an upload attempt. Kept free of Android classes so it can be unit tested.
 *  - 2xx: apply each per-message result (created/duplicate = synced; rejected = permanent, shown to the person).
 *  - 401/403: the device was signed out or revoked. Stop and keep the queue until the person signs in again.
 *  - 408/429/5xx/network: keep queued and retry with exponential backoff (30 s, doubling, at most 30 minutes).
 *  - other 4xx: the request itself is wrong; keep the messages and mark them failed (never silently dropped).
 */
public final class UploadPolicy {
    public enum Outcome { APPLY_RESULTS, STOP_AUTH, RETRY, FAIL_REQUEST }

    private UploadPolicy() {}

    public static Outcome forStatus(int httpStatus) {
        if (httpStatus >= 200 && httpStatus < 300) return Outcome.APPLY_RESULTS;
        if (httpStatus == 401 || httpStatus == 403) return Outcome.STOP_AUTH;
        if (httpStatus <= 0 || httpStatus == 408 || httpStatus == 429 || httpStatus >= 500) return Outcome.RETRY;
        return Outcome.FAIL_REQUEST;
    }

    public static long backoffMillis(int attempts) {
        long base = 30_000L;
        int shift = Math.max(0, Math.min(attempts - 1, 6));
        return Math.min(base << shift, 30 * 60_000L);
    }
}
