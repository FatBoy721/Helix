package org.crabcore.u1control.slicing

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.ArrayAdapter
import com.u1.slicer.data.SliceConfig
import org.crabcore.u1control.R
import org.json.JSONArray
import org.json.JSONObject

/**
 * The groups of settings the prepare screen can override.
 *
 * A group counts as chosen only once the user has opened its dialog and applied
 * it. That distinction matters because these overrides are written into a 3MF's
 * own project settings: emitting a group the user never touched would replace
 * whatever the file asked for with this class's constructor defaults, which is
 * how a downloaded model that specifies supports or a brim silently lost them.
 */
enum class SliceSettingGroup { SUPPORTS, BRIM, INFILL, IRONING }

/** User-facing slice overrides on the prepare screen (Phase 1 — SliceConfig fields only). */
data class HelixSliceSettings(
  var supportsEnabled: Boolean = false,
  var supportType: String = "normal(auto)",
  var supportAngle: Int = 30,
  /** Orca 1-based filament index; 0 = engine default. */
  var supportFilament: Int = 0,
  /** Orca 1-based index; 0 = default, -1 = match [supportFilament]. */
  var supportInterfaceFilament: Int = -1,
  var supportBuildPlateOnly: Boolean = false,
  var supportPattern: String = "default",
  var brimWidthMm: Float = 0f,
  /** Sparse infill: -1 = keep profile default; otherwise 0..1. */
  var infillDensity: Float = -1f,
  /** Orca sparse_infill_pattern value; "default" = keep profile default. */
  var infillPattern: String = "default",
  /** Orca ironing_type: "no ironing" | "top" | "topmost" | "solid". */
  var ironingType: String = "no ironing",
  /** Orca ironing_pattern: "concentric" | "zig-zag". */
  var ironingPattern: String = "zig-zag",
  /** Ironing flow percent (Orca default 10). */
  var ironingFlow: Int = 10,
  /** Ironing line spacing mm (Orca default 0.15). */
  var ironingSpacing: Float = 0.15f,
  /** Ironing speed mm/s (Orca default 30). */
  var ironingSpeed: Int = 30,
  /** Which groups the user actually applied; see [SliceSettingGroup]. */
  var chosen: Set<SliceSettingGroup> = emptySet(),
) {
  fun chose(group: SliceSettingGroup): Boolean = group in chosen

  /** This value plus [group] marked as a deliberate user choice. */
  fun choosing(group: SliceSettingGroup): HelixSliceSettings = copy(chosen = chosen + group)

  fun hasSupportsEnabled(): Boolean = supportsEnabled

  fun hasBrimEnabled(): Boolean = brimWidthMm > 0f

  fun hasIroningEnabled(): Boolean = ironingType != "no ironing"

  fun hasInfillOverride(): Boolean = infillDensity >= 0f || infillPattern != "default"

  /** Round-trip serialization so a background re-slice can replay the exact
   *  prepare-screen overrides (supports/brim/infill/ironing). */
  fun toJson(): String = JSONObject().apply {
    put("supportsEnabled", supportsEnabled)
    put("supportType", supportType)
    put("supportAngle", supportAngle)
    put("supportFilament", supportFilament)
    put("supportInterfaceFilament", supportInterfaceFilament)
    put("supportBuildPlateOnly", supportBuildPlateOnly)
    put("supportPattern", supportPattern)
    put("brimWidthMm", brimWidthMm.toDouble())
    put("infillDensity", infillDensity.toDouble())
    put("infillPattern", infillPattern)
    put("ironingType", ironingType)
    put("ironingPattern", ironingPattern)
    put("ironingFlow", ironingFlow)
    put("ironingSpacing", ironingSpacing.toDouble())
    put("ironingSpeed", ironingSpeed)
    put("chosen", JSONArray(chosen.map { it.name }))
  }.toString()

  /**
   * Writes the user's choices onto [config], leaving untouched groups alone.
   *
   * Runs after [Project3mfSettings.applyTo], so anything not chosen here keeps
   * the project's own value rather than this class's constructor default.
   */
  fun applyTo(config: SliceConfig) {
    if (chose(SliceSettingGroup.SUPPORTS)) {
      config.supportEnabled = supportsEnabled
      if (supportsEnabled) {
        config.supportType = supportType
        config.supportAngle = supportAngle.toFloat()
        config.supportBuildPlateOnly = supportBuildPlateOnly
        config.supportPattern = supportPattern
        if (supportFilament > 0) config.supportFilament = supportFilament
        val iface = when {
          supportInterfaceFilament == -1 -> supportFilament
          supportInterfaceFilament > 0 -> supportInterfaceFilament
          else -> 0
        }
        if (iface > 0) config.supportInterfaceFilament = iface
      }
    }
    if (chose(SliceSettingGroup.BRIM)) config.brimWidth = brimWidthMm.coerceAtLeast(0f)
    if (chose(SliceSettingGroup.INFILL)) {
      if (infillDensity in 0f..1f) config.fillDensity = infillDensity
      if (infillPattern != "default") config.fillPattern = infillPattern
    }
    // Ironing has no SliceConfig fields — it rides only via the 3MF profile
    // overrides in [toProfileKeyOverrides] (so STL slices skip it).
  }

  /**
   * Keys for [SliceSettings3mfPatcher] (Orca project_settings.config JSON).
   *
   * Only groups the user applied appear. Writing a key for an untouched group
   * would overwrite the project's own answer with a default nobody picked —
   * which is exactly how a 3MF authored with supports arrived at the engine
   * with `enable_support: 0`.
   */
  fun toProfileKeyOverrides(): Map<String, String> {
    val out = linkedMapOf<String, String>()
    if (chose(SliceSettingGroup.SUPPORTS)) {
      out["enable_support"] = if (supportsEnabled) "1" else "0"
      if (supportsEnabled) {
        out["support_type"] = supportType
        out["support_threshold_angle"] = supportAngle.toString()
        out["support_on_build_plate_only"] = if (supportBuildPlateOnly) "1" else "0"
        out["support_base_pattern"] = supportPattern
        if (supportFilament > 0) out["support_filament"] = supportFilament.toString()
        val iface = when {
          supportInterfaceFilament == -1 -> supportFilament
          supportInterfaceFilament > 0 -> supportInterfaceFilament
          else -> 0
        }
        if (iface > 0) out["support_interface_filament"] = iface.toString()
      }
    }
    if (chose(SliceSettingGroup.BRIM)) {
      out["brim_width"] = brimWidthMm.coerceAtLeast(0f).toString()
      out["brim_type"] = if (brimWidthMm > 0f) "outer_only" else "no_brim"
    }
    if (chose(SliceSettingGroup.INFILL)) {
      if (infillDensity in 0f..1f) {
        out["sparse_infill_density"] = "${(infillDensity * 100).toInt()}%"
      }
      if (infillPattern != "default") out["sparse_infill_pattern"] = infillPattern
    }
    if (chose(SliceSettingGroup.IRONING)) {
      // An applied ironing dialog with ironing switched off must still say so,
      // or turning it back off would leave the project's own value standing.
      out["ironing_type"] = ironingType
      if (hasIroningEnabled()) {
        out["ironing_pattern"] = ironingPattern
        out["ironing_flow"] = "$ironingFlow%"
        out["ironing_spacing"] = ironingSpacing.toString()
        out["ironing_speed"] = ironingSpeed.toString()
      }
    }
    return out
  }

  companion object {
    /**
     * Prepare-screen state showing what [project] actually asks for.
     *
     * Nothing here counts as a user choice — [chosen] stays empty — so these
     * values light the toolbar tiles and pre-fill the dialogs without being
     * written back over the project as overrides. Open a dialog and apply it
     * and the group becomes a real choice from that point on.
     */
    fun seededFrom(project: Project3mfSettings): HelixSliceSettings {
      val settings = HelixSliceSettings()
      if (!project.isPresent) return settings

      project.boolean("enable_support")?.let { settings.supportsEnabled = it }
      project.string("support_type")?.let { settings.supportType = it }
      project.int("support_threshold_angle")?.let {
        settings.supportAngle = it.coerceIn(0, 90)
      }
      project.boolean("support_on_build_plate_only")?.let { settings.supportBuildPlateOnly = it }
      project.string("support_base_pattern")?.let { settings.supportPattern = it }
      project.int("support_filament")?.let { settings.supportFilament = it }
      project.int("support_interface_filament")?.let { settings.supportInterfaceFilament = it }

      // A brim the project switched off has no width to show, whatever number
      // is parked in brim_width.
      val brimOff = project.string("brim_type") == "no_brim"
      project.float("brim_width")?.let { settings.brimWidthMm = if (brimOff) 0f else it }

      project.fraction("sparse_infill_density")?.let {
        settings.infillDensity = it.coerceIn(0f, 1f)
      }
      project.string("sparse_infill_pattern")?.let { settings.infillPattern = it }

      project.string("ironing_type")?.let { settings.ironingType = it }
      project.string("ironing_pattern")?.let { settings.ironingPattern = it }
      project.fraction("ironing_flow")?.let { settings.ironingFlow = (it * 100).toInt() }
      project.float("ironing_spacing")?.let { settings.ironingSpacing = it }
      project.int("ironing_speed")?.let { settings.ironingSpeed = it }

      return settings
    }

    /** Build settings from the RN sliceFile options map (all keys optional). */
    fun fromBridgeOptions(
      supportEnabled: Boolean?,
      supportType: String?,
      supportAngle: Double?,
      supportFilament: Int?,
      supportInterfaceFilament: Int?,
      supportBuildPlateOnly: Boolean?,
      supportPattern: String?,
      brimWidth: Double?,
    ): HelixSliceSettings {
      val settings = HelixSliceSettings()
      // A key the caller sent is a deliberate choice; one it omitted leaves the
      // project's own value alone.
      val chosen = mutableSetOf<SliceSettingGroup>()
      supportEnabled?.let { settings.supportsEnabled = it; chosen += SliceSettingGroup.SUPPORTS }
      supportType?.let { settings.supportType = it; chosen += SliceSettingGroup.SUPPORTS }
      supportAngle?.let {
        settings.supportAngle = it.toInt().coerceIn(0, 90)
        chosen += SliceSettingGroup.SUPPORTS
      }
      supportFilament?.let { settings.supportFilament = it; chosen += SliceSettingGroup.SUPPORTS }
      supportInterfaceFilament?.let {
        settings.supportInterfaceFilament = it
        chosen += SliceSettingGroup.SUPPORTS
      }
      supportBuildPlateOnly?.let {
        settings.supportBuildPlateOnly = it
        chosen += SliceSettingGroup.SUPPORTS
      }
      supportPattern?.let { settings.supportPattern = it; chosen += SliceSettingGroup.SUPPORTS }
      brimWidth?.let { settings.brimWidthMm = it.toFloat(); chosen += SliceSettingGroup.BRIM }
      settings.chosen = chosen
      return settings
    }

    /**
     * The chosen-group set from a [toJson] payload.
     *
     * A record written before this field existed has no "chosen" array. Those
     * are replays of a slice the user had already configured, so treating them
     * as "everything the prepare screen can set was chosen" reproduces that
     * slice exactly rather than quietly re-slicing it with different settings.
     */
    private fun chosenFromJson(o: JSONObject): Set<SliceSettingGroup> {
      val raw = o.optJSONArray("chosen") ?: return SliceSettingGroup.entries.toSet()
      return (0 until raw.length())
        .mapNotNull { index ->
          val name = raw.optString(index)
          SliceSettingGroup.entries.firstOrNull { it.name == name }
        }
        .toSet()
    }

    /** Reconstruct from [toJson] output; null/blank/garbage → defaults. */
    fun fromJson(json: String?): HelixSliceSettings {
      if (json.isNullOrBlank()) return HelixSliceSettings()
      return runCatching {
        val o = JSONObject(json)
        HelixSliceSettings(
          supportsEnabled = o.optBoolean("supportsEnabled"),
          supportType = o.optString("supportType", "normal(auto)"),
          supportAngle = o.optInt("supportAngle", 30).coerceIn(0, 90),
          supportFilament = o.optInt("supportFilament", 0),
          supportInterfaceFilament = o.optInt("supportInterfaceFilament", -1),
          supportBuildPlateOnly = o.optBoolean("supportBuildPlateOnly"),
          supportPattern = o.optString("supportPattern", "default"),
          brimWidthMm = o.optDouble("brimWidthMm", 0.0).toFloat(),
          infillDensity = o.optDouble("infillDensity", -1.0).toFloat(),
          infillPattern = o.optString("infillPattern", "default"),
          ironingType = o.optString("ironingType", "no ironing"),
          ironingPattern = o.optString("ironingPattern", "zig-zag"),
          ironingFlow = o.optInt("ironingFlow", 10),
          ironingSpacing = o.optDouble("ironingSpacing", 0.15).toFloat(),
          ironingSpeed = o.optInt("ironingSpeed", 30),
          chosen = chosenFromJson(o),
        )
      }.getOrDefault(HelixSliceSettings())
    }
  }
}

