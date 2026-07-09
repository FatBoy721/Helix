package org.crabcore.u1control.slicing

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.content.res.ColorStateList
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.CheckBox
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.crabcore.u1control.R
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
import java.util.concurrent.TimeUnit
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
  private var modelPath: String = ""
  private var uploadName: String = "print.gcode"
  private var initialTool: Int = 0
  private var loadedToolMask: Int = -1
  private var usedToolMask: Int = -1
  private var prefFlowCal = false
  private var prefTimelapse = false
  private var prefAutoLevel = false

  // Print-dialog tool→slot mapping: index = the tool the slicer used, value =
  // the physical U1 slot the user picked for it. Identity until changed.
  private val toolSlotMap = intArrayOf(0, 1, 2, 3)

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
    modelPath = intent.getStringExtra(EXTRA_MODEL_PATH).orEmpty()
      .ifBlank { LastSliceStore.modelPath.orEmpty() }
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

    // Hidden until a send actually starts — no idle chatter above the buttons.
    sendStatus = TextView(this).apply {
      text = if (moonrakerUrl.isBlank()) "No printer connected in Helix." else ""
      textSize = 12f
      setTextColor(Color.rgb(160, 170, 180))
      setPadding(0, 0, 0, dp(8))
      visibility = if (moonrakerUrl.isBlank()) View.VISIBLE else View.GONE
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
    // Saved printers count too — the dialog's picker can retarget the send.
    val enabled = moonrakerUrl.isNotBlank() || HelixPrinterStore.read(this).isNotEmpty()
    // Save works with no printer at all — it's the manual-upload escape hatch.
    row.addView(pill("Save", false) { saveGcode() },
      LinearLayout.LayoutParams(0, dp(48), 0.8f).apply { setMargins(0, 0, dp(5), 0) })
    row.addView(pill("Upload", false) { if (enabled) sendToPrinter(false) }.apply { alpha = if (enabled) 1f else 0.4f },
      LinearLayout.LayoutParams(0, dp(48), 1f).apply { setMargins(dp(5), 0, dp(5), 0) })
    row.addView(pill("Upload & Print", true) { if (enabled) showPrintPreprocessDialog() }.apply { alpha = if (enabled) 1f else 0.4f },
      LinearLayout.LayoutParams(0, dp(48), 1.6f).apply { setMargins(dp(5), 0, 0, 0) })
    bar.addView(row)
    return bar
  }

  // ---------- Print Preprocessing dialog ----------

  private fun showPrintPreprocessDialog() {
    HelixThemedDialog.showFloatingCenter(
      activity = this,
      accent = accentColor,
      title = "Print Preprocessing",
      iconRes = R.drawable.ic_print,
      content = buildPreprocessContent(),
      secondaryLabel = "Cancel",
      primaryLabel = "Print",
      onPrimary = { sendToPrinter(true) },
    )
  }

  private fun buildPreprocessContent(): View {
    fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
    }

    fun sectionTitle(text: String) = TextView(this).apply {
      this.text = text
      textSize = 13f
      setTextColor(HelixAppTheme.TEXT)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      setPadding(0, dp(12), 0, dp(6))
    }

    // Model information ------------------------------------------------------
    root.addView(sectionTitle("Model Information"))
    root.addView(TextView(this).apply {
      val mins = (LastSliceStore.estimatedTimeSeconds / 60f).toInt()
      val grams = LastSliceStore.estimatedFilamentGrams
      // Effective config the ENGINE actually sliced with (echoed in the gcode
      // footer) — proves whether profile overrides like ironing really landed.
      val ironing = findGcodeConfigLine(Regex("""ironing_type\s*=\s*(.+)""", RegexOption.IGNORE_CASE))
      val infillPat = findGcodeConfigLine(Regex("""sparse_infill_pattern\s*=\s*(.+)""", RegexOption.IGNORE_CASE))
      val cfgBits = listOfNotNull(
        infillPat?.let { "infill $it" },
        ironing?.let { "ironing $it" },
      ).joinToString(" · ")
      text = "$uploadName\n${mins} min  ·  ${String.format("%.1f", grams)} g  ·  ${LastSliceStore.totalLayers} layers" +
        if (cfgBits.isNotEmpty()) "\n$cfgBits" else ""
      textSize = 12f
      setTextColor(HelixAppTheme.SUBTEXT)
    })

    // Printer — tap to send this print to any printer saved in Helix ---------
    val printers = HelixPrinterStore.read(this)
    if (printers.isNotEmpty()) {
      root.addView(sectionTitle("Printer"))
      val printerRow = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(12), dp(10), dp(12), dp(10))
        background = GradientDrawable().apply {
          cornerRadius = dp(10).toFloat()
          setColor(HelixAppTheme.CARD)
          setStroke(dp(1), HelixAppTheme.BORDER)
        }
        isClickable = true
      }
      if (moonrakerUrl.isBlank()) moonrakerUrl = printers.first().url

      // Match the connected URL to a saved printer — exact first, then by host
      // (LAN vs Tailscale URLs share a printer entry).
      fun hostOf(u: String) = u.substringAfter("://").substringBefore('/').substringBefore(':').lowercase()
      fun nameFor(url: String): String =
        printers.firstOrNull { it.url.trimEnd('/') == url.trimEnd('/') }?.name
          ?: printers.firstOrNull { hostOf(it.url) == hostOf(url) }?.name
          ?: hostOf(url).ifBlank { "Printer" }

      val printerName = TextView(this).apply {
        text = nameFor(moonrakerUrl)
        textSize = 13f
        setTextColor(HelixAppTheme.TEXT)
        typeface = android.graphics.Typeface.DEFAULT_BOLD
      }
      val printerStatus = TextView(this).apply {
        text = "Checking…"
        textSize = 11f
        setTextColor(HelixAppTheme.SUBTEXT)
      }
      fun refreshPrinterStatus() {
        printerStatus.text = "Checking…"
        printerStatus.setTextColor(HelixAppTheme.SUBTEXT)
        fetchPrinterState(moonrakerUrl) { state, color ->
          runOnUiThread {
            printerStatus.text = state
            printerStatus.setTextColor(color)
          }
        }
      }
      refreshPrinterStatus()

      val nameCol = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        addView(printerName)
        addView(printerStatus)
      }
      printerRow.addView(ImageView(this).apply {
        setImageResource(R.drawable.ic_print)
        imageTintList = ColorStateList.valueOf(accentColor)
        layoutParams = LinearLayout.LayoutParams(dp(18), dp(18)).apply { marginEnd = dp(10) }
      })
      printerRow.addView(nameCol)
      printerRow.addView(TextView(this).apply {
        text = "▾"
        textSize = 13f
        setTextColor(HelixAppTheme.SUBTEXT)
      })
      printerRow.setOnClickListener {
        showPrinterPicker(printerRow, printers) { picked ->
          moonrakerUrl = picked.url
          printerName.text = picked.name
          refreshPrinterStatus()
        }
      }
      root.addView(printerRow, LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ))
    }

    // Filament — one card per tool the print ACTUALLY uses. Circle + card tint =
    // the model's colour for that tool; grams/types parsed from the gcode; load
    // state from the printer's tool mask. Row centres itself for 1–4 cards.
    root.addView(sectionTitle("Filament"))
    val colours = runCatching { GcodeFilamentColors.resolve(this, gcodePath, modelPath.ifBlank { null }) }
      .getOrDefault(emptyList())
    val grams = parsePerToolGrams()
    val types = parseFilamentTypes()
    val usedTools = (0..3).filter { (requiredToolMask() and (1 shl it)) != 0 }
      .ifEmpty { listOf(initialTool.coerceIn(0, 3)) }

    val filRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_HORIZONTAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
    }

    // Fit all used tools inside the dialog: shrink card + circle when 4-up.
    val dialogContentW = minOf(dp(380), (resources.displayMetrics.widthPixels * 0.92f).toInt()) - dp(32)
    val cardW = minOf(dp(88), dialogContentW / usedTools.size - dp(8))
    val circleD = (cardW * 0.55f).toInt().coerceAtMost(dp(48))
    usedTools.forEachIndexed { pos, tool ->
      val hex = colours.getOrNull(tool) ?: colours.getOrNull(pos) ?: "#30343A"
      val colour = parseHex(hex)
      val card = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(10), dp(12), dp(10), dp(12))
        background = GradientDrawable().apply {
          cornerRadius = dp(12).toFloat()
          // Card bathes in the model's colour, dimmed so text stays readable.
          setColor((colour and 0x00FFFFFF) or 0x2E000000)
          setStroke(dp(1), (colour and 0x00FFFFFF) or 0x66000000)
        }
      }
      val circleBg = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(colour)
        setStroke(dp(1), 0x55FFFFFF.toInt())
      }
      card.addView(View(this).apply {
        background = circleBg
        layoutParams = LinearLayout.LayoutParams(circleD, circleD)
      })
      card.addView(TextView(this).apply {
        text = "T$tool"
        textSize = 15f
        gravity = Gravity.CENTER
        setTextColor(HelixAppTheme.TEXT)
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        setPadding(0, dp(6), 0, 0)
      })
      card.addView(TextView(this).apply {
        text = types.getOrNull(tool)?.ifBlank { null } ?: types.getOrNull(pos)?.ifBlank { null } ?: "PLA"
        textSize = 11f
        maxLines = 1
        gravity = Gravity.CENTER
        setTextColor(HelixAppTheme.TEXT)
      })
      val g = grams.getOrNull(tool) ?: grams.getOrNull(pos)
      val gramsTxt = if (g != null && g > 0) " · ${String.format("%.1f", g)}g" else ""
      val statusView = TextView(this).apply {
        textSize = 10f
        gravity = Gravity.CENTER
        setPadding(0, dp(2), 0, 0)
      }
      fun refreshStatus() {
        val slot = toolSlotMap[tool]
        val slotLoaded = loadedToolMask < 0 || (loadedToolMask and (1 shl slot)) != 0
        val slotTxt = if (slot != tool) "→ T$slot" else if (slotLoaded) "Loaded" else "Empty"
        statusView.text = slotTxt + gramsTxt
        statusView.setTextColor(if (slotLoaded) HelixAppTheme.SUBTEXT else 0xFFCF6679.toInt())
        // Circle shows what will ACTUALLY print: the chosen slot's filament
        // colour when remapped, the model's colour on the default slot.
        val circleColour = if (slot != tool) {
          parseHex(FilamentSlotColors.read(this).getOrNull(slot) ?: "#30343A")
        } else {
          colour
        }
        circleBg.setColor(circleColour)
      }
      refreshStatus()
      card.addView(statusView)
      // Tap → pick which machine slot supplies this colour.
      card.isClickable = true
      card.setOnClickListener { showSlotPicker(card, tool) { refreshStatus() } }
      filRow.addView(card, LinearLayout.LayoutParams(cardW, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
        setMargins(dp(4), 0, dp(4), 0)
      })
    }
    root.addView(filRow)

    // Print preferences ------------------------------------------------------
    root.addView(sectionTitle("Print Preferences"))
    fun prefRow(label: String, initial: Boolean, onChange: (Boolean) -> Unit) {
      val rowView = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, dp(4), 0, dp(4))
      }
      rowView.addView(TextView(this).apply {
        text = label
        textSize = 13f
        setTextColor(HelixAppTheme.TEXT)
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      })
      rowView.addView(CheckBox(this).apply {
        isChecked = initial
        buttonTintList = ColorStateList.valueOf(accentColor)
        setOnCheckedChangeListener { _, checked -> onChange(checked) }
      })
      root.addView(rowView)
    }
    prefRow("Extrusion Flow Calibration", prefFlowCal) { prefFlowCal = it }
    prefRow("Time-lapse Camera", prefTimelapse) { prefTimelapse = it }
    prefRow("Auto Leveling", prefAutoLevel) { prefAutoLevel = it }

    return root
  }

  private fun parseHex(hex: String): Int = try {
    Color.parseColor(if (hex.startsWith("#")) hex else "#$hex")
  } catch (_: Throwable) {
    HelixAppTheme.CARD_ALT
  }

  /** Dropdown listing the printers saved in Helix; picking one retargets the send. */
  private fun showPrinterPicker(
    anchor: View,
    printers: List<HelixPrinterStore.Printer>,
    onPicked: (HelixPrinterStore.Printer) -> Unit,
  ) {
    fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    val list = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        setColor(HelixAppTheme.CARD)
        setStroke(dp(1), HelixAppTheme.BORDER)
      }
      setPadding(dp(6), dp(6), dp(6), dp(6))
    }
    val popup = android.widget.PopupWindow(
      list, dp(240), LinearLayout.LayoutParams.WRAP_CONTENT, true,
    )
    printers.forEach { printer ->
      val active = printer.url.trimEnd('/') == moonrakerUrl.trimEnd('/')
      val row = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(12), dp(9), dp(12), dp(9))
        if (active) {
          background = GradientDrawable().apply {
            cornerRadius = dp(8).toFloat()
            setColor((accentColor and 0x00FFFFFF) or 0x26000000)
          }
        }
        isClickable = true
        setOnClickListener {
          onPicked(printer)
          popup.dismiss()
        }
      }
      row.addView(TextView(this).apply {
        text = printer.name
        textSize = 13f
        setTextColor(if (active) accentColor else HelixAppTheme.TEXT)
        typeface = android.graphics.Typeface.DEFAULT_BOLD
      })
      val statusLabel = TextView(this).apply {
        text = "Checking…"
        textSize = 11f
        setTextColor(HelixAppTheme.SUBTEXT)
      }
      row.addView(statusLabel)
      list.addView(row)
      fetchPrinterState(printer.url) { state, color ->
        runOnUiThread {
          statusLabel.text = state
          statusLabel.setTextColor(color)
        }
      }
    }
    popup.elevation = dp(8).toFloat()
    popup.showAsDropDown(anchor, 0, dp(4))
  }

  /** Quick Moonraker print_stats poll → "Idle" / "Printing" / "Paused" / "Offline". */
  private fun fetchPrinterState(url: String, onResult: (String, Int) -> Unit) {
    Thread {
      try {
        val client = OkHttpClient.Builder()
          .connectTimeout(3, java.util.concurrent.TimeUnit.SECONDS)
          .readTimeout(3, java.util.concurrent.TimeUnit.SECONDS)
          .build()
        val req = Request.Builder()
          .url("${url.trimEnd('/')}/printer/objects/query?print_stats")
          .get().build()
        client.newCall(req).execute().use { resp ->
          if (!resp.isSuccessful) throw IllegalStateException("HTTP ${resp.code}")
          val body = resp.body?.string().orEmpty()
          val state = org.json.JSONObject(body)
            .optJSONObject("result")?.optJSONObject("status")
            ?.optJSONObject("print_stats")?.optString("state") ?: "unknown"
          when (state) {
            "printing" -> onResult("Printing", accentColor)
            "paused" -> onResult("Paused", 0xFFF5B45A.toInt())
            "complete", "standby", "ready", "cancelled", "idle" -> onResult("Idle", 0xFF6BCB77.toInt())
            "error" -> onResult("Error", 0xFFCF6679.toInt())
            else -> onResult("Idle", 0xFF6BCB77.toInt())
          }
        }
      } catch (_: Throwable) {
        onResult("Offline", 0xFFCF6679.toInt())
      }
    }.start()
  }

  /**
   * Dropdown under a filament card: the machine's four slots (colour + loaded
   * state, from the Slice tab's slot settings + printer mask). Picking one maps
   * this print colour onto that physical slot at send time.
   */
  private fun showSlotPicker(anchor: View, tool: Int, onPicked: () -> Unit) {
    fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    val slotColors = FilamentSlotColors.read(this)

    val list = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        setColor(HelixAppTheme.CARD)
        setStroke(dp(1), HelixAppTheme.BORDER)
      }
      setPadding(dp(6), dp(6), dp(6), dp(6))
    }

    val popup = android.widget.PopupWindow(
      list,
      dp(170),
      LinearLayout.LayoutParams.WRAP_CONTENT,
      true,
    )

    for (slot in 0..3) {
      val slotLoaded = loadedToolMask < 0 || (loadedToolMask and (1 shl slot)) != 0
      val row = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(10), dp(9), dp(10), dp(9))
        isClickable = true
        if (toolSlotMap[tool] == slot) {
          background = GradientDrawable().apply {
            cornerRadius = dp(8).toFloat()
            setColor((accentColor and 0x00FFFFFF) or 0x26000000)
          }
        }
        setOnClickListener {
          toolSlotMap[tool] = slot
          onPicked()
          popup.dismiss()
        }
      }
      row.addView(View(this).apply {
        background = GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(parseHex(slotColors.getOrNull(slot) ?: "#30343A"))
          setStroke(dp(1), 0x55FFFFFF.toInt())
        }
        layoutParams = LinearLayout.LayoutParams(dp(20), dp(20))
      })
      row.addView(TextView(this).apply {
        text = "T$slot"
        textSize = 13f
        setTextColor(HelixAppTheme.TEXT)
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        setPadding(dp(10), 0, 0, 0)
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      })
      row.addView(TextView(this).apply {
        text = if (slotLoaded) "Loaded" else "Empty"
        textSize = 11f
        setTextColor(if (slotLoaded) HelixAppTheme.SUBTEXT else 0xFFCF6679.toInt())
      })
      list.addView(row)
    }

    popup.elevation = dp(8).toFloat()
    popup.showAsDropDown(anchor, 0, dp(4))
  }

  /** Per-tool grams from the gcode footer (`; filament used [g] = a, b, c`). */
  private fun parsePerToolGrams(): List<Double> {
    val re = Regex("""filament used \[g\]\s*=\s*(.+)""", RegexOption.IGNORE_CASE)
    val line = findGcodeConfigLine(re) ?: return emptyList()
    return line.split(",").mapNotNull { it.trim().toDoubleOrNull() }
  }

  /** Per-tool filament types (`; filament_type = PLA;PETG`), else empty. */
  private fun parseFilamentTypes(): List<String> {
    val re = Regex("""filament_type\s*=\s*(.+)""", RegexOption.IGNORE_CASE)
    val line = findGcodeConfigLine(re) ?: return emptyList()
    return line.split(',', ';').map { it.trim().trim('"') }.filter { it.isNotEmpty() }
  }

  /** Scans the gcode footer (then header) for a `; key = value` config line. */
  private fun findGcodeConfigLine(re: Regex): String? {
    val file = File(gcodePath)
    if (!file.exists()) return null
    return try {
      java.io.RandomAccessFile(file, "r").use { raf ->
        val len = raf.length()
        val from = maxOf(0L, len - 256 * 1024)
        raf.seek(from)
        val bytes = ByteArray((len - from).toInt())
        raf.readFully(bytes)
        String(bytes, Charsets.UTF_8).lineSequence().forEach { line ->
          if (line.startsWith(";")) {
            re.find(line)?.let { return it.groupValues[1].trim() }
          }
        }
      }
      null
    } catch (_: Throwable) {
      null
    }
  }

  private fun setSendStatus(text: String) {
    runOnUiThread {
      sendStatus?.text = text
      sendStatus?.visibility = if (text.isBlank()) View.GONE else View.VISIBLE
    }
  }

  private fun sendToPrinter(alsoPrint: Boolean) {
    if (sending) return
    val base = moonrakerUrl.trimEnd('/')
    if (base.isBlank()) { setSendStatus("No printer connected in Helix."); return }
    if (!File(gcodePath).exists()) { setSendStatus("G-code file is missing."); return }
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
        val file = remappedGcodeFile()
        // Default OkHttp timeouts are 10s — a multi-MB gcode over WiFi/Tailscale
        // needs the same size-scaled window HelixSlicerModule.uploadGcode uses.
        val sizeMb = file.length() / (1024L * 1024L)
        val timeoutSec = maxOf(30L, minOf(300L, sizeMb + 30L))
        val client = OkHttpClient.Builder()
          .connectTimeout(20, TimeUnit.SECONDS)
          .writeTimeout(timeoutSec, TimeUnit.SECONDS)
          .readTimeout(timeoutSec, TimeUnit.SECONDS)
          .build()
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

  // Dialog remap: rewrite tool changes onto the slots the user picked.
  private fun remappedGcodeFile(): File {
    val identity = toolSlotMap.withIndex().all { (i, v) -> i == v }
    if (identity) return File(gcodePath)
    val remapped = File(filesDir, "remap_send.gcode")
    return if (GcodeToolMapper.applyToolMapping(gcodePath, remapped.absolutePath, toolSlotMap.copyOf())) {
      remapped
    } else {
      File(gcodePath)
    }
  }

  // "Save" pill → SAF create-document so the gcode can be uploaded manually
  // (e.g. through Fluidd in a browser) when a direct send isn't possible.
  private fun saveGcode() {
    if (!File(gcodePath).exists()) { setSendStatus("G-code file is missing."); return }
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "application/octet-stream"
      putExtra(Intent.EXTRA_TITLE, uploadName)
    }
    try {
      startActivityForResult(intent, REQ_SAVE_GCODE)
    } catch (_: Throwable) {
      setSendStatus("No file picker available on this device.")
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQ_SAVE_GCODE) return
    val uri = data?.data
    if (resultCode != RESULT_OK || uri == null) return
    setSendStatus("Saving $uploadName...")
    Thread {
      try {
        val file = remappedGcodeFile()
        contentResolver.openOutputStream(uri)?.use { out ->
          file.inputStream().use { it.copyTo(out) }
        } ?: throw IllegalStateException("Could not open the chosen location.")
        setSendStatus("Saved $uploadName")
      } catch (error: Throwable) {
        setSendStatus("Save failed: ${error.message ?: error::class.java.simpleName}")
      }
    }.start()
  }

  private fun requiredToolMask(): Int {
    val mask = usedToolMask and 0x0F
    return if (mask != 0) mask else (1 shl initialTool.coerceIn(0, 3))
  }

  private fun missingLoadedTools(): String? {
    if (loadedToolMask < 0) return null
    // Check the PHYSICAL slots the print will use after the dialog's remap.
    var physical = 0
    for (t in 0..3) {
      if ((requiredToolMask() and (1 shl t)) != 0) physical = physical or (1 shl toolSlotMap[t])
    }
    val missing = physical and loadedToolMask.inv() and 0x0F
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
    }
    viewer = view
    view.setExtruderColors(resolveSlotColors())
    view.setGcode(parsed)
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

  private fun resolveSlotColors(): List<String> =
    GcodeFilamentColors.resolve(this, gcodePath, modelPath.ifBlank { null })

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
    const val EXTRA_MODEL_PATH = "modelPath"
    const val EXTRA_SLOT_COLORS = "slotColors"
    private const val REQ_SAVE_GCODE = 4471
  }
}
