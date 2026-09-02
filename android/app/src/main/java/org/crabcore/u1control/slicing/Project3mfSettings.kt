package org.crabcore.u1control.slicing

import android.content.Context
import com.u1.slicer.data.SliceConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipFile

/**
 * One line of the project-settings sheet.
 *
 * [default] is null when the printer's bundled profile says nothing about this
 * setting, which is the case for every non-Bambu profile Helix ships.
 */
data class ProjectSettingRow(
  val label: String,
  val value: String,
  val default: String?,
) {
  /** True when the project overrides a value the printer profile does specify. */
  val differs: Boolean get() = default != null && default != value
}

/**
 * A 3MF's embedded [Metadata/project_settings.config], and the bridge from it
 * into [SliceConfig].
 *
 * The native engine reads that entry itself when it opens the model — and then
 * the prebuilt JNI wrapper applies every [SliceConfig] field over the result.
 * The wrapper is a binary we do not build, so it cannot be taught to skip
 * fields; the only way to stop it overwriting the project's own settings with
 * Helix's defaults is to put the project's values into SliceConfig first. That
 * is what [applyTo] is for. User overrides are applied afterwards and still win.
 *
 * Every accessor is nullable and means "the project did not say", which is not
 * the same as "the project said zero". Callers decide the fallback.
 *
 * Bambu writes values as strings, and per-extruder or per-filament keys as
 * arrays of strings, so both shapes are accepted and arrays read their first
 * entry — the profile's own primary variant.
 * crabcore
 */
class Project3mfSettings private constructor(private val config: JSONObject?) {

  /** False when the file carried no project settings at all (a plain STL). */
  val isPresent: Boolean get() = config != null

  // ---- Typed readers ----

  /** A key's value, unwrapping the array form Bambu uses for per-variant keys. */
  fun string(key: String): String? {
    val raw = config?.opt(key) ?: return null
    val value = if (raw is JSONArray) raw.opt(0) else raw
    return (value as? String ?: value?.toString())?.trim()?.takeIf { it.isNotEmpty() }
  }

  fun boolean(key: String): Boolean? = when (string(key)?.lowercase()) {
    "1", "true" -> true
    "0", "false" -> false
    else -> null
  }

  fun float(key: String): Float? = string(key)?.toFloatOrNull()

  fun int(key: String): Int? = string(key)?.toFloatOrNull()?.toInt()

  /** `"15%"` reads as 0.15; a bare `"0.15"` is already a fraction. */
  fun fraction(key: String): Float? {
    val raw = string(key) ?: return null
    val percent = raw.endsWith("%")
    val value = raw.removeSuffix("%").toFloatOrNull() ?: return null
    return if (percent) value / 100f else value
  }

  // ---- Named settings ----

  val primeTowerEnabled: Boolean? get() = boolean("enable_prime_tower")

  val primeTowerWidth: Float? get() = float("prime_tower_width")?.takeIf { it > 0f }

  /**
   * Bed temperature for the plate the project is actually set up for.
   *
   * Bambu stores a temperature per plate type and names the chosen one in
   * `curr_bed_type`; reading `hot_plate_temp` regardless would give a Supertack
   * project the High Temp figure, which for PLA is 20C out.
   */
  val bedTemperature: Int? get() {
    val key = BED_TEMP_KEYS[string("curr_bed_type")] ?: "hot_plate_temp"
    return int(key)?.takeIf { it > 0 }
  }

