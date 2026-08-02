package org.crabcore.u1control.slicing

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import java.util.Locale
import org.crabcore.u1control.R
import org.crabcore.u1control.slicing.HelixCockpit as P
import org.crabcore.u1control.slicing.PreprocessRouting.Check
import org.crabcore.u1control.slicing.PreprocessRouting.Lane
import org.crabcore.u1control.slicing.PreprocessRouting.Pref
import org.crabcore.u1control.slicing.PreprocessRouting.RouteSource
import org.crabcore.u1control.slicing.PreprocessRouting.Tone
import org.crabcore.u1control.slicing.PreprocessRouting.Tool

/**
 * Print preprocess — the Ticket sheet, in native views.
 *
 * A port of [components/PrintPreprocessDialog.tsx] so the native G-code preview's
 * "Upload & Print" lands on the same screen as the RN slicer and Files tabs. By
 * the time it opens the decision is already made, so it answers four things at a
 * glance — what, where, how long, what it costs — folds routing and options away,
 * and makes the commit deliberate with a press-and-hold.
 *
 * Routing and blocking live in [PreprocessRouting], shared with the RN sheet.
 */
class HelixPreprocessSheet(
  private val activity: Activity,
  private val config: Config,
) {
  data class Config(
    val fileName: String,
    val estTimeSeconds: Float,
    val estGrams: Float,
    val layers: Int,
    val thumbnail: Bitmap?,
    /** The machine's four physical lanes. */
    val lanes: List<Lane>,
    /** File tools the gcode asks for. */
    val required: List<Int>,
    val perToolGrams: List<Double>,
    val printers: List<HelixPrinterStore.Printer>,
    val activePrinterUrl: String,
    val initialPrefs: Set<Pref>,
    val sendLabel: String = "Hold to start",
    /** Reports reachability, busy state and bed mesh for a printer, on the UI thread. */
    val probePrinter: (String, (PrinterState) -> Unit) -> Unit,
    val onPrinterPicked: (HelixPrinterStore.Printer) -> Unit,
    /** file tool → physical lane, plus the chosen print preferences. */
    val onSend: (Map<Int, Int>, Set<Pref>) -> Unit,
  )

  data class PrinterState(
    val label: String,
    val reachable: Boolean,
    val busy: Boolean,
    val meshProfile: String?,
  )

  private enum class Fold { ROUTING, OPTIONS }

  private val density = activity.resources.displayMetrics.density
  private val manual = mutableMapOf<Int, Int>()
  private val prefs = config.initialPrefs.toMutableSet()

  private var openFold: Fold? = null
  private var printerUrl = config.activePrinterUrl
  private var printerState: PrinterState? = null
  private var errorMessage: String? = null
  private var sending = false

  private val dialog = Dialog(activity)
  private lateinit var root: FrameLayout
  private lateinit var sheet: LinearLayout
  private lateinit var body: LinearLayout
  private lateinit var footer: FrameLayout
  private var layer: View? = null
  private var overlay: View? = null
  private var statusLabel: TextView? = null
  private var progressBar: ProgressBar? = null
  private var progressPct: TextView? = null

  // ---------- view helpers ----------

  private fun dp(value: Int): Int = (value * density).toInt()
  private fun dpf(value: Float): Float = value * density

  private fun rounded(fill: Int, radiusDp: Float, stroke: Int? = null, strokeDp: Int = 1) =
    GradientDrawable().apply {
      cornerRadius = dpf(radiusDp)
      setColor(fill)
      stroke?.let { setStroke(dp(strokeDp), it) }
    }

  /** Rounded on top only, like a sheet rising from the bottom edge. */
  private fun sheetBackground(radiusDp: Int) = GradientDrawable().apply {
    val r = dpf(radiusDp.toFloat())
    cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
    setColor(P.BG)
    setStroke(dp(1), P.BORDER)
  }

  private fun oval(fill: Int, stroke: Int? = null, strokeDp: Float = 1f) = GradientDrawable().apply {
    shape = GradientDrawable.OVAL
    setColor(fill)
    stroke?.let { setStroke(dpf(strokeDp).toInt(), it) }
  }

  private fun text(
    value: String,
    sizeSp: Float,
    color: Int,
    bold: Boolean = false,
    tracking: Float = 0f,
  ) = TextView(activity).apply {
    text = value
    textSize = sizeSp
    setTextColor(color)
    if (bold) typeface = Typeface.DEFAULT_BOLD
    if (tracking != 0f) letterSpacing = tracking
    includeFontPadding = false
  }

  /** The 4-toolhead whole-printer glyph. Multi-tone — never tint it. */
  private fun printerIconView() = ImageView(activity).apply {
    setImageResource(R.drawable.ic_printer)
    scaleType = ImageView.ScaleType.FIT_CENTER
  }

  private fun row() = LinearLayout(activity).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    // Nothing here aligns on a text baseline, and baseline alignment measures
    // weighted nested columns at zero width, which they never recover from.
    isBaselineAligned = false
  }

  private fun column() = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }

  private fun fullWidth(height: Int = LinearLayout.LayoutParams.WRAP_CONTENT) =
    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, height)

  private fun weighted(weight: Float = 1f) =
    LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, weight)

  /**
   * Adds [child] with RN-style `gap` spacing ahead of it (skipped for the first).
   * A child that already carries LayoutParams keeps them — sizes set by the
   * builders must survive, only the margin is layered on.
   */
  private fun LinearLayout.addSpaced(
    child: View,
    gapDp: Int,
    params: LinearLayout.LayoutParams? = null,
  ) {
    val lp = params
      ?: child.layoutParams as? LinearLayout.LayoutParams
      ?: LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
    if (childCount > 0 && gapDp > 0) {
      if (orientation == LinearLayout.HORIZONTAL) lp.marginStart = dp(gapDp)
      else lp.topMargin = dp(gapDp)
    }
    addView(child, lp)
  }

  /** ScrollView with a hard height cap — the RN sheet's `maxHeight`. */
  private class CappedScrollView(context: Context, private val cap: Int) : ScrollView(context) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
      super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(cap, MeasureSpec.AT_MOST))
    }
  }

  // ---------- model ----------

  /** Always four addressable lanes, so routing can speak in T0–T3. */
  private val displayLanes: List<Lane> = List(4) { index ->
    config.lanes.firstOrNull { it.index == index }
      ?: Lane(index = index, color = P.SURFACE_ALT, status = "empty")
  }

  private val required: List<Int> =
    config.required.distinct().sorted().ifEmpty { listOf(0) }

  private fun tools(): List<Tool> =
    PreprocessRouting.buildTools(required, displayLanes, manual, config.perToolGrams)

  private fun checks(tools: List<Tool>): List<Check> = PreprocessRouting.buildChecks(
    connected = printerState?.reachable ?: true,
    printerBusy = printerState?.busy ?: false,
    printerName = printerName(printerUrl),
    tools = tools,
    lanes = displayLanes,
  )

  /** Saved printer matching [url] — exact first, then by host, since LAN and
   *  Tailscale URLs share one entry. */
  private fun printerName(url: String): String {
    fun host(value: String) =
      value.substringAfter("://").substringBefore('/').substringBefore(':').lowercase()
    return config.printers.firstOrNull { it.url.trimEnd('/') == url.trimEnd('/') }?.name
      ?: config.printers.firstOrNull { host(it.url) == host(url) }?.name
      ?: host(url).ifBlank { "Printer" }
  }

  private fun toneColor(tone: Tone) = when (tone) {
    Tone.PASS -> P.SUCCESS
    Tone.WARN -> P.WARN
    Tone.FAIL -> P.DANGER
  }

  private fun toneIcon(tone: Tone) = when (tone) {
    Tone.PASS -> HelixIcons.CHECK_CIRCLE
    Tone.WARN -> HelixIcons.ALERT_CIRCLE
    Tone.FAIL -> HelixIcons.CLOSE_CIRCLE
  }

  /** RN `formatDuration` from components/PrintProgress. */
  private fun formatDuration(totalSeconds: Float): String {
    if (!totalSeconds.isFinite() || totalSeconds < 0f) return "--"
    val seconds = Math.round(totalSeconds)
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    if (hours > 0) return "${hours}h ${minutes}m"
    val rest = seconds % 60
    return if (minutes > 0) "${minutes}m ${rest}s" else "${rest}s"
  }

  private fun grams(value: Double) = String.format(Locale.US, "%.1f", value)

  // ---------- lifecycle ----------

  fun show() {
    root = FrameLayout(activity).apply {
      setBackgroundColor(P.SCRIM)
      setOnClickListener { requestClose() }
    }

    body = column().apply { setPadding(0, dp(16), 0, dp(14)) }

    // 88% of the screen for the whole sheet, as in the RN `maxHeight`; the footer
    // and grabber sit outside the scroll, so the scroll itself gets a bit less.
    val scroll = CappedScrollView(
      activity,
      (activity.resources.displayMetrics.heightPixels * 0.7f).toInt(),
    ).apply {
      isVerticalScrollBarEnabled = false
      addView(body, fullWidth())
    }

    footer = FrameLayout(activity)

    sheet = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      isClickable = true
      background = sheetBackground(P.RADIUS + 10)
      setPadding(dp(16), 0, dp(16), dp(12))
      addView(grabber())
      addView(scroll, fullWidth())
      addView(footer, fullWidth())
    }
    EdgeInsets.applyBottom(sheet)

    root.addView(
      sheet,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM,
      ),
    )

    dialog.apply {
      setContentView(root)
      window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
      window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      // Back closes the top layer first, and never interrupts a send.
      setOnKeyListener { _, keyCode, event ->
        if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
          requestClose()
          true
        } else {
          false
        }
      }
      show()
    }

    render()
    probe(printerUrl)
  }

  fun dismiss() = dialog.dismiss()

  private fun requestClose() {
    if (sending) return
    if (layer != null) closeLayer() else dialog.dismiss()
  }

  /** Drives the sending overlay from the activity's upload thread. */
  fun onSendProgress(message: String, progress: Float) = activity.runOnUiThread {
    statusLabel?.text = message
    val pct = (progress.coerceIn(0f, 1f) * 100f).toInt()
    progressBar?.progress = pct
    progressPct?.text = "$pct%"
  }

  fun onSendFailed(message: String) = activity.runOnUiThread {
    sending = false
    errorMessage = message
    overlay?.let { root.removeView(it) }
    overlay = null
    statusLabel = null
    progressBar = null
    progressPct = null
    render()
  }

  private fun probe(url: String) {
    if (url.isBlank()) {
      printerState = PrinterState("No printer", reachable = false, busy = false, meshProfile = null)
      render()
      return
    }
    config.probePrinter(url) { state ->
      // Ignore a reply for a printer the user has since switched away from.
      if (url == printerUrl) {
        printerState = state
        render()
      }
    }
  }

  // ---------- render ----------

  private fun render() {
    body.removeAllViews()
    footer.removeAllViews()

    val tools = tools()
    val checks = checks(tools)
    val failing = checks.filter { it.tone == Tone.FAIL && it.blocking }
    val blocked = failing.isNotEmpty()
    val notes = checks.filter { it.tone == Tone.WARN || it.tone == Tone.FAIL }
    val rerouted = tools.filter { it.source == RouteSource.AUTO }
    val routingOpen = openFold == Fold.ROUTING || blocked

    body.addSpaced(hero(), 0, fullWidth())
    body.addSpaced(statBand(tools), 11, fullWidth())
    body.addSpaced(
      if (notes.isNotEmpty()) notice(notes, blocked) else cleanRow(rerouted),
      11,
      fullWidth(),
    )
    errorMessage?.let { body.addSpaced(text(it, 12f, P.DANGER, bold = true), 11, fullWidth()) }

    body.addSpaced(routingHead(tools, routingOpen, blocked), 11, fullWidth(dp(52)))
    if (routingOpen) body.addSpaced(routingBody(tools), 4, fullWidth())

    body.addSpaced(optionsHead(), 11, fullWidth(dp(52)))
    if (openFold == Fold.OPTIONS) body.addSpaced(optionsBody(), 4, fullWidth())

    footer.addView(
      if (blocked) fixBar(failing.first().detail, tools) else holdButton(),
      FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(56)),
    )
  }

  private fun grabber() = View(activity).apply {
    background = rounded(P.BORDER, 2f)
    layoutParams = LinearLayout.LayoutParams(dp(40), dp(4)).apply {
      gravity = Gravity.CENTER_HORIZONTAL
      topMargin = dp(10)
    }
  }

  private fun hero(): View {
    val hero = row()

    val thumb = config.thumbnail
    hero.addSpaced(
      if (thumb != null) {
        ImageView(activity).apply {
          setImageBitmap(thumb)
          scaleType = ImageView.ScaleType.FIT_CENTER
          background = rounded(P.SURFACE, 16f)
          clipToOutline = true
        }
      } else {
        FrameLayout(activity).apply { background = rounded(P.SURFACE_ALT, 16f) }
      },
      0,
      LinearLayout.LayoutParams(dp(72), dp(72)),
    )

    val name = config.fileName
      .substringAfterLast('/')
      .substringAfterLast('\\')
      .replace(Regex("""\.gcode$""", RegexOption.IGNORE_CASE), "")

    val titles = column()
    titles.addSpaced(
      text(name, 21f, P.TEXT, bold = true, tracking = -0.026f).apply { maxLines = 2 },
      0,
      fullWidth(),
    )
    titles.addSpaced(printerPill(), 7)
    hero.addSpaced(titles, 14, weighted())
    return hero
  }

  private fun printerPill(): View {
    val pill = row().apply {
      background = rounded(P.SURFACE, 999f, P.BORDER)
      setPadding(dp(9), 0, dp(9), 0)
      isClickable = config.printers.isNotEmpty()
      setOnClickListener { if (config.printers.isNotEmpty()) openPrinterLayer() }
    }
    pill.addSpaced(
      printerIconView().apply {
        layoutParams = LinearLayout.LayoutParams(dp(13), dp(13))
      },
      0,
    )
    pill.addSpaced(text(printerName(printerUrl), 12f, P.TEXT, bold = true).apply { maxLines = 1 }, 5)
    pill.addSpaced(HelixIcons.view(activity, HelixIcons.CHEVRON_DOWN, 15f, P.DIM), 5)
    pill.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(28))
    return pill
  }

  private fun statBand(tools: List<Tool>): View {
    val band = row().apply {
      background = rounded(P.SURFACE, (P.RADIUS - 4).toFloat(), P.BORDER)
      setPadding(dp(14), dp(14), dp(14), dp(14))
      weightSum = 3f
    }
    val shown =
      if (config.estGrams > 0f) config.estGrams.toDouble() else tools.sumOf { it.grams }

    fun divider() = View(activity).apply {
      setBackgroundColor(P.BORDER)
      layoutParams = LinearLayout.LayoutParams(1, dp(34))
    }

    band.addSpaced(
      stat(HelixIcons.CLOCK, formatDuration(config.estTimeSeconds), "Duration", P.DIM, P.TEXT),
      0,
      weighted(),
    )
    band.addSpaced(divider(), 12)
    band.addSpaced(
      stat(
        HelixIcons.CALENDAR_CLOCK,
        PreprocessRouting.finishClock(activity, config.estTimeSeconds),
        "Done by",
        P.ACCENT,
        P.ACCENT,
      ),
      12,
      weighted(),
    )
    band.addSpaced(divider(), 12)
    band.addSpaced(
      stat(
        HelixIcons.WEIGHT_GRAM,
        "${grams(shown)} g",
        if (config.layers > 0) "${config.layers} layers" else "Filament",
        P.DIM,
        P.TEXT,
      ),
      12,
      weighted(),
    )
    return band
  }

  private fun stat(
    icon: Int,
    value: String,
    label: String,
    iconColor: Int,
    valueColor: Int,
  ): View {
    val cell = column()
    cell.addSpaced(
      HelixIcons.view(activity, icon, 15f, iconColor).apply { gravity = Gravity.START },
      0,
    )
    cell.addSpaced(
      text(value, 17f, valueColor, bold = true, tracking = -0.023f).apply { maxLines = 1 },
      3,
    )
    cell.addSpaced(
      text(label.uppercase(Locale.US), 10f, P.DIM, bold = true, tracking = 0.06f).apply {
        maxLines = 1
      },
      3,
    )
    return cell
  }

  private fun notice(notes: List<Check>, blocked: Boolean): View {
    val tone = if (blocked) P.DANGER else P.WARN
    val box = column().apply {
      background = rounded(P.alpha(tone, 0.1f), (P.RADIUS - 6).toFloat(), P.alpha(tone, 0.5f))
      setPadding(dp(12), dp(12), dp(12), dp(12))
    }
    notes.forEach { note ->
      val line = row()
      line.addSpaced(HelixIcons.view(activity, toneIcon(note.tone), 16f, toneColor(note.tone)), 0)
      line.addSpaced(text(note.detail, 12.5f, P.TEXT, bold = true), 9, weighted())
      box.addSpaced(line, 8, fullWidth())
    }
    return box
  }

  private fun cleanRow(rerouted: List<Tool>): View {
    val message = if (rerouted.isNotEmpty()) {
      "Routed around empty lanes — " +
        rerouted.joinToString(", ") { "T${it.fileTool} on lane ${it.assigned + 1}" }
    } else {
      "Lanes loaded, printer idle"
    }
    val line = row().apply { setPadding(dp(2), 0, dp(2), 0) }
    line.addSpaced(HelixIcons.view(activity, HelixIcons.CHECK_CIRCLE, 15f, P.SUCCESS), 0)
    line.addSpaced(text(message, 12f, P.DIM), 8, weighted())
    return line
  }

  private fun routingHead(tools: List<Tool>, open: Boolean, blocked: Boolean): View {
    val head = row().apply {
      background = rounded(P.SURFACE, (P.RADIUS - 6).toFloat(), P.BORDER)
      setPadding(dp(13), 0, dp(13), 0)
      clipChildren = false
      isClickable = !blocked
      setOnClickListener {
        openFold = if (open && !blocked) null else Fold.ROUTING
        render()
      }
    }

    val chips = row().apply { clipChildren = false }
    tools.forEach { chips.addSpaced(laneChip(it, 26), 4) }
    head.addSpaced(chips, 0)
    head.addSpaced(
      text("${tools.size} ${if (tools.size == 1) "lane" else "lanes"}", 12.5f, P.TEXT, bold = true),
      10,
    )
    head.addSpaced(weightBar(tools), 10, LinearLayout.LayoutParams(0, dp(6), 1f))
    head.addSpaced(chevron(open), 10)
    return head
  }

  private fun chevron(open: Boolean) = HelixIcons.view(
    activity,
    if (open) HelixIcons.CHEVRON_DOWN else HelixIcons.CHEVRON_RIGHT,
    18f,
    P.DIM,
  )

  private fun weightBar(tools: List<Tool>): View {
    val total = tools.sumOf { maxOf(it.grams, 0.01) }.takeIf { it > 0.0 } ?: 1.0
    val bar = LinearLayout(activity).apply {
      orientation = LinearLayout.HORIZONTAL
      background = rounded(P.SURFACE_ALT, 3f)
      clipToOutline = true
    }
    tools.forEach { tool ->
      bar.addView(
        View(activity).apply {
          setBackgroundColor(if (tool.lane.isEmpty) P.alpha(P.DANGER, 0.5f) else tool.lane.color)
        },
        LinearLayout.LayoutParams(
          0,
          LinearLayout.LayoutParams.MATCH_PARENT,
          (maxOf(tool.grams, 0.01) / total).toFloat(),
        ),
      )
    }
    return bar
  }

  private fun routingBody(tools: List<Tool>): View {
    val list = column().apply {
      setPadding(0, dp(4), 0, 0)
      clipChildren = false
    }
    tools.forEach { tool ->
      val line = row().apply {
        setPadding(dp(4), dp(9), dp(4), dp(9))
        clipChildren = false
        isClickable = true
        setOnClickListener { openLaneLayer(tool.fileTool) }
      }
      line.addSpaced(laneChip(tool, 34), 0)

      val heading = PreprocessRouting.laneLabel(tool.lane) + when (tool.source) {
        RouteSource.MANUAL -> "  → lane ${tool.assigned + 1}"
        RouteSource.AUTO -> "  auto → lane ${tool.assigned + 1}"
        RouteSource.IDENTITY -> ""
      }
      val labels = column()
      labels.addSpaced(text(heading, 14f, P.TEXT, bold = true), 0)
      labels.addSpaced(
        text("lane ${tool.assigned + 1} · ${PreprocessRouting.laneDetail(tool.lane)}", 11.5f, P.DIM),
        2,
      )
      line.addSpaced(labels, 12, weighted())

      if (tool.grams > 0) line.addSpaced(text("${grams(tool.grams)} g", 12f, P.DIM, bold = true), 12)
      line.addSpaced(HelixIcons.view(activity, HelixIcons.CHEVRON_RIGHT, 17f, P.DIM), 12)

      list.addSpaced(line, 0, fullWidth())
    }
    return list
  }

  private fun optionsHead(): View {
    val summary = Pref.values().filter { prefs.contains(it) }
      .joinToString(", ") { it.label }
      .ifBlank { "Print preferences" }
    val open = openFold == Fold.OPTIONS
    val head = row().apply {
      background = rounded(P.SURFACE, (P.RADIUS - 6).toFloat(), P.BORDER)
      setPadding(dp(13), 0, dp(13), 0)
      isClickable = true
      setOnClickListener {
        openFold = if (open) null else Fold.OPTIONS
        render()
      }
    }
    head.addSpaced(HelixIcons.view(activity, HelixIcons.TUNE, 17f, P.DIM), 0)
    head.addSpaced(text(summary, 12.5f, P.TEXT, bold = true).apply { maxLines = 1 }, 10, weighted())
    head.addSpaced(chevron(open), 10)
    return head
  }

  private fun optionsBody(): View {
    val list = column().apply { setPadding(0, dp(4), 0, 0) }
    Pref.values().forEach { pref ->
      val on = prefs.contains(pref)
      val line = row().apply {
        setPadding(dp(4), dp(9), dp(4), dp(9))
        isClickable = true
        setOnClickListener {
          if (on) prefs.remove(pref) else prefs.add(pref)
          render()
        }
      }
      line.addSpaced(HelixIcons.view(activity, pref.icon, 18f, if (on) P.ACCENT else P.DIM), 0)
      val labels = column()
      labels.addSpaced(text(pref.label, 14f, P.TEXT, bold = true), 0)
      labels.addSpaced(text(pref.hint, 11.5f, P.DIM), 2)
      line.addSpaced(labels, 12, weighted())
      line.addSpaced(toggle(on), 12)
      list.addSpaced(line, 0, fullWidth())
    }
    return list
  }

  private fun toggle(on: Boolean): View {
    val track = FrameLayout(activity).apply {
      background = rounded(if (on) P.ACCENT else P.SURFACE_ALT, 12f, if (on) P.ACCENT else P.BORDER)
      setPadding(dp(2), dp(2), dp(2), dp(2))
      layoutParams = LinearLayout.LayoutParams(dp(42), dp(24))
    }
    val edge = if (on) Gravity.END else Gravity.START
    track.addView(
      View(activity).apply { background = rounded(if (on) P.ON_ACCENT else P.DIM, 9f) },
      FrameLayout.LayoutParams(dp(18), dp(18), Gravity.CENTER_VERTICAL or edge),
    )
    return track
  }

  private fun laneChip(tool: Tool, sizeDp: Int): View {
    val empty = tool.lane.isEmpty
    val ring = when {
      empty -> P.alpha(P.DANGER, 0.8f)
      tool.source == RouteSource.MANUAL -> P.ACCENT
      else -> tool.lane.color
    }
    val chip = FrameLayout(activity).apply {
      clipChildren = false
      clipToPadding = false
      background = oval(P.BG, ring, 2.5f)
      layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
    }
    chip.addView(
      text("T${tool.fileTool}", sizeDp * 0.34f, P.TEXT, bold = true).apply {
        gravity = Gravity.CENTER
      },
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ),
    )
    if (empty) {
      chip.addView(
        FrameLayout(activity).apply {
          background = oval(P.DANGER)
          addView(
            HelixIcons.view(activity, HelixIcons.ALERT, 7f, P.BG),
            FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT,
              FrameLayout.LayoutParams.MATCH_PARENT,
            ),
          )
        },
        FrameLayout.LayoutParams(dp(13), dp(13), Gravity.TOP or Gravity.END),
      )
    }
    return chip
  }

  // ---------- commit ----------

  private fun holdButton(): View {
    val container = FrameLayout(activity).apply {
      background = rounded(P.ACCENT_FILL, 28f)
      clipToOutline = true
    }
    val fill = View(activity).apply {
      setBackgroundColor(Color.argb(66, 255, 255, 255))
      layoutParams = FrameLayout.LayoutParams(0, FrameLayout.LayoutParams.MATCH_PARENT)
    }
    container.addView(fill)

    val caption = text(config.sendLabel, 15f, P.ON_ACCENT, bold = true)
    val label = row().apply { gravity = Gravity.CENTER }
    label.addSpaced(HelixIcons.view(activity, HelixIcons.PRINTER_NOZZLE, 19f, P.ON_ACCENT), 0)
    label.addSpaced(caption, 9)
    container.addView(
      label,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ),
    )

    container.setOnTouchListener(HoldGesture(container, fill, caption))
    return container
  }

  /** Press-and-hold: fills the pill over [HOLD_MS], and commits only if held through. */
  private inner class HoldGesture(
    private val container: FrameLayout,
    private val fill: View,
    private val caption: TextView,
  ) : View.OnTouchListener {
    private var animator: ValueAnimator? = null
    private var settled = false

    override fun onTouch(view: View, event: MotionEvent): Boolean {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> if (!sending) begin(view)
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> abort()
        else -> return false
      }
      return true
    }

    private fun begin(view: View) {
      settled = false
      caption.text = "Keep holding…"
      animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = HOLD_MS
        addUpdateListener { step -> setFill(step.animatedFraction) }
        addListener(object : AnimatorListenerAdapter() {
          override fun onAnimationEnd(animation: Animator) {
            if (settled) return
            settled = true
            reset()
            view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            commit()
          }
        })
        start()
      }
    }

    /** Lifted early — settle first so the end listener cannot fire a send. */
    private fun abort() {
      settled = true
      animator?.cancel()
      animator = null
      reset()
    }

    private fun reset() {
      caption.text = config.sendLabel
      setFill(0f)
    }

    private fun setFill(fraction: Float) {
      fill.layoutParams = (fill.layoutParams as FrameLayout.LayoutParams).apply {
        width = (container.width * fraction).toInt()
      }
      fill.requestLayout()
    }
  }

  private fun fixBar(reason: String, tools: List<Tool>): View {
    val bar = row().apply {
      gravity = Gravity.CENTER
      background = rounded(P.alpha(P.DANGER, 0.16f), 28f, P.alpha(P.DANGER, 0.5f))
      setPadding(dp(16), 0, dp(16), 0)
      isClickable = true
      setOnClickListener {
        val starved = tools.firstOrNull { it.lane.isEmpty }
        if (starved != null) openLaneLayer(starved.fileTool) else openPrinterLayer()
      }
    }
    bar.addSpaced(HelixIcons.view(activity, HelixIcons.WRENCH, 18f, P.DANGER), 0)
    bar.addSpaced(text(reason, 14f, P.DANGER, bold = true).apply { maxLines = 1 }, 9, weighted())
    return bar
  }

  private fun commit() {
    if (sending) return
    sending = true
    errorMessage = null
    showSendingOverlay()
    config.onSend(tools().associate { it.fileTool to it.assigned }, prefs.toSet())
  }

  private fun showSendingOverlay() {
    val card = column().apply {
      gravity = Gravity.CENTER_HORIZONTAL
      background = rounded(P.SURFACE, 24f, P.BORDER)
      setPadding(dp(22), dp(22), dp(22), dp(22))
    }
    card.addSpaced(
      FrameLayout(activity).apply {
        background = oval(P.alpha(P.ACCENT, 0.14f))
        addView(
          ProgressBar(activity).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(P.ACCENT)
          },
          FrameLayout.LayoutParams(dp(34), dp(34), Gravity.CENTER),
        )
      },
      0,
      LinearLayout.LayoutParams(dp(52), dp(52)),
    )
    card.addSpaced(text("Starting print", 19f, P.TEXT, bold = true, tracking = -0.021f), 13)

    statusLabel = text("Preparing your print…", 13f, P.TEXT, bold = true).apply {
      gravity = Gravity.CENTER
      maxLines = 2
    }
    card.addSpaced(requireNotNull(statusLabel), 13, fullWidth())

    progressBar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
      max = 100
      progress = 0
      progressTintList = ColorStateList.valueOf(P.ACCENT)
      progressBackgroundTintList = ColorStateList.valueOf(P.SURFACE_ALT)
    }
    progressPct = text("0%", 12f, P.DIM, bold = true).apply { gravity = Gravity.END }

    val progressRow = row()
    progressRow.addSpaced(requireNotNull(progressBar), 0, LinearLayout.LayoutParams(0, dp(6), 1f))
    progressRow.addSpaced(
      requireNotNull(progressPct),
      8,
      LinearLayout.LayoutParams(dp(38), LinearLayout.LayoutParams.WRAP_CONTENT),
    )
    card.addSpaced(progressRow, 13, fullWidth())

    val host = FrameLayout(activity).apply {
      setBackgroundColor(0xC2000000.toInt())
      isClickable = true
      addView(
        card,
        FrameLayout.LayoutParams(
          minOf(dp(380), (activity.resources.displayMetrics.widthPixels * 0.86f).toInt()),
          FrameLayout.LayoutParams.WRAP_CONTENT,
          Gravity.CENTER,
        ),
      )
    }
    overlay = host
    root.addView(
      host,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ),
    )
  }

  // ---------- second layer: lane and printer pickers ----------

  /** The RN sheet pushes the main card back when a picker rises over it. */
  private fun pushBack(back: Boolean) {
    sheet.animate()
      .scaleX(if (back) 0.94f else 1f)
      .scaleY(if (back) 0.94f else 1f)
      .translationY(if (back) -dpf(14f) else 0f)
      .alpha(if (back) 0.5f else 1f)
      .setDuration(160)
      .start()
  }

  private fun closeLayer() {
    layer?.let { root.removeView(it) }
    layer = null
    pushBack(false)
  }

  private fun openLayer(title: String, hint: String?, rows: (LinearLayout) -> Unit) {
    closeLayer()

    val content = column().apply { setPadding(dp(P.GAP), dp(4), dp(P.GAP), dp(P.GAP)) }
    content.addSpaced(text(title, 21f, P.TEXT, bold = true, tracking = -0.019f), 0, fullWidth())
    hint?.let { content.addSpaced(text(it, 12f, P.DIM), 4, fullWidth()) }
    rows(content)

    val back = row().apply {
      setPadding(dp(P.GAP), dp(10), dp(P.GAP), 0)
      minimumHeight = dp(40)
      isClickable = true
      setOnClickListener { closeLayer() }
    }
    back.addSpaced(HelixIcons.view(activity, HelixIcons.CHEVRON_LEFT, 18f, P.TEXT), 0)
    back.addSpaced(text("Back", 13f, P.TEXT, bold = true), 2)

    val panel = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      isClickable = true
      background = sheetBackground(P.RADIUS + 8)
      setPadding(0, 0, 0, dp(14))
      addView(grabber())
      addView(back, fullWidth())
      addView(
        CappedScrollView(activity, (activity.resources.displayMetrics.heightPixels * 0.6f).toInt())
          .apply {
            isVerticalScrollBarEnabled = false
            addView(content, fullWidth())
          },
        fullWidth(),
      )
    }
    EdgeInsets.applyBottom(panel)

    layer = panel
    root.addView(
      panel,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM,
      ),
    )
    pushBack(true)
  }

  private fun pickerRow(
    active: Boolean,
    badge: View,
    title: String,
    subtitle: TextView,
    onPick: () -> Unit,
  ): View {
    val line = row().apply {
      minimumHeight = dp(56)
      setPadding(dp(10), dp(6), dp(10), dp(6))
      if (active) background = rounded(P.alpha(P.ACCENT, 0.14f), (P.RADIUS - 4).toFloat())
      isClickable = true
      setOnClickListener { onPick() }
    }
    line.addSpaced(badge, 0)
    val labels = column()
    labels.addSpaced(text(title, 14f, P.TEXT, bold = true), 0)
    labels.addSpaced(subtitle, 2)
    line.addSpaced(labels, 12, weighted())
    if (active) line.addSpaced(HelixIcons.view(activity, HelixIcons.CHECK, 18f, P.ACCENT), 12)
    return line
  }

  private fun openLaneLayer(fileTool: Int) {
    val assigned = tools().firstOrNull { it.fileTool == fileTool }?.assigned ?: fileTool
    openLayer("Lane for T$fileTool", "Choose the physical spool that feeds this tool.") { content ->
      displayLanes.forEach { lane ->
        val badge = FrameLayout(activity).apply {
          background = oval(P.BG, if (lane.isEmpty) P.alpha(P.DANGER, 0.6f) else lane.color, 2f)
          addView(
            text("${lane.index + 1}", 12f, P.TEXT, bold = true).apply { gravity = Gravity.CENTER },
            FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT,
              FrameLayout.LayoutParams.MATCH_PARENT,
            ),
          )
          layoutParams = LinearLayout.LayoutParams(dp(34), dp(34))
        }
        content.addSpaced(
          pickerRow(
            active = assigned == lane.index,
            badge = badge,
            title = PreprocessRouting.laneLabel(lane),
            subtitle = text(PreprocessRouting.laneDetail(lane), 11.5f, P.DIM),
          ) {
            manual[fileTool] = lane.index
            closeLayer()
            render()
          },
          6,
          fullWidth(),
        )
      }
    }
  }

  private fun openPrinterLayer() {
    openLayer("Select Printer", null) { content ->
      config.printers.forEach { printer ->
        val active = printer.url.trimEnd('/') == printerUrl.trimEnd('/')
        val badge = FrameLayout(activity).apply {
          background = rounded(P.alpha(P.ACCENT, 0.14f), 12f)
          addView(
            printerIconView(),
            FrameLayout.LayoutParams(
              dp(18),
              dp(18),
              Gravity.CENTER,
            ),
          )
          layoutParams = LinearLayout.LayoutParams(dp(36), dp(36))
        }
        val subtitle = text("Checking…", 11.5f, P.DIM)
        config.probePrinter(printer.url) { state ->
          subtitle.text = state.label
          subtitle.setTextColor(if (state.busy) P.WARN else P.DIM)
        }
        content.addSpaced(
          pickerRow(active, badge, printer.name, subtitle) {
            printerUrl = printer.url
            printerState = null
            config.onPrinterPicked(printer)
            closeLayer()
            render()
            probe(printer.url)
          },
          6,
          fullWidth(),
        )
      }
    }
  }

  private companion object {
    const val HOLD_MS = 700L
  }
}
