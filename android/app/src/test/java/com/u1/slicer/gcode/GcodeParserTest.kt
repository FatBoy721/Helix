package com.u1.slicer.gcode

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Test

class GcodeParserTest {
  @Test
  fun bambuMachineToolCodesDoNotReplaceThePrintableFilament() {
    withGcode(
      """
      M83
      T0
      T1000
      G1 X10 Y0 E1
      T255
      G1 X20 Y0 E1
      """.trimIndent(),
    ) { file ->
      val extruders = GcodeParser.parse(file).layers
        .flatMap { it.moves }
        .filter { it.type == MoveType.EXTRUDE }
        .map { it.extruder }

      assertEquals(listOf(0, 0), extruders)
    }
  }

  @Test
  fun legitimateMultiDigitFilamentIndicesStillWork() {
    withGcode(
      """
      M83
      T10
      G1 X10 Y0 E1
      """.trimIndent(),
    ) { file ->
      val extrusion = GcodeParser.parse(file).layers
        .flatMap { it.moves }
        .single { it.type == MoveType.EXTRUDE }

      assertEquals(10, extrusion.extruder)
    }
  }

  private fun withGcode(contents: String, block: (java.io.File) -> Unit) {
    val path = Files.createTempFile("helix-gcode-parser-", ".gcode")
    try {
      Files.write(path, contents.toByteArray())
      block(path.toFile())
    } finally {
      Files.deleteIfExists(path)
    }
  }
}
