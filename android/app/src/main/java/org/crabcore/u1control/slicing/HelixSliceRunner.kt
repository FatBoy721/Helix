package org.crabcore.u1control.slicing

import android.content.Context
import com.u1.slicer.NativeLibrary
import com.u1.slicer.data.SliceConfig
import com.u1.slicer.data.SliceResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The one true slice pipeline: load (painted file when Smart Paint saved one),
 * replay prepare-session edits, build the U1 config, slice, inject thumbnails.
 *
 * Shared by the RN bridge ([HelixSlicerModule.sliceFile]) and the prepare
 * screen's Slice button ([HelixModelPreviewActivity]) so both paths produce
 * identical G-code and can't drift apart.
 */
object HelixSliceRunner {

  private val slicing = AtomicBoolean(false)

  class BusyError : Exception("A slice is already running")
  class LoadError(msg: String) : Exception(msg)

  data class Outcome(
    val result: SliceResult?,
    val thumbnailsInjected: Boolean,
    val initialTool: Int,
    val usedToolMask: Int,
  )

  data class MaterialProfile(
    val material: String,
    val brand: String,
    val nozzleTemp: Int,
    val maxVolumetricSpeed: Float,
    val pressureAdvance: Float,
  )

  fun parseMaterialProfiles(json: String?): List<MaterialProfile> {
    if (json.isNullOrBlank()) return emptyList()
    return runCatching {
      val array = JSONArray(json)
      (0 until array.length()).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        MaterialProfile(
          material = item.optString("material", "PLA"),
          brand = item.optString("brand", "Generic"),
          nozzleTemp = item.optInt("nozzleTemp", 220).coerceIn(160, 300),
          maxVolumetricSpeed = item.optDouble("maxVolumetricSpeed", 12.0).toFloat().coerceIn(1f, 30f),
          pressureAdvance = item.optDouble("pressureAdvance", 0.0).toFloat().coerceIn(0f, 1f),
        )
      }
    }.getOrDefault(emptyList())
  }

  /**
   * Runs a full slice synchronously on the calling thread (callers spawn their
   * own worker). Throws [BusyError] when a slice is already running anywhere in
   * the app, [LoadError] when the model can't be loaded.
   *
   * [configure] applies caller options onto the [SliceConfig] before the
   * session's wipe-tower override.
   */
  fun run(
    context: Context,
    lib: NativeLibrary,
    path: String,
    onProgress: (Int, String) -> Unit,
    initialTool: Int = 0,
    sliceSettings: HelixSliceSettings = HelixSliceSettings(),
    materialProfiles: List<MaterialProfile> = emptyList(),
    configure: SliceConfig.() -> Unit = {},
  ): Outcome {
    if (!slicing.compareAndSet(false, true)) throw BusyError()
    try {
      lib.progressListener = onProgress
      synchronized(NativeEngineGuard.LOCK) {
        onProgress(0, "loading model")

        // Smart Paint: when the paint screen saved a painted 3MF for this model,
        // slice THAT file — it carries the per-triangle paint_color data.
        val effectivePath = PrepareSession.paintedFileFor(path)
          ?.takeIf { File(it).exists() }
          ?: path
        val loadPath = SliceSettings3mfPatcher.resolvePath(context, effectivePath, sliceSettings)
        if (!lib.loadModel(loadPath)) {
          throw LoadError("Engine could not load model: $loadPath")
        }

        // Re-apply any prepare-screen edits (rotate/scale/copies/split/positions)
        // recorded for this model — loadModel wiped the engine's in-memory state.
        // (Painted files never have session ops: setPaintedFile clears them.)
        if (PrepareSession.hasEdits(path)) {
          onProgress(0, "applying arrangement")
          runCatching { PrepareSession.replay(path, lib) }
        }

        // Multicolor models carry more than one filament in their project config.
        // For those we keep the engine's multi-tool output; only single-colour
        // prints get pinned to the user's chosen loaded head.
        val filamentCount = readFilamentCount(lib)
        val multicolor = filamentCount > 1

        val (startGcode, endGcode) = readMachineGcode(context)
        val selectedTool = initialTool.coerceIn(0, 3)
        val config = SliceConfig(
          machineStartGcode = startGcode,
          machineEndGcode = endGcode,
        ).apply {
          sliceSettings.applyTo(this)
          configure()
          applyMaterialProfiles(materialProfiles, selectedTool)
          if (multicolor) configureMultiTool(filamentCount) else forceSingleTool(selectedTool)
          // Wipe tower position shown/dragged on the prepare screen.
          PrepareSession.towerPositionFor(path)?.let { (tx, ty) ->
            wipeTowerX = tx
            wipeTowerY = ty
          }
        }

        onProgress(1, "slicing")
        val result = lib.slice(config)
        val toolResult = if (result != null && result.success && result.gcodePath.isNotBlank()) {
          // Single-colour: pin startup to the loaded head. Multicolor: keep all tools.
          if (multicolor) GcodeToolMapper.usedMaskOnly(result.gcodePath)
          else GcodeToolMapper.applyInitialTool(result.gcodePath, selectedTool)
        } else {
          GcodeToolMapper.Result(false, 1 shl selectedTool)
        }

        if (result != null && result.success && result.gcodePath.isNotBlank()) {
          val bedMesh = GcodeToolMapper.clampU1BedMeshBounds(result.gcodePath)
          check(bedMesh.success) {
            "Could not safely constrain the adaptive bed-mesh bounds"
          }
          onProgress(99, "applying first-layer flow limit")
          val guard = GcodeFirstLayerGuard.apply(result.gcodePath)
          check(guard.success) {
            "Could not apply the required first-layer flow limit"
          }
        }

        // Stamp the engine's REAL palette (what the prepare screen showed) into
        // the gcode config comments. The engine writes default white, and the
        // 3MF's project_settings often holds Bambu's stock palette (green/blue),
        // not the model's — this line is what preview/dialog/Moonraker read.
        if (result != null && result.success && result.gcodePath.isNotBlank()) {
          val palette = readFilamentColours(lib)
          if (palette.isNotEmpty()) {
            runCatching { GcodeFilamentColors.embedPalette(result.gcodePath, palette) }
          }
        }

        val thumbnailsInjected = if (result != null && result.success && result.gcodePath.isNotBlank()) {
          runCatching { GcodeThumbnailInjector.inject(result.gcodePath, path) }.getOrDefault(false)
        } else {
          false
        }
        if (result != null && result.success) {
          LastSliceStore.record(path, result, selectedTool, toolResult.usedToolMask)
        }
        return Outcome(result, thumbnailsInjected, selectedTool, toolResult.usedToolMask)
      }
    } finally {
      lib.progressListener = null
      slicing.set(false)
    }
  }

  // Snapmaker U1 machine start/end G-code from the bundled printer profile
  // (same asset + shape as the reference app's readPrinterMachineGcode).
  private fun readMachineGcode(context: Context): Pair<String, String> {
    return try {
      val json = context.assets
        .open("orca_profiles/printer/snapmaker_u1.json")
        .bufferedReader().use { JSONObject(it.readText()) }
      Pair(
        json.optString("machine_start_gcode", ""),
        json.optString("machine_end_gcode", ""),
      )
    } catch (error: Throwable) {
      "" to ""
    }
  }

  /** Number of filaments declared in the loaded model's project config (>=1). */
  private fun readFilamentCount(lib: NativeLibrary): Int = readFilamentColours(lib).size.coerceAtLeast(1)

  /** The engine's parsed palette — the same colours the prepare screen renders. */
  private fun readFilamentColours(lib: NativeLibrary): List<String> {
    val json = runCatching { lib.nativeGetProjectConfig() }.getOrNull() ?: return emptyList()
    return try {
      val project = JSONObject(json)
      val arr = project.optJSONArray("filamentColours") ?: return emptyList()
      val colours = (0 until arr.length()).mapNotNull { i ->
        val hex = arr.optString(i).trim()
        if (hex.isEmpty()) null else canonicalColour(hex)
      }
      // Geometry-only 3MF files can repeat the same colour once per object or
      // colour group. They do not describe a multi-filament print. Bambu
      // projects keep their real filament list and must not be collapsed here.
      if (project.optBoolean("isBbl", false)) colours else colours.distinct()
    } catch (_: Throwable) {
      emptyList()
    }
  }

  private fun canonicalColour(raw: String): String {
    val hex = raw.removePrefix("#").uppercase()
    return if (hex.matches(Regex("[0-9A-F]{8}"))) "#${hex.take(6)}"
    else if (hex.matches(Regex("[0-9A-F]{6}"))) "#$hex"
    else "#$hex"
  }

  private fun SliceConfig.applyMaterialProfiles(profiles: List<MaterialProfile>, selectedTool: Int) {
    if (profiles.isEmpty()) return
    val normalized = Array(4) { index -> profiles.getOrNull(index) ?: profiles.first() }
    filamentType = normalized[selectedTool].material
    filamentTypes = Array(4) { index -> normalized[index].material }
    extruderTemps = IntArray(4) { index -> normalized[index].nozzleTemp }
    nozzleTemp = normalized[selectedTool].nozzleTemp
    filamentMaxVolumetricSpeeds = FloatArray(4) { index -> normalized[index].maxVolumetricSpeed }
    filamentPressureAdvances = FloatArray(4) { index -> normalized[index].pressureAdvance }
  }

  /** Size the config for [count] filaments (U1 has 4 ACE slots) so the engine keeps
   *  the multicolor tool changes instead of collapsing to one filament. */
  private fun SliceConfig.configureMultiTool(count: Int) {
    val n = count.coerceIn(1, 4)
    extruderCount = maxOf(extruderCount, n)
    if (filamentTypes.size < n) {
      val e = filamentTypes
      filamentTypes = Array(n) { i -> e.getOrNull(i) ?: filamentType }
    }
    if (extruderTemps.size < n) {
      val e = extruderTemps
      extruderTemps = IntArray(n) { i -> e.getOrNull(i) ?: nozzleTemp }
    }
    if (extruderRetractLength.size < n) {
      val e = extruderRetractLength
      extruderRetractLength = FloatArray(n) { i -> e.getOrNull(i) ?: retractLength }
    }
    if (extruderRetractSpeed.size < n) {
      val e = extruderRetractSpeed
      extruderRetractSpeed = FloatArray(n) { i -> e.getOrNull(i) ?: retractSpeed }
    }
  }

  private fun SliceConfig.forceSingleTool(tool: Int) {
    if (tool !in 0..3) return
    val count = maxOf(extruderCount, tool + 1)
    extruderCount = count
    if (filamentTypes.size < count) {
      val existing = filamentTypes
      filamentTypes = Array(count) { i -> existing.getOrNull(i) ?: filamentType }
    }
    if (extruderTemps.size < count) {
      val existing = extruderTemps
      extruderTemps = IntArray(count) { i -> existing.getOrNull(i) ?: nozzleTemp }
    }
    if (extruderRetractLength.size < count) {
      val existing = extruderRetractLength
      extruderRetractLength = FloatArray(count) { i -> existing.getOrNull(i) ?: retractLength }
    }
    if (extruderRetractSpeed.size < count) {
      val existing = extruderRetractSpeed
      extruderRetractSpeed = FloatArray(count) { i -> existing.getOrNull(i) ?: retractSpeed }
    }
  }
}
