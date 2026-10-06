package com.yuntu.geocam;

import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.DownloadListener;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Base64;

/**
 * 滑洲天象七星 · Android 壳
 * WebView 加载本地打包的 React 单文件应用（assets/www/index.html）。
 * 关键增强：
 *  1) getUserMedia 相机取流 —— WebChromeClient.onPermissionRequest 放行 + 运行时 CAMERA 权限；
 *  2) 网页 geolocation 水印定位 —— onGeolocationPermissionsShowPrompt 放行 + 运行时定位权限；
 *  3) 拍摄后的 data:URL「下载照片」—— DownloadListener 落盘到 公共下载/天象七星（无存储桥时 <a download> 在 WebView 不生效）。
 * 注意：受 d8 8.2.2 + JDK26 限制，禁用 enum 与匿名内部类，全部用具名 static 内部类 / lambda。
 */
public class MainActivity extends Activity {

    static final int REQ_PERMS = 42;
    static final String[] RUNTIME_PERMS;

    static {
        String[] base = new String[]{
                android.Manifest.permission.CAMERA,
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.ACCESS_COARSE_LOCATION,
        };
        if (Build.VERSION.SDK_INT <= 28) {
            RUNTIME_PERMS = new String[]{
                    android.Manifest.permission.CAMERA,
                    android.Manifest.permission.ACCESS_FINE_LOCATION,
                    android.Manifest.permission.ACCESS_COARSE_LOCATION,
                    android.Manifest.permission.WRITE_EXTERNAL_STORAGE,
            };
        } else {
            RUNTIME_PERMS = base;
        }
    }

    WebView webView;
    boolean permsAskedOnce = false;
    android.webkit.ValueCallback<Uri[]> filePathCallback;
    static final int FILE_PICK = 1001;

