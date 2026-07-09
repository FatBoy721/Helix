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
import com.u1.slicer.viewer.ModelRenderer
import com.u1.slicer.viewer.ModelViewerView
import org.json.JSONObject
import java.io.File
import kotlin.math.sqrt

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
  /** 3MF file colours on the mesh until the user paints (then machine slot colours apply). */
  private var meshPaletteFloats = listOf<FloatArray>()
  private var paintedMask = BooleanArray(0)
  private var trianglePositions: FloatArray = FloatArray(0)
  private var triangleNormals: FloatArray = FloatArray(0)
  private var triangleNeighbors: Array<IntArray> = emptyArray()

  // User-declared slot colours passed from Slice Lab (T0–T3).
  private var slotColors: ArrayList<String>? = null
  private var loadedToolMask: Int = -1
  private var targetObject: Int = 0
  private var objectPositions: FloatArray? = null
  private var objectSizes: FloatArray? = null
  private var paintableTriangles: IntRange? = null

  private var activeSlot = 0
  private var paintMode = true       // false = orbit/view mode
  private var lassoMode = false
  private var fillMode = false
  private var brushRadiusMm = 3f
  private var dirty = false
  private var fillAngleDegrees = 45
  private var fillRespectColor = true

  // Undo: sparse (triangle -> previous slot) diff per stroke, newest last.
  private val undoStack = ArrayDeque<HashMap<Int, Int>>()
  private var activeStroke: HashMap<Int, Int>? = null

  private var slotViews = listOf<TextView>()
  private var modeButton: TextView? = null
  private var lassoButton: TextView? = null
  private var fillButton: TextView? = null
  private var undoButton: TextView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    modelPath = intent.getStringExtra(EXTRA_FILE_PATH).orEmpty()
    slotColors = intent.getStringArrayListExtra(EXTRA_SLOT_COLORS)
    loadedToolMask = intent.getIntExtra(EXTRA_LOADED_TOOL_MASK, -1)
    targetObject = intent.getIntExtra(EXTRA_TARGET_OBJECT, 0).coerceAtLeast(0)
    objectPositions = intent.getFloatArrayExtra(EXTRA_OBJECT_POSITIONS)
    objectSizes = intent.getFloatArrayExtra(EXTRA_OBJECT_SIZES)
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
      text = "Brush"
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
    fillButton = TextView(this).apply {
      text = "Fill"
      textSize = 13f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(110, 120, 130))
      setPadding(dp(12), dp(10), dp(12), dp(10))
      setOnClickListener { showFillSettings() }
    }
    bottom.addView(modeButton)
    bottom.addView(lassoButton)
    bottom.addView(fillButton)
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
          val m = preparePaintMesh(PrepareSceneFetcher.fetch(lib))
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

  private fun preparePaintMesh(mesh: MeshData): MeshData {
    val positions = objectPositions
    val sizes = objectSizes
    if (positions == null || sizes == null) {
      paintableTriangles = 0 until (mesh.vertexCount / 3)
      return mesh
    }
    val objectCount = positions.size / 2
    if (objectCount < 2 || sizes.size / 3 != objectCount || targetObject !in 0 until objectCount) {
      paintableTriangles = 0 until (mesh.vertexCount / 3)
      return mesh
    }
    val split = ModelRenderer.splitMeshByObjects(mesh, positions, sizes) ?: run {
      paintableTriangles = 0 until (mesh.vertexCount / 3)
      return mesh
    }
    val sortedMesh = split.first
    val range = split.second.getOrNull(targetObject)
    paintableTriangles = if (range != null) {
      val start = range.vertexStart / 3
      start until (start + range.vertexCount / 3)
    } else {
      0 until (sortedMesh.vertexCount / 3)
    }
    return sortedMesh
  }

  private fun showMesh(m: MeshData, projectPalette: List<String>) {
    val triCount = m.vertexCount / 3
    if (m.vertexCount > MeshData.MAX_PICKING_VERTEX_COUNT) {
      showError("This model is too large to paint (${triCount} triangles).")
      return
    }

    // Machine / loaded slot colours on T0–T3 swatches (and in the saved painted 3MF).
    paletteHex =
      FilamentSlotColors.mergedSlotHex(this, slotColors, loadedToolMask, projectPalette, SLOT_COUNT)
        .toMutableList()
    paletteFloats = FilamentSlotColors.toFloatPalette(paletteHex)
    val meshPaletteCount = maxOf(projectPalette.size, paletteHex.size, SLOT_COUNT)
    meshPaletteFloats =
      FilamentSlotColors.meshPaletteFromProject(projectPalette, paletteHex, meshPaletteCount)
    slotViews.forEachIndexed { i, v ->
      v.setBackgroundColor(Color.parseColor(paletteHex[i]))
    }

    // Initial slot ids from the mesh's current extruder indices (0-based slots).
    regionIds = IntArray(triCount)
    paintedMask = BooleanArray(triCount)
    trianglePositions = m.toPickingPositions()
    triangleNormals = buildTriangleNormals(trianglePositions)
    triangleNeighbors = buildTriangleNeighbors(trianglePositions)
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
    view.recolorMesh(meshPaletteFloats)
    // The prepare scene mesh is already world-space; picking uses raw positions.
    view.setTrianglePickingPositions(trianglePositions)
    mesh = m

    selectSlot(0)
    applyGestureMode()
    val objectLabel = if (objectPositions != null && objectSizes != null) "Object ${targetObject + 1}" else "Model"
    subtitleView.text = "$objectLabel \u00B7 $triCount triangles"
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
    paletteFloats = FilamentSlotColors.toFloatPalette(paletteHex)
    slotViews.getOrNull(slot)?.setBackgroundColor(Color.parseColor(normalized))
    FilamentSlotColors.write(this, paletteHex)
    if (paintedMask.any { it }) pushColorsToViewer()
    if (activeSlot == slot) selectSlot(slot)
  }

  private fun showFillSettings() {
    HelixPaintFillUi.show(
      activity = this,
      accent = 0xFF2196F3.toInt(),
      state = PaintFillSettings(fillAngleDegrees, fillRespectColor),
    ) { draft ->
      fillAngleDegrees = draft.fillAngleDegrees
      fillRespectColor = draft.respectColor
      fillMode = true
      paintMode = true
      lassoMode = false
      applyGestureMode()
      toast("Tap a region to fill with T$activeSlot")
    }
  }

  // ---------- Painting ----------

  private fun paintTriangles(tris: List<Int>) {
    if (tris.isEmpty() || regionIds.isEmpty()) return
    val allowed = paintableTriangles
    val stroke = activeStroke
    var changed = false
    for (t in tris) {
      if (t < 0 || t >= regionIds.size) continue
      if (allowed != null && t !in allowed) continue
      val old = regionIds[t]
      if (old == activeSlot) continue
      stroke?.putIfAbsent(t, old)
      regionIds[t] = activeSlot
      paintedMask[t] = true
      changed = true
    }
    if (!changed) return
    dirty = true
    pushColorsToViewer()
  }

  private fun pushColorsToViewer() {
    val view = viewer ?: return
    val bytes = ByteArray(regionIds.size) { regionIds[it].toByte() }
    view.updateExtruderIndices(bytes)
    if (paintedMask.any { it }) {
      view.recolorMeshWithPaintMask(paintedMask, meshPaletteFloats, paletteFloats)
    } else {
      view.recolorMesh(meshPaletteFloats)
    }
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
    for ((tri, old) in stroke) {
      regionIds[tri] = old
      paintedMask[tri] = false
    }
    activeStroke = null
    dirty = undoStack.any { it.isNotEmpty() }
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
    if (!paintMode) {
      lassoMode = false
      fillMode = false
    }
    applyGestureMode()
  }

  private fun toggleLasso() {
    lassoMode = !lassoMode
    if (lassoMode) {
      paintMode = true
      fillMode = false
    }
    applyGestureMode()
  }

  private fun fillFromTriangle(seedTri: Int) {
    if (seedTri !in regionIds.indices) return
    val allowed = paintableTriangles
    if (allowed != null && seedTri !in allowed) return

    beginStroke()
    val seedSlot = regionIds[seedTri]
    val threshold = fillAngleThreshold()
    val baseX = triangleNormals[seedTri * 3]
    val baseY = triangleNormals[seedTri * 3 + 1]
    val baseZ = triangleNormals[seedTri * 3 + 2]

    val queue = ArrayDeque<Int>()
    val seen = BooleanArray(regionIds.size)
    queue.addLast(seedTri)
    seen[seedTri] = true
    var filled = 0

    while (queue.isNotEmpty()) {
      val tri = queue.removeFirst()
      if (allowed != null && tri !in allowed) continue

      val nx = triangleNormals[tri * 3]
      val ny = triangleNormals[tri * 3 + 1]
      val nz = triangleNormals[tri * 3 + 2]
      val passesAngle = nx * baseX + ny * baseY + nz * baseZ >= threshold
      val passesColor = !fillRespectColor || regionIds[tri] == seedSlot
      if (!passesAngle || !passesColor) continue

      if (regionIds[tri] != activeSlot) {
        activeStroke?.putIfAbsent(tri, regionIds[tri])
        regionIds[tri] = activeSlot
        paintedMask[tri] = true
        dirty = true
        filled++
      }

      for (neighbor in triangleNeighbors.getOrNull(tri) ?: IntArray(0)) {
        if (neighbor in regionIds.indices && !seen[neighbor]) {
          seen[neighbor] = true
          queue.addLast(neighbor)
        }
      }
    }

    activeStroke = null
    if (dirty) {
      pushColorsToViewer()
      if (filled > 0) toast("Filled $filled triangles")
    } else {
      undoStack.removeLastOrNull()
      toast("Nothing to fill here")
    }
    updateUndoButton()
  }

  /** Mirrors the reference AiPaintViewer's three exclusive gesture modes. */
  private fun applyGestureMode() {
    val view = viewer ?: return
    view.onBrushPaint = null
    view.onBrushStrokeStart = null
    view.onTriangleTapped = null
    view.onFillTap = null
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
      paintMode && fillMode -> {
        view.onFillTap = { tri -> fillFromTriangle(tri) }
      }
      paintMode -> {
        view.brushRadiusWorld = brushRadiusMm
        view.onBrushStrokeStart = { beginStroke() }
        view.onBrushPaint = { tris -> paintTriangles(tris) }
      }
      // View mode: no paint callbacks — single-finger orbit works as usual.
    }
    modeButton?.text = if (paintMode) "Brush" else "Viewing"
    modeButton?.setTextColor(if (paintMode) Color.rgb(120, 220, 130) else Color.WHITE)
    lassoButton?.setTextColor(if (lassoMode) Color.rgb(120, 220, 130) else Color.rgb(110, 120, 130))
    fillButton?.setTextColor(if (fillMode) Color.rgb(120, 220, 130) else Color.rgb(110, 120, 130))
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

  private fun buildTriangleNormals(positions: FloatArray): FloatArray {
    val triCount = positions.size / 9
    val out = FloatArray(triCount * 3)
    for (tri in 0 until triCount) {
      val base = tri * 9
      val ax = positions[base + 3] - positions[base]
      val ay = positions[base + 4] - positions[base + 1]
      val az = positions[base + 5] - positions[base + 2]
      val bx = positions[base + 6] - positions[base]
      val by = positions[base + 7] - positions[base + 1]
      val bz = positions[base + 8] - positions[base + 2]
      var nx = ay * bz - az * by
      var ny = az * bx - ax * bz
      var nz = ax * by - ay * bx
      val len = sqrt(nx * nx + ny * ny + nz * nz)
      if (len > 1e-6f) {
        nx /= len
        ny /= len
        nz /= len
      }
      out[tri * 3] = nx
      out[tri * 3 + 1] = ny
      out[tri * 3 + 2] = nz
    }
    return out
  }

  private fun buildTriangleNeighbors(positions: FloatArray): Array<IntArray> {
    val triCount = positions.size / 9
    if (triCount == 0) return emptyArray()
    val edgeToTris = HashMap<String, MutableList<Int>>(triCount * 2)
    for (tri in 0 until triCount) {
      val base = tri * 9
      val edges = arrayOf(
        edgeKey(positions, base, base + 3),
        edgeKey(positions, base + 3, base + 6),
        edgeKey(positions, base + 6, base),
      )
      for (edge in edges) {
        edgeToTris.getOrPut(edge) { ArrayList(2) }.add(tri)
      }
    }
    val neighbors = Array(triCount) { linkedSetOf<Int>() }
    for (tris in edgeToTris.values) {
      if (tris.size < 2) continue
      for (i in tris.indices) {
        for (j in i + 1 until tris.size) {
          neighbors[tris[i]].add(tris[j])
          neighbors[tris[j]].add(tris[i])
        }
      }
    }
    return Array(triCount) { tri -> neighbors[tri].toIntArray() }
  }

  /** Orca smart fill angle → min normal dot product vs seed face. */
  private fun fillAngleThreshold(): Float {
    val radians = Math.toRadians(fillAngleDegrees.coerceIn(0, 90).toDouble())
    return kotlin.math.cos(radians).toFloat()
  }

  private fun edgeKey(positions: FloatArray, a: Int, b: Int): String {
    val ka = vertexKey(positions[a], positions[a + 1], positions[a + 2])
    val kb = vertexKey(positions[b], positions[b + 1], positions[b + 2])
    return if (ka <= kb) "$ka|$kb" else "$kb|$ka"
  }

  private fun vertexKey(x: Float, y: Float, z: Float): String {
    val scale = 500f
    return "${(x * scale).toInt()},${(y * scale).toInt()},${(z * scale).toInt()}"
  }

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
    const val EXTRA_LOADED_TOOL_MASK = "loadedToolMask"
    const val EXTRA_TARGET_OBJECT = "targetObject"
    const val EXTRA_OBJECT_POSITIONS = "objectPositions"
    const val EXTRA_OBJECT_SIZES = "objectSizes"
    private const val SLOT_COUNT = 4
    private const val MAX_UNDO = 20
  }
}
