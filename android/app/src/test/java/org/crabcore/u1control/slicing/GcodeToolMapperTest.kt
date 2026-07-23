package org.crabcore.u1control.slicing

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GcodeToolMapperTest {
  @Test
  fun shiftsOutOfBoundsMeshWithoutCollapsingItsSpan() {
    withGcode("BED_MESH_CALIBRATE mesh_min=-2,-2 mesh_max=1,1 ADAPTIVE=1") { file ->
      val result = GcodeToolMapper.clampU1BedMeshBounds(file.toString())

      assertTrue(result.success)
      assertTrue(result.rewritten)
      assertEquals(
        "BED_MESH_CALIBRATE mesh_min=3.00000,3.00000 mesh_max=6.00000,6.00000 ADAPTIVE=1\n",
        readText(file),
      )
    }
  }

  @Test
  fun leavesSafeBoundsUntouched() {
    val gcode = "BED_MESH_CALIBRATE mesh_min=3,4 mesh_max=260,267 ADAPTIVE=1"
    withGcode(gcode) { file ->
      val result = GcodeToolMapper.clampU1BedMeshBounds(file.toString())

      assertTrue(result.success)
      assertFalse(result.rewritten)
      assertEquals("$gcode\n", readText(file))
    }
  }

  @Test
  fun failsClosedForCollapsedOrReversedBounds() {
    val gcode = "BED_MESH_CALIBRATE mesh_min=20,20 mesh_max=20,10 ADAPTIVE=1"
    withGcode(gcode) { file ->
      val result = GcodeToolMapper.clampU1BedMeshBounds(file.toString())

      assertFalse(result.success)
      assertFalse(result.rewritten)
      assertEquals("$gcode\n", readText(file))
    }
  }

  @Test
  fun acceptsDefaultMeshCommandWithoutAdaptiveBounds() {
    val gcode = "BED_MESH_CALIBRATE"
    withGcode(gcode) { file ->
      val result = GcodeToolMapper.clampU1BedMeshBounds(file.toString())

      assertTrue(result.success)
      assertFalse(result.rewritten)
      assertEquals("$gcode\n", readText(file))
    }
  }

  private fun withGcode(contents: String, block: (java.nio.file.Path) -> Unit) {
    val file = Files.createTempFile("helix-bed-mesh-", ".gcode")
    try {
      Files.write(file, "$contents\n".toByteArray(Charsets.UTF_8))
      block(file)
    } finally {
      Files.deleteIfExists(file)
    }
  }

  private fun readText(file: java.nio.file.Path): String =
    String(Files.readAllBytes(file), Charsets.UTF_8)
}
