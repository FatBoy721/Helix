package org.crabcore.u1control.slicing

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import com.u1.slicer.NativeLibrary
import com.u1.slicer.aipaint.AiRegion
import com.u1.slicer.aipaint.PaintedMeshWriter
import com.u1.slicer.viewer.MeshData
import com.u1.slicer.viewer.ModelViewerView
import org.json.JSONObject
import java.io.File

/**
 * Smart Paint (manual) — brush/lasso painting of filament slots onto the model.
 *
 * The gesture layer (brush picking, lasso polygon capture, stroke callbacks) was
 * ported with ModelViewerView; this screen supplies the missing state machine:
 * per-triangle slot ids, a 4-slot palette, undo, and a Save step that writes a
 * painted 3MF via [PaintedMeshWriter]. [HelixSlicerModule.sliceFile] slices the
 * painted file in place of the original (see [PrepareSession.setPaintedFile]).
 *
 * AI auto-segmentation from the reference app is intentionally not ported — it
 * depends on a cloud labeling service. This is the manual painting core.
 */
class HelixPaintActivity : Activity() {
  private lateinit var subtitleView: TextView
  private lateinit var container: FrameLayout
  private var viewer: ModelViewerView? = null
  private var busyOverlay: FrameLayout? = null

  private var native: NativeLibrary? = null
  private var modelPath: String = ""

  private var mesh: MeshData? = null
  private var regionIds: IntArray = IntArray(0)   // per-triangle slot 0..3
  private var paletteHex = mutableListOf<String>()
  private var paletteFloats = listOf<FloatArray>()

  // User-declared slot colours passed from Slice Lab (T0–T3).
  private var slotColors: ArrayList<String>? = null

  private var activeSlot = 0
  private var paintMode = true       // false = orbit/view mode
  private var lassoMode = false
  private var brushRadiusMm = 3f
  private var dirty = false

  // Undo: sparse (triangle -> previous slot) diff per stroke, newest last.
  private val undoStack = ArrayDeque<HashMap<Int, Int>>()
  private var activeStroke: HashMap<Int, Int>? = null

  private var slotViews = listOf<TextView>()
  private var modeButton: TextView? = null
  private var lassoButton: TextView? = null
  private var undoButton: TextView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    modelPath = intent.getStringExtra(EXTRA_FILE_PATH).orEmpty()
    slotColors = intent.getStringArrayListExtra(EXTRA_SLOT_COLORS)
    val rootView = buildLayout()
    setContentView(rootView)
    EdgeInsets.apply(rootView)