data class SupportFilamentOption(val configValue: Int, val label: String)

/** T0–T3 labels for the support-material pickers (Orca config values stay 1-based). */
fun buildSupportFilamentOptions(
  slotColors: List<String>?,
  loadedToolMask: Int,
): List<SupportFilamentOption> {
  val options = mutableListOf(SupportFilamentOption(0, "Default"))
  for (slot in 0 until 4) {
    val empty = loadedToolMask >= 0 && (loadedToolMask and (1 shl slot)) == 0
    val color = slotColors?.getOrNull(slot)?.trim()?.removePrefix("#")?.uppercase()
    val colorBit = if (!color.isNullOrBlank()) " · #$color" else ""
    val emptyBit = if (empty) " (empty)" else ""
    options.add(SupportFilamentOption(slot + 1, "T$slot$colorBit$emptyBit"))
  }
  return options
}

/** Shared little UI builders for the slice-settings dialogs. */
private object SliceSettingsWidgets {
  fun rowLabel(activity: Activity, text: String) = TextView(activity).apply {
    this.text = text
    textSize = 13f
    setTextColor(HelixAppTheme.TEXT)
    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
  }

  fun bindStringSpinner(
    activity: Activity,
    spinner: Spinner,
    options: List<Pair<String, String>>,
    initialValue: String,
    onPick: (String) -> Unit,
  ) {
    spinner.adapter = ArrayAdapter(
      activity,
      android.R.layout.simple_spinner_dropdown_item,
      options.map { it.second },
    )
    spinner.setSelection(options.indexOfFirst { it.first == initialValue }.coerceAtLeast(0))
    spinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
      override fun onItemSelected(
        parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long,
      ) {
        onPick(options[position].first)
      }
      override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
    }
  }

  fun spinnerRow(activity: Activity, label: String, spinner: Spinner, dp: (Int) -> Int) =
    LinearLayout(activity).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      addView(rowLabel(activity, label))
      addView(spinner, LinearLayout.LayoutParams(dp(180), LinearLayout.LayoutParams.WRAP_CONTENT))
    }

  fun seekBar(activity: Activity, accent: Int, maxVal: Int, initial: Int, onChange: (Int) -> Unit) =
    SeekBar(activity).apply {
      max = maxVal
      progress = initial
      progressTintList = ColorStateList.valueOf(accent)
      thumbTintList = ColorStateList.valueOf(accent)
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
          if (fromUser) onChange(progress)
        }
        override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
        override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
      })
    }

  fun mutedLabel(activity: Activity) = TextView(activity).apply {
    textSize = 13f
    setTextColor(HelixAppTheme.SUBTEXT)
  }
}

