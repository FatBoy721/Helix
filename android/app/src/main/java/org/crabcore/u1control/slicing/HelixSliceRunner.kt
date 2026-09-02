package org.crabcore.u1control.slicing

import android.content.Context
import com.u1.slicer.NativeLibrary
import com.u1.slicer.data.SliceConfig
import com.u1.slicer.viewer.MachineProfile
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

  private data class MachineGcodeProfile(
    val startGcode: String,
    val endGcode: String,
    val translateMarlinMachineLimits: Boolean = false,
    val stripM486: Boolean = false,
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
    materialProfilesJson: String? = null,
    forceExtruderCount: Int? = null,
    usedExtrudersHint: List<Int>? = null,
    machine: MachineProfile = MachineProfile.U1,
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
        val usedExtruders = usedExtrudersHint.orEmpty().filter { it in 0..3 }.distinct()
        val verifiedSingleMaterial = isSingleMaterialBambu(machine.sliceProfileAsset, usedExtruders)
        val normalizedPath = if (
          verifiedSingleMaterial &&
          effectivePath.endsWith(".3mf", ignoreCase = true) &&
          usedExtruders.single() != 0
        ) {
          // A Bambu project may list four installed presets while every triangle
          // on this plate uses only one of them. Keep the project settings, but
          // remap that lone source extruder to logical tool 0: the physical AMS
          // lane is selected later by the project_file command.
          val output = File(context.cacheDir, "helix_bambu_single_${File(effectivePath).name}")
          PlateExtractor.remapExtruders(
            File(effectivePath),
            mapOf(usedExtruders.single() + 1 to 0),
            output,
          ).absolutePath
        } else {
          effectivePath
        }
        val loadPath = SliceSettings3mfPatcher.resolvePath(context, normalizedPath, sliceSettings)
        val projectSettings = Project3mfSettings.read(loadPath)
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
        // prints get pinned to the user's chosen loaded head. forceExtruderCount
        // (per-colour remap) lifts the tool count to cover every mapped slot even
        // when the file declares fewer filaments than the user routed to.
        val filamentCount = readFilamentCount(lib)
        val effectiveCount = maxOf(filamentCount, forceExtruderCount ?: 1).coerceIn(1, 4)
        val multicolor = !verifiedSingleMaterial && effectiveCount > 1

        val machineGcode = readMachineProfile(context, machine.sliceProfileAsset)
        val selectedTool = initialTool.coerceIn(0, 3)
        val materialProfiles = parseMaterialProfiles(materialProfilesJson)
        val config = SliceConfig(
          machineStartGcode = machineGcode.startGcode,
          machineEndGcode = machineGcode.endGcode,
          // The engine reads these over JNI to size the printable area. Left at
          // the U1's 270 default they let a 220mm machine slice parts that do
          // not fit its bed.
          bedSizeX = machine.bed.sizeX,
          bedSizeY = machine.bed.sizeY,
          maxPrintHeight = machine.bed.height,
        ).apply {
          // Default wipe-tower corner, in bed coordinates. The old 170/140
          // literals were placed for a 270mm bed and sit off a smaller one.
          wipeTowerX = machine.bed.sizeX * (170f / 270f)
          wipeTowerY = machine.bed.sizeY * (140f / 270f)
          wipeTowerWidth =
            projectSettings.primeTowerWidth ?: Project3mfSettings.DEFAULT_PRIME_TOWER_WIDTH_MM
          // The project's own settings first. The engine reads them when it
          // opens the 3MF, but the JNI wrapper then applies every SliceConfig
          // field over the top, so anything left at a Helix default here
          // silently replaces what the file asked for. Seeding them makes that
          // second pass a no-op instead of a stomp.
          projectSettings.applyTo(this)
          // Then the user's deliberate overrides, which outrank the file.
          sliceSettings.applyTo(this)
          configure()
          applyMaterialProfiles(materialProfiles, selectedTool)
          if (multicolor) configureMultiTool(effectiveCount) else forceSingleTool(selectedTool)
          // The engine applies SliceConfig over the project settings it just read
          // from the 3MF, so leaving this at its false default deleted the tower
          // every multicolour project asked for — while the prepare screen still
          // drew one.
          //
          // Only a multi-tool slice can have a tower at all. Within that, the
          // project's own answer decides: a file that says nothing (an STL, or a
          // 3MF with no project settings) keeps the previous behaviour of no
          // tower rather than being newly given one, because a U1 purges through
          // its own firmware mechanism and does not want one uninvited.
          wipeTowerEnabled = multicolor && projectSettings.primeTowerEnabled == true
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
          if (machineGcode.translateMarlinMachineLimits || machineGcode.stripM486) {
            val compatibility = KlipperGcodeCompatibility.apply(
              result.gcodePath,
              machineGcode.translateMarlinMachineLimits,
              machineGcode.stripM486,
            )
            check(compatibility.success) {
              "Could not translate unsupported machine G-code"
            }
          }
          val bedMesh = GcodeToolMapper.clampBedMeshBounds(
            result.gcodePath, machine.bed.sizeX, machine.bed.sizeY,
          )
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
          LastSliceStore.record(
            path, result, selectedTool, toolResult.usedToolMask,
            sliceSettingsJson = sliceSettings.toJson(),
            materialProfilesJson = materialProfilesJson,
          )
        }
        return Outcome(result, thumbnailsInjected, selectedTool, toolResult.usedToolMask)
      }
    } finally {
      lib.progressListener = null
      slicing.set(false)
    }
  }

  // Machine start/end G-code from the bundled printer profile for [asset]
  // (same shape as the reference app's readPrinterMachineGcode).
  //
  // A null asset means we have no verified profile for the machine, so we hand
  // the engine empty strings and let it emit its own bare defaults. That is the
  // right answer for an unknown printer: generic G-code may be suboptimal, but
  // another machine's start G-code homes and primes in the wrong places.
  private fun readMachineProfile(context: Context, asset: String?): MachineGcodeProfile {
    if (asset.isNullOrBlank()) return MachineGcodeProfile("", "")
    return try {
      val json = context.assets
        .open("orca_profiles/printer/$asset")
        .bufferedReader().use { JSONObject(it.readText()) }
      MachineGcodeProfile(
        startGcode = compatibleMachineStartGcode(
          asset,
          json.optString("machine_start_gcode", ""),
        ),
        endGcode = json.optString("machine_end_gcode", ""),
        translateMarlinMachineLimits = json.optBoolean(
          "helix_translate_marlin_machine_limits",
          false,
        ),
        stripM486 = json.optBoolean("helix_strip_m486", false),
      )
    } catch (_: Throwable) {
      MachineGcodeProfile("", "")
    }
  }

  /**
   * Bambu changed its purge expressions in August 2025 to independent purge
   * speed/temperature variables and explicitly marked the profile change as
   * requiring the latest slicer. Helix's prebuilt engine predates those two
   * placeholders, but supports the immediately preceding official Bambu
   * expressions. The emitted commands and physical motion remain unchanged;
   * only their value sources use names this engine can resolve.
   */
  internal fun compatibleMachineStartGcode(asset: String, startGcode: String): String {
    return when (asset) {
      BAMBU_P1S_PROFILE_ASSET ->
        startGcode.replace(BAMBU_NEW_PURGE_EXPRESSION, BAMBU_P1S_COMPAT_PURGE_EXPRESSION)
      BAMBU_A1_PROFILE_ASSET -> startGcode
        .replace(BAMBU_NEW_PURGE_EXPRESSION, BAMBU_A1_COMPAT_PURGE_EXPRESSION)
        .replace(BAMBU_A1_NEW_FLUSH_TEMPERATURE, BAMBU_A1_COMPAT_FLUSH_TEMPERATURE)
      else -> startGcode
    }
  }

  internal fun isSingleMaterialBambu(asset: String?, usedExtruders: List<Int>): Boolean =
    asset in BAMBU_PROFILE_ASSETS && usedExtruders.filter { it in 0..3 }.distinct().size == 1

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

  private const val BAMBU_P1S_PROFILE_ASSET = "bambu_p1s.json"
  private const val BAMBU_A1_PROFILE_ASSET = "bambu_a1.json"
  private val BAMBU_PROFILE_ASSETS = setOf(BAMBU_P1S_PROFILE_ASSET, BAMBU_A1_PROFILE_ASSET)
  private const val BAMBU_NEW_PURGE_EXPRESSION =
    "M620.1 E F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60} " +
      "T{flush_temperatures[initial_no_support_extruder]}"
  private const val BAMBU_P1S_COMPAT_PURGE_EXPRESSION =
    "M620.1 E F{filament_max_volumetric_speed[initial_extruder]/2.4053*60} " +
      "T{nozzle_temperature_range_high[initial_extruder]}"
  private const val BAMBU_A1_COMPAT_PURGE_EXPRESSION =
    "M620.1 E F{filament_max_volumetric_speed[initial_no_support_extruder]/2.4053*60} " +
      "T{nozzle_temperature_range_high[initial_no_support_extruder]}"
  private const val BAMBU_A1_NEW_FLUSH_TEMPERATURE =
    "M109 S{flush_temperatures[initial_no_support_extruder]} H300"
  private const val BAMBU_A1_COMPAT_FLUSH_TEMPERATURE =
    "M109 S{nozzle_temperature_range_high[initial_no_support_extruder]} H300"

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