    val file = File(modelPath)
    if (modelPath.isBlank() || !file.exists()) {
      showError("Model file was not found.")
      return
    }
    if (!NativeLibrary.isLoaded) {
      showError("Native slicer library is not loaded.")
      return
    }
    loadModel(file)
  }

  override fun onDestroy() {
    viewer?.clearMesh()
    viewer?.onPause()
    viewer = null
    super.onDestroy()
  }

  // ---------- Layout ----------

  private fun buildLayout(): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.rgb(10, 12, 14))
    }

    // Top bar: back, title, undo, save
    val topBar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(12), dp(8), dp(12), dp(8))
      setBackgroundColor(Color.rgb(18, 21, 24))
    }
    topBar.addView(TextView(this).apply {
      text = "<"
      textSize = 28f
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      setOnClickListener { finish() }
      layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
    })
    val labels = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_VERTICAL
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    }
    labels.addView(TextView(this).apply {
      text = "Smart Paint"
      textSize = 16f
      setTextColor(Color.WHITE)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
    })
    subtitleView = TextView(this).apply {
      text = "Loading model..."
      textSize = 12f
      maxLines = 1
      setTextColor(Color.rgb(150, 160, 170))
    }
    labels.addView(subtitleView)
    topBar.addView(labels)

    undoButton = TextView(this).apply {
      text = "Undo"
      textSize = 13f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(110, 120, 130))
      setPadding(dp(10), dp(10), dp(10), dp(10))
      setOnClickListener { undoStroke() }
    }
    topBar.addView(undoButton)
    topBar.addView(TextView(this).apply {
      text = "Save"
      textSize = 13f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(120, 220, 130))
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      setPadding(dp(10), dp(10), dp(10), dp(10))
      setOnClickListener { savePainted() }
    })

    container = FrameLayout(this).apply {
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
    }
    container.addView(ProgressBar(this).apply {
      isIndeterminate = true
      layoutParams = FrameLayout.LayoutParams(dp(46), dp(46), Gravity.CENTER)
    })

    // Brush size row
    val brushLabel = TextView(this).apply {
      text = "Brush: ${brushRadiusMm.toInt()} mm"
      textSize = 13f
      setTextColor(Color.WHITE)
      setPadding(dp(12), 0, dp(8), 0)
      minWidth = dp(96)
    }
    val brushSeek = SeekBar(this).apply {
      max = 19
      progress = (brushRadiusMm - 1f).toInt()
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
          brushRadiusMm = (progress + 1).toFloat()
          brushLabel.text = "Brush: ${brushRadiusMm.toInt()} mm"
          if (paintMode && !lassoMode) viewer?.brushRadiusWorld = brushRadiusMm
        }
        override fun onStartTrackingTouch(seekBar: SeekBar?) {}
        override fun onStopTrackingTouch(seekBar: SeekBar?) {}
      })
    }
    val brushRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setBackgroundColor(Color.rgb(14, 17, 20))
      setPadding(dp(4), dp(2), dp(12), dp(2))
      addView(brushLabel)
      addView(brushSeek)
    }

    // Bottom bar: mode toggles + slot palette
    val bottom = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setBackgroundColor(Color.rgb(18, 21, 24))
      setPadding(dp(8), dp(6), dp(8), dp(6))
    }
    modeButton = TextView(this).apply {
      text = "Painting"
      textSize = 13f
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      setPadding(dp(12), dp(10), dp(12), dp(10))
      setOnClickListener { togglePaintMode() }
    }
    lassoButton = TextView(this).apply {
      text = "Lasso"
      textSize = 13f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(110, 120, 130))
      setPadding(dp(12), dp(10), dp(12), dp(10))
      setOnClickListener { toggleLasso() }
    }
    bottom.addView(modeButton)
    bottom.addView(lassoButton)
    bottom.addView(View(this).apply {
      layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
    })

    val slots = mutableListOf<TextView>()
    for (slot in 0 until SLOT_COUNT) {
      val v = TextView(this).apply {
        text = "T$slot"
        textSize = 14f
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).also {
          it.marginStart = dp(6)
        }
        setOnClickListener { selectSlot(slot) }
        setOnLongClickListener {
          showSlotColorPicker(slot)
          true
        }
      }
      slots.add(v)
      bottom.addView(v)
    }
    slotViews = slots

    root.addView(topBar)
    root.addView(container)
    root.addView(brushRow)
    root.addView(bottom)
    return root
  }

  // ---------- Loading ----------

  private fun loadModel(file: File) {
    Thread {
      try {
        synchronized(NativeEngineGuard.LOCK) {
          val lib = native ?: NativeLibrary().also { native = it }
          if (!lib.loadModel(file.absolutePath)) {
            throw IllegalStateException("Native engine could not load this model.")
          }
          val m = PrepareSceneFetcher.fetch(lib)
          val palette = readPaletteHex(lib)
          runOnUiThread { showMesh(m, palette) }
        }
      } catch (error: Throwable) {
        runOnUiThread {
          showError("Paint setup failed: ${error.message ?: error::class.java.simpleName}")
        }
      }
    }.start()
  }

  private fun readPaletteHex(lib: NativeLibrary): List<String> {
    val json = runCatching { lib.nativeGetProjectConfig() }.getOrNull() ?: return emptyList()
    return try {
      val colours = JSONObject(json).optJSONArray("filamentColours") ?: return emptyList()
      (0 until colours.length()).mapNotNull { i ->
        colours.optString(i).takeIf { it.isNotBlank() }?.let {
          val hex = if (it.startsWith("#")) it else "#$it"
          runCatching { Color.parseColor(hex); hex.uppercase() }.getOrNull()
        }
      }
    } catch (_: Throwable) {
      emptyList()
    }
  }

  private fun showMesh(m: MeshData, projectPalette: List<String>) {
    val triCount = m.vertexCount / 3
    if (m.vertexCount > MeshData.MAX_PICKING_VERTEX_COUNT) {
      showError("This model is too large to paint (${triCount} triangles).")
      return
    }

    // User-declared slot colours (Slice Lab / long-press here) beat 3MF defaults.
    val saved = FilamentSlotColors.read(this)
    paletteHex = (0 until SLOT_COUNT).map { slot ->
      FilamentSlotColors.normalizeHex(slotColors?.getOrNull(slot))
        ?: saved.getOrNull(slot)
        ?: FilamentSlotColors.normalizeHex(projectPalette.getOrNull(slot))
        ?: FilamentSlotColors.normalizeHex(DEFAULT_SLOT_HEX[slot])
        ?: "#808080"
    }.toMutableList()
    paletteFloats = paletteHex.map { hex ->
      val c = Color.parseColor(hex)
      floatArrayOf(Color.red(c) / 255f, Color.green(c) / 255f, Color.blue(c) / 255f, 1f)
    }
    slotViews.forEachIndexed { i, v ->
      v.setBackgroundColor(Color.parseColor(paletteHex[i]))
    }

    // Initial slot ids from the mesh's current extruder indices (0-based slots).
    regionIds = IntArray(triCount)
    var offset = 0
    for (batch in m.batches) {
      val mat = batch.materialIndices
      if (mat != null) {
        mat.position(0)
        for (t in 0 until batch.triangleCount) {
          regionIds[offset + t] = (mat.get(t).toInt() and 0xFF).coerceIn(0, SLOT_COUNT - 1)
        }
      }
      offset += batch.triangleCount
    }

    container.removeAllViews()
    val view = ModelViewerView(this).also {
      it.layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
    }
    viewer = view

    val busy = FrameLayout(this).apply {
      setBackgroundColor(Color.argb(150, 10, 12, 14))
      addView(ProgressBar(this@HelixPaintActivity).apply {
        isIndeterminate = true
        layoutParams = FrameLayout.LayoutParams(dp(46), dp(46), Gravity.CENTER)
      })
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
      visibility = View.GONE
      isClickable = true
    }
    busyOverlay = busy

    container.addView(view)
    container.addView(busy)

    view.setMesh(m)
    view.recolorMesh(paletteFloats)
    // The prepare scene mesh is already world-space; picking uses raw positions.
    view.setTrianglePickingPositions(m.toPickingPositions())
    mesh = m

    selectSlot(0)
    applyGestureMode()
    subtitleView.text =
      "$triCount triangles \u00B7 tap T0\u2013T3 to paint \u00B7 long-press to change colour"
  }

  private fun showSlotColorPicker(slot: Int) {
    val presets = FilamentSlotColors.presets
    val labels = presets.map { "#$it" }.toTypedArray()
    android.app.AlertDialog.Builder(this)
      .setTitle("Filament T$slot")
      .setItems(labels) { _, which ->
        applySlotColor(slot, "#${presets[which]}")
      }
      .setNegativeButton("Cancel", null)
      .show()
  }

  private fun applySlotColor(slot: Int, hex: String) {
    val normalized = FilamentSlotColors.normalizeHex(hex) ?: return
    paletteHex[slot] = normalized
    paletteFloats = paletteHex.map { h ->
      val c = Color.parseColor(h)
      floatArrayOf(Color.red(c) / 255f, Color.green(c) / 255f, Color.blue(c) / 255f, 1f)
    }
    slotViews.getOrNull(slot)?.setBackgroundColor(Color.parseColor(normalized))
    FilamentSlotColors.write(this, paletteHex)
    pushColorsToViewer()
    if (activeSlot == slot) selectSlot(slot)
  }

  // ---------- Painting ----------

  private fun paintTriangles(tris: List<Int>) {
    if (tris.isEmpty() || regionIds.isEmpty()) return
    val stroke = activeStroke
    var changed = false
    for (t in tris) {
      if (t < 0 || t >= regionIds.size) continue
      val old = regionIds[t]
      if (old == activeSlot) continue
      stroke?.putIfAbsent(t, old)
      regionIds[t] = activeSlot
      changed = true
    }
    if (!changed) return
    dirty = true
    pushColorsToViewer()
  }

  private fun pushColorsToViewer() {
    val view = viewer ?: return
    val bytes = ByteArray(regionIds.size) { regionIds[it].toByte() }
    // pendingExtruderUpdate is applied before pendingRecolor on the GL thread,
    // so both land in the same frame.
    view.updateExtruderIndices(bytes)
    view.recolorMesh(paletteFloats)
  }

  private fun beginStroke() {
    val stroke = HashMap<Int, Int>()
    activeStroke = stroke
    undoStack.addLast(stroke)
    while (undoStack.size > MAX_UNDO) undoStack.removeFirst()
    updateUndoButton()
  }

  private fun undoStroke() {
    // Drop trailing empty strokes (taps that painted nothing).
    while (undoStack.isNotEmpty() && undoStack.last().isEmpty()) undoStack.removeLast()
    val stroke = undoStack.removeLastOrNull() ?: return
    for ((tri, old) in stroke) regionIds[tri] = old
    activeStroke = null
    pushColorsToViewer()
    updateUndoButton()
  }

  private fun updateUndoButton() {
    val hasUndo = undoStack.any { it.isNotEmpty() }
    undoButton?.setTextColor(if (hasUndo) Color.WHITE else Color.rgb(110, 120, 130))
  }

  // ---------- Modes ----------

  private fun selectSlot(slot: Int) {
    activeSlot = slot
    slotViews.forEachIndexed { i, v ->
      v.alpha = if (i == slot) 1f else 0.45f
      v.scaleX = if (i == slot) 1.15f else 1f
      v.scaleY = if (i == slot) 1.15f else 1f
    }
    if (!paintMode) togglePaintMode() else applyGestureMode()
  }

  private fun togglePaintMode() {
    paintMode = !paintMode
    if (!paintMode) lassoMode = false
    applyGestureMode()
  }

  private fun toggleLasso() {
    lassoMode = !lassoMode
    if (lassoMode) paintMode = true
    applyGestureMode()
  }

  /** Mirrors the reference AiPaintViewer's three exclusive gesture modes. */
  private fun applyGestureMode() {
    val view = viewer ?: return
    view.onBrushPaint = null
    view.onBrushStrokeStart = null
    view.lassoMode = false
    view.onLassoLoop = null
    view.brushRadiusWorld = 0f
    when {
      paintMode && lassoMode -> {
        view.lassoMode = true
        view.onLassoLoop = { tris ->
          beginStroke()
          paintTriangles(tris)
          activeStroke = null
        }
      }
      paintMode -> {
        view.brushRadiusWorld = brushRadiusMm
        view.onBrushStrokeStart = { beginStroke() }
        view.onBrushPaint = { tris -> paintTriangles(tris) }
      }
      // View mode: no paint callbacks — single-finger orbit works as usual.
    }
    modeButton?.text = if (paintMode) (if (lassoMode) "Painting" else "Painting") else "Viewing"
    modeButton?.setTextColor(if (paintMode) Color.rgb(120, 220, 130) else Color.WHITE)
    lassoButton?.setTextColor(if (lassoMode) Color.rgb(120, 220, 130) else Color.rgb(110, 120, 130))
  }

  // ---------- Save ----------

  private fun savePainted() {
    val m = mesh ?: return
    if (!dirty) {
      toast("Nothing painted yet.")
      return
    }
    busyOverlay?.visibility = View.VISIBLE
    subtitleView.text = "Writing painted model..."
    val ids = regionIds.copyOf()
    Thread {
      try {
        val positions = m.toPickingPositions()
        val regions = (0 until SLOT_COUNT).map { slot ->
          AiRegion(
            id = slot,
            label = "T$slot",
            suggestedColour = paletteHex[slot],
            slot = slot,
          )
        }
        val outFile = File(File(modelPath).parentFile, "painted_helix.3mf")
        PaintedMeshWriter.write(
          positions = positions,
          regionIds = ids,
          regions = regions,
          outputFile = outFile,
          printerColours = paletteHex,
        )
        PrepareSession.begin(File(modelPath).absolutePath)
        PrepareSession.setPaintedFile(outFile.absolutePath)
        runOnUiThread {
          busyOverlay?.visibility = View.GONE
          toast("Painted model saved — slicing will use your paint.")
          finish()
        }
      } catch (error: Throwable) {
        runOnUiThread {
          busyOverlay?.visibility = View.GONE
          subtitleView.text = "Save failed"
          toast("Save failed: ${error.message ?: error::class.java.simpleName}")
        }
      }
    }.start()
  }

  // ---------- Helpers ----------

  /** "#RRGGBB" (uppercase) for any parseable colour string, null otherwise. */
  private fun normalizeHex(raw: String?): String? = FilamentSlotColors.normalizeHex(raw)

  private fun toast(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
  }

  private fun showError(message: String) {
    container.removeAllViews()
    subtitleView.text = "Paint unavailable"
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

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  companion object {
    const val EXTRA_FILE_PATH = "filePath"
    const val EXTRA_SLOT_COLORS = "slotColors"
    private const val SLOT_COUNT = 4
    private const val MAX_UNDO = 20
    private val DEFAULT_SLOT_HEX = listOf("#FFFFFF", "#161616", "#FF7043", "#2196F3")
  }
}
