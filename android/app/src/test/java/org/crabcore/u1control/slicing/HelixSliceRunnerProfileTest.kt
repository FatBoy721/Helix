package org.crabcore.u1control.slicing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HelixSliceRunnerProfileTest {
  @Test
  fun `P1S startup uses the official pre independent-purge variables`() {
    val current = """
      G28
      M620.1 E F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60} T{flush_temperatures[initial_no_support_extruder]}
      G90
    """.trimIndent()

    val compatible = HelixSliceRunner.compatibleMachineStartGcode("bambu_p1s.json", current)

    assertFalse(compatible.contains("flush_volumetric_speeds"))
    assertFalse(compatible.contains("flush_temperatures"))
    assertTrue(
      compatible.contains(
        "M620.1 E F{filament_max_volumetric_speed[initial_extruder]/2.4053*60} " +
          "T{nozzle_temperature_range_high[initial_extruder]}",
      ),
    )
    assertEquals(3, compatible.lineSequence().count())
  }

  @Test
  fun `A1 startup uses the official pre independent-purge variables`() {
    val current = """
      G28 X
      M620.1 E F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60} T{flush_temperatures[initial_no_support_extruder]}
      M109 S{flush_temperatures[initial_no_support_extruder]} H300
      G90
    """.trimIndent()

    val compatible = HelixSliceRunner.compatibleMachineStartGcode("bambu_a1.json", current)

    assertFalse(compatible.contains("flush_volumetric_speeds"))
    assertFalse(compatible.contains("flush_temperatures"))
    assertTrue(
      compatible.contains(
        "M620.1 E F{filament_max_volumetric_speed[initial_no_support_extruder]/2.4053*60} " +
          "T{nozzle_temperature_range_high[initial_no_support_extruder]}",
      ),
    )
    assertTrue(
      compatible.contains(
        "M109 S{nozzle_temperature_range_high[initial_no_support_extruder]} H300",
      ),
    )
    assertEquals(4, compatible.lineSequence().count())
  }

  @Test
  fun `compatibility substitution is Bambu-only`() {
    val current =
      "M620.1 E F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60} " +
        "T{flush_temperatures[initial_no_support_extruder]}"

    assertEquals(
      current,
      HelixSliceRunner.compatibleMachineStartGcode("snapmaker_u1.json", current),
    )
    assertEquals(
      current,
      HelixSliceRunner.compatibleMachineStartGcode("flashforge_ad5x.json", current),
    )
  }

  @Test
  fun `Bambu trusts actual mesh use over the installed preset list`() {
    assertTrue(HelixSliceRunner.isSingleMaterialBambu("bambu_p1s.json", listOf(3)))
    assertTrue(HelixSliceRunner.isSingleMaterialBambu("bambu_a1.json", listOf(3, 3)))
    assertFalse(HelixSliceRunner.isSingleMaterialBambu("bambu_p1s.json", listOf(0, 3)))
    assertFalse(HelixSliceRunner.isSingleMaterialBambu("bambu_a1.json", emptyList()))
  }

  @Test
  fun `single-material inference cannot change other printers`() {
    assertFalse(HelixSliceRunner.isSingleMaterialBambu("snapmaker_u1.json", listOf(3)))
    assertFalse(HelixSliceRunner.isSingleMaterialBambu("flashforge_ad5x.json", listOf(3)))
    assertFalse(HelixSliceRunner.isSingleMaterialBambu(null, listOf(3)))
  }
}
