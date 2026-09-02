package org.crabcore.u1control.slicing

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GcodeToolMapperTest {
  /** The Snapmaker U1's 270mm bed, which these cases were written against. */
  private val U1_BED = 270f

  @Test
  fun shiftsOutOfBoundsMeshWithoutCollapsingItsSpan() {
    withGcode("BED_MESH_CALIBRATE mesh_min=-2,-2 mesh_max=1,1 ADAPTIVE=1") { file ->
      val result = GcodeToolMapper.clampBedMeshBounds(file.toString(), U1_BED, U1_BED)

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
      val result = GcodeToolMapper.clampBedMeshBounds(file.toString(), U1_BED, U1_BED)

      assertTrue(result.success)
      assertFalse(result.rewritten)
      assertEquals("$gcode\n", readText(file))
    }
  }

  @Test
  fun failsClosedForCollapsedOrReversedBounds() {
    val gcode = "BED_MESH_CALIBRATE mesh_min=20,20 mesh_max=20,10 ADAPTIVE=1"
    withGcode(gcode) { file ->
      val result = GcodeToolMapper.clampBedMeshBounds(file.toString(), U1_BED, U1_BED)

      assertFalse(result.success)
      assertFalse(result.rewritten)
      assertEquals("$gcode\n", readText(file))
    }
  }

  @Test
  fun acceptsDefaultMeshCommandWithoutAdaptiveBounds() {
    val gcode = "BED_MESH_CALIBRATE"
    withGcode(gcode) { file ->
      val result = GcodeToolMapper.clampBedMeshBounds(file.toString(), U1_BED, U1_BED)

      assertTrue(result.success)
      assertFalse(result.rewritten)
      assertEquals("$gcode\n", readText(file))
    }
  }

  @Test
  fun clampsToASmallerBedRatherThanTheU1() {
    // 3..217 on a 220mm AD5X. Under the old hardcoded 3..267 this line was
    // considered safe and the printer would probe well past its own bed.
    withGcode("BED_MESH_CALIBRATE mesh_min=3,3 mesh_max=260,260 ADAPTIVE=1") { file ->
      val result = GcodeToolMapper.clampBedMeshBounds(file.toString(), 220f, 220f)

      assertTrue(result.success)
      assertTrue(result.rewritten)
      assertEquals(
        "BED_MESH_CALIBRATE mesh_min=3.00000,3.00000 mesh_max=217.00000,217.00000 ADAPTIVE=1\n",
        readText(file),
      )
    }
  }

  @Test
  fun boundsSafeOnTheU1CanStillBeUnsafeOnASmallerBed() {
    // Same input, two machines: untouched at 270, clamped at 220.
    val gcode = "BED_MESH_CALIBRATE mesh_min=3,4 mesh_max=260,267 ADAPTIVE=1"
    withGcode(gcode) { file ->
      assertFalse(GcodeToolMapper.clampBedMeshBounds(file.toString(), U1_BED, U1_BED).rewritten)
    }
    withGcode(gcode) { file ->
      assertTrue(GcodeToolMapper.clampBedMeshBounds(file.toString(), 220f, 220f).rewritten)
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
