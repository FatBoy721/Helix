package org.crabcore.u1control.slicing

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KlipperGcodeCompatibilityTest {
  @Test
  fun translatesMarlinLimitsAndStripsM486ForOptedInKlipperProfile() {
    val gcode = """
      ; generated machine limits
      M201 X12000 Y10000 Z500 E5000
      M203 X500 Y450 Z30 E30
      M205 X10 Y8 Z2 E2
      M486 S0
      G1 X10 Y10 F12000
      M486 S-1
    """.trimIndent()

    withGcode(gcode) { file ->
      val result = KlipperGcodeCompatibility.apply(
        file.toString(),
        translateMarlinMachineLimits = true,
        stripM486 = true,
      )

      assertTrue(result.success)
      assertTrue(result.rewritten)
      assertEquals(3, result.translatedLimits)
      assertEquals(2, result.strippedCommands)
      assertEquals(
        """
          ; generated machine limits
          SET_VELOCITY_LIMIT ACCEL=10000 ; Helix translated M201
          SET_VELOCITY_LIMIT VELOCITY=450 ; Helix translated M203
          SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=5.65685 ; Helix translated M205
          G1 X10 Y10 F12000
        """.trimIndent() + "\n",
        readText(file),
      )
    }
  }

  @Test
  fun leavesU1BytesUntouchedWhenProfileDoesNotOptIn() {
    val bytes = "; U1\r\nM201 X10000 Y10000\r\nM486 S0\r\n".toByteArray(Charsets.UTF_8)
    val file = Files.createTempFile("helix-u1-gcode-", ".gcode")
    try {
      Files.write(file, bytes)

      val result = KlipperGcodeCompatibility.apply(
        file.toString(),
        translateMarlinMachineLimits = false,
        stripM486 = false,
      )

      assertTrue(result.success)
      assertFalse(result.rewritten)
      assertTrue(bytes.contentEquals(Files.readAllBytes(file)))
    } finally {
      Files.deleteIfExists(file)
    }
  }

  @Test
  fun optionsAreIndependentAndCommentsAreNeverCommands() {
    val gcode = """
      ; M486 S0
      M201 X9000 Y8000
      M486 S1
      M204 S5000
    """.trimIndent()

    withGcode(gcode) { file ->
      val result = KlipperGcodeCompatibility.apply(
        file.toString(),
        translateMarlinMachineLimits = false,
        stripM486 = true,
      )

      assertTrue(result.success)
      assertEquals(0, result.translatedLimits)
      assertEquals(1, result.strippedCommands)
      assertEquals(
        "; M486 S0\nM201 X9000 Y8000\nM204 S5000\n",
        readText(file),
      )
    }
  }

  @Test
  fun stripsMalformedTargetLimitInsteadOfSendingAnUnknownCommand() {
    withGcode("M201 Z500 E1000") { file ->
      val result = KlipperGcodeCompatibility.apply(
        file.toString(),
        translateMarlinMachineLimits = true,
        stripM486 = false,
      )

      assertTrue(result.success)
      assertTrue(result.rewritten)
      assertEquals(0, result.translatedLimits)
      assertEquals(1, result.strippedCommands)
      assertEquals("", readText(file))
    }
  }

  private fun withGcode(contents: String, block: (java.nio.file.Path) -> Unit) {
    val file = Files.createTempFile("helix-klipper-compat-", ".gcode")
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
