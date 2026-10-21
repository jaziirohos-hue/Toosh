package so.toosh.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TooshNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Android would enlarge only the text (not the boxes around it) to follow the phone's font size, which makes
        // text spill out of buttons. The web app instead scales the whole screen by the font size (see main.tsx).
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
