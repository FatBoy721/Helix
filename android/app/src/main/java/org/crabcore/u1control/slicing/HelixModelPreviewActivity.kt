package org.crabcore.u1control.slicing

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.widget.ImageView
import org.crabcore.u1control.R
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import com.u1.slicer.NativeLibrary
import com.u1.slicer.data.WipeTowerDepthEstimator
import com.u1.slicer.model.CopyArrangeCalculator
import com.u1.slicer.viewer.MeshData
import com.u1.slicer.viewer.ModelRenderer
import com.u1.slicer.viewer.ModelViewerView
import com.u1.slicer.viewer.StlParser
import org.json.JSONObject
import java.io.File

/**
 * Interactive 3D prepare screen (F66-style port of Taylor's Prepare tab, plain views).
 *
 * On top of the original orbit/pan/zoom preview this adds:
 *  - filament colours from the 3MF project config
 *  - tap an object to select/highlight it (silhouette outline)
 *  - drag objects around the plate (native positions updated on drag end)
 *  - per-object rotate 45° / scale ±10% / duplicate
 *  - auto-orient, split to objects, auto-arrange
 *
 * Edits are recorded in [PrepareSession] and replayed by HelixSlicerModule.sliceFile
 * right after its loadModel call, so what you see on this screen is what slices.
 */
class HelixModelPreviewActivity : Activity() {
  private lateinit var titleView: TextView
  private lateinit var subtitleView: TextView
  private lateinit var container: FrameLayout
  private var viewer: ModelViewerView? = null
  private var busyOverlay: FrameLayout? = null
  private var toolbar: LinearLayout? = null

  private var native: NativeLibrary? = null
  private var modelPath: String = ""
  private var interactive = false
  // Theme accent from the RN app (defaults to Helix blue) — used for the Slice
  // button + tile icon tint so the native screen follows the user's theme.
  private var accentColor: Int = 0xFF2196F3.toInt()
  private var moonrakerUrl: String = ""
  private var displayTitle: String = ""
  private var initialTool: Int = 0
  private var loadedToolMask: Int = -1

  private fun parseAccent(hex: String?): Int =
    try {
      if (hex.isNullOrBlank()) 0xFF2196F3.toInt() else Color.parseColor(hex.trim())
    } catch (_: Throwable) {
      0xFF2196F3.toInt()
    }

  private fun accentColorHex(): String = String.format("#%06X", 0xFFFFFF and accentColor)
  private var slicingNow = false

  // Scene state (world-space mesh + per-object layout)
  private var mesh: MeshData? = null
  private var objectCount = 0
  private var boxes = FloatArray(0)      // [sx0, sy0, sz0, ...]
  private var positions = FloatArray(0)  // [x0, y0, ...] bed-space AABB-min corners
  private var basePositions = FloatArray(0)  // engine positions at last fetch (pre-copies)
  private var selectedObject = -1
  private var filamentPalette: List<FloatArray>? = null

  // User-declared slot colours (from Slice Lab) — forwarded to paint.
  private var slotColors: ArrayList<String>? = null

  // Copies (single-object beds only; rendered client-side, applied at slice time)
  private var copyCount = 1
  private var copiesRow: LinearLayout? = null
  private var copiesLabel: TextView? = null
  private var copiesSeek: SeekBar? = null

  // Wipe tower (shown for multi-filament projects)
  private var towerShown = false
  private var towerX = 0f
  private var towerY = 0f
  private var towerDepth = 20f

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    modelPath = intent.getStringExtra(EXTRA_FILE_PATH).orEmpty()
    slotColors = intent.getStringArrayListExtra(EXTRA_SLOT_COLORS)
    accentColor = parseAccent(intent.getStringExtra(EXTRA_ACCENT))
    moonrakerUrl = intent.getStringExtra(EXTRA_MOONRAKER).orEmpty()
    initialTool = intent.getIntExtra(EXTRA_INITIAL_TOOL, 0).coerceIn(0, 3)
    loadedToolMask = intent.getIntExtra(EXTRA_LOADED_TOOL_MASK, -1)
    val title = intent.getStringExtra(EXTRA_TITLE)
      ?.takeIf { it.isNotBlank() }
      ?: File(modelPath).name.ifBlank { "3D Preview" }
    displayTitle = title

    val rootView = buildLayout(title)
    setContentView(rootView)
    EdgeInsets.apply(rootView)

    val file = File(modelPath)
    if (modelPath.isBlank() || !file.exists()) {
      showError("Model file was not found.")
      return
    }

