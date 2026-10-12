package com.mk442.rumk;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlPullParserFactory;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class MainActivity extends Activity {
    private WebView webView;
    private WebViewAssetLoader assetLoader;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(8, 7, 15));
        getWindow().setNavigationBarColor(Color.rgb(8, 7, 15));
        getWindow().getDecorView().setSystemUiVisibility(0);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(8, 7, 15));
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        WebView.setWebContentsDebuggingEnabled(false);
        android.webkit.WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " RumkMK442/1.0");

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.addJavascriptInterface(new RumkBridge(), "RumkNative");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                android.webkit.WebResourceResponse response = assetLoader.shouldInterceptRequest(request.getUrl());
                return response != null ? response : super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
                if ("https".equals(scheme) || "http".equals(scheme) || "about".equals(scheme)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                } catch (ActivityNotFoundException ex) {
                    Toast.makeText(MainActivity.this, "لا يوجد تطبيق لفتح هذا الرابط", Toast.LENGTH_SHORT).show();
                    return true;
                }
            }
        });
        setContentView(webView);
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript("(function(){const d=document.querySelector('dialog[open]');if(d){d.close();return 'closed'};return 'back'})()", value -> {
                if ("\"back\"".equals(value)) finish();
            });
        } else {
            finish();
        }
    }

    private final class RumkBridge {
        @JavascriptInterface
        public void searchYouTubeRss(String query, String order, String callbackId) {
            if (query == null || query.length() > 180 || callbackId == null || !callbackId.matches("[0-9]{1,12}")) return;
            new Thread(() -> {
                String result;
                try {
                    result = fetchYoutubeSearchRss(query, "date".equals(order) ? "date" : "relevance");
                } catch (Exception e) {
                    result = "[]";
                }
                final String finalResult = result;
                runOnUiThread(() -> {
                    if (webView == null) return;
                    String js = "window.__rumkNativeResult(" + JSONObject.quote(callbackId) + "," + JSONObject.quote(finalResult) + ");";
                    webView.evaluateJavascript(js, null);
                });
            }, "rumk-youtube-rss").start();
        }

        @JavascriptInterface
        public void openExternal(String rawUrl) {
            if (rawUrl == null || rawUrl.length() > 4096) return;
            Uri uri = Uri.parse(rawUrl);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!"https".equals(scheme) && !"http".equals(scheme)) return;
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                    startActivity(intent);
                } catch (ActivityNotFoundException ex) {
                    Toast.makeText(MainActivity.this, "تعذر فتح الرابط", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    private String fetchYoutubeSearchRss(String query, String order) throws Exception {
        String encoded = URLEncoder.encode(query, StandardCharsets.UTF_8.name());
        URL url = new URL("https://www.youtube.com/feeds/videos.xml?search_query=" + encoded + "&order=" + URLEncoder.encode(order, StandardCharsets.UTF_8.name()));
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(9000);
        connection.setReadTimeout(11000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/atom+xml, application/xml, text/xml, */*");
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36 RumkMK442/1.0");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return "[]";
            try (InputStream input = new BufferedInputStream(connection.getInputStream())) {
                return parseYoutubeXml(input);
            }
        } finally {
            connection.disconnect();
        }
    }

    private String parseYoutubeXml(InputStream input) throws Exception {
        XmlPullParserFactory factory = XmlPullParserFactory.newInstance();
        factory.setNamespaceAware(true);
        XmlPullParser parser = factory.newPullParser();
        parser.setInput(input, "UTF-8");
        JSONArray results = new JSONArray();
        JSONObject current = null;
        String lastTag = "";
        StringBuilder text = new StringBuilder();
        boolean insideAuthor = false;
        int event = parser.getEventType();
        while (event != XmlPullParser.END_DOCUMENT && results.length() < 25) {
            if (event == XmlPullParser.START_TAG) {
                lastTag = parser.getName();
                text.setLength(0);
                if ("entry".equals(lastTag)) {
                    current = new JSONObject();
                    insideAuthor = false;
                } else if (current != null && "author".equals(lastTag)) {
                    insideAuthor = true;
                }
            } else if (event == XmlPullParser.TEXT || event == XmlPullParser.CDSECT) {
                text.append(parser.getText());
            } else if (event == XmlPullParser.END_TAG) {
                String tag = parser.getName();
                String value = text.toString().trim();
                if (current != null && !value.isEmpty()) {
                    if ("videoId".equals(tag) && !current.has("id")) current.put("id", value);
                    else if ("title".equals(tag) && !current.has("title")) current.put("title", value);
                    else if ("name".equals(tag) && insideAuthor && !current.has("author")) current.put("author", value);
                    else if ("published".equals(tag) && !current.has("published")) current.put("published", value);
                }
                if ("author".equals(tag)) insideAuthor = false;
                if ("entry".equals(tag) && current != null) {
                    String id = current.optString("id", "");
                    if (!id.isEmpty()) {
                        current.put("url", "https://www.youtube.com/watch?v=" + id);
                        current.put("thumbnail", "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg");
                        current.put("description", "");
                        results.put(current);
                    }
                    current = null;
                }
                lastTag = "";
                text.setLength(0);
            }
            event = parser.next();
        }
        return results.toString();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("RumkNative");
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
