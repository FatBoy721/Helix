package com.u1.slicer.aipaint

/**
 * Trimmed port of the reference app's AiRegion — just the fields
 * [PaintedMeshWriter] needs (one region per physical filament slot).
 */
data class AiRegion(
    val id: Int,
    val label: String,
    val suggestedColour: String,       // hex "#RRGGBB"
    val userColour: String? = null,
    val slot: Int = 0,
) {
    val effectiveColour: String get() = userColour ?: suggestedColour
}
