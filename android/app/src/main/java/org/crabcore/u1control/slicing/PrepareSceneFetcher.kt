package org.crabcore.u1control.slicing

import com.u1.slicer.NativeLibrary
import com.u1.slicer.viewer.MeshData
import com.u1.slicer.viewer.NativeRenderBatch
import java.nio.ByteOrder

/**
 * Builds a [MeshData] from the native prepare render scene of the currently
 * loaded model. Shared by the prepare screen and the paint screen.
 *
 * Caller must hold [NativeEngineGuard.LOCK] and have loaded a model.
 */
object PrepareSceneFetcher {

  fun fetch(lib: NativeLibrary): MeshData {
    val sceneHandle = lib.buildPrepareRenderScene()
    if (sceneHandle == 0L) {
      throw IllegalStateException("Native engine returned no preview scene.")
    }

    val batches = mutableListOf<NativeRenderBatch>()
    try {
      while (true) {
        val batchCount = lib.nativeGetPrepareRenderSceneBatchCount(sceneHandle)
        val complete = lib.nativeIsPrepareRenderSceneComplete(sceneHandle)

        while (batches.size < batchCount) {
          val index = batches.size
          val triangleCount = lib.nativeGetPrepareRenderSceneTriangleCount(sceneHandle, index)
          val geometry = lib.nativeGetPrepareRenderSceneGeometryBuffer(sceneHandle, index)
          if (triangleCount <= 0 || geometry == null) break

          val material = lib.nativeGetPrepareRenderSceneMaterialBuffer(sceneHandle, index)
          geometry.order(ByteOrder.nativeOrder())
          material?.order(ByteOrder.nativeOrder())
          batches.add(
            NativeRenderBatch(
              geometry.asFloatBuffer(),
              material,
              triangleCount,
              lib.nativeGetPrepareRenderSceneBoundingBox(sceneHandle, index),
            ),
          )
        }

        if (complete && batches.size >= batchCount) break
        Thread.sleep(16)
      }

      if (batches.isEmpty()) {
        throw IllegalStateException("No preview geometry was returned.")
      }

      val bounds = calculateBounds(batches)
      val batchRanges = mutableListOf<IntRange>()
      var start = 0
      for (batch in batches) {
        batchRanges.add(start until (start + batch.triangleCount))
        start += batch.triangleCount
      }
      val modifierStart = lib.nativeGetPreviewModifierBlockStart()

      return MeshData(
        batches = batches.toList(),
        minX = bounds[0],
        minY = bounds[1],
        minZ = bounds[2],
        maxX = bounds[3],
        maxY = bounds[4],
        maxZ = bounds[5],
        batchRanges = batchRanges,
        modifierBlockStartTriangle = if (modifierStart >= 0) modifierStart else null,
        sceneHandle = sceneHandle,
      )
    } catch (error: Throwable) {
      runCatching { lib.nativeReleasePrepareRenderScene(sceneHandle) }
      throw error
    }
  }

  private fun calculateBounds(batches: List<NativeRenderBatch>): FloatArray {
    var minX = Float.MAX_VALUE
    var minY = Float.MAX_VALUE
    var minZ = Float.MAX_VALUE
    var maxX = -Float.MAX_VALUE
    var maxY = -Float.MAX_VALUE
    var maxZ = -Float.MAX_VALUE

    for (batch in batches) {
      val nativeBounds = batch.bounds
      if (nativeBounds != null && nativeBounds.size == 6) {
        minX = minOf(minX, nativeBounds[0])
        minY = minOf(minY, nativeBounds[1])
        minZ = minOf(minZ, nativeBounds[2])
        maxX = maxOf(maxX, nativeBounds[3])
        maxY = maxOf(maxY, nativeBounds[4])
        maxZ = maxOf(maxZ, nativeBounds[5])
        continue
      }

      val buffer = batch.geometry
      for (vertex in 0 until batch.triangleCount * 3) {
        val base = vertex * MeshData.FLOATS_PER_VERTEX
        val x = buffer.get(base)
        val y = buffer.get(base + 1)
        val z = buffer.get(base + 2)
        minX = minOf(minX, x)
        minY = minOf(minY, y)
        minZ = minOf(minZ, z)
        maxX = maxOf(maxX, x)
        maxY = maxOf(maxY, y)
        maxZ = maxOf(maxZ, z)
      }
    }

    return floatArrayOf(minX, minY, minZ, maxX, maxY, maxZ)
  }
}