/** Supports dialog — the toolbar's Supports tile. */
object HelixSupportSettingsUi {
  private val supportTypes = listOf(
    "normal(auto)" to "Normal (auto)",
    "tree(auto)" to "Tree (auto)",
    "normal(manual)" to "Normal (manual)",
    "tree(manual)" to "Tree (manual)",
  )

  private val supportPatterns = listOf(
    "default" to "Default",
    "rectilinear" to "Rectilinear",
    "rectilinear_grid" to "Grid",
    "honeycomb" to "Honeycomb",
    "lightning" to "Lightning",
  )

  fun show(
    activity: Activity,
    accent: Int,
    state: HelixSliceSettings,
    slotColors: List<String>?,
    loadedToolMask: Int,
    onApply: (HelixSliceSettings) -> Unit,
  ) {
    val draft = state.copy()
    val density = activity.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()
    val w = SliceSettingsWidgets

    val supportDetail = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }

    val typeSpinner = Spinner(activity)
    w.bindStringSpinner(activity, typeSpinner, supportTypes, draft.supportType) {
      draft.supportType = it
    }

    val angleLabel = w.mutedLabel(activity)
    fun refreshAngleLabel() {
      angleLabel.text = "Overhang angle: ${draft.supportAngle}°"
    }
    refreshAngleLabel()
    val angleBar = w.seekBar(activity, accent, 90, draft.supportAngle) {
      draft.supportAngle = it
      refreshAngleLabel()
    }