  /**
   * Copies the project's settings onto [config].
   *
   * Only keys the project actually carries are written, so a file that says
   * nothing about a setting leaves Helix's default in place. Nothing here is a
   * user choice — [HelixSliceSettings.applyTo] runs afterwards for those.
   */
  fun applyTo(target: SliceConfig) {
    if (!isPresent) return

    // Layers and shells.
    float("layer_height")?.let { target.layerHeight = it }
    float("initial_layer_print_height")?.let { target.firstLayerHeight = it }
    int("wall_loops")?.let { target.perimeters = it }
    int("top_shell_layers")?.let { target.topSolidLayers = it }
    int("bottom_shell_layers")?.let { target.bottomSolidLayers = it }

    // Infill.
    fraction("sparse_infill_density")?.let { target.fillDensity = it.coerceIn(0f, 1f) }
    string("sparse_infill_pattern")?.let { target.fillPattern = it }

    // Speeds. These are per-extruder-variant arrays; the first entry is the
    // profile's primary variant, which is the one Helix slices for.
    float("outer_wall_speed")?.let { target.printSpeed = it }
    float("travel_speed")?.let { target.travelSpeed = it }
    float("initial_layer_speed")?.let { target.firstLayerSpeed = it }

    // Adhesion.
    int("skirt_loops")?.let { target.skirtLoops = it }
    float("skirt_distance")?.let { target.skirtDistance = it }
    float("brim_width")?.let { target.brimWidth = it }

    // Supports.
    boolean("enable_support")?.let { target.supportEnabled = it }
    string("support_type")?.let { target.supportType = it }
    float("support_threshold_angle")?.let { target.supportAngle = it }
    boolean("support_on_build_plate_only")?.let { target.supportBuildPlateOnly = it }
    string("support_base_pattern")?.let { target.supportPattern = it }
    int("support_filament")?.let { target.supportFilament = it }
    int("support_interface_filament")?.let { target.supportInterfaceFilament = it }

    // Hardware and material.
    float("nozzle_diameter")?.let { target.nozzleDiameter = it }
    float("filament_diameter")?.let { target.filamentDiameter = it }
    string("filament_type")?.let { target.filamentType = it }
    // Left for resolveNativeMaterialProfiles to override when the user's own
    // filament library has something to say; this is only the file's guess.
    int("nozzle_temperature")?.let { target.nozzleTemp = it }
    bedTemperature?.let { target.bedTemp = it }

    // Retraction.
    float("retraction_length")?.let { target.retractLength = it }
    float("retraction_speed")?.let { target.retractSpeed = it }
  }

  /**
   * The settings this project specifies, in prepare-screen order, each next to
   * the printer profile's own value where one is known.
   *
   * [baseline] is the bundled machine profile. Only the Bambu profiles carry
   * print-scoped keys, so for a U1 or an AD5X the defaults come back null and
   * the rows read as "this is what the project asks for" rather than "this is
   * what the project changed" — which is the honest answer when there is
   * nothing to compare against.
   */
  fun summarize(baseline: Project3mfSettings = NONE): List<ProjectSettingRow> {
    if (!isPresent) return emptyList()
    return SUMMARY_KEYS.mapNotNull { entry ->
      val value = entry.read(this) ?: return@mapNotNull null
      ProjectSettingRow(entry.label, value, entry.read(baseline))
    }
  }

  private class SummaryKey(val label: String, val read: (Project3mfSettings) -> String?)

