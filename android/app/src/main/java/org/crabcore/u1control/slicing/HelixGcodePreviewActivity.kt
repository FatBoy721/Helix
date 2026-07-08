package org.crabcore.u1control.slicing

import android.app.Activity
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.u1.slicer.gcode.GcodeParser
import com.u1.slicer.gcode.ParsedGcode
import com.u1.slicer.viewer.GcodeViewerView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.net.URLEncoder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Native 3D G-code toolpath preview — plain-views port of the reference app's
 * Compose GcodeViewer3DScreen. Shows sliced toolpaths as GPU-instanced ribbons
 * (GcodeRenderer / libvgcode port) with:
 *  - vertical layer range slider (two thumbs: bottom + top layer)
 *  - travel move toggle
 *  - feature-type color toggle (walls/infill/support palette vs extruder colors)
 *  - reset camera
 */
class HelixGcodePreviewActivity : Activity() {
  private lateinit var subtitleView: TextView
  private lateinit var container: FrameLayout
  private var viewer: GcodeViewerView? = null
  private var gcode: ParsedGcode? = null
  private var slider: VerticalRangeSlider? = null
  private var sliderTopLabel: TextView? = null
  private var featureColorMode = false
  private var showTravel = false
  private var featureButton: TextView? = null
  private var travelButton: TextView? = null
  private var sendStatus: TextView? = null
  private var sending = false

  private var accentColor: Int = 0xFF2196F3.toInt()
  private var moonrakerUrl: String = ""
  private var gcodePath: String = ""
  private var uploadName: String = "print.gcode"
  private var initialTool: Int = 0
  private var loadedToolMask: Int = -1
  private var usedToolMask: Int = -1

  // Keep the model's name on the uploaded file (engine always writes output.gcode).
  private fun deriveUploadName(title: String?): String {
    val base = (title ?: "").trim()
      .substringBeforeLast('.', title ?: "")
      .ifBlank { "print" }
      .replace(Regex("""[/\\:*?"<>|]"""), "_")
    return "$base.gcode"
  }

  private fun parseAccent(hex: String?): Int =
    try {
      if (hex.isNullOrBlank()) 0xFF2196F3.toInt() else Color.parseColor(hex.trim())
    } catch (_: Throwable) {
      0xFF2196F3.toInt()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val path = intent.getStringExtra(EXTRA_FILE_PATH).orEmpty()
    gcodePath = path
    accentColor = parseAccent(intent.getStringExtra(EXTRA_ACCENT))
    moonrakerUrl = intent.getStringExtra(EXTRA_MOONRAKER).orEmpty()
    initialTool = intent.getIntExtra(EXTRA_INITIAL_TOOL, 0).coerceIn(0, 3)
    loadedToolMask = intent.getIntExtra(EXTRA_LOADED_TOOL_MASK, -1)
    usedToolMask = intent.getIntExtra(EXTRA_USED_TOOL_MASK, -1)
    val title = intent.getStringExtra(EXTRA_TITLE)
      ?.takeIf { it.isNotBlank() }
      ?: "3D G-code View"
    uploadName = deriveUploadName(intent.getStringExtra(EXTRA_TITLE))

    val rootView = buildLayout(title)
    setContentView(rootView)
    EdgeInsets.apply(rootView)

    val file = File(path)
    if (path.isBlank() || !file.exists()) {
      showError("G-code file was not found.")
      return
    }

    loadGcode(file)
  }

  override fun onDestroy() {
    viewer?.onPause()
    viewer = null
    super.onDestroy()
  }

  override fun onPause() {
    viewer?.onPause()
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    viewer?.onResume()
  }

