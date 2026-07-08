package com.u1.slicer

import com.u1.slicer.data.SliceConfig
import com.u1.slicer.data.SliceResult

/**
 * JNI surface for the Helix slice proof.
 *
 * The prebuilt slicer library (libprusaslicer-jni.so from u1-slicer-for-android)
 * exports symbols for com.u1.slicer.NativeLibrary, so this package/class name must
 * stay unchanged unless the native library is rebuilt.
 *
 * Native → Kotlin callback: during slice() the native code looks up
 * onSliceProgress(ILjava/lang/String;)V on this instance (slicer_wrapper.cpp:185)
 * and calls it with (percentage, stage). The method and signature must exist.
 *
 * Output: the engine writes <dir-of-loaded-model>/output.gcode (sapil_print.cpp:1377,
 * g_files_dir is derived from the loadModel path) and returns it in SliceResult.gcodePath.
 */
class NativeLibrary {
  companion object {
    var loadError: String? = null
      private set

    val isLoaded: Boolean = try {
      System.loadLibrary("c++_shared")
      System.loadLibrary("prusaslicer-jni")
      true
    } catch (error: Throwable) {
      loadError = "${error::class.java.simpleName}: ${error.message}"
      false
    }
  }

  // ---- Core ----
  external fun getCoreVersion(): String

  // ---- Model lifecycle ----
  /** Loads an STL or 3MF from an absolute filesystem path. */
  external fun loadModel(path: String): Boolean

  external fun clearModel()

  // ---- 3D preview scene ----
  external fun buildPrepareRenderScene(maxTriangles: Int = 0): Long
  external fun nativeGetPrepareRenderSceneBatchCount(handle: Long): Int
  external fun nativeIsPrepareRenderSceneComplete(handle: Long): Boolean
  external fun nativeGetPrepareRenderSceneTriangleCount(handle: Long, batchIndex: Int): Int
  external fun nativeGetPrepareRenderSceneGeometryBuffer(handle: Long, batchIndex: Int): java.nio.ByteBuffer?
  external fun nativeGetPrepareRenderSceneMaterialBuffer(handle: Long, batchIndex: Int): java.nio.ByteBuffer?
  external fun nativeGetPrepareRenderSceneBoundingBox(handle: Long, batchIndex: Int): FloatArray?
  external fun nativeGetPreviewModifierBlockStart(): Int
  external fun nativeReleasePrepareRenderScene(handle: Long): Boolean

  /** Cancels an in-progress native slice (CanceledException at next checkpoint). */
  external fun cancelSlice()

  // ---- Objects on the plate ----
  /** Count of ModelObjects in the loaded model. 0 when nothing is loaded. */
  external fun nativeGetObjectCount(): Int

  /** Flat [sizeX0, sizeY0, sizeZ0, sizeX1, ...] per object (post-scale/rotation, no offset). */
  external fun getObjectBoundingBoxes(): FloatArray

  /** Per-object world-space AABB min as flat [minX0, minY0, minX1, minY1, ...]. */
  external fun nativeGetObjectWorldAABBMins(): FloatArray

  /** Set per-object XY lower-left positions [x0, y0, x1, y1, ...]; size/2 must equal object count. */
  external fun setObjectPositions(positions: FloatArray): Boolean

  /** Display name for the object. Empty/null when no model loaded or index out of range. */
  external fun nativeGetObjectName(objIdx: Int): String?

  /** Count of ModelVolumes on objects[objIdx]. Returns 0 for out-of-range. */
  external fun nativeGetVolumeCount(objectIndex: Int): Int

  /** True iff volume.is_splittable() — probe for Split-to-Parts. */
  external fun nativeIsVolumeSplittable(objIdx: Int, volIdx: Int): Boolean

  /** Split one volume into multiple volumes within the same object. Returns new volume count or -1. */
  external fun nativeSplitVolume(objIdx: Int, volIdx: Int): Int

  /** Replace instances of the (single) model with copies at [x0, y0, x1, y1, ...] bed positions. */
  external fun setModelInstances(positions: FloatArray): Boolean

  // ---- Per-object pose ----
  /** Set instances[0] rotation for one object. Angles in degrees, Euler XYZ. */
  external fun nativeSetObjectRotation(objIdx: Int, x: Float, y: Float, z: Float): Boolean

  /** Get instances[0] rotation as [x, y, z] degrees. */
  external fun nativeGetObjectRotation(objIdx: Int): FloatArray

  /** Set instances[0] per-axis scale factor for one object. */
  external fun nativeSetObjectScale(objIdx: Int, sx: Float, sy: Float, sz: Float): Boolean

  /** Get instances[0] per-axis scale factor as [sx, sy, sz]. */
  external fun nativeGetObjectScale(objIdx: Int): FloatArray

  // ---- Copies / split / auto-orient ----
  /** Deep-copy object [objIdx]; returns the new object's index or -1. */
  external fun nativeDuplicateObject(objIdx: Int): Int

  /** True iff the object has more than one connected part (Split to Objects works). */
  external fun nativeIsObjectSplittable(objIdx: Int): Boolean

  /** Split object into connected components. Returns [removedIdx, addedCount] or null. */
  external fun nativeSplitObject(objIdx: Int): IntArray?

  /** Auto-orient one object onto a stable face. Returns new Euler [x,y,z] radians or null. */
  external fun nativeAutoOrientObject(objIdx: Int): DoubleArray?

  /** Auto-orient every object. Returns count of oriented objects. */
  external fun nativeAutoOrientAll(): Int

  // ---- Project config (filament colours etc.) ----
  /** JSON: { isBbl, fileVersion, filamentColours: ["#RRGGBB",...], ... } or null. */
  external fun nativeGetProjectConfig(): String?

  // ---- Slicing ----
  /** Runs the full slice; returns null or SliceResult (success/cancelled/error). */
  external fun slice(config: SliceConfig): SliceResult?

  // ---- Progress callback (invoked FROM native code during slice) ----
  var progressListener: ((Int, String) -> Unit)? = null

  fun onSliceProgress(percentage: Int, stage: String) {
    progressListener?.invoke(percentage, stage)
  }
}
