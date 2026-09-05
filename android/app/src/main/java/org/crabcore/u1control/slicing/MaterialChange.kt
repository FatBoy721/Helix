package org.crabcore.u1control.slicing

/**
 * Decides whether routing a file tool to a different lane needs a re-slice.
 *
 * Remapping a tool only rewrites T-codes (see
 * HelixGcodePreviewActivity.remappedGcodeFile); every temperature, flow and
 * retraction value in the gcode still belongs to the material the file was
 * sliced with. That is fine when the new lane holds the same polymer and wrong
 * when it does not — routing a PLA slice onto a PETG lane printed PETG at PLA
 * temps, silently (issue #18).
 *
 * The comparison is on BASE POLYMER, not on the lane's display name. Lanes
 * routinely differ by brand or sub-type while being the same material
 * ("PLA Generic" vs "PLA BASIC Snapmaker"), and re-slicing those would cost the
 * user ~30s for an identical result.
 */
object MaterialChange {

  /**
   * Base polymers the app knows, longest-first so "PETG-CF" wins over "PETG"
   * and "PA6-CF" over "PA". Mirrors services/filamentProfiles.ts MATERIALS so
   * the native sheet and the JS dialog classify a spool the same way.
   */
  private val MAIN_TYPES = listOf(
    "PLA-CF", "PETG-CF", "PETG-HF", "PA6-CF", "PA6-GF", "PA-CF", "PA-GF",
    "PC-ABS", "PLA", "PETG", "TPU", "ABS", "ASA", "PA", "PC", "PVA",
  )

  /**
   * Base polymer for a spool's display name. "PLA BASIC" -> "PLA",
   * "PETG HF" -> "PETG-HF", "" / "EMPTY" / "NONE" -> "PLA" (the engine's own
   * default, matching deriveMainType in services/filamentProfiles.ts).
   *
   * "NONE" is the literal the U1 puts in print_task_config.filament_type for an
   * empty lane. services/filamentSlots.ts strips it before it reaches native, so
   * this is defence in depth rather than a live path - but the two classifiers
   * are documented as agreeing, and an unguarded "NONE" would compare as its own
   * polymer and force a pointless ~30s re-slice.
   */
  fun mainType(display: String?): String {
    val upper = display.orEmpty().trim().uppercase().replace('_', '-')
    if (upper.isEmpty() || upper == "EMPTY" || upper == "NONE") return "PLA"
    val squashed = upper.replace(" ", "-")
    MAIN_TYPES.firstOrNull { squashed == it }?.let { return it }
    MAIN_TYPES.firstOrNull { squashed.startsWith("$it-") }?.let { return it }
    return upper.split(' ', '-').firstOrNull()?.ifBlank { null } ?: "PLA"
  }

  /** True when printing [target] with gcode sliced for [sliced] needs a re-slice. */
  fun needsReslice(sliced: String?, target: String?): Boolean =
    mainType(sliced) != mainType(target)
}
