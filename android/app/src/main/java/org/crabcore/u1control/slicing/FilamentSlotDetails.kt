package org.crabcore.u1control.slicing

import android.content.Context

/**
 * What the RN app knows about each physical filament slot beyond its colour:
 * material, sub type, brand, and whether the machine reports it loaded.
 *
 * Colours stay in [FilamentSlotColors] because paint and mesh palettes need them
 * on their own terms. This store carries the descriptive half so native screens —
 * the print preprocess sheet especially — can label a lane exactly as the RN
 * sheet does without re-deriving anything from Moonraker. RN resolves printer
 * truth against saved settings and pushes both halves through
 * [HelixSlicerModule.setFilamentSlots].
 */
object FilamentSlotDetails {
  /** Mirrors RN `FilamentSlotDisplay`; [status] is a `FilamentSlotStatus` value. */
  data class Slot(
    val material: String,
    val mainType: String,
    val subType: String,
    val brand: String,
    val status: String,
  ) {
    val isEmpty: Boolean get() = status == "empty"
  }

  private const val PREFS = "helix_filament_slot_details"
  private const val COUNT = 4

  /** Stand-in until RN has pushed. `unknown` reads as usable, never as empty. */
  private val UNKNOWN = Slot(material = "PLA", mainType = "PLA", subType = "", brand = "", status = "unknown")

  fun read(context: Context): List<Slot> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return (0 until COUNT).map { index ->
      Slot(
        material = prefs.getString("material$index", null) ?: UNKNOWN.material,
        mainType = prefs.getString("mainType$index", null) ?: UNKNOWN.mainType,
        subType = prefs.getString("subType$index", null) ?: UNKNOWN.subType,
        brand = prefs.getString("brand$index", null) ?: UNKNOWN.brand,
        status = prefs.getString("status$index", null) ?: UNKNOWN.status,
      )
    }
  }

  fun write(context: Context, slots: List<Slot>) {
    val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    for (index in 0 until COUNT) {
      val slot = slots.getOrNull(index) ?: UNKNOWN
      editor.putString("material$index", slot.material)
      editor.putString("mainType$index", slot.mainType)
      editor.putString("subType$index", slot.subType)
      editor.putString("brand$index", slot.brand)
      editor.putString("status$index", slot.status)
    }
    editor.apply()
  }
}
