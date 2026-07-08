package org.crabcore.u1control.slicing

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.util.concurrent.Executors

class MakerWorldDownloaderActivity : Activity() {
  private lateinit var webView: WebView
  private lateinit var progress: ProgressBar
  private lateinit var statusText: TextView
  private val executor = Executors.newSingleThreadExecutor()
  private var downloading = false
  private var startUrl = "https://makerworld.com/en"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    startUrl = buildStartUrl()
    val rootView = buildContentView()
    setContentView(rootView)
    EdgeInsets.apply(rootView)
    setupWebView()
    webView.loadUrl(startUrl)
  }

  override fun onDestroy() {
    try {
      webView.stopLoading()
      webView.destroy()
    } catch (_: Throwable) {
    }
    executor.shutdownNow()
    super.onDestroy()
  }

  override fun onBackPressed() {
    if (::webView.isInitialized && webView.canGoBack()) {
      webView.goBack()
      return
    }
    setResult(RESULT_CANCELED)
    super.onBackPressed()
  }

  private fun buildContentView(): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(0xff101418.toInt())
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      )
    }

    val toolbar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(10), dp(8), dp(10), dp(8))
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
    }

    val close = Button(this).apply {
      text = "Close"
      setOnClickListener {
        setResult(RESULT_CANCELED)
        finish()
      }
    }
    toolbar.addView(close, LinearLayout.LayoutParams(dp(86), dp(42)))

    statusText = TextView(this).apply {
      text = "Tap MakerWorld's Download button."
      setTextColor(0xfff5f7fa.toInt())
      textSize = 13f
      setPadding(dp(10), 0, dp(10), 0)
      maxLines = 2
    }
    toolbar.addView(
      statusText,
      LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
    )

    val browser = Button(this).apply {
      text = "Open"
      setOnClickListener { openExternal(webView.url ?: startUrl) }
    }
    toolbar.addView(browser, LinearLayout.LayoutParams(dp(78), dp(42)))

    progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
      isIndeterminate = true
      visibility = View.GONE
    }

    webView = WebView(this).apply {
      layoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        0,
        1f,
      )
    }

    root.addView(toolbar)
    root.addView(
      progress,
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(3),
      ),
    )
    root.addView(webView)
    return root
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun setupWebView() {
    val cookies = CookieManager.getInstance()
    cookies.setAcceptCookie(true)
    cookies.setAcceptThirdPartyCookies(webView, true)

    webView.settings.javaScriptEnabled = true
    webView.settings.domStorageEnabled = true
    webView.settings.javaScriptCanOpenWindowsAutomatically = true
    webView.settings.setSupportMultipleWindows(true)
    webView.settings.userAgentString = MW_UA

    val mainWebView = webView
    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val target = request?.url ?: return false
        if (target.shouldOpenExternallyForAuth()) {
          openExternal(target.toString())
          return true
        }
        return false
      }

      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        progress.visibility = View.VISIBLE
        statusText.text = "Loading MakerWorld..."
      }

      override fun onPageFinished(view: WebView?, url: String?) {
        progress.visibility = View.GONE
        CookieManager.getInstance().flush()
        statusText.text = "Tap MakerWorld's Download button."
      }
    }

    webView.webChromeClient = object : WebChromeClient() {
      override fun onCreateWindow(
        view: WebView?,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?,
      ): Boolean {
        val popup = WebView(this@MakerWorldDownloaderActivity).apply {
          settings.javaScriptEnabled = true
          settings.domStorageEnabled = true
          settings.javaScriptCanOpenWindowsAutomatically = true
          settings.setSupportMultipleWindows(true)
          CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
          webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
              popupView: WebView?,
              request: WebResourceRequest?,
            ): Boolean {
              val target = request?.url ?: return false
              if (target.shouldOpenExternallyForAuth()) {
                openExternal(target.toString())
              } else {
                mainWebView.loadUrl(target.toString())
              }
              popupView?.destroy()
              return true
            }

            override fun onPageStarted(popupView: WebView?, url: String?, favicon: Bitmap?) {
              if (!url.isNullOrBlank()) {
                val target = Uri.parse(url)
                if (target.shouldOpenExternallyForAuth()) {
                  openExternal(url)
                } else {
                  mainWebView.loadUrl(url)
                }
              }
              popupView?.stopLoading()
              popupView?.destroy()
            }
          }
        }

        val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
        transport.webView = popup
        resultMsg.sendToTarget()
        return true
      }
    }

    webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
      if (downloading) return@setDownloadListener
      downloading = true
      val filename = sanitizeFilename(resolveDownloadFilename(url, contentDisposition, mimeType))
      val referer = webView.url ?: startUrl
      statusText.text = "Downloading $filename..."
      progress.visibility = View.VISIBLE

      executor.execute {
        try {
          val file = downloadToFilesDir(url, filename, userAgent, mimeType, referer)
          runOnUiThread {
            val result = Intent().apply {
              putExtra(EXTRA_DESIGN_ID, intent.getStringExtra(EXTRA_DESIGN_ID))
              putExtra(EXTRA_INSTANCE_ID, intent.getStringExtra(EXTRA_INSTANCE_ID))
              putExtra(EXTRA_FILE_PATH, file.absolutePath)
              putExtra(EXTRA_FILE_NAME, file.name)
              putExtra(EXTRA_SIZE_BYTES, file.length())
              putExtra(EXTRA_SOURCE_URL, url)
            }
            setResult(RESULT_OK, result)
            Toast.makeText(this, "Downloaded ${file.name}", Toast.LENGTH_SHORT).show()
            finish()
          }
        } catch (error: Throwable) {
          runOnUiThread {
            downloading = false
            progress.visibility = View.GONE
            statusText.text = "Download failed: ${error.message ?: error::class.java.simpleName}"
            Toast.makeText(this, statusText.text, Toast.LENGTH_LONG).show()
          }
        }
      }
    }
  }

  private fun downloadToFilesDir(
    url: String,
    filename: String,
    userAgent: String?,
    mimeType: String?,
    referer: String,
  ): File {
    val dir = File(filesDir, "makerworld").apply { mkdirs() }
    var currentUrl = url
    var currentName = filename

    repeat(6) {
      val connection = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false
        connectTimeout = 30_000
        readTimeout = 120_000
        requestMethod = "GET"
        setRequestProperty("User-Agent", userAgent?.takeIf { it.isNotBlank() } ?: MW_UA)
        setRequestProperty("Accept", "application/json, text/plain, */*")
        setRequestProperty("Referer", referer)
        CookieManager.getInstance().getCookie(currentUrl)?.takeIf { it.isNotBlank() }?.let {
          setRequestProperty("Cookie", it)
        }
      }

      val code = connection.responseCode
      if (code in 300..399) {
        val location = connection.getHeaderField("Location")
          ?: throw IllegalStateException("Redirect without Location")
        currentUrl = URL(URL(currentUrl), location).toString()
        connection.disconnect()
        return@repeat
      }

      if (code !in 200..299) {
        val body = connection.errorStream?.bufferedReader()?.use { it.readText().take(300) }
        connection.disconnect()
        throw IllegalStateException("HTTP $code${if (body.isNullOrBlank()) "" else ": $body"}")
      }

      val contentType = connection.contentType ?: mimeType ?: ""
      val disposition = connection.getHeaderField("Content-Disposition")
      if (!disposition.isNullOrBlank()) {
        currentName = sanitizeFilename(resolveDownloadFilename(currentUrl, disposition, contentType))
      }

      if (contentType.contains("json", ignoreCase = true)) {
        val text = connection.inputStream.bufferedReader().use { it.readText() }
        connection.disconnect()
        val json = JSONObject(text)
        val fileUrl = json.optString("url", "")
        if (fileUrl.isBlank()) throw IllegalStateException(json.optString("error", "No file URL returned"))
        currentName = sanitizeFilename(json.optString("name", currentName))
        currentUrl = fileUrl
        return@repeat
      }

      currentName = ensureModelExtension(currentName, contentType)
      val target = uniqueFile(dir, currentName)
      val temp = File(dir, "${target.name}.download")
      temp.delete()
      connection.inputStream.use { input ->
        temp.outputStream().use { output -> input.copyTo(output) }
      }
      connection.disconnect()
      if (temp.length() <= 0L) {
        temp.delete()
        throw IllegalStateException("Downloaded file is empty")
      }
      if (!temp.renameTo(target)) {
        temp.copyTo(target, overwrite = true)
        temp.delete()
      }
      return target
    }

    throw IllegalStateException("Too many redirects")
  }

  private fun buildStartUrl(): String {
    intent.getStringExtra(EXTRA_START_URL)?.takeIf { it.isNotBlank() }?.let { return it }
    val designId = intent.getStringExtra(EXTRA_DESIGN_ID)?.takeIf { it.isNotBlank() }
    val instanceId = intent.getStringExtra(EXTRA_INSTANCE_ID)?.takeIf { it.isNotBlank() }
    if (designId != null) {
      return buildString {
        append("https://makerworld.com/en/models/")
        append(designId)
        if (instanceId != null) append("#profileId-").append(instanceId)
      }
    }
    return "https://makerworld.com/en"
  }

  private fun openExternal(url: String) {
    try {
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
    } catch (_: ActivityNotFoundException) {
      Toast.makeText(this, "No browser found", Toast.LENGTH_SHORT).show()
    }
  }

  private fun Uri.shouldOpenExternallyForAuth(): Boolean {
    val h = host?.lowercase() ?: return false
    return h == "accounts.google.com" ||
      h.endsWith(".accounts.google.com") ||
      h == "appleid.apple.com" ||
      h == "www.facebook.com" ||
      h == "m.facebook.com"
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  companion object {
    const val EXTRA_DESIGN_ID = "designId"
    const val EXTRA_INSTANCE_ID = "instanceId"
    const val EXTRA_START_URL = "startUrl"
    const val EXTRA_FILE_PATH = "filePath"
    const val EXTRA_FILE_NAME = "fileName"
    const val EXTRA_SIZE_BYTES = "sizeBytes"
    const val EXTRA_SOURCE_URL = "sourceUrl"

    private const val MW_UA =
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

    fun resolveDownloadFilename(url: String, contentDisposition: String?, mimeType: String?): String {
      val extended = Regex("""filename\*=UTF-8''([^;]+)""", RegexOption.IGNORE_CASE)
        .find(contentDisposition ?: "")
        ?.groupValues
        ?.getOrNull(1)
      if (!extended.isNullOrBlank()) {
        return URLDecoder.decode(extended.trim('"'), "UTF-8")
      }

      val basic = Regex("""filename="?([^";\n]+)"?""", RegexOption.IGNORE_CASE)
        .find(contentDisposition ?: "")
        ?.groupValues
        ?.getOrNull(1)
      if (!basic.isNullOrBlank()) return basic.trim()

      return URLUtil.guessFileName(url, contentDisposition, mimeType)
    }

    fun sanitizeFilename(filename: String): String =
      filename.replace(Regex("""[/\\:*?"<>|]"""), "_").trim().ifBlank { "model.3mf" }

    private fun ensureModelExtension(filename: String, contentType: String): String {
      if (filename.endsWith(".3mf", ignoreCase = true) || filename.endsWith(".stl", ignoreCase = true)) {
        return filename
      }
      return if (contentType.contains("stl", ignoreCase = true)) "$filename.stl" else "$filename.3mf"
    }

    private fun uniqueFile(dir: File, filename: String): File {
      val base = filename.substringBeforeLast('.', filename)
      val ext = filename.substringAfterLast('.', "")
      var candidate = File(dir, filename)
      var index = 1
      while (candidate.exists()) {
        val suffix = if (ext.isBlank()) "-$index" else "-$index.$ext"
        candidate = File(dir, "$base$suffix")
        index += 1
      }
      return candidate
    }
  }
}