    supportDetail.addView(w.spinnerRow(activity, "Support type", typeSpinner, ::dp))
    supportDetail.addView(angleLabel, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(10) })
    supportDetail.addView(angleBar)

    val filamentOptions = buildSupportFilamentOptions(slotColors, loadedToolMask)
    val interfaceOptions = listOf(SupportFilamentOption(-1, "Same as support")) + filamentOptions

    fun bindFilamentSpinner(
      spinner: Spinner,
      options: List<SupportFilamentOption>,
      initialValue: Int,
      onPick: (Int) -> Unit,
    ) {
      spinner.adapter = ArrayAdapter(
        activity,
        android.R.layout.simple_spinner_dropdown_item,
        options.map { it.label },
      )
      spinner.setSelection(options.indexOfFirst { it.configValue == initialValue }.coerceAtLeast(0))
      spinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
        override fun onItemSelected(
          parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long,
        ) {
          onPick(options[position].configValue)
        }
        override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
      }
    }

    val supportFilamentSpinner = Spinner(activity)
    bindFilamentSpinner(supportFilamentSpinner, filamentOptions, draft.supportFilament) {
      draft.supportFilament = it
    }
    val interfaceFilamentSpinner = Spinner(activity)
    bindFilamentSpinner(interfaceFilamentSpinner, interfaceOptions, draft.supportInterfaceFilament) {
      draft.supportInterfaceFilament = it
    }

    supportDetail.addView(
      w.spinnerRow(activity, "Support material", supportFilamentSpinner, ::dp),
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(10) },
    )
    supportDetail.addView(
      w.spinnerRow(activity, "Interface material", interfaceFilamentSpinner, ::dp),
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(8) },
    )

    val buildPlateCheck = CheckBox(activity).apply {
      text = "Build plate only"
      textSize = 13f
      setTextColor(HelixAppTheme.TEXT)
      isChecked = draft.supportBuildPlateOnly
      buttonTintList = ColorStateList.valueOf(accent)
      setOnCheckedChangeListener { _, checked -> draft.supportBuildPlateOnly = checked }
    }
    supportDetail.addView(
      buildPlateCheck,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(8) },
    )

    val patternSpinner = Spinner(activity)
    w.bindStringSpinner(activity, patternSpinner, supportPatterns, draft.supportPattern) {
      draft.supportPattern = it
    }
    supportDetail.addView(
      w.spinnerRow(activity, "Support pattern", patternSpinner, ::dp),
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(8) },
    )

    fun refreshSupportDetailVisibility() {
      supportDetail.visibility = if (draft.supportsEnabled) View.VISIBLE else View.GONE
    }

    val supportsCheck = CheckBox(activity).apply {
      text = "Enable supports"
      textSize = 13f
      setTextColor(HelixAppTheme.TEXT)
      isChecked = draft.supportsEnabled
      buttonTintList = ColorStateList.valueOf(accent)
      setOnCheckedChangeListener { _, checked ->
        draft.supportsEnabled = checked
        refreshSupportDetailVisibility()
      }
    }

    val content = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      addView(supportsCheck)
      addView(supportDetail)
    }
    refreshSupportDetailVisibility()

    HelixThemedDialog.showFloatingCenter(
      activity = activity,
      accent = accent,
      title = "Supports",
      iconRes = R.drawable.ic_tool_support,
      content = content,
      onPrimary = { onApply(draft.choosing(SliceSettingGroup.SUPPORTS)) },
    )
  }
}

