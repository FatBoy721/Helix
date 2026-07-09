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
) {
  fun hasSupportsEnabled(): Boolean = supportsEnabled

  fun hasBrimEnabled(): Boolean = brimWidthMm > 0f

  fun hasIroningEnabled(): Boolean = ironingType != "no ironing"

  fun hasInfillOverride(): Boolean = infillDensity >= 0f || infillPattern != "default"

  fun applyTo(config: SliceConfig) {
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
    config.brimWidth = brimWidthMm.coerceAtLeast(0f)
    if (infillDensity in 0f..1f) config.fillDensity = infillDensity
    if (infillPattern != "default") config.fillPattern = infillPattern
    // Ironing has no SliceConfig fields — it rides only via the 3MF profile
    // overrides in [toProfileKeyOverrides] (so STL slices skip it).
  }

  /** Keys for [SliceSettings3mfPatcher] (Orca project_settings.config JSON). */
  fun toProfileKeyOverrides(): Map<String, String> {
    val out = linkedMapOf<String, String>()
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
    out["brim_width"] = brimWidthMm.coerceAtLeast(0f).toString()
    out["brim_type"] = if (brimWidthMm > 0f) "outer_only" else "no_brim"
    if (infillDensity in 0f..1f) {
      out["sparse_infill_density"] = "${(infillDensity * 100).toInt()}%"
    }
    if (infillPattern != "default") out["sparse_infill_pattern"] = infillPattern
    if (hasIroningEnabled()) {
      out["ironing_type"] = ironingType
      out["ironing_pattern"] = ironingPattern
      out["ironing_flow"] = "$ironingFlow%"
      out["ironing_spacing"] = ironingSpacing.toString()
      out["ironing_speed"] = ironingSpeed.toString()
    }
    return out
  }

  companion object {
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
      supportEnabled?.let { settings.supportsEnabled = it }
      supportType?.let { settings.supportType = it }
      supportAngle?.let { settings.supportAngle = it.toInt().coerceIn(0, 90) }
      supportFilament?.let { settings.supportFilament = it }
      supportInterfaceFilament?.let { settings.supportInterfaceFilament = it }
      supportBuildPlateOnly?.let { settings.supportBuildPlateOnly = it }
      supportPattern?.let { settings.supportPattern = it }
      brimWidth?.let { settings.brimWidthMm = it.toFloat() }
      return settings
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
      onPrimary = { onApply(draft) },
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
      onPrimary = { onApply(draft) },
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
      onPrimary = { onApply(draft) },
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
