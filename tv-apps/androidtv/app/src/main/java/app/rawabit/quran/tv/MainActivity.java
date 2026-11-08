package app.rawabit.quran.tv;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Thin launcher: opens the app's TV screen (QR code for the phone remote). */
public class MainActivity extends Activity {
  private static final String TV_URL = "https://rawabit-alziker-alhakim.vercel.app/#/room?view=tv";
  private WebView web;

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    web.setWebViewClient(new WebViewClient());
    setContentView(web);
    web.loadUrl(TV_URL);
  }

  @Override public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
}
