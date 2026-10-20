package so.toosh.app.net;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Minimal HTTPS JSON client for background work. Production builds refuse cleartext (network_security_config). */
public final class Api {
    public static final class Response {
        public final int status; public final String body;
        public Response(int status, String body) { this.status = status; this.body = body; }
    }

    /** Swappable for tests. */
    public interface Transport { Response send(String method, String url, String token, String jsonBody) throws Exception; }

    public static final Transport HTTP = (method, url, token, jsonBody) -> {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Accept", "application/json");
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
        if (jsonBody != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) { os.write(jsonBody.getBytes(StandardCharsets.UTF_8)); }
        }
        int status = c.getResponseCode();
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (in != null) try (InputStream s = in) { byte[] buf = new byte[8192]; int n; while ((n = s.read(buf)) > 0) out.write(buf, 0, n); }
        c.disconnect();
        return new Response(status, out.toString("UTF-8"));
    };

    private Api() {}
}
