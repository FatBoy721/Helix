package org.crabcore.u1control.slicing

import com.u1.slicer.data.SliceResult

/** Last successful slice — lets the RN Slice Lab tab offer upload/print after
 *  slicing from the native prepare screen (which never calls back into JS). */
object LastSliceStore {
  @Volatile var modelPath: String? = null
  @Volatile var gcodePath: String? = null
  @Volatile var totalLayers: Int = 0
  @Volatile var estimatedTimeSeconds: Float = 0f
  @Volatile var estimatedFilamentGrams: Float = 0f
  @Volatile var initialTool: Int = 0
  @Volatile var usedToolMask: Int = 1

  fun record(model: String, result: SliceResult, initialTool: Int = 0, usedToolMask: Int = 1) {
    if (!result.success || result.gcodePath.isBlank()) return
    modelPath = model
    gcodePath = result.gcodePath
    totalLayers = result.totalLayers
    estimatedTimeSeconds = result.estimatedTimeSeconds
    estimatedFilamentGrams = result.estimatedFilamentGrams
    this.initialTool = initialTool
    this.usedToolMask = usedToolMask
  }

  fun clear() {
    modelPath = null
    gcodePath = null
    totalLayers = 0
    estimatedTimeSeconds = 0f
    estimatedFilamentGrams = 0f
    initialTool = 0
    usedToolMask = 1
  }
}