  companion object {
    private const val PROJECT_SETTINGS = "Metadata/project_settings.config"

    private fun onOff(value: Boolean?): String? = when (value) {
      true -> "On"
      false -> "Off"
      null -> null
    }

    private fun unit(raw: String?, suffix: String): String? =
      raw?.let { "$it$suffix" }

    /**
     * What the project-settings sheet lists, in the order it lists them.
     *
     * Deliberately a curated set: a Bambu project and Helix's bundled profile
     * differ in hundreds of bookkeeping keys, and listing those would bury the
     * handful a user actually recognises.
     */
    private val SUMMARY_KEYS = listOf(
      SummaryKey("Layer height") { unit(it.string("layer_height"), " mm") },
      SummaryKey("First layer") { unit(it.string("initial_layer_print_height"), " mm") },
      SummaryKey("Walls") { it.string("wall_loops") },
      SummaryKey("Top layers") { it.string("top_shell_layers") },
      SummaryKey("Bottom layers") { it.string("bottom_shell_layers") },
      SummaryKey("Infill") { it.string("sparse_infill_density") },
      SummaryKey("Infill pattern") { it.string("sparse_infill_pattern") },
      SummaryKey("Supports") { onOff(it.boolean("enable_support")) },
      SummaryKey("Support type") { it.string("support_type") },
      SummaryKey("Overhang angle") { unit(it.string("support_threshold_angle"), "°") },
      SummaryKey("Brim") { it.string("brim_type") },
      SummaryKey("Brim width") { unit(it.string("brim_width"), " mm") },
      SummaryKey("Ironing") { it.string("ironing_type") },
      SummaryKey("Prime tower") { onOff(it.boolean("enable_prime_tower")) },
      SummaryKey("Outer wall speed") { unit(it.string("outer_wall_speed"), " mm/s") },
      SummaryKey("Travel speed") { unit(it.string("travel_speed"), " mm/s") },
      SummaryKey("First layer speed") { unit(it.string("initial_layer_speed"), " mm/s") },
      SummaryKey("Skirt loops") { it.string("skirt_loops") },
      SummaryKey("Build plate") { it.string("curr_bed_type") },
      SummaryKey("Bed temp") { it.bedTemperature?.let { temp -> "$temp°C" } },
    )

    /**
     * `prime_tower_width` when the project does not name one. This is what the
     * stock Bambu and Orca profiles ship, and what the prepare screen draws —
     * SliceConfig's own 60mm default matched neither.
     */
    const val DEFAULT_PRIME_TOWER_WIDTH_MM = 35f

    /**
     * Bambu's plate labels and the key each one's temperature lives under.
     * Labels are the engine's own, read out of libprusaslicer-jni.so.
     */
    private val BED_TEMP_KEYS = mapOf(
      "Cool Plate" to "cool_plate_temp",
      "Smooth Cool Plate" to "cool_plate_temp",
      "Textured Cool Plate" to "textured_cool_plate_temp",
      "Cool Plate (SuperTack)" to "supertack_plate_temp",
      "Supertack Plate" to "supertack_plate_temp",
      "Engineering Plate" to "eng_plate_temp",
      "High Temp Plate" to "hot_plate_temp",
      "Smooth High Temp Plate" to "hot_plate_temp",
      "Smooth PEI Plate" to "hot_plate_temp",
      "Textured PEI Plate" to "textured_plate_temp",
    )

    /** Nothing known — a plain STL, a missing file, or a damaged zip. */
    val NONE = Project3mfSettings(null)

    /**
     * Reads [path]'s embedded project settings. Anything that is not a readable
     * 3MF carrying that entry yields [NONE] rather than throwing: a slice must
     * still run on a file whose metadata we cannot parse.
     */
    fun read(path: String?): Project3mfSettings {
      if (path.isNullOrBlank() || !path.endsWith(".3mf", ignoreCase = true)) return NONE
      val file = File(path)
      if (!file.exists()) return NONE
      return runCatching {
        ZipFile(file).use { zip ->
          val entry = zip.getEntry(PROJECT_SETTINGS) ?: return NONE
          parse(zip.getInputStream(entry).bufferedReader().use { it.readText() })
        }
      }.getOrDefault(NONE)
    }

    /**
     * The bundled machine profile for [asset], to compare a project against.
     *
     * Only the Bambu profiles carry print-scoped keys; the U1 and AD5X ones do
     * not, so those legitimately come back with nothing to compare.
     */
    fun readProfileAsset(context: Context, asset: String?): Project3mfSettings {
      if (asset.isNullOrBlank()) return NONE
      return runCatching {
        parse(
          context.assets.open("orca_profiles/printer/$asset")
            .bufferedReader().use { it.readText() },
        )
      }.getOrDefault(NONE)
    }

    /** Parses the config JSON body. Exposed for tests; never throws. */
    internal fun parse(json: String): Project3mfSettings =
      runCatching { Project3mfSettings(JSONObject(json)) }.getOrDefault(NONE)
  }
}