    void startFileChooser() {
        try {
            android.content.Intent i = new android.content.Intent(
                    android.content.Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(android.content.Intent.CATEGORY_OPENABLE);
            i.setType("image/*");
            startActivityForResult(i, FILE_PICK);
        } catch (Exception e) {
            if (filePathCallback != null) { filePathCallback.onReceiveValue(null); filePathCallback = null; }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        if (requestCode == FILE_PICK) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri uri = data.getData();
                try {
                    getContentResolver().takePersistableUriPermission(
                            uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignore) { }
                results = new Uri[]{uri};
            }
            if (filePathCallback != null) { filePathCallback.onReceiveValue(results); filePathCallback = null; }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(0xFF05070A);
        getWindow().setNavigationBarColor(0xFF05070A);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF05070A);
        setContentView(webView);
        // 发布版默认关闭 WebView 远程调试（chrome://inspect 可连上看页面源码）；联调时再打开
        WebView.setWebContentsDebuggingEnabled(false);

        WebSettings st = webView.getSettings();
        st.setJavaScriptEnabled(true);
        st.setDomStorageEnabled(true);
        st.setGeolocationEnabled(true);
        st.setMediaPlaybackRequiresUserGesture(false);
        st.setAllowFileAccess(true);
        st.setAllowContentAccess(true);
        st.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= 21) {
            st.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppChromeClient(this));
        webView.setDownloadListener(new PhotoSaver(this));
        webView.addJavascriptInterface(new PhotoBridge(this), "AndroidBridge");

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!permsAskedOnce) {
            permsAskedOnce = true;
            if (!hasAllPerms()) {
                requestPermissions(RUNTIME_PERMS, REQ_PERMS);
            }
        }
        webView.onResume();
    }

    @Override
    protected void onStop() {
        super.onStop();
        // 退到后台释放相机取流与网页计时器
        webView.onPause();
    }

    boolean hasAllPerms() {
        for (String p : RUNTIME_PERMS) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    boolean hasCameraPerm() {
        return checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    boolean hasLocationPerm() {
        return checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    /** 相机权限从“拒绝”变为“允许”后重载页面，让 getUserMedia 重新拉起 */
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grants) {
        if (requestCode == REQ_PERMS) {
            boolean cameraGranted = hasCameraPerm();
            if (cameraGranted && !cameraWasLive) {
                // 启动时若拒绝了相机，页面已回退到演示画面；补授权后重载一次
                webView.reload();
                Toast.makeText(this, "已获相机权限，正在开启取景", Toast.LENGTH_SHORT).show();
            }
            cameraWasLive = cameraGranted;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grants);
    }

    boolean cameraWasLive = false;

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    void toast(final String msg) {
        runOnUiThread(new ShowToast(this, msg));
    }

    // ---------- 具名内部类（禁匿名类/enum） ----------

    private static final class ShowToast implements Runnable {
        private final MainActivity act;
        private final String msg;
        ShowToast(MainActivity a, String m) { this.act = a; this.msg = m; }
        @Override public void run() {
            Toast.makeText(act, msg, Toast.LENGTH_SHORT).show();
        }
    }

    private static final class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            // 记录 <a download> 点击时的文件名（DownloadListener 的 contentDisposition 为空）
            view.evaluateJavascript(
                    "(function(){if(window.__dlPatched)return;window.__dlPatched=1;window.__dlName='';"
                            + "document.addEventListener('click',function(e){"
                            + "var t=e.target;var a=t&&t.closest?t.closest('a[download]'):null;"
                            + "if(a&&a.download)window.__dlName=a.download;},true);})()",
                    null);
        }
    }

    private static final class AppChromeClient extends WebChromeClient {
        private final MainActivity act;
        AppChromeClient(MainActivity a) { this.act = a; }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean wantsVideo = false;
            for (String r : request.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) { wantsVideo = true; break; }
            }
            if (wantsVideo && !act.hasCameraPerm()) {
                request.deny();
                act.toast("请先允许相机权限才能实拍");
                act.requestPermissions(RUNTIME_PERMS, REQ_PERMS);
                return;
            }
            request.grant(request.getResources());
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(
                String origin, GeolocationPermissions.Callback callback) {
            if (act.hasLocationPerm()) {
                callback.invoke(origin, true, false);
            } else {
                callback.invoke(origin, false, false);
                act.requestPermissions(RUNTIME_PERMS, REQ_PERMS);
            }
        }

        @Override
        public boolean onShowFileChooser(
                WebView view, android.webkit.ValueCallback<Uri[]> callback,
                FileChooserParams params) {
            act.filePathCallback = callback;
            act.startFileChooser();
            return true;
        }
    }

    /** 捕获 <a download> 的 data:URL 图片，写入 公共下载/天象七星 */
    private static final class PhotoSaver implements DownloadListener {
        private final MainActivity act;
        PhotoSaver(MainActivity a) { this.act = a; }

        @Override
        public void onDownloadStart(
                final String url, String userAgent,
                String contentDisposition, String mimetype, long contentLength) {
            if (!url.startsWith("data:")) {
                // 非 data 链接交给系统浏览器
                try {
                    android.content.Intent i = new android.content.Intent(
                            android.content.Intent.ACTION_VIEW, Uri.parse(url));
                    act.startActivity(i);
                } catch (Exception e) {
                    act.toast("无法打开该链接");
                }
                return;
            }
            final String fallback = fixName(fileName(contentDisposition), mimetype);
            act.webView.evaluateJavascript("window.__dlName||''", new DlNameCb(this, fallback, url, mimetype));
        }
    }

    /** evaluateJavascript 回读下载文件名的具名回调（JSON 字符串需反转义）。
     *  注意：d8 8.2.2 + JDK26 遇泛型实现类会 NPE，这里刻意使用原始类型 ValueCallback。 */
    @SuppressWarnings({"rawtypes", "unchecked"})
    private static final class DlNameCb
            implements android.webkit.ValueCallback {
        private final PhotoSaver saver;
        private final String fallback;
        private final String url;
        private final String mime;
        DlNameCb(PhotoSaver s, String f, String u, String m) {
            saver = s; fallback = f; url = u; mime = m;
        }
        @Override
        public void onReceiveValue(Object raw) {
            String value = raw == null ? null : raw.toString();
            String name = fallback;
            try {
                Object v = new org.json.JSONTokener(value == null ? "\"\"" : value).nextValue();
                String s = v == null ? "" : v.toString();
                if (!s.isEmpty()) name = MainActivity.fixName(s, mime);
            } catch (Exception ignore) {
            }
            new Thread(new SaveJob(url, name, saver.act)).start();
        }
    }

    /** JS 桥：拍摄后自动把 JPEG 存入系统相册（DCIM/天象七星，与相机照片同列主时间线），同步返回 ok/错误信息 */
    private static final class PhotoBridge {
        private final MainActivity act;
        PhotoBridge(MainActivity a) { this.act = a; }

        @JavascriptInterface
        public String savePhoto(String base64Data, String fileName) {
            try {
                if (base64Data == null || base64Data.isEmpty()) return "空数据";
                byte[] bytes = Base64.getDecoder().decode(base64Data);
                String name = fixName(fileName == null || fileName.isEmpty()
                        ? "天象七星_" + System.currentTimeMillis() + ".jpg" : fileName, "image/jpeg");
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                            Environment.DIRECTORY_DCIM + "/天象七星");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri uri = act.getContentResolver()
                            .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "MediaStore 插入失败";
                    OutputStream os = act.getContentResolver().openOutputStream(uri);
                    os.write(bytes);
                    os.close();
                    v.clear();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    act.getContentResolver().update(uri, v, null, null);
                    return "ok|" + uri.toString();
                } else {
                    File dir = new File(
                            Environment.getExternalStoragePublicDirectory(
                                    Environment.DIRECTORY_DCIM), "天象七星");
                    if (!dir.exists() && !dir.mkdirs()) return "无法创建相册目录";
                    File f = new File(dir, name);
                    FileOutputStream fos = new FileOutputStream(f);
                    fos.write(bytes);
                    fos.close();
                    MediaScannerConnection.scanFile(
                            act, new String[]{ f.getAbsolutePath() },
                            new String[]{ "image/jpeg" }, null);
                    return "ok|" + Uri.fromFile(f).toString();
                }
            } catch (Exception e) {
                return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            }
        }

        /** 跳系统相册查看指定照片（看完返回 App 继续拍，奥维式体验） */
        @JavascriptInterface
        public String openPhoto(String uriStr) {
            try {
                android.content.Intent i = new android.content.Intent(
                        android.content.Intent.ACTION_VIEW);
                i.setDataAndType(Uri.parse(uriStr), "image/*");
                i.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(i);
                return "ok";
            } catch (Exception e) {
                return e.getMessage() == null ? "fail" : e.getMessage();
            }
        }

        /** 家云同步通道：原生 POST（绕 WebView CORS/明文限制）。返回 ok|响应体 或错误 */
        @JavascriptInterface
        public String httpPost(String urlStr, String jsonBody) {
            return doHttp("POST", urlStr, jsonBody);
        }

        /** 家云同步通道：原生 GET（测试连接等） */
        @JavascriptInterface
        public String httpGet(String urlStr) {
            return doHttp("GET", urlStr, null);
        }

        /** 异步 POST：后台线程上传，完成回调 cbTemplate 中的 %RET%（JSON 字符串），UI 不阻塞。connectMs 可选（内网探测用短超时） */
        @JavascriptInterface
        public String httpPostAsync(String urlStr, String body, String cbTemplate, Integer connectMs) {
            new Thread(new AsyncNet(this, "POST", urlStr, body, cbTemplate,
                    connectMs == null ? 6000 : connectMs.intValue())).start();
            return "started";
        }

        /** 异步 GET（测试连接用） */
        @JavascriptInterface
        public String httpGetAsync(String urlStr, String cbTemplate, Integer connectMs) {
            new Thread(new AsyncNet(this, "GET", urlStr, null, cbTemplate,
                    connectMs == null ? 6000 : connectMs.intValue())).start();
            return "started";
        }

        /** 后台网络任务（具名 Runnable，禁匿名类） */
        private static final class AsyncNet implements Runnable {
            private final PhotoBridge bridge;
            private final String method;
            private final String url;
            private final String body;
            private final String cbTemplate;
            private final int connectMs;
            AsyncNet(PhotoBridge b, String m, String u, String bo, String cb, int cms) {
                bridge = b; method = m; url = u; body = bo; cbTemplate = cb; connectMs = cms;
            }
            @Override
            public void run() {
                final String ret;
                try {
                    ret = doHttp(method, url, body, connectMs);
                } catch (Exception e) {
                    return;
                }
                bridge.act.runOnUiThread(new DeliverJs(bridge.act, cbTemplate, ret));
            }
        }

        /** 把结果投递回 WebView 回调 */
        private static final class DeliverJs implements Runnable {
            private final MainActivity act;
            private final String cbTemplate;
            private final String ret;
            DeliverJs(MainActivity a, String cb, String r) { act = a; cbTemplate = cb; ret = r; }
            @Override
            public void run() {
                try {
                    if (act.webView == null || cbTemplate == null || !cbTemplate.contains("%RET%")) return;
                    String js = cbTemplate.replace("%RET%", org.json.JSONObject.quote(ret));
                    act.webView.evaluateJavascript(js, null);
                } catch (Exception ignore) {
                }
            }
        }

        /** 大文件上传走相册 uri：JS→Java 桥有消息大小限制，照片字节由原生读取 */
        @JavascriptInterface
        public String httpPostFile(String urlStr, String token, String metaJson, String uriStr) {
            try {
                byte[] bytes = readPhotoWithRetry(uriStr);
                if (bytes == null || bytes.length < 1000) return "照片尚未落盘";
                String b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
                String body = "{\"token\":" + jsonString(token)
                        + ",\"meta\":" + (metaJson == null || metaJson.isEmpty() ? "{}" : metaJson)
                        + ",\"image\":" + jsonString(b64) + "}";
                return doHttp("POST", urlStr, body);
            } catch (Exception e) {
                return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            }
        }

        /** 刚写入的 MediaStore 项可能短暂不可读：最多轮询 10 次 × 500ms */
        byte[] readPhotoWithRetry(String uriStr) throws Exception {
            Exception last = null;
            for (int i = 0; i < 10; i++) {
                try {
                    byte[] b = readPhotoOnce(uriStr);
                    if (b != null && b.length > 1000) return b;
                } catch (Exception e) {
                    last = e;
                }
                try {
                    Thread.sleep(500);
                } catch (InterruptedException ie) {
                    break;
                }
            }
            if (last != null) throw last;
            return null;
        }

        byte[] readPhotoOnce(String uriStr) throws Exception {
            if (uriStr.startsWith("content://")) {
                java.io.InputStream in = act.getContentResolver()
                        .openInputStream(Uri.parse(uriStr));
                if (in == null) throw new Exception("uri打不开");
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                in.close();
                return bo.toByteArray();
            }
            java.io.File f = new java.io.File(Uri.parse(uriStr).getPath());
            if (!f.exists()) throw new Exception("文件不存在");
            java.io.FileInputStream fi = new java.io.FileInputStream(f);
            byte[] all = new byte[(int) f.length()];
            int off = 0;
            int n2;
            while (off < all.length
                    && (n2 = fi.read(all, off, all.length - off)) > 0) off += n2;
            fi.close();
            return all;
        }

        /** JSON 字符串字面量转义 */
        static String jsonString(String s) {
            try {
                return org.json.JSONObject.quote(s == null ? "" : s);
            } catch (Exception e) {
                return "\"\"";
            }
        }

        static String doHttp(String method, String urlStr, String body) {
            return doHttp(method, urlStr, body, 6000);
        }

        static String doHttp(String method, String urlStr, String body, int connectMs) {
            java.io.InputStream is = null;
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection)
                        new java.net.URL(urlStr).openConnection();
                c.setConnectTimeout(connectMs);
                c.setReadTimeout(20000);
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                c.setRequestProperty("Accept", "application/json");
                if ("POST".equals(method)) {
                    c.setRequestMethod("POST");
                    c.setDoOutput(true);
                    byte[] b = (body == null ? "" : body).getBytes("UTF-8");
                    c.setFixedLengthStreamingMode(b.length);
                    java.io.OutputStream os = c.getOutputStream();
                    os.write(b);
                    os.flush();
                    os.close();
                }
                int code = c.getResponseCode();
                is = code < 400 ? c.getInputStream() : c.getErrorStream();
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                if (is != null) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
                    is.close();
                }
                String resp = bo.toString("UTF-8");
                if (code == 200) return "ok|" + resp;
                return "http-" + code + "|" + resp;
            } catch (Exception e) {
                return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            } finally {
                if (is != null) { try { is.close(); } catch (Exception ignore) { } }
            }
        }
    }

    private static final class SaveJob implements Runnable {
        private final String dataUrl;
        private final String name;
        private final MainActivity act;
        SaveJob(String u, String n, MainActivity a) { dataUrl = u; name = n; act = a; }

        @Override
        public void run() {
            try {
                int comma = dataUrl.indexOf(',');
                if (comma < 0) throw new Exception("bad data url");
                byte[] bytes = Base64.getDecoder().decode(dataUrl.substring(comma + 1));
                if (Build.VERSION.SDK_INT >= 29) {
                    saveQ(bytes, name, act);
                } else {
                    saveLegacy(bytes, name, act);
                }
                act.toast("已保存到 下载/天象七星 · " + name);
            } catch (Exception e) {
                act.toast("保存失败：" + e.getMessage());
            }
        }

        @TargetApi(29)
        static void saveQ(byte[] bytes, String name, MainActivity a) throws Exception {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, "image/jpeg");
            v.put(MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/天象七星");
            Uri uri = a.getContentResolver()
                    .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new Exception("MediaStore 插入失败");
            OutputStream os = a.getContentResolver().openOutputStream(uri);
            os.write(bytes);
            os.close();
        }

        @SuppressWarnings("deprecation")
        static void saveLegacy(byte[] bytes, String name, MainActivity a) throws Exception {
            File dir = new File(
                    Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS), "天象七星");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("无法创建目录");
            File f = new File(dir, name);
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(bytes);
            fos.close();
        }
    }

    // ---------- 工具方法 ----------

    static String fileName(String contentDisposition) {
        String def = "天象七星_" + System.currentTimeMillis() + ".jpg";
        if (contentDisposition == null || contentDisposition.isEmpty()) return def;
        try {
            int idx = contentDisposition.toLowerCase().indexOf("filename=");
            if (idx < 0) return def;
            String n = contentDisposition.substring(idx + 9).trim();
            if (n.startsWith("\"") && n.endsWith("\"") && n.length() > 1) {
                n = n.substring(1, n.length() - 1);
            }
            n = Uri.decode(n);
            return n.isEmpty() ? def : n;
        } catch (Exception e) {
            return def;
        }
    }

    static String fixName(String n, String mime) {
        if (n == null || n.isEmpty()) return "photo.jpg";
        if (!n.toLowerCase().endsWith(".jpg") && !n.toLowerCase().endsWith(".jpeg")) {
            int dot = n.lastIndexOf('.');
            if (dot > 0) n = n.substring(0, dot);
            n = n + ".jpg";
        }
        n = n.replaceAll("[\\\\/:*?\"<>|]", "_");
        return n;
    }
}
