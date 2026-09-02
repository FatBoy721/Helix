package org.crabcore.u1control.slicing

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONObject
import org.crabcore.u1control.MainActivity
import com.u1.slicer.gcode.GcodeParser
import com.u1.slicer.gcode.ParsedGcode
import com.u1.slicer.viewer.BedProfile
import com.u1.slicer.viewer.MachineProfile
import com.u1.slicer.viewer.GcodeViewerView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Bambu upload/start is owned by the RN send flow, not this Moonraker preview. */
internal fun usesHelixBambuSend(machineProfile: MachineProfile): Boolean =
  machineProfile.sliceProfileAsset?.lowercase() in setOf("bambu_p1s.json", "bambu_a1.json")

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
  /** Build volume of the printer this gcode is headed for; see the model preview. */
  private var bedProfile: BedProfile = BedProfile.U1
  /** Full machine profile — also gates the PAXX-only print preferences below. */
  private var machineProfile: MachineProfile = MachineProfile.U1
  private var prefFlowCal = false
  private var prefTimelapse = false
  private var prefAutoLevel = false
  private var prefIfs = false
  private var prefAiMonitoring = true
  private var prefAiSensitivity = AiDetectionSensitivity.LOW

  // Print-dialog tool→slot mapping: index = the tool the slicer used, value =
  // the physical U1 slot the user picked for it. Identity until changed.
  private val toolSlotMap = intArrayOf(0, 1, 2, 3)

  // The Ticket-style preprocess sheet; held so the upload thread can drive its
  // progress overlay, and nulled once the send resolves or the sheet dismisses.
  private var preprocessSheet: HelixPreprocessSheet? = null

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
    // The extra carries a MachineProfile wrapper, not a bare bed. Parsing it as
    // a bed reads no size keys and yields a plateless 270 grid.
    machineProfile = MachineProfile.fromJson(intent.getStringExtra(EXTRA_BED_PROFILE))
    bedProfile = machineProfile.bed
    prefAiMonitoring = PreprocessPreferenceStore.aiMonitoringEnabled(this)
    prefAiSensitivity = PreprocessPreferenceStore.aiDetectionSensitivity(this)
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
    viewer?.let {
      it.onResume()
      // The viewer renders only when dirty; ensure a resumed/surface-recreated
      // preview gets a frame even when Android does not deliver another input.
      it.requestRender()
    }
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
    val bambuSend = usesHelixBambuSend(machineProfile)
    val bar = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.rgb(18, 21, 24))
      setPadding(dp(12), dp(8), dp(12), dp(10))
    }

    // Hidden until a send actually starts — no idle chatter above the buttons.
    sendStatus = TextView(this).apply {
      text = when {
        bambuSend -> "Bambu print ready for LAN upload."
        moonrakerUrl.isBlank() -> "No printer connected in Helix."
        else -> ""
      }
      textSize = 12f
      setTextColor(Color.rgb(160, 170, 180))
      setPadding(0, 0, 0, dp(8))
      visibility = if (text.isBlank()) View.GONE else View.VISIBLE
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
      LinearLayout.LayoutParams(0, dp(48), 0.8f).apply {
        setMargins(0, 0, dp(5), 0)
      })
    // These actions speak Moonraker HTTP. Bambu's verified FTPS + MQTT path is
    // in the Helix Slice screen, so showing these here would either claim the
    // live printer is offline or send the wrong protocol to it.
    if (bambuSend) {
      row.addView(pill("Upload & Print", true) { returnToHelixForBambuSend() },
        LinearLayout.LayoutParams(0, dp(48), 1.6f).apply { setMargins(dp(5), 0, 0, 0) })
    } else {
      row.addView(pill("Upload", false) { if (enabled) sendToPrinter(false) }.apply { alpha = if (enabled) 1f else 0.4f },
        LinearLayout.LayoutParams(0, dp(48), 1f).apply { setMargins(dp(5), 0, dp(5), 0) })
      row.addView(pill("Upload & Print", true) { if (enabled) showPrintPreprocessDialog() }.apply { alpha = if (enabled) 1f else 0.4f },
        LinearLayout.LayoutParams(0, dp(48), 1.6f).apply { setMargins(dp(5), 0, 0, 0) })
    }
    bar.addView(row)
    return bar
  }

  // ---------- Print Preprocessing dialog ----------

  private fun showPrintPreprocessDialog() {
    val printers = HelixPrinterStore.read(this)
    if (moonrakerUrl.isBlank()) {
      moonrakerUrl = printers.firstOrNull { it.url.isNotBlank() || it.tailscaleUrl.isNotBlank() }
        ?.let { it.url.ifBlank { it.tailscaleUrl } } ?: ""
    }

    val slotColors = runCatching { FilamentSlotColors.read(this) }.getOrDefault(emptyList())
    val slotDetails = runCatching { FilamentSlotDetails.read(this) }.getOrDefault(emptyList())
    val lanes = (0..3).map { slot ->
      val loaded = loadedToolMask < 0 || (loadedToolMask and (1 shl slot)) != 0
      val detail = slotDetails.getOrNull(slot)
      PreprocessRouting.Lane(
        index = slot,
        color = parseHex(slotColors.getOrNull(slot) ?: "#30343A"),
        brand = detail?.brand ?: "",
        material = detail?.material ?: "PLA",
        mainType = detail?.mainType ?: "",
        subType = detail?.subType ?: "",
        status = if (!loaded) "empty" else (detail?.status?.ifBlank { null } ?: "loaded"),
      )
    }

    val required = (0..3).filter { (requiredToolMask() and (1 shl it)) != 0 }
      .ifEmpty { listOf(initialTool.coerceIn(0, 3)) }

    val initialPrefs = mutableSetOf<PreprocessRouting.Pref>().apply {
      if (prefAiMonitoring && machineProfile.supportsPrintPreferences) {
        add(PreprocessRouting.Pref.AI_MONITORING)
      }
      if (prefAutoLevel) add(PreprocessRouting.Pref.AUTO_LEVEL)
      if (prefFlowCal) add(PreprocessRouting.Pref.FLOW_CAL)
      if (prefTimelapse) add(PreprocessRouting.Pref.TIMELAPSE)
      // RN defaults IFS on (slicer.tsx printPrefs): a material-station machine
      // feeds from the station unless the operator opts out of it.
      if (prefIfs || machineProfile.printPrefs.contains(PreprocessRouting.Pref.IFS.key)) {
        add(PreprocessRouting.Pref.IFS)
      }
    }

    val config = HelixPreprocessSheet.Config(
      fileName = uploadName,
      estTimeSeconds = LastSliceStore.estimatedTimeSeconds.toFloat(),
      estGrams = LastSliceStore.estimatedFilamentGrams.toFloat(),
      layers = LastSliceStore.totalLayers,
      thumbnail = runCatching { GcodeThumbnailReader.readBitmap(gcodePath) }.getOrNull(),
      // The RN layer decides which toggles this machine can honour, so the
      // sheet and the JS dialog cannot drift apart again.
      offeredPrefs = PreprocessRouting.offeredPrefs(
        machineProfile.printPrefs,
        supportsAiMonitoring = machineProfile.supportsPrintPreferences,
      ),
      // Same for what the machine calls its feeds — Lane 1–4 vs T0–T3.
      laneNaming = machineProfile.laneNaming,
      lanes = lanes,
      required = required,
      perToolGrams = parsePerToolGrams(),
      printers = printers,
      activePrinterUrl = moonrakerUrl,
      initialPrefs = initialPrefs,
      sendLabel = "Hold to start",
      probePrinter = { url, cb ->
        fetchPrinterState(url) { state, color, workingUrl ->
          runOnUiThread {
            if (workingUrl.isNotBlank()) moonrakerUrl = workingUrl
            cb(HelixPreprocessSheet.PrinterState(
              label = state,
              reachable = workingUrl.isNotBlank(),
              busy = state == "Printing" || state == "Paused",
              meshProfile = null,
            ))
          }
        }
      },
      onPrinterPicked = { printer -> moonrakerUrl = printer.url.ifBlank { printer.tailscaleUrl } },
      onSend = ::startPrint,
    )

    preprocessSheet = HelixPreprocessSheet(this, config).also { it.show() }
  }

  private fun startPrint(assignments: Map<Int, Int>, prefs: Set<PreprocessRouting.Pref>) {
    for ((tool, lane) in assignments) {
      if (tool in 0..3 && lane in 0..3) toolSlotMap[tool] = lane
    }
    prefAutoLevel = prefs.contains(PreprocessRouting.Pref.AUTO_LEVEL)
    prefFlowCal = prefs.contains(PreprocessRouting.Pref.FLOW_CAL)
    prefTimelapse = prefs.contains(PreprocessRouting.Pref.TIMELAPSE)
    prefIfs = prefs.contains(PreprocessRouting.Pref.IFS)
    prefAiMonitoring = prefs.contains(PreprocessRouting.Pref.AI_MONITORING)
    if (machineProfile.supportsPrintPreferences) {
      PreprocessPreferenceStore.setAiMonitoringEnabled(this, prefAiMonitoring)
    }

    sendToPrinter(true)
  }

  /**
   * Waits briefly for the printer's material prompt and answers it with the
   * lanes chosen on the sheet. Silent when none appears — most machines never
   * raise one, and a print that started cleanly needs no confirmation.
   */
  private fun answerMaterialPrompt(client: OkHttpClient, base: String) {
    val toolToSlot = toolSlotMap.withIndex().associate { (tool, lane) -> tool to lane }
    val deadline = System.currentTimeMillis() + PROMPT_WAIT_MS
    while (System.currentTimeMillis() < deadline) {
      val body = runCatching {
        client.newCall(
          Request.Builder().url("$base/server/gcode_store?count=60").get().build(),
        ).execute().use { resp -> if (resp.isSuccessful) resp.body?.string().orEmpty() else "" }
      }.getOrDefault("")

      val answer = ZmodPrintPrompt.answerFor(
        ZmodPrintPrompt.messagesFromStore(body),
        uploadName,
        toolToSlot,
        prefAutoLevel,
      )
      if (answer != null) {
        val enc = URLEncoder.encode(answer, "UTF-8")
        runCatching {
          client.newCall(
            Request.Builder().url("$base/printer/gcode/script?script=$enc")
              .post("".toRequestBody(null)).build(),
          ).execute().close()
        }
        return
      }
      Thread.sleep(PROMPT_POLL_MS)
    }
  }

  private fun parseHex(hex: String): Int = try {
    Color.parseColor(if (hex.startsWith("#")) hex else "#$hex")
  } catch (_: Throwable) {
    HelixAppTheme.CARD_ALT
  }

  /** Host (no scheme/path/port) for matching LAN ↔ Tailscale urls of one printer. */
  private fun hostOf(u: String): String =
    u.substringAfter("://").substringBefore('/').substringBefore(':').lowercase()

  /**
   * Moonraker endpoints worth trying for [primaryUrl], best-first:
   * the given url, then the matching saved printer's alternate endpoint
   * (LAN ↔ Tailscale), then every other saved endpoint as a last resort.
   * Lets the dialog reach a printer the user left running when away from home.
   */
  private fun resolveCandidates(primaryUrl: String): List<String> {
    val out = LinkedHashSet<String>()
    val p = primaryUrl.trim().trimEnd('/')
    if (p.isNotEmpty()) out.add(p)
    val printers = HelixPrinterStore.read(this)
    val matched = if (p.isNotEmpty()) printers.firstOrNull {
      it.url.trimEnd('/') == p ||
        it.tailscaleUrl.trimEnd('/') == p ||
        (hostOf(p).isNotEmpty() && (hostOf(it.url) == hostOf(p) || hostOf(it.tailscaleUrl) == hostOf(p)))
    } else null
    matched?.let {
      if (it.url.isNotBlank()) out.add(it.url.trimEnd('/'))
      if (it.tailscaleUrl.isNotBlank()) out.add(it.tailscaleUrl.trimEnd('/'))
    }
    printers.forEach {
      if (it.url.isNotBlank()) out.add(it.url.trimEnd('/'))
      if (it.tailscaleUrl.isNotBlank()) out.add(it.tailscaleUrl.trimEnd('/'))
    }
    return out.toList()
  }

  /**
   * Quick Moonraker print_stats poll with LAN→Tailscale failover. Tries each
   * candidate; the first to answer wins and onResult receives (state, color,
   * workingUrl). "Offline" only if every candidate is unreachable — which is
   * the real fix for "printer shows off when the user is away from home".
   */
  private fun fetchPrinterState(primaryUrl: String, onResult: (String, Int, String) -> Unit) {
    val candidates = resolveCandidates(primaryUrl)
    Thread {
      val client = OkHttpClient.Builder()
        .connectTimeout(3, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(3, java.util.concurrent.TimeUnit.SECONDS)
        .build()
      var resolved = false
      for (url in candidates) {
        if (resolved) break
        try {
          val req = Request.Builder()
            .url("$url/printer/objects/query?print_stats")
            .get().build()
          client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return@use  // try next candidate
            val body = resp.body?.string().orEmpty()
            val state = org.json.JSONObject(body)
              .optJSONObject("result")?.optJSONObject("status")
              ?.optJSONObject("print_stats")?.optString("state") ?: "unknown"
            val (label, color) = when (state) {
              "printing" -> "Printing" to accentColor
              "paused" -> "Paused" to 0xFFF5B45A.toInt()
              "error" -> "Error" to 0xFFCF6679.toInt()
              else -> "Idle" to 0xFF6BCB77.toInt()
            }
            resolved = true
            onResult(label, color, url)
          }
        } catch (_: Throwable) {
          // this candidate unreachable — continue to the next
        }
      }
      if (!resolved) onResult("Offline", 0xFFCF6679.toInt(), "")
    }.start()
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

  private fun reportProgress(message: String, fraction: Float) {
    setSendStatus(message)
    preprocessSheet?.onSendProgress(message, fraction)
  }

  private fun sendToPrinter(alsoPrint: Boolean) {
    if (sending) return
    if (moonrakerUrl.isBlank()) { setSendStatus("No printer connected in Helix."); return }
    if (!File(gcodePath).exists()) { setSendStatus("G-code file is missing."); return }
    if (alsoPrint) {
      val missing = missingLoadedTools()
      if (missing != null) {
        setSendStatus("Load filament in $missing before printing.")
        return
      }
    }
    val requestedTimelapse = alsoPrint && prefTimelapse
    val requestedAutoLevel = alsoPrint && prefAutoLevel
    val requestedFlowCalibration = alsoPrint && prefFlowCal
    val requestedAiMonitoring = alsoPrint && prefAiMonitoring
    val requestedAiSensitivity = prefAiSensitivity
    val requestedPhysicalExtruders = physicalUsedExtruders()
    sending = true
    reportProgress(if (requestedTimelapse) "Preparing timelapse..." else "Uploading $uploadName...", 0.02f)
    Thread {
      try {
        // Resolve a reachable Moonraker base (LAN → Tailscale failover) before
        // upload — the status card may have probed LAN and failed when the user
        // is away from home. Pick the first candidate that answers a print_stats
        // probe; if none do, the printer really is offline.
        val probeClient = OkHttpClient.Builder()
          .connectTimeout(4, TimeUnit.SECONDS)
          .readTimeout(4, TimeUnit.SECONDS)
          .build()
        val base = resolveCandidates(moonrakerUrl).firstOrNull { cand ->
          try {
            probeClient.newCall(
              Request.Builder().url("$cand/printer/objects/query?print_stats").get().build(),
            ).execute().use { it.isSuccessful }
          } catch (_: Throwable) { false }
        }
        if (base == null) {
          setSendStatus("No printer connected in Helix.")
          return@Thread
        }
        moonrakerUrl = base
        var file = remappedGcodeFile()
        if (requestedTimelapse) {
          file = GcodeTimelapseInjector.inject(file.absolutePath, cacheDir)
          reportProgress("Uploading $uploadName...", 0.05f)
        }
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
          .addFormDataPart(
            "file",
            uploadName,
            ProgressRequestBody(file, "text/plain".toMediaTypeOrNull()) { frac ->
              reportProgress("Uploading $uploadName...", 0.05f + frac * 0.80f)
            },
          )
          .build()
        client.newCall(Request.Builder().url("$base/server/files/upload").post(body).build())
          .execute().use { resp ->
            if (!resp.isSuccessful) throw IllegalStateException("Upload HTTP ${resp.code}")
          }
        if (alsoPrint) {
          // IFS off on a material-station machine: zmod's per-print external-spool
          // path. SET_ZCOLOR SILENT=2 raises no material prompt at all, so there
          // is nothing to answer — applyPrintPreferences already no-ops here
          // (supportsPrintPreferences=false), and /printer/print/start is what
          // would raise the prompt, so it is skipped too.
          val ifsOff = machineProfile.printPrefs.contains(PreprocessRouting.Pref.IFS.key) && !prefIfs
          if (ifsOff) {
            reportProgress("Starting $uploadName (external spool)...", 0.96f)
            val script = URLEncoder.encode(
              ZmodPrintPrompt.ifsOffPrintGcode(uploadName, prefAutoLevel),
              "UTF-8",
            )
            moonrakerJson(
              client,
              Request.Builder().url("$base/printer/gcode/script?script=$script")
                .post("".toRequestBody(null)).build(),
              "Print start",
            )
          } else {
            reportProgress("Applying AI monitoring and print preferences...", 0.9f)
            applyPrintPreferences(
              client,
              base,
              requestedAutoLevel,
              requestedTimelapse,
              requestedFlowCalibration,
              requestedAiMonitoring,
              requestedAiSensitivity,
              requestedPhysicalExtruders,
            )
            reportProgress("Starting $uploadName...", 0.96f)
            val enc = URLEncoder.encode(uploadName, "UTF-8")
            client.newCall(
              Request.Builder().url("$base/printer/print/start?filename=$enc")
                .post("".toRequestBody(null)).build(),
            ).execute().use { resp ->
              if (!resp.isSuccessful) throw IllegalStateException("Print start HTTP ${resp.code}")
            }
            // zmod answers a print start by asking which lane feeds each tool —
            // a question this sheet just asked. Answer it here rather than waiting
            // for the RN layer, which is not even in front yet.
            reportProgress("Confirming materials...", 0.98f)
            answerMaterialPrompt(client, base)
          }
        }
        reportProgress(if (alsoPrint) "Sent — printing $uploadName" else "Uploaded $uploadName", 1f)
        preprocessSheet?.dismiss()
        preprocessSheet = null
        if (alsoPrint) returnToHomeWithPrintSuccess(uploadName)
      } catch (error: Throwable) {
        val failMsg = error.message ?: error::class.java.simpleName
        setSendStatus("Send failed: $failMsg")
        preprocessSheet?.onSendFailed(failMsg)
      } finally {
        sending = false
      }
    }.start()
  }

  private fun applyPrintPreferences(
    client: OkHttpClient,
    base: String,
    autoLevel: Boolean,
    timelapse: Boolean,
    flowCalibration: Boolean,
    aiMonitoring: Boolean,
    aiSensitivity: AiDetectionSensitivity,
    usedExtruders: List<Int>,
  ) {
    val state = moonrakerJson(
      client,
      Request.Builder().url("$base/printer/objects/query?print_stats").get().build(),
      "Printer status",
    ).optJSONObject("result")
      ?.optJSONObject("status")
      ?.optJSONObject("print_stats")
      ?.optString("state")
    if (state == "printing" || state == "paused") {
      throw IllegalStateException("Printer is already $state")
    }

    // PAXX/U1 firmware only. Other machines have neither SET_PRINT_PREFERENCES
    // nor the print_task_config object, so this errored and then failed its own
    // read-back with "Printer rejected the selected print preferences".
    if (!machineProfile.supportsPrintPreferences) return

    val script = PreprocessRouting.aiMonitoringCommand(aiMonitoring, aiSensitivity) + "\n" +
      "SET_MAIN_STATE MAIN_STATE=IDLE\n" +
      "SET_PRINT_USED_EXTRUDERS EXTRUDERS=${usedExtruders.joinToString(",")}\n" +
      "SET_PRINT_PREFERENCES BED_LEVEL=${if (autoLevel) 1 else 0} " +
      "TIME_LAPSE_CAMERA=${if (timelapse) 1 else 0} " +
      "FLOW_CALIBRATE=${if (flowCalibration) 1 else 0} " +
      "FLOW_CALIBRATE_EXTRUDERS=0,1,2,3"
    val encodedScript = URLEncoder.encode(script, "UTF-8")
    moonrakerJson(
      client,
      Request.Builder().url("$base/printer/gcode/script?script=$encodedScript")
        .post("".toRequestBody(null)).build(),
      "Print preferences",
    )

    val config = moonrakerJson(
      client,
      Request.Builder().url("$base/printer/objects/query?print_task_config").get().build(),
      "Print preference verification",
    ).optJSONObject("result")
      ?.optJSONObject("status")
      ?.optJSONObject("print_task_config")
      ?: throw IllegalStateException("Printer returned no print preference state")
    val flowCalibrationExtruders = config.optJSONArray("flow_calib_extruders")
    val configuredExtruders = config.optJSONArray("extruders_used")
    if (
      !config.has("auto_bed_leveling") ||
      !config.has("time_lapse_camera") ||
      !config.has("flow_calibrate") ||
      config.optBoolean("auto_bed_leveling") != autoLevel ||
      config.optBoolean("time_lapse_camera") != timelapse ||
      config.optBoolean("flow_calibrate") != flowCalibration ||
      flowCalibrationExtruders == null ||
      flowCalibrationExtruders.length() < 4 ||
      (0 until 4).any { !flowCalibrationExtruders.optBoolean(it) } ||
      configuredExtruders == null ||
      configuredExtruders.length() < 4 ||
      (0 until 4).any { configuredExtruders.optBoolean(it) != usedExtruders.contains(it) }
    ) {
      throw IllegalStateException("Printer rejected the selected print preferences")
    }
  }

  private fun moonrakerJson(
    client: OkHttpClient,
    request: Request,
    operation: String,
  ): JSONObject = client.newCall(request).execute().use { response ->
    val body = response.body?.string().orEmpty()
    if (!response.isSuccessful) {
      throw IllegalStateException("$operation HTTP ${response.code}")
    }
    try {
      JSONObject(body)
    } catch (error: Throwable) {
      throw IllegalStateException("$operation returned invalid JSON", error)
    }
  }

  private fun returnToHomeWithPrintSuccess(filename: String) {
    runOnUiThread {
      val homeIntent = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("u1control:///"),
        this,
        MainActivity::class.java,
      ).apply {
        putExtra(HelixSlicerModule.EXTRA_PRINT_SENT_FILENAME, filename)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
      startActivity(homeIntent)
      finish()
    }
  }

  /** Returns to the still-mounted Slice tab, which owns Bambu FTPS + MQTT. */
  private fun returnToHelixForBambuSend() {
    LastSliceStore.requestBambuSend()
    val helixIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    startActivity(helixIntent)
    finish()
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

  private fun physicalUsedExtruders(): List<Int> =
    (0..3)
      .filter { (requiredToolMask() and (1 shl it)) != 0 }
      .map { toolSlotMap[it] }
      .distinct()
      .sorted()

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
      // Set before attach so the first frame already has the right bed.
      it.renderer.bedProfile = bedProfile
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
    const val EXTRA_BED_PROFILE = "bedProfile"
    /** How long to wait for a material prompt after starting a print. */
    private const val PROMPT_WAIT_MS = 12_000L
    private const val PROMPT_POLL_MS = 600L
    const val EXTRA_MODEL_PATH = "modelPath"
    const val EXTRA_SLOT_COLORS = "slotColors"
    private const val REQ_SAVE_GCODE = 4471
  }
}