  private fun buildLayout(title: String): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.rgb(10, 12, 14))
    }

    val topBar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(12), dp(8), dp(12), dp(8))
      setBackgroundColor(Color.rgb(18, 21, 24))
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
    }

    val back = TextView(this).apply {
      text = "<"
      textSize = 28f
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      setOnClickListener { finish() }
      layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
    }

    val labels = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_VERTICAL
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    }

    val titleView = TextView(this).apply {
      text = title
      textSize = 16f
      maxLines = 1
      setTextColor(Color.WHITE)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
    }
    subtitleView = TextView(this).apply {
      text = "Parsing G-code..."
      textSize = 12f
      maxLines = 1
      setTextColor(Color.rgb(150, 160, 170))
    }
    labels.addView(titleView)
    labels.addView(subtitleView)

    fun actionButton(label: String, onClick: () -> Unit) = TextView(this).apply {
      text = label
      textSize = 12f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(150, 160, 170))
      setPadding(dp(8), dp(8), dp(8), dp(8))
      setOnClickListener { onClick() }
    }

    featureButton = actionButton("Feature") { toggleFeatureColors() }
    travelButton = actionButton("Travel") { toggleTravel() }
    val reset = actionButton("Reset") { resetView() }.apply { setTextColor(Color.WHITE) }

    topBar.addView(back)
    topBar.addView(labels)
    topBar.addView(featureButton)
    topBar.addView(travelButton)
    topBar.addView(reset)

    // Content row: GL viewer (weight 1) + vertical layer slider strip
    val contentRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        0,
        1f,
      )
    }

    container = FrameLayout(this).apply {
      setBackgroundColor(Color.rgb(10, 12, 14))
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
    }

    val progress = ProgressBar(this).apply {
      isIndeterminate = true
      layoutParams = FrameLayout.LayoutParams(dp(46), dp(46), Gravity.CENTER)
    }
    container.addView(progress)

    val sliderStrip = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setBackgroundColor(Color.rgb(18, 21, 24))
      setPadding(0, dp(8), 0, dp(8))
      layoutParams = LinearLayout.LayoutParams(dp(52), LinearLayout.LayoutParams.MATCH_PARENT)
      visibility = View.GONE
    }
    sliderTopLabel = TextView(this).apply {
      text = ""
      textSize = 11f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(120, 200, 255))
    }
    slider = VerticalRangeSlider(this).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        0,
        1f,
      )
      onRangeChanged = { lo, hi ->
        viewer?.setLayerRange(lo, hi)
        updateSubtitle(lo, hi)
      }
    }
    val sliderBottomLabel = TextView(this).apply {
      text = "1"
      textSize = 11f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(150, 160, 170))
    }
    sliderStrip.addView(sliderTopLabel)
    sliderStrip.addView(slider)
    sliderStrip.addView(sliderBottomLabel)
    this.sliderStrip = sliderStrip

    contentRow.addView(container)
    contentRow.addView(sliderStrip)

    root.addView(topBar)
    root.addView(contentRow)
    root.addView(buildSendBar())
    return root
  }

  // Send-to-printer bar shown under the toolpath view. Uploads the sliced G-code
  // straight to the connected Moonraker (passed in from the RN app).
  private fun buildSendBar(): View {
    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.rgb(18, 21, 24))
      setPadding(dp(12), dp(8), dp(12), dp(10))
    }

    sendStatus = TextView(this).apply {
      text = if (moonrakerUrl.isBlank()) {
        "No printer connected in Helix."
      } else {
        "Ready to send. Uses ${maskToTools(requiredToolMask())}."
      }
      textSize = 12f
      setTextColor(Color.rgb(160, 170, 180))
      setPadding(0, 0, 0, dp(8))
    }
    bar.addView(sendStatus)

    fun pill(label: String, filled: Boolean, onClick: () -> Unit) = TextView(this).apply {
      text = label
      textSize = 14f
      gravity = Gravity.CENTER
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      setTextColor(if (filled) Color.WHITE else Color.rgb(220, 228, 236))
      background = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        if (filled) setColor(accentColor) else {
          setColor(Color.rgb(35, 43, 53))
          setStroke(dp(1), (accentColor and 0x00FFFFFF) or 0x59000000)
        }
      }
      isClickable = true
      setOnClickListener { onClick() }
    }

    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    val enabled = moonrakerUrl.isNotBlank()
    row.addView(pill("Upload", false) { if (enabled) sendToPrinter(false) }.apply { alpha = if (enabled) 1f else 0.4f },
      LinearLayout.LayoutParams(0, dp(48), 1f).apply { setMargins(0, 0, dp(5), 0) })
    row.addView(pill("Upload & Print", true) { if (enabled) sendToPrinter(true) }.apply { alpha = if (enabled) 1f else 0.4f },
      LinearLayout.LayoutParams(0, dp(48), 1.6f).apply { setMargins(dp(5), 0, 0, 0) })
    bar.addView(row)
    return bar
  }

  private fun setSendStatus(text: String) {
    runOnUiThread { sendStatus?.text = text }
  }

  private fun sendToPrinter(alsoPrint: Boolean) {
    if (sending) return
    val base = moonrakerUrl.trimEnd('/')
    val file = File(gcodePath)
    if (base.isBlank()) { setSendStatus("No printer connected in Helix."); return }
    if (!file.exists()) { setSendStatus("G-code file is missing."); return }
    if (alsoPrint) {
      val missing = missingLoadedTools()
      if (missing != null) {
        setSendStatus("Load filament in $missing before printing.")
        return
      }
    }
    sending = true
    setSendStatus("Uploading $uploadName...")
    Thread {
      try {
        val client = OkHttpClient()
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
          .addFormDataPart("root", "gcodes")
          .addFormDataPart("file", uploadName, file.asRequestBody("text/plain".toMediaType()))
          .build()
        client.newCall(Request.Builder().url("$base/server/files/upload").post(body).build())
          .execute().use { resp ->
            if (!resp.isSuccessful) throw IllegalStateException("Upload HTTP ${resp.code}")
          }
        if (alsoPrint) {
          val enc = URLEncoder.encode(uploadName, "UTF-8")
          client.newCall(
            Request.Builder().url("$base/printer/print/start?filename=$enc")
              .post("".toRequestBody(null)).build(),
          ).execute().use { }
        }
        setSendStatus(if (alsoPrint) "Sent — printing $uploadName" else "Uploaded $uploadName")
      } catch (error: Throwable) {
        setSendStatus("Send failed: ${error.message ?: error::class.java.simpleName}")
      } finally {
        sending = false
      }
    }.start()
  }

  private fun requiredToolMask(): Int {
    val mask = usedToolMask and 0x0F
    return if (mask != 0) mask else (1 shl initialTool.coerceIn(0, 3))
  }

  private fun missingLoadedTools(): String? {
    if (loadedToolMask < 0) return null
    val missing = requiredToolMask() and loadedToolMask.inv() and 0x0F
    return if (missing == 0) null else maskToTools(missing)
  }

  private fun maskToTools(mask: Int): String =
    (0..3).filter { (mask and (1 shl it)) != 0 }.joinToString(" ") { "T$it" }

  private var sliderStrip: LinearLayout? = null

  private fun loadGcode(file: File) {
    Thread {
      try {
        val parsed = GcodeParser.parse(file)
        if (parsed.layers.isEmpty()) {
          throw IllegalStateException("No printable layers found in this G-code.")
        }
        runOnUiThread { showViewer(parsed) }
      } catch (error: Throwable) {
        runOnUiThread {
          showError("Preview failed: ${error.message ?: error::class.java.simpleName}")
        }
      }
    }.start()
  }

  private fun showViewer(parsed: ParsedGcode) {
    gcode = parsed
    container.removeAllViews()

    val view = GcodeViewerView(this).also {
      it.layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
      it.setGcode(parsed)
    }
    viewer = view
    container.addView(view)

    val layerCount = parsed.layers.size
    if (layerCount > 1) {
      sliderStrip?.visibility = View.VISIBLE
      sliderTopLabel?.text = layerCount.toString()
      slider?.configure(0, layerCount - 1)
    }
    updateSubtitle(0, layerCount - 1)
    if (parsed.isPreviewSimplified) {
      android.widget.Toast.makeText(
        this,
        "Large file: preview is simplified.",
        android.widget.Toast.LENGTH_SHORT,
      ).show()
    }
  }

  private fun updateSubtitle(minLayer: Int, maxLayer: Int) {
    val parsed = gcode ?: return
    val layerCount = parsed.layers.size
    val minZ = parsed.layers.getOrNull(minLayer)?.z ?: 0f
    val maxZ = parsed.layers.getOrNull(maxLayer)?.z ?: 0f
    val zInfo = if (minLayer > 0) {
      String.format("%.1f-%.1fmm", minZ, maxZ)
    } else {
      String.format("%.1fmm", maxZ)
    }
    subtitleView.text = "$layerCount layers  $zInfo  ·  layer ${maxLayer + 1}/$layerCount"
  }

  private fun toggleFeatureColors() {
    featureColorMode = !featureColorMode
    viewer?.setFeatureColorMode(featureColorMode)
    featureButton?.setTextColor(if (featureColorMode) Color.rgb(120, 200, 255) else Color.rgb(150, 160, 170))
  }

  private fun toggleTravel() {
    showTravel = !showTravel
    viewer?.setShowTravel(showTravel)
    travelButton?.setTextColor(if (showTravel) Color.rgb(120, 200, 255) else Color.rgb(150, 160, 170))
  }

  private fun resetView() {
    val view = viewer ?: return
    val parsed = gcode ?: return
    view.renderer.camera.apply {
      setTarget(135.0, 135.0, ((parsed.layers.lastOrNull()?.z ?: 0f) / 2f).toDouble())
      distance = 400.0
      elevation = 35.0
      azimuth = -45.0
      panX = 0.0
      panY = 0.0
    }
    view.requestRender()
  }

  private fun showError(message: String) {
    container.removeAllViews()
    subtitleView.text = "Preview unavailable"
    container.addView(TextView(this).apply {
      text = message
      textSize = 14f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(245, 180, 90))
      setPadding(dp(20), dp(20), dp(20), dp(20))
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
    })
  }

  private fun dp(value: Int): Int =
    (value * resources.displayMetrics.density).toInt()

  /**
   * Minimal vertical two-thumb range slider (top thumb = max layer, bottom
   * thumb = min layer). Plain-views replacement for Compose's rotated
   * RangeSlider used by the reference app.
   */
  private class VerticalRangeSlider(context: Context) : View(context) {
    var onRangeChanged: ((Int, Int) -> Unit)? = null

    private var minValue = 0
    private var maxValue = 1
    private var lowValue = 0
    private var highValue = 1
    private var activeThumb = Thumb.NONE

    private enum class Thumb { NONE, LOW, HIGH }

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(55, 62, 70)
      strokeWidth = 4f * context.resources.displayMetrics.density
      strokeCap = Paint.Cap.ROUND
    }
    private val rangePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(120, 200, 255)
      strokeWidth = 4f * context.resources.displayMetrics.density
      strokeCap = Paint.Cap.ROUND
    }
    private val thumbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
    }
    private val thumbRadius = 9f * context.resources.displayMetrics.density
    private val touchPadding = 18f * context.resources.displayMetrics.density

    fun configure(min: Int, max: Int) {
      minValue = min
      maxValue = max.coerceAtLeast(min + 1)
      lowValue = min
      highValue = maxValue
      invalidate()
    }

    private fun valueToY(value: Int): Float {
      val usable = height - 2 * thumbRadius
      val t = (value - minValue).toFloat() / (maxValue - minValue).toFloat()
      // top of track = maxValue, bottom = minValue
      return thumbRadius + usable * (1f - t)
    }

    private fun yToValue(y: Float): Int {
      val usable = height - 2 * thumbRadius
      val t = 1f - ((y - thumbRadius) / usable)
      return (minValue + t * (maxValue - minValue)).roundToInt().coerceIn(minValue, maxValue)
    }

    override fun onDraw(canvas: Canvas) {
      val cx = width / 2f
      val topY = valueToY(maxValue)
      val bottomY = valueToY(minValue)
      canvas.drawLine(cx, topY, cx, bottomY, trackPaint)
      val hiY = valueToY(highValue)
      val loY = valueToY(lowValue)
      canvas.drawLine(cx, hiY, cx, loY, rangePaint)
      canvas.drawCircle(cx, loY, thumbRadius, thumbPaint)
      canvas.drawCircle(cx, hiY, thumbRadius, thumbPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          parent?.requestDisallowInterceptTouchEvent(true)
          val loY = valueToY(lowValue)
          val hiY = valueToY(highValue)
          val dLo = abs(event.y - loY)
          val dHi = abs(event.y - hiY)
          activeThumb = when {
            dLo > touchPadding && dHi > touchPadding -> if (dHi <= dLo) Thumb.HIGH else Thumb.LOW
            dHi <= dLo -> Thumb.HIGH
            else -> Thumb.LOW
          }
          applyDrag(event.y)
          return true
        }
        MotionEvent.ACTION_MOVE -> {
          applyDrag(event.y)
          return true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          activeThumb = Thumb.NONE
          return true
        }
      }
      return super.onTouchEvent(event)
    }

    private fun applyDrag(y: Float) {
      val value = yToValue(y)
      when (activeThumb) {
        Thumb.LOW -> lowValue = min(value, highValue)
        Thumb.HIGH -> highValue = max(value, lowValue)
        Thumb.NONE -> return
      }
      invalidate()
      onRangeChanged?.invoke(lowValue, highValue)
    }
  }

  companion object {
    const val EXTRA_FILE_PATH = "filePath"
    const val EXTRA_TITLE = "title"
    const val EXTRA_ACCENT = "accentColor"
    const val EXTRA_MOONRAKER = "moonrakerUrl"
    const val EXTRA_INITIAL_TOOL = "initialTool"
    const val EXTRA_LOADED_TOOL_MASK = "loadedToolMask"
    const val EXTRA_USED_TOOL_MASK = "usedToolMask"
  }
}