/** Infill dialog — pattern + density overrides. */
object HelixInfillSettingsUi {
  private val infillPatterns = listOf(
    "default" to "Profile default",
    "gyroid" to "Gyroid",
    "grid" to "Grid",
    "rectilinear" to "Rectilinear",
    "cubic" to "Cubic",
    "adaptivecubic" to "Adaptive Cubic",
    "triangles" to "Triangles",
    "honeycomb" to "Honeycomb",
    "3dhoneycomb" to "3D Honeycomb",
    "lightning" to "Lightning",
    "concentric" to "Concentric",
    "crosshatch" to "Cross Hatch",
  )

  fun show(
    activity: Activity,
    accent: Int,
    state: HelixSliceSettings,
    onApply: (HelixSliceSettings) -> Unit,
  ) {
    val draft = state.copy()
    val density = activity.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()
    val w = SliceSettingsWidgets

    val patternSpinner = Spinner(activity)
    w.bindStringSpinner(activity, patternSpinner, infillPatterns, draft.infillPattern) {
      draft.infillPattern = it
    }

    val densityLabel = w.mutedLabel(activity)
    fun refreshDensityLabel() {
      densityLabel.text = if (draft.infillDensity < 0f) {
        "Density: profile default"
      } else {
        "Density: ${(draft.infillDensity * 100).toInt()}%"
      }
    }
    refreshDensityLabel()
    val densityBar = w.seekBar(
      activity, accent, 100,
      if (draft.infillDensity < 0f) 15 else (draft.infillDensity * 100).toInt(),
    ) {
      draft.infillDensity = it / 100f
      refreshDensityLabel()
    }

    val resetBtn = TextView(activity).apply {
      text = "Reset to profile default"
      textSize = 12f
      setTextColor(HelixAppTheme.SUBTEXT)
      setPadding(0, dp(8), 0, 0)
      setOnClickListener {
        draft.infillDensity = -1f
        draft.infillPattern = "default"
        patternSpinner.setSelection(0)
        refreshDensityLabel()
      }
    }

    val content = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      addView(w.spinnerRow(activity, "Pattern", patternSpinner, ::dp))
      addView(densityLabel, LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(10) })
      addView(densityBar)
      addView(resetBtn)
    }

    HelixThemedDialog.showFloatingCenter(
      activity = activity,
      accent = accent,
      title = "Infill",
      iconRes = R.drawable.ic_tool_arrange,
      content = content,
      onPrimary = { onApply(draft.choosing(SliceSettingGroup.INFILL)) },
    )
  }
}