    PrepareSession.begin(file.absolutePath)
    loadModel(file)
  }

  override fun onDestroy() {
    viewer?.clearMesh()
    viewer?.onPause()
    viewer = null
    super.onDestroy()
  }

  // ---------- Layout ----------

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

    titleView = TextView(this).apply {
      text = title
      textSize = 16f
      maxLines = 1
      setTextColor(Color.WHITE)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
    }
    subtitleView = TextView(this).apply {
      text = "Loading model..."
      textSize = 12f
      maxLines = 1
      setTextColor(Color.rgb(150, 160, 170))
    }
    labels.addView(titleView)
    labels.addView(subtitleView)

    val reset = TextView(this).apply {
      text = "Reset"
      textSize = 13f
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      setOnClickListener { viewer?.resetView() }
      layoutParams = LinearLayout.LayoutParams(dp(64), dp(40))
    }

    topBar.addView(back)
    topBar.addView(labels)
    topBar.addView(reset)

    container = FrameLayout(this).apply {
      setBackgroundColor(Color.rgb(10, 12, 14))
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        0,
        1f,
      )
    }

    val progress = ProgressBar(this).apply {
      isIndeterminate = true
      layoutParams = FrameLayout.LayoutParams(dp(46), dp(46), Gravity.CENTER)
    }
    container.addView(progress)

    // Bottom toolbar — chunky icon tiles + a prominent Slice button (hidden
    // until an interactive scene loads).
    fun tile(iconRes: Int, label: String, onClick: () -> Unit): View {
      val col = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(4), dp(10), dp(4), dp(8))
        background = GradientDrawable().apply {
          setColor(Color.rgb(35, 43, 53))
          cornerRadius = dp(14).toFloat()
          setStroke(dp(1), (accentColor and 0x00FFFFFF) or 0x59000000)
        }
        isClickable = true
        setOnClickListener { onClick() }
        setOnTouchListener { v, e ->
          when (e.actionMasked) {
            android.view.MotionEvent.ACTION_DOWN -> v.alpha = 0.55f
            android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> v.alpha = 1f
          }
          false
        }
      }
      col.addView(ImageView(this).apply {
        setImageResource(iconRes)
        imageTintList = ColorStateList.valueOf(Color.rgb(232, 237, 243))
        layoutParams = LinearLayout.LayoutParams(dp(24), dp(24))
      })
      col.addView(TextView(this).apply {
        text = label
        textSize = 11f
        gravity = Gravity.CENTER
        setTextColor(Color.rgb(198, 208, 218))
        setPadding(0, dp(5), 0, 0)
      })
      return col
    }
    fun toolRow(vararg tiles: View): LinearLayout = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      tiles.forEach { t ->
        addView(t, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
          setMargins(dp(4), dp(4), dp(4), dp(4))
        })
      }
    }

    val panel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.rgb(18, 21, 24))
      setPadding(dp(6), dp(6), dp(6), dp(8))
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
      visibility = View.GONE
    }
    panel.addView(toolRow(
      tile(R.drawable.ic_tool_rotate, "Rotate") { rotateSelected(45f) },
      tile(R.drawable.ic_tool_bigger, "Bigger") { scaleSelected(1.1f) },
      tile(R.drawable.ic_tool_smaller, "Smaller") { scaleSelected(1f / 1.1f) },
      tile(R.drawable.ic_tool_copy, "Copy") { duplicateSelected() },
    ))
    panel.addView(toolRow(
      tile(R.drawable.ic_tool_orient, "Orient") { autoOrientSelected() },
      tile(R.drawable.ic_tool_split, "Split") { splitSelected() },
      tile(R.drawable.ic_tool_parts, "Parts") { splitPartsSelected() },
      tile(R.drawable.ic_tool_arrange, "Arrange") { arrangeAll() },
    ))

    val sliceBtn = TextView(this).apply {
      text = "Slice ▶"
      textSize = 17f
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      background = GradientDrawable().apply {
        setColor(accentColor)
        cornerRadius = dp(14).toFloat()
      }
      setOnClickListener { sliceNow() }
    }
    val actionRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      addView(tile(R.drawable.ic_tool_paint, "Paint") { openPaint() }, LinearLayout.LayoutParams(0, dp(56), 1f).apply {
        setMargins(dp(4), dp(4), dp(4), dp(4))
      })
      addView(sliceBtn, LinearLayout.LayoutParams(0, dp(56), 2.4f).apply {
        setMargins(dp(4), dp(4), dp(4), dp(4))
      })
    }
    panel.addView(actionRow)
    toolbarScroll = panel

    // Copies slider — single-object beds only (multi-object beds use the Copy button).
    val cLabel = TextView(this).apply {
      text = "Copies: 1"
      textSize = 13f
      setTextColor(Color.WHITE)
      setPadding(dp(12), 0, dp(8), 0)
      minWidth = dp(84)
    }
    val cSeek = SeekBar(this).apply {
      max = 0
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
          if (fromUser) setCopies(progress + 1)
        }
        override fun onStartTrackingTouch(seekBar: SeekBar?) {}
        override fun onStopTrackingTouch(seekBar: SeekBar?) {}
      })
    }
    val cRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setBackgroundColor(Color.rgb(14, 17, 20))
      setPadding(dp(4), dp(2), dp(12), dp(2))
      addView(cLabel)
      addView(cSeek)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
      visibility = View.GONE
    }
    copiesRow = cRow
    copiesLabel = cLabel
    copiesSeek = cSeek

    root.addView(topBar)
    root.addView(container)
    root.addView(cRow)
    root.addView(panel)
    return root
  }

  private var toolbarScroll: View? = null

  // ---------- Loading ----------

  private fun loadModel(file: File) {
    Thread {
      try {
        if (NativeLibrary.isLoaded) {
          loadNativeScene(file)
        } else if (file.name.endsWith(".stl", ignoreCase = true)) {
          // Fallback: view-only STL preview when the native engine is unavailable.
          val parsed = StlParser.parse(file)
          runOnUiThread { showStaticViewer(parsed) }
        } else {
          throw IllegalStateException("Native slicer library is not loaded: ${NativeLibrary.loadError}")
        }
      } catch (error: Throwable) {
        runOnUiThread {
          showError("Preview failed: ${error.message ?: error::class.java.simpleName}")
        }
      }
    }.start()
  }

  /** Full native load: model + preview scene + object layout + filament colours. */
  private fun loadNativeScene(file: File) {
    synchronized(NativeEngineGuard.LOCK) {
      val lib = native ?: NativeLibrary().also { native = it }
      if (!lib.loadModel(file.absolutePath)) {
        throw IllegalStateException("Native engine could not load this model.")
      }
      filamentPalette = readFilamentPalette(lib)
      fetchSceneAndShowLocked(lib)
    }
  }

  /**
   * Fetches the current prepare render scene + object layout from the engine and
   * posts it to the UI. Caller must hold NativeEngineGuard.LOCK. Used for both the
   * initial load and rebuilds after pose-changing edits.
   */
  private fun fetchSceneAndShowLocked(lib: NativeLibrary) {
    val newMesh = PrepareSceneFetcher.fetch(lib)
    val count = lib.nativeGetObjectCount().coerceAtLeast(1)
    val newBoxes = runCatching { lib.getObjectBoundingBoxes() }.getOrDefault(FloatArray(0))
    var newPositions = runCatching { lib.nativeGetObjectWorldAABBMins() }.getOrDefault(FloatArray(0))
    if (newPositions.size / 2 != count) newPositions = FloatArray(0)

    runOnUiThread { showScene(newMesh, count, newBoxes, newPositions) }
  }

  private fun readFilamentPalette(lib: NativeLibrary): List<FloatArray>? {
    val json = runCatching { lib.nativeGetProjectConfig() }.getOrNull() ?: return null
    return try {
      val colours = JSONObject(json).optJSONArray("filamentColours") ?: return null
      val palette = (0 until colours.length()).mapNotNull { i ->
        val hex = colours.optString(i).takeIf { it.isNotBlank() } ?: return@mapNotNull null
        try {
          val c = Color.parseColor(if (hex.startsWith("#")) hex else "#$hex")
          floatArrayOf(Color.red(c) / 255f, Color.green(c) / 255f, Color.blue(c) / 255f, 1f)
        } catch (_: Throwable) {
          null
        }
      }
      palette.ifEmpty { null }
    } catch (_: Throwable) {
      null
    }
  }

  // ---------- Scene presentation ----------

  private fun showScene(newMesh: MeshData, count: Int, newBoxes: FloatArray, newPositions: FloatArray) {
    val previousMesh = mesh
    interactive = true
    objectCount = count
    boxes = newBoxes
    basePositions = newPositions.copyOf()
    positions = newPositions.copyOf()
    if (selectedObject >= count) selectedObject = -1
    if (count > 1 && copyCount > 1) {
      // Bed became multi-object (split/duplicate) — copies no longer apply.
      copyCount = 1
      PrepareSession.setCopies(1, null)
    }

    val view = viewer ?: createViewer()
    val renderer = view.renderer

    // Multi-object scenes get per-object vertex ranges so drag feedback is immediate.
    var uploadMesh = newMesh
    var ranges: List<ModelRenderer.ObjectMeshRange>? = null
    if (count > 1 && positions.size / 2 == count && newBoxes.size / 3 == count) {
      val split = ModelRenderer.splitMeshByObjects(newMesh, positions, newBoxes)
      if (split != null) {
        uploadMesh = split.first
        ranges = split.second
        // Split copies vertex data into fresh Java buffers — release the native scene now.
        releaseMeshAsync(newMesh)
      }
    }

    // Client-side copies grid for a single-object bed (recomputed after pose edits so
    // the grid follows the object's current footprint).
    if (count == 1 && copyCount > 1 && newBoxes.size >= 2) {
      positions = CopyArrangeCalculator.calculate(
        newBoxes[0], newBoxes[1], copyCount, BED_SIZE, BED_SIZE,
      )
      PrepareSession.setCopies(copyCount, positions)
    }

    renderer.multiObjectMode = count > 1
    renderer.instancePositions = if (positions.isNotEmpty()) positions.copyOf() else null
    renderer.perObjectSizes = if (newBoxes.isNotEmpty()) newBoxes.copyOf() else null
    renderer.highlightIndex = selectedObject
    view.persistentSelectionIndex = selectedObject
    view.placementMode = positions.isNotEmpty()
    updateWipeTower(renderer, uploadMesh)
    view.setMesh(uploadMesh, ranges)
    filamentPalette?.let { view.recolorMesh(it) }
    refreshPickingPositions(view, uploadMesh, ranges)

    // Release the previously displayed mesh's native buffers once the new one is queued.
    if (previousMesh != null && previousMesh !== newMesh) releaseMeshAsync(previousMesh)
    mesh = uploadMesh

    hideBusy()
    toolbarScroll?.visibility = View.VISIBLE
    updateCopiesRow()
    updateSubtitle()
  }

  /** Shows the prime tower footprint for multi-filament projects; hides it otherwise. */
  private fun updateWipeTower(renderer: ModelRenderer, m: MeshData) {
    val multiFilament = (filamentPalette?.size ?: 0) > 1
    if (!multiFilament || positions.isEmpty()) {
      towerShown = false
      renderer.wipeTower = null
      return
    }
    towerDepth = WipeTowerDepthEstimator.estimateDepth(m.sizeZ)
    val dragged = PrepareSession.towerPosition
    if (dragged != null) {
      towerX = dragged.first.coerceIn(0f, BED_SIZE - TOWER_WIDTH)
      towerY = dragged.second.coerceIn(0f, BED_SIZE - towerDepth)
    } else {
      val (tx, ty) = CopyArrangeCalculator.computeWipeTowerPositionForObjects(
        positions, boxes, TOWER_WIDTH, towerDepth, BED_SIZE, BED_SIZE,
      )
      towerX = tx
      towerY = ty
      // Record the auto position too — what the preview shows is what slices.
      PrepareSession.setTowerPosition(towerX, towerY)
    }
    towerShown = true
    renderer.wipeTower = ModelRenderer.WipeTowerInfo(towerX, towerY, TOWER_WIDTH, towerDepth)
  }

  /** Copies slider applies to single-object beds only. */
  private fun updateCopiesRow() {
    val row = copiesRow ?: return
    if (objectCount != 1 || boxes.size < 2) {
      row.visibility = View.GONE
      return
    }
    val maxCopies = CopyArrangeCalculator.maxCopies(boxes[0], boxes[1], BED_SIZE, BED_SIZE)
    copiesSeek?.max = (maxCopies - 1).coerceAtLeast(0)
    copiesSeek?.progress = copyCount - 1
    copiesLabel?.text = "Copies: $copyCount"
    row.visibility = View.VISIBLE
  }

  private fun setCopies(count: Int) {
    if (objectCount != 1 || boxes.size < 2) return
    copyCount = count.coerceAtLeast(1)
    copiesLabel?.text = "Copies: $copyCount"
    val view = viewer ?: return
    positions = if (copyCount > 1) {
      CopyArrangeCalculator.calculate(boxes[0], boxes[1], copyCount, BED_SIZE, BED_SIZE)
    } else {
      basePositions.copyOf()
    }
    PrepareSession.setCopies(copyCount, if (copyCount > 1) positions else null)
    view.renderer.instancePositions = if (positions.isNotEmpty()) positions.copyOf() else null
    updateWipeTower(view.renderer, mesh ?: return)
    mesh?.let { refreshPickingPositions(view, it, view.renderer.objectMeshRanges) }
    view.requestRender()
    updateSubtitle()
  }

  private fun createViewer(): ModelViewerView {
    container.removeAllViews()
    val view = ModelViewerView(this).also {
      it.layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
    }
    viewer = view

    view.onTriangleTapped = { triIdx ->
      val ranges = view.renderer.objectMeshRanges
      val owner = if (ranges.isNullOrEmpty()) 0 else {
        ranges.indexOfFirst { r ->
          val triStart = r.vertexStart / 3
          val triEnd = (r.vertexStart + r.vertexCount) / 3
          triIdx in triStart until triEnd
        }.let { if (it >= 0) it else 0 }
      }
      selectObject(if (selectedObject == owner) -1 else owner)
    }
    view.onEmptyTap = { selectObject(-1) }

    view.onObjectMoved = { index, dx, dy ->
      val instanceCount = positions.size / 2
      if (index in 0 until instanceCount) {
        // Copies of a single object share the object-0 footprint; multi-object beds
        // have one box per object.
        val bi = if (objectCount == 1) 0 else index
        val sizeX = boxes.getOrElse(bi * 3) { 0f }
        val sizeY = boxes.getOrElse(bi * 3 + 1) { 0f }
        positions[index * 2] = (positions[index * 2] + dx).coerceIn(0f, BED_SIZE - sizeX)
        positions[index * 2 + 1] = (positions[index * 2 + 1] + dy).coerceIn(0f, BED_SIZE - sizeY)
        view.renderer.instancePositions = positions.copyOf()
      } else if (index == instanceCount && towerShown) {
        // Wipe tower drag (hitTest reports index == instance count for the tower).
        towerX = (towerX + dx).coerceIn(0f, BED_SIZE - TOWER_WIDTH)
        towerY = (towerY + dy).coerceIn(0f, BED_SIZE - towerDepth)
        view.renderer.wipeTower =
          ModelRenderer.WipeTowerInfo(towerX, towerY, TOWER_WIDTH, towerDepth)
        PrepareSession.setTowerPosition(towerX, towerY)
      }
    }
    view.onDragEnded = { commitPositions() }

    val busy = FrameLayout(this).apply {
      setBackgroundColor(Color.argb(150, 10, 12, 14))
      addView(ProgressBar(this@HelixModelPreviewActivity).apply {
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
    return view
  }

  private fun refreshPickingPositions(
    view: ModelViewerView,
    m: MeshData,
    ranges: List<ModelRenderer.ObjectMeshRange>?,
  ) {
    // Mirrors the renderer's draw transform (drawModelAt / drawObjectRange), so
    // ray picking matches what is on screen — including after drags.
    view.setTrianglePickingPositions(
      m.toWorldSpacePickingPositions(
        ranges,
        view.renderer.instancePositions,
        view.renderer.modelScale,
      ),
    )
  }

  private fun showStaticViewer(m: MeshData) {
    container.removeAllViews()
    val view = ModelViewerView(this).also {
      it.layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
      it.setMesh(m)
    }
    viewer = view
    container.addView(view)
    mesh = m
    objectCount = 1
    subtitleView.text =
      "${m.vertexCount / 3} triangles, ${m.sizeX.toInt()} x ${m.sizeY.toInt()} x ${m.sizeZ.toInt()} mm (view only)"
  }

  private fun updateSubtitle() {
    val m = mesh ?: return
    val sel = if (selectedObject >= 0) {
      val name = runCatching {
        synchronized(NativeEngineGuard.LOCK) { native?.nativeGetObjectName(selectedObject) }
      }.getOrNull()?.takeIf { !it.isNullOrBlank() }
      "  \u00B7  ${name ?: "Object ${selectedObject + 1}"} selected"
    } else if (objectCount > 1) {
      "  \u00B7  tap an object to select"
    } else {
      ""
    }
    val objects = when {
      objectCount > 1 -> "$objectCount objects, "
      copyCount > 1 -> "$copyCount copies, "
      else -> ""
    }
    subtitleView.text =
      "$objects${m.vertexCount / 3} triangles, ${m.sizeX.toInt()} x ${m.sizeY.toInt()} x ${m.sizeZ.toInt()} mm$sel"
  }

  private fun selectObject(index: Int) {
    selectedObject = index
    val view = viewer ?: return
    view.persistentSelectionIndex = index
    view.renderer.highlightIndex = index
    view.requestRender()
    updateSubtitle()
  }

  // ---------- Object edits ----------

  /** Object the toolbar actions apply to: the selection, or object 0 when there's only one. */
  private fun targetObject(): Int? {
    if (!interactive) {
      toast("Editing needs the native engine.")
      return null
    }
    if (selectedObject >= 0) return selectedObject
    if (objectCount == 1) return 0
    toast("Tap an object first.")
    return null
  }

  private fun rotateSelected(deltaZDeg: Float) {
    val idx = targetObject() ?: return
    runEdit { lib ->
      val r = lib.nativeGetObjectRotation(idx)
      val z = (r[2] + deltaZDeg) % 360f
      if (lib.nativeSetObjectRotation(idx, r[0], r[1], z)) {
        PrepareSession.record(PrepareSession.Op.Rotation(idx, r[0], r[1], z))
        true
      } else false
    }
  }

  private fun scaleSelected(factor: Float) {
    val idx = targetObject() ?: return
    runEdit { lib ->
      val s = lib.nativeGetObjectScale(idx)
      val sx = (s[0] * factor).coerceIn(0.05f, 20f)
      val sy = (s[1] * factor).coerceIn(0.05f, 20f)
      val sz = (s[2] * factor).coerceIn(0.05f, 20f)
      if (lib.nativeSetObjectScale(idx, sx, sy, sz)) {
        PrepareSession.record(PrepareSession.Op.Scale(idx, sx, sy, sz))
        true
      } else false
    }
  }

  private fun duplicateSelected() {
    val idx = targetObject() ?: return
    runEdit { lib ->
      val newIdx = lib.nativeDuplicateObject(idx)
      if (newIdx < 0) return@runEdit false
      PrepareSession.record(PrepareSession.Op.Duplicate(idx))
      // Place the copy without disturbing existing objects.
      val newBoxes = runCatching { lib.getObjectBoundingBoxes() }.getOrDefault(FloatArray(0))
      val existing = if (positions.isNotEmpty()) positions
        else runCatching { lib.nativeGetObjectWorldAABBMins() }.getOrDefault(FloatArray(0))
      if (newBoxes.size >= 3 && existing.isNotEmpty()) {
        val placed = CopyArrangeCalculator.placeAdditionalObject(existing, newBoxes, BED_SIZE)
        lib.setObjectPositions(placed)
        PrepareSession.setPositions(placed)
      }
      true
    }
  }

  private fun autoOrientSelected() {
    val idx = targetObject() ?: return
    runEdit(message = "Auto-orienting...") { lib ->
      if (lib.nativeAutoOrientObject(idx) == null) {
        toastFromWorker("No better orientation found for this object.")
        return@runEdit false
      }
      val r = lib.nativeGetObjectRotation(idx)
      PrepareSession.record(PrepareSession.Op.Rotation(idx, r[0], r[1], r[2]))
      true
    }
  }

  private fun splitSelected() {
    val idx = targetObject() ?: return
    runEdit { lib ->
      if (!lib.nativeIsObjectSplittable(idx)) {
        toastFromWorker("This object has only one part.")
        return@runEdit false
      }
      val res = lib.nativeSplitObject(idx)
      if (res == null) {
        toastFromWorker("This object has only one connected piece.")
        return@runEdit false
      }
      PrepareSession.record(PrepareSession.Op.SplitObject(idx))
      selectedObject = -1
      true
    }
  }

  /**
   * F66 — split every splittable volume of the target object into separate parts.
   * Iterates volumes in descending index order so splitting one volume (which can
   * append new volumes) doesn't shift the indices of volumes not yet processed.
   */
  private fun splitPartsSelected() {
    val idx = targetObject() ?: return
    runEdit { lib ->
      val volCount = lib.nativeGetVolumeCount(idx)
      if (volCount <= 0) {
        toastFromWorker("No volumes found on this object.")
        return@runEdit false
      }
      var newCount = -1
      for (v in volCount - 1 downTo 0) {
        if (!lib.nativeIsVolumeSplittable(idx, v)) continue
        val res = lib.nativeSplitVolume(idx, v)
        if (res > 0) {
          PrepareSession.record(PrepareSession.Op.SplitVolume(idx, v))
          newCount = res
        }
      }
      if (newCount < 0) {
        toastFromWorker("No splittable parts in this object.")
        return@runEdit false
      }
      toastFromWorker("Object now has $newCount part(s).")
      true
    }
  }

  /**
   * Slice straight from the prepare screen and open the toolpath preview.
   * Runs the same [HelixSliceRunner] pipeline as the RN Slice button, so the
   * session edits (arrangement, copies, paint, wipe tower) are honoured.
   */
  // Captures the live 3D model render (with the user's arrangement/copies/colors)
  // and injects it as the gcode thumbnail so the printer shows the real plate,
  // not the 3MF's stock marketing image. Always calls onDone (capture is best-effort).
  private fun injectRenderThumbnail(gcodePath: String, onDone: () -> Unit) {
    // Keep the clean embedded render (from a 3MF) if the slicer already injected
    // one — that's the crisp preview the printer cards show. Only fall back to a
    // captured view render for models with no embedded image (e.g. STL).
    if (GcodeThumbnailInjector.hasThumbnail(gcodePath)) {
      onDone(); return
    }
    val view = viewer
    if (view == null || view.width <= 0 || view.height <= 0) {
      onDone(); return
    }
    val bmp = try {
      Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
    } catch (_: Throwable) {
      onDone(); return
    }
    try {
      PixelCopy.request(view, bmp, { res ->
        if (res == PixelCopy.SUCCESS) {
          Thread {
            runCatching { GcodeThumbnailInjector.injectBitmap(gcodePath, bmp) }
            runOnUiThread { bmp.recycle(); onDone() }
          }.start()
        } else {
          bmp.recycle(); onDone()
        }
      }, Handler(Looper.getMainLooper()))
    } catch (_: Throwable) {
      bmp.recycle(); onDone()
    }
  }

  private fun sliceNow() {
    if (!interactive) {
      toast("Slicing needs the native engine.")
      return
    }
    if (slicingNow) return
    slicingNow = true
    showBusy("Slicing...")
    Thread {
      try {
        val lib = native ?: NativeLibrary().also { native = it }
        val outcome = HelixSliceRunner.run(
          this,
          lib,
          modelPath,
          onProgress = { pct, stage ->
            runOnUiThread { subtitleView.text = "Slicing \u2014 $stage ($pct%)" }
          },
          initialTool = initialTool,
        )
        val result = outcome.result
        runOnUiThread {
          slicingNow = false
          hideBusy()
          updateSubtitle()
          when {
            result == null -> toast("Slice failed: engine returned no result.")
            result.cancelled -> toast("Slice cancelled.")
            !result.success ->
              toast("Slice failed: ${result.errorMessage.ifBlank { "unknown error" }}")
            else -> {
              // Inject a render of the actual sliced plate as the gcode thumbnail
              // (replaces the 3MF stock image), then open the toolpath preview.
              injectRenderThumbnail(result.gcodePath) {
                startActivity(
                  android.content.Intent(this, HelixGcodePreviewActivity::class.java).apply {
                    putExtra(HelixGcodePreviewActivity.EXTRA_FILE_PATH, result.gcodePath)
                    putExtra(HelixGcodePreviewActivity.EXTRA_TITLE, displayTitle)
                    putExtra(HelixGcodePreviewActivity.EXTRA_ACCENT, accentColorHex())
                    putExtra(HelixGcodePreviewActivity.EXTRA_MOONRAKER, moonrakerUrl)
                    putExtra(HelixGcodePreviewActivity.EXTRA_INITIAL_TOOL, outcome.initialTool)
                    putExtra(HelixGcodePreviewActivity.EXTRA_LOADED_TOOL_MASK, loadedToolMask)
                    putExtra(HelixGcodePreviewActivity.EXTRA_USED_TOOL_MASK, outcome.usedToolMask)
                  },
                )
              }
            }
          }
        }
      } catch (error: HelixSliceRunner.BusyError) {
        runOnUiThread {
          slicingNow = false
          hideBusy()
          updateSubtitle()
          toast("A slice is already running.")
        }
      } catch (error: Throwable) {
        runOnUiThread {
          slicingNow = false
          hideBusy()
          updateSubtitle()
          toast("Slice failed: ${error.message ?: error::class.java.simpleName}")
        }
      }
    }.start()
  }

  /** Launch Smart Paint. Gated to single-object beds and paintable mesh sizes. */
  private fun openPaint() {
    if (!interactive) {
      toast("Painting needs the native engine.")
      return
    }
    if (objectCount > 1) {
      toast("Painting works on single-object models (split beds merge on save).")
      return
    }
    val m = mesh
    if (m != null && m.vertexCount > MeshData.MAX_PICKING_VERTEX_COUNT) {
      toast("This model is too large to paint.")
      return
    }
    if (PrepareSession.hasEdits(modelPath)) {
      toast("Note: saved paint replaces the prepare edits.")
    }
    startActivity(
      android.content.Intent(this, HelixPaintActivity::class.java).apply {
        putExtra(HelixPaintActivity.EXTRA_FILE_PATH, modelPath)
        slotColors?.let { putStringArrayListExtra(HelixPaintActivity.EXTRA_SLOT_COLORS, it) }
      },
    )
  }

  private fun arrangeAll() {
    if (!interactive) return
    if (objectCount == 1 && copyCount > 1) {
      toast("Copies are already arranged in a grid.")
      return
    }
    // Keep-out rect for the wipe tower (margin-inflated) so arrange never packs
    // an object under the printed tower.
    val reserved = if (towerShown) floatArrayOf(
      towerX - 5f, towerY - 5f,
      towerX + TOWER_WIDTH + 5f, towerY + towerDepth + 5f,
    ) else null
    runEdit { lib ->
      val liveBoxes = runCatching { lib.getObjectBoundingBoxes() }.getOrDefault(FloatArray(0))
      val incoming = if (positions.isNotEmpty()) positions
        else runCatching { lib.nativeGetObjectWorldAABBMins() }.getOrDefault(FloatArray(0))
      if (liveBoxes.isEmpty()) return@runEdit false
      val result = CopyArrangeCalculator.autoArrange(liveBoxes, reserved, incoming, BED_SIZE)
      lib.setObjectPositions(result.positions)
      PrepareSession.setPositions(result.positions)
      if (result.overflowCount > 0) {
        toastFromWorker("${result.overflowCount} object(s) did not fit on the bed.")
      }
      true
    }
  }

  /**
   * Runs a native edit on a worker thread under the engine lock, then refetches
   * the preview scene so the display reflects the engine's new state.
   */
  private fun runEdit(message: String = "Updating...", edit: (NativeLibrary) -> Boolean) {
    showBusy(message)
    Thread {
      try {
        synchronized(NativeEngineGuard.LOCK) {
          val lib = native ?: NativeLibrary().also { native = it }
          if (!edit(lib)) {
            runOnUiThread { hideBusy() }
            return@Thread
          }
          fetchSceneAndShowLocked(lib)
        }
      } catch (error: Throwable) {
        runOnUiThread {
          hideBusy()
          toast("Edit failed: ${error.message ?: error::class.java.simpleName}")
        }
      }
    }.start()
  }

  private fun commitPositions() {
    if (positions.isEmpty()) return
    val committed = positions.copyOf()

    // Copies mode: the engine still holds ONE object — copies exist only client-side
    // and are applied via setModelInstances at slice time. Just record the drag.
    if (objectCount == 1 && copyCount > 1) {
      PrepareSession.updateCopyPositions(committed)
      val view = viewer ?: return
      mesh?.let { refreshPickingPositions(view, it, view.renderer.objectMeshRanges) }
      return
    }

    Thread {
      try {
        synchronized(NativeEngineGuard.LOCK) {
          val lib = native ?: NativeLibrary().also { native = it }
          if (committed.size / 2 == lib.nativeGetObjectCount()) {
            lib.setObjectPositions(committed)
          }
        }
        PrepareSession.setPositions(committed)
        // Picking positions move with the objects — refresh so taps stay accurate.
        runOnUiThread {
          val view = viewer ?: return@runOnUiThread
          val m = mesh ?: return@runOnUiThread
          refreshPickingPositions(view, m, view.renderer.objectMeshRanges)
        }
      } catch (_: Throwable) {
        // Positions stay applied visually; the next edit/slice re-syncs.
      }
    }.start()
  }

  // ---------- Helpers ----------

  private fun releaseMeshAsync(m: MeshData) {
    if (m.sceneHandle == 0L) return
    val view = viewer
    if (view != null) {
      // Queue on the GL thread so the release happens after the current frame.
      view.queueEvent { runCatching { m.release(native ?: NativeLibrary()) } }
    } else {
      runCatching { m.release(native ?: NativeLibrary()) }
    }
  }

  private fun showBusy(message: String) {
    busyOverlay?.visibility = View.VISIBLE
    subtitleView.text = message
  }

  private fun hideBusy() {
    busyOverlay?.visibility = View.GONE
  }

  private fun toast(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
  }

  private fun toastFromWorker(message: String) {
    runOnUiThread { toast(message) }
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

  companion object {
    const val EXTRA_FILE_PATH = "filePath"
    const val EXTRA_TITLE = "title"
    const val EXTRA_SLOT_COLORS = "slotColors"
    const val EXTRA_ACCENT = "accentColor"
    const val EXTRA_MOONRAKER = "moonrakerUrl"
    const val EXTRA_INITIAL_TOOL = "initialTool"
    const val EXTRA_LOADED_TOOL_MASK = "loadedToolMask"
    private const val BED_SIZE = 270f

    // Orca default prime_tower_width (the lab SliceConfig's 60mm default is the
    // engine-side fallback; the preview mirrors what profiles actually use).
    private const val TOWER_WIDTH = 35f
  }
}
