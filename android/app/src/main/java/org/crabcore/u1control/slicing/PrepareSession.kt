package org.crabcore.u1control.slicing

import com.u1.slicer.NativeLibrary

/**
 * Records the prepare-screen edits (rotate, scale, copies, split, auto-orient,
 * placement, wipe tower, paint) made in [HelixModelPreviewActivity] for the
 * currently shared model.
 *
 * The native engine's model state is wiped every time `loadModel` runs — and
 * `sliceFile` always re-loads. So the preview's edits must be replayed onto the
 * freshly loaded model right before slicing (the same replay-after-reload
 * pattern Taylor's app uses in `startSlicing`). Ops are replayed strictly in
 * the order they were recorded so object indices line up: splits and
 * duplicates change the index space, and later ops were recorded against the
 * post-split/post-dup indices.
 *
 * Callers must hold [NativeEngineGuard.LOCK] around [replay].
 */
object PrepareSession {

  sealed class Op {
    data class SplitObject(val objIdx: Int) : Op()
    data class SplitVolume(val objIdx: Int, val volIdx: Int) : Op()
    data class Duplicate(val objIdx: Int) : Op()
    /** Absolute Euler rotation in degrees (covers manual rotate AND auto-orient results). */
    data class Rotation(val objIdx: Int, val x: Float, val y: Float, val z: Float) : Op()
    /** Absolute per-axis scale factor. */
    data class Scale(val objIdx: Int, val sx: Float, val sy: Float, val sz: Float) : Op()
  }

  @Volatile private var modelPath: String? = null
  private val ops = mutableListOf<Op>()
  @Volatile private var objectPositions: FloatArray? = null

  /** User-dragged wipe tower position (bed mm, lower-left), or null = automatic. */
  @Volatile var towerPosition: Pair<Float, Float>? = null
    private set

  /** Copies of a single-object bed (1 = no copies). Rendered client-side; applied at slice. */
  @Volatile var copyCount: Int = 1
    private set

  /** Bed positions of the copies, flat [x0, y0, ...]; size/2 == copyCount when set. */
  @Volatile private var copyPositions: FloatArray? = null

  /** Painted 3MF written by the paint screen — when set, sliced INSTEAD of the original. */
  @Volatile var paintedFilePath: String? = null
    private set

  /** Starts (or resumes) the session for [path]. A different path clears all recorded state. */
  fun begin(path: String) {
    if (path != modelPath) {
      modelPath = path
      synchronized(ops) { ops.clear() }
      objectPositions = null
      towerPosition = null
      copyCount = 1
      copyPositions = null
      paintedFilePath = null
    }
  }

  fun record(op: Op) {
    synchronized(ops) { ops.add(op) }
  }

  /** Final bed placement, flat [x0, y0, x1, y1, ...] — overwritten on every drag/arrange. */
  fun setPositions(positions: FloatArray) {
    objectPositions = positions.copyOf()
  }

  fun setTowerPosition(x: Float, y: Float) {
    towerPosition = x to y
  }

  /** Slider state for single-object copies. [positions] are the grid/dragged bed spots. */
  fun setCopies(count: Int, positions: FloatArray?) {
    copyCount = count.coerceAtLeast(1)
    copyPositions = positions?.copyOf()
  }

  fun updateCopyPositions(positions: FloatArray) {
    copyPositions = positions.copyOf()
  }

  /**
   * Marks [painted] as the file to slice in place of the session's model. Clears
   * every other recorded edit: the painted 3MF bakes the mesh in world space, so
   * pose/split/copy ops recorded against the original no longer apply.
   */
  fun setPaintedFile(painted: String?) {
    synchronized(ops) { ops.clear() }
    objectPositions = null
    copyCount = 1
    copyPositions = null
    paintedFilePath = painted
  }

  fun hasOps(path: String): Boolean =
    path == modelPath && synchronized(ops) { ops.isNotEmpty() }

  fun hasEdits(path: String): Boolean =
    path == modelPath && (
      synchronized(ops) { ops.isNotEmpty() } ||
        objectPositions != null || copyPositions != null || copyCount > 1
      )

  /** Painted 3MF path to slice instead of [path], or null. */
  fun paintedFileFor(path: String): String? =
    if (path == modelPath) paintedFilePath else null

  /** Wipe tower position override for [path], or null. */
  fun towerPositionFor(path: String): Pair<Float, Float>? =
    if (path == modelPath) towerPosition else null

  /**
   * Re-applies all recorded edits onto a freshly loaded model. No-op when the
   * loaded path differs from the session's. Caller holds NativeEngineGuard.LOCK.
   */
  fun replay(path: String, native: NativeLibrary) {
    if (path != modelPath) return
    val snapshot = synchronized(ops) { ops.toList() }
    for (op in snapshot) {
      when (op) {
        is Op.SplitObject -> native.nativeSplitObject(op.objIdx)
        is Op.SplitVolume -> native.nativeSplitVolume(op.objIdx, op.volIdx)
        is Op.Duplicate -> native.nativeDuplicateObject(op.objIdx)
        is Op.Rotation -> native.nativeSetObjectRotation(op.objIdx, op.x, op.y, op.z)
        is Op.Scale -> native.nativeSetObjectScale(op.objIdx, op.sx, op.sy, op.sz)
      }
    }
    val positions = objectPositions
    if (positions != null && positions.size / 2 == native.nativeGetObjectCount()) {
      native.setObjectPositions(positions)
    }
    // Copies apply only to a single-object bed (multi-object beds use setObjectPositions
    // above; instancing a multi-object model would explode into N x N instances).
    val copies = copyPositions
    if (copyCount > 1 && copies != null && copies.size / 2 == copyCount &&
      native.nativeGetObjectCount() == 1
    ) {
      native.setModelInstances(copies)
    }
  }
}