/** Ironing dialog — everything ironing lives here (the tile lights when on). */
object HelixIroningSettingsUi {
  private val ironingTypes = listOf(
    "top" to "All top surfaces",
    "topmost" to "Topmost surface only",
    "solid" to "All solid surfaces",
  )

  private val ironingPatterns = listOf(
    "zig-zag" to "Zig-zag",
    "concentric" to "Concentric",
  )

  fun show(
    activity: Activity,
    accent: Int,
    state: HelixSliceSettings,
    onApply: (HelixSliceSettings) -> Unit,
  ) {
    val draft = state.copy()
    val density = activity.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()
    val w = SliceSettingsWidgets

    val detail = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }

    val typeSpinner = Spinner(activity)
    w.bindStringSpinner(
      activity, typeSpinner, ironingTypes,
      draft.ironingType.takeIf { it != "no ironing" } ?: "top",
    ) { draft.ironingType = it }

    val patternSpinner = Spinner(activity)
    w.bindStringSpinner(activity, patternSpinner, ironingPatterns, draft.ironingPattern) {
      draft.ironingPattern = it
    }

    val flowLabel = w.mutedLabel(activity)
    fun refreshFlow() { flowLabel.text = "Flow: ${draft.ironingFlow}%" }
    refreshFlow()
    val flowBar = w.seekBar(activity, accent, 35, draft.ironingFlow.coerceIn(0, 35)) {
      draft.ironingFlow = it
      refreshFlow()
    }

    val spacingLabel = w.mutedLabel(activity)
    fun refreshSpacing() {
      spacingLabel.text = "Spacing: ${String.format("%.2f", draft.ironingSpacing)} mm"
    }
    refreshSpacing()
    val spacingBar = w.seekBar(
      activity, accent, 45,
      ((draft.ironingSpacing - 0.05f) * 100).toInt().coerceIn(0, 45),
    ) {
      draft.ironingSpacing = 0.05f + it / 100f
      refreshSpacing()
    }

