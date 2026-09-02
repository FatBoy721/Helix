package org.crabcore.u1control.slicing

import com.u1.slicer.data.SliceResult

/** Last successful slice — lets the RN Slice Lab tab offer upload/print after
 *  slicing from the native prepare screen (which never calls back into JS).
 *
 *  Also keeps the sliceSettings + materialProfiles JSON so a background
 *  re-slice (e.g. "print this in a different loaded filament") can replay the
 *  exact prepare-screen overrides and material temperatures. */
object LastSliceStore {
  @Volatile var modelPath: String? = null
  @Volatile var gcodePath: String? = null
  @Volatile var totalLayers: Int = 0
  @Volatile var estimatedTimeSeconds: Float = 0f
  @Volatile var estimatedFilamentGrams: Float = 0f
  @Volatile var initialTool: Int = 0
  @Volatile var usedToolMask: Int = 1
  @Volatile var sliceSettingsJson: String? = null
  @Volatile var materialProfilesJson: String? = null
  @Volatile private var bambuSendRequested: Boolean = false

  /** One-shot handoff from the native preview to the RN Bambu send dialog. */
  @Synchronized
  fun requestBambuSend() {
    bambuSendRequested = true
  }

  @Synchronized
  fun takeBambuSendRequest(): Boolean {
    val requested = bambuSendRequested
    bambuSendRequested = false
    return requested
  }

  fun record(
    model: String,
    result: SliceResult,
    initialTool: Int = 0,
    usedToolMask: Int = 1,
    sliceSettingsJson: String? = null,
    materialProfilesJson: String? = null,
  ) {
    if (!result.success || result.gcodePath.isBlank()) return
    modelPath = model
    gcodePath = result.gcodePath
    totalLayers = result.totalLayers
    estimatedTimeSeconds = result.estimatedTimeSeconds
    estimatedFilamentGrams = result.estimatedFilamentGrams
    this.initialTool = initialTool
    this.usedToolMask = usedToolMask
    this.sliceSettingsJson = sliceSettingsJson
    this.materialProfilesJson = materialProfilesJson
  }

  fun clear() {
    modelPath = null
    gcodePath = null
    totalLayers = 0
    estimatedTimeSeconds = 0f
    estimatedFilamentGrams = 0f
    initialTool = 0
    usedToolMask = 1
    sliceSettingsJson = null
    materialProfilesJson = null
    bambuSendRequested = false
  }
}
