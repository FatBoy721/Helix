package com.u1.slicer.viewer

import org.json.JSONObject

/**
 * Build volume plus the plate drawn beneath the model in the 3D viewers.
 *
 * Mirrors `BedProfile` in services/printerProfiles.ts: the RN layer resolves the
 * active printer and hands these numbers to the preview Activity, so the bed you
 * see is the bed the engine slices against.
 *
 * Helix shipped U1-only, so the viewers had 270 and 135 written into them in a
 * dozen places. Everything bed-shaped now reads off one of these instead.
 */
data class BedProfile(
    /** Printable area in mm — Orca's `printable_area`. */
    @JvmField val sizeX: Float,
    @JvmField val sizeY: Float,
    /** Max Z in mm — Orca's `printable_height`. */
    @JvmField val height: Float,
    /**
     * Plate mesh filename inside the `bed/` asset dir, or null to draw a plain
     * rectangle. Binary STL only — the loader does not parse ASCII.
     *
     * Authored in Orca's convention: about the centre of the printable area, so
     * the loader shifts by (sizeX/2, sizeY/2). These meshes are deliberately not
     * symmetric — the material hanging off the front is the plate's grab handle
     * and is meant to overhang the bed.
     */
    @JvmField val modelAsset: String?,
    /**
     * Wordmark painted on the plate. Null leaves the plate bare, which is the
     * right answer for any machine whose mark we do not have — stamping
     * "snapmaker" on a FlashForge plate is worse than stamping nothing.
     */
    @JvmField val logoText: String?,
) {
    /** Bed centre, i.e. what the camera looks at and what meshes are shifted by. */
    val centerX: Float get() = sizeX / 2f
    val centerY: Float get() = sizeY / 2f

    /**
     * How far back the default plate-overview camera sits. Tuned on the U1
     * (270mm bed at distance 500) and scaled from there, so a small bed is not
     * framed from orbit and a large one does not overflow the viewport.
     */
    val defaultCameraDistance: Double get() = (maxOf(sizeX, sizeY) * 1.85f).toDouble()

    companion object {
        /**
         * Snapmaker U1. Also the fallback when no profile is supplied, so an
         * older RN bundle that does not pass one keeps its existing bed.
         *
         * Orca's printable_area for the U1 is nominally 271x272 with a half-mm
         * origin offset; the viewers and CopyArrangeCalculator have always used
         * a flat 270x270 and the arrangement maths is tuned to it.
         */
        @JvmField
        val U1 = BedProfile(
            sizeX = 270f,
            sizeY = 270f,
            height = 270f,
            modelAsset = "u1_bed.stl",
            logoText = "snapmaker",
        )

        /**
         * Parses the bed the RN layer resolved for the active printer, as
         * serialised by services/printerProfiles.ts.
         *
         * Falls back to [U1] on anything malformed or absent — including an
         * older JS bundle running against a newer native build, which sends no
         * bed at all. A wrong-sized bed is a visual bug; a crash on open is not
         * a trade worth making.
         */
        @JvmStatic
        fun fromJson(json: String?): BedProfile {
            if (json.isNullOrBlank()) return U1
            return try {
                val obj = JSONObject(json)
                val sizeX = obj.optDouble("sizeX", U1.sizeX.toDouble()).toFloat()
                val sizeY = obj.optDouble("sizeY", U1.sizeY.toDouble()).toFloat()
                val height = obj.optDouble("height", U1.height.toDouble()).toFloat()
                // A zero or negative bed would divide the camera by nothing and
                // build an empty grid, so treat it as unusable rather than
                // rendering a degenerate plate.
                if (sizeX <= 0f || sizeY <= 0f || height <= 0f) return U1
                BedProfile(
                    sizeX = sizeX,
                    sizeY = sizeY,
                    height = height,
                    modelAsset = obj.optStringOrNull("modelAsset"),
                    logoText = obj.optStringOrNull("logoText"),
                )
            } catch (_: Throwable) {
                U1
            }
        }

        /** optString maps JSON null to "null"; this maps it to a Kotlin null. */
        internal fun JSONObject.optStringOrNull(key: String): String? {
            if (!has(key) || isNull(key)) return null
            return optString(key).takeIf { it.isNotBlank() }
        }
    }
}

/**
 * Everything about the target machine that the slice needs: how big its bed is,
 * and which Orca printer profile supplies its start/end G-code.
 *
 * Separate from [BedProfile] because the renderers genuinely only need the bed,
 * while the slice needs the machine. Mirrors `MachineProfile` in
 * services/printerProfiles.ts.
 */
data class MachineProfile(
    @JvmField val bed: BedProfile,
    /**
     * Printer profile under the `orca_profiles/printer/` asset dir, or null to
     * let the engine fall back to its own defaults (a bare G28).
     *
     * This is what stops an AD5X job going out with the U1's start G-code —
     * the two prime on opposite sides of the bed.
     */
    @JvmField val sliceProfileAsset: String?,
    /**
     * The machine exposes PAXX's print_task_config object and its
     * SET_PRINT_PREFERENCES macros. U1 firmware only — see the TS profile.
     */
    @JvmField val supportsPrintPreferences: Boolean,
    /**
     * Preparation toggles the preprocess sheet should offer, by the same keys
     * services/printerProfiles.ts uses. Empty means the RN layer sent none, in
     * which case the sheet keeps its own full list rather than showing nothing.
     */
    @JvmField val printPrefs: List<String>,
    /**
     * How the machine names its material feeds: "lane" shows Lane 1–4 (AD5X,
     * Bambu), "tool" shows T0–T3 feeding lanes (U1, everything else). Mirrors
     * `laneNaming` in services/printerProfiles.ts.
     */
    @JvmField val laneNaming: String,
) {
    companion object {
        /** Snapmaker U1 — the machine Helix shipped with, and the fallback. */
        @JvmField
        val U1 = MachineProfile(
            bed = BedProfile.U1,
            sliceProfileAsset = "snapmaker_u1.json",
            supportsPrintPreferences = true,
            printPrefs = listOf("autoLevel", "flowCal", "timelapse"),
            laneNaming = "tool",
        )

        /**
         * Parses what the RN layer resolved for the active printer. Falls back
         * to [U1] on anything malformed, matching BedProfile.fromJson.
         */
        @JvmStatic
        fun fromJson(json: String?): MachineProfile {
            if (json.isNullOrBlank()) return U1
            return try {
                val obj = JSONObject(json)
                // Accept a bare bed object too, so a JS bundle that predates the
                // slice plumbing still positions the bed correctly.
                val bedJson = if (obj.has("bed")) obj.optJSONObject("bed")?.toString() else json
                MachineProfile(
                    bed = BedProfile.fromJson(bedJson),
                    sliceProfileAsset = with(BedProfile) { obj.optStringOrNull("sliceProfileAsset") },
                    // Absent means an older JS bundle; the U1 was the only
                    // machine then, so its behaviour is the right default.
                    supportsPrintPreferences = obj.optBoolean("supportsPrintPreferences", true),
                    printPrefs = obj.optJSONArray("printPrefs")?.let { arr ->
                      (0 until arr.length()).mapNotNull { arr.optString(it).takeIf(String::isNotBlank) }
                    } ?: emptyList(),
                    // Absent for the same reason, and the U1 names tools.
                    laneNaming = obj.optString("laneNaming", "tool").ifBlank { "tool" },
                )
            } catch (_: Throwable) {
                U1
            }
        }
    }
}