    val speedLabel = w.mutedLabel(activity)
    fun refreshSpeed() { speedLabel.text = "Speed: ${draft.ironingSpeed} mm/s" }
    refreshSpeed()
    val speedBar = w.seekBar(activity, accent, 90, (draft.ironingSpeed - 10).coerceIn(0, 90)) {
      draft.ironingSpeed = 10 + it
      refreshSpeed()
    }

    detail.addView(w.spinnerRow(activity, "Ironing on", typeSpinner, ::dp))
    detail.addView(
      w.spinnerRow(activity, "Pattern", patternSpinner, ::dp),
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(8) },
    )
    detail.addView(flowLabel, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(8) })
    detail.addView(flowBar)
    detail.addView(spacingLabel)
    detail.addView(spacingBar)
    detail.addView(speedLabel)
    detail.addView(speedBar)

    fun refreshVisibility() {
      detail.visibility = if (draft.ironingType != "no ironing") View.VISIBLE else View.GONE
    }

    val enableCheck = CheckBox(activity).apply {
      text = "Enable ironing"
      textSize = 13f
      setTextColor(HelixAppTheme.TEXT)
      isChecked = draft.ironingType != "no ironing"
      buttonTintList = ColorStateList.valueOf(accent)
      setOnCheckedChangeListener { _, checked ->
        draft.ironingType = if (checked) "top" else "no ironing"
        refreshVisibility()
      }
    }

    val content = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      addView(enableCheck)
      addView(detail)
    }
    refreshVisibility()

    HelixThemedDialog.showFloatingCenter(
      activity = activity,
      accent = accent,
      title = "Ironing",
      iconRes = R.drawable.ic_tool_iron,
      content = content,
      onPrimary = { onApply(draft.choosing(SliceSettingGroup.IRONING)) },
    )
  }
}

/** Brim width picker — same floating themed dialog as supports. */
object HelixBrimSettingsUi {
  private val brimOptionsMm = floatArrayOf(0f, 3f, 5f, 8f)

  fun show(
    activity: Activity,
    accent: Int,
    brimWidthMm: Float,
    onApply: (Float) -> Unit,
  ) {
    var draft = brimWidthMm
    val density = activity.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()

    val chipRow = LinearLayout(activity).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val chips = mutableListOf<TextView>()

    fun refreshChips() {
      chips.forEachIndexed { index, chip ->
        val selected = brimOptionsMm[index] == draft
        val bg = chip.background as GradientDrawable
        bg.setColor(
          if (selected) (accent and 0x00FFFFFF) or 0x40000000 else HelixAppTheme.CARD_ALT,
        )
        bg.setStroke(
          dp(1),
          if (selected) accent else HelixAppTheme.BORDER,
        )
        chip.setTextColor(if (selected) accent else HelixAppTheme.SUBTEXT)
      }
    }

    brimOptionsMm.forEachIndexed { index, mm ->
      val label = if (mm <= 0f) "Off" else "${mm.toInt()} mm"
      val chip = TextView(activity).apply {
        text = label
        textSize = 13f
        gravity = Gravity.CENTER
        setPadding(dp(14), dp(10), dp(14), dp(10))
        background = GradientDrawable().apply { cornerRadius = dp(8).toFloat() }
        setOnClickListener {
          draft = brimOptionsMm[index]
          refreshChips()
        }
      }
      chips.add(chip)
      chipRow.addView(
        chip,
        LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
          if (index > 0) marginStart = dp(8)
        },
      )
    }
    refreshChips()

    val content = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      addView(
        TextView(activity).apply {
          text = "Brim width"
          textSize = 13f
          setTextColor(HelixAppTheme.SUBTEXT)
          setPadding(0, 0, 0, dp(10))
        },
      )
      addView(chipRow)
    }

    HelixThemedDialog.showFloatingCenter(
      activity = activity,
      accent = accent,
      title = "Brim",
      iconRes = R.drawable.ic_tool_brim,
      content = content,
      onPrimary = { onApply(draft) },
    )
  }
}
