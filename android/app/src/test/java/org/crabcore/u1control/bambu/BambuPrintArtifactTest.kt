package org.crabcore.u1control.bambu

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.security.MessageDigest
import java.util.Base64
import java.util.zip.ZipFile

class BambuPrintArtifactTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `build writes firmware-ready project with matching uppercase gcode md5`() {
    val gcode = temporaryFolder.newFile("plate.gcode").apply { writeText(P1S_GCODE) }
    val output = temporaryFolder.root.resolve("safe_job.gcode.3mf")

    val result = BambuPrintArtifact.build(
      gcodeFile = gcode,
      outputFile = output,
      projectSettingsJson = p1sProjectSettings().toString(),
      thumbnailPng = THUMBNAIL,
      metadata = BambuPrintArtifact.Metadata(710, 1.21, "PLA", "#e4bd68"),
    )

    assertEquals(md5(output.readBytes()), result.archiveMd5)
    assertEquals(md5(P1S_GCODE.toByteArray()), result.gcodeMd5)
    assertEquals(
      listOf(
        BambuPrintArtifact.PrintableObject(42, "Bracket & Cap (copy 1)"),
        BambuPrintArtifact.PrintableObject(77, "Bracket & Cap (copy 2)"),
      ),
      result.objects,
    )
    ZipFile(output).use { zip ->
      val names = zip.entries().asSequence().map { it.name }.toSet()
      assertTrue(REQUIRED_ENTRIES.all(names::contains))
      assertEquals(result.gcodeMd5, zip.readText("Metadata/plate_1.gcode.md5"))
      assertEquals(P1S_GCODE, zip.readText("Metadata/plate_1.gcode"))
      assertTrue(zip.readText("Metadata/slice_info.config").contains("printer_model_id\" value=\"C12"))
      assertTrue(zip.readText("Metadata/slice_info.config").contains("color=\"#E4BD68\""))
      assertTrue(zip.readText("Metadata/slice_info.config").contains("identify_id=\"42\" name=\"Bracket &amp; Cap (copy 1)\""))
      assertTrue(zip.readText("Metadata/slice_info.config").contains("identify_id=\"77\" name=\"Bracket &amp; Cap (copy 2)\""))
      assertEquals("Bambu Lab P1S", JSONObject(zip.readText("Metadata/project_settings.config")).getString("printer_model"))
    }
  }

  @Test
  fun `build refuses generic or U1 gcode even when archive settings say P1S`() {
    val gcode = temporaryFolder.newFile("u1.gcode").apply {
      writeText(P1S_GCODE.replace("machine: P1S-0.4", "machine: Snapmaker U1"))
    }

    val error = runCatching {
      BambuPrintArtifact.build(
        gcode,
        temporaryFolder.root.resolve("unsafe.gcode.3mf"),
        p1sProjectSettings().toString(),
        THUMBNAIL,
        BambuPrintArtifact.Metadata(1, 1.0, "PLA", "#FFFFFF"),
      )
    }.exceptionOrNull()

    assertTrue(error is IllegalArgumentException)
    assertTrue(error?.message.orEmpty().contains("P1S profile"))
    assertFalse(temporaryFolder.root.resolve("unsafe.gcode.3mf").exists())
  }

  @Test
  fun `build refuses incomplete project settings and one pixel thumbnails`() {
    val gcode = temporaryFolder.newFile("plate.gcode").apply { writeText(P1S_GCODE) }
    val incomplete = JSONObject()
      .put("printer_model", "Bambu Lab P1S")
      .put("printer_settings_id", "Bambu Lab P1S 0.4 nozzle")
      .put("machine_start_gcode", "; machine: P1S-0.4")

    val settingsError = runCatching {
      BambuPrintArtifact.build(
        gcode,
        temporaryFolder.root.resolve("incomplete.gcode.3mf"),
        incomplete.toString(),
        THUMBNAIL,
        BambuPrintArtifact.Metadata(1, 1.0, "PLA", "#FFFFFF"),
      )
    }.exceptionOrNull()
    assertTrue(settingsError?.message.orEmpty().contains("incomplete"))

    val onePixel = THUMBNAIL.copyOf().apply {
      this[19] = 1
      this[23] = 1
    }
    val thumbnailError = runCatching {
      BambuPrintArtifact.build(
        gcode,
        temporaryFolder.root.resolve("tiny.gcode.3mf"),
        p1sProjectSettings().toString(),
        onePixel,
        BambuPrintArtifact.Metadata(1, 1.0, "PLA", "#FFFFFF"),
      )
    }.exceptionOrNull()
    assertTrue(thumbnailError?.message.orEmpty().contains("larger than 1x1"))
  }

  private fun p1sProjectSettings(): JSONObject = JSONObject().apply {
    repeat(500) { index -> put("verified_setting_$index", index.toString()) }
    put("printer_model", "Bambu Lab P1S")
    put("printer_settings_id", "Bambu Lab P1S 0.4 nozzle")
    put("machine_start_gcode", ";===== machine: P1S-0.4 ========================")
  }

  private fun ZipFile.readText(name: String): String =
    getInputStream(getEntry(name)).bufferedReader().use { it.readText() }

  private fun md5(bytes: ByteArray): String = MessageDigest.getInstance("MD5")
    .digest(bytes)
    .joinToString("") { "%02X".format(it) }

  private companion object {
    const val P1S_GCODE = "; HEADER_BLOCK_START\n; total layer number: 1\n; model label id: 42,77\n; HEADER_BLOCK_END\n; CONFIG_BLOCK_START\n; machine_start_gcode = ;===== machine: P1S-0.4 ========================\n; CONFIG_BLOCK_END\n; EXECUTABLE_BLOCK_START\n; printing object Bracket & Cap id:1 copy 0\n; start printing object, unique label id: 42\nM624 AQ==\nM625\n; printing object Bracket & Cap id:1 copy 1\n; start printing object, unique label id: 77\nM624 Ag==\nM625\n; printing object Bracket & Cap id:1 copy 0\n; start printing object, unique label id: 42\nG28\n"

    val THUMBNAIL: ByteArray = Base64.getDecoder().decode(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAADtGLyqAAAAGUlEQVQIHWNc1RfKyQAETOz8P1l+sXxhBQAmRQSkZjmXUAAAAABJRU5ErkJggg=="
    )

    val REQUIRED_ENTRIES = setOf(
      "[Content_Types].xml",
      "_rels/.rels",
      "3D/3dmodel.model",
      "Metadata/project_settings.config",
      "Metadata/plate_1.json",
      "Metadata/plate_1.gcode.md5",
      "Metadata/plate_1.gcode",
      "Metadata/_rels/model_settings.config.rels",
      "Metadata/model_settings.config",
      "Metadata/slice_info.config",
      "Metadata/plate_1.png",
      "Metadata/plate_1_small.png",
      "Metadata/plate_no_light_1.png",
      "Metadata/top_1.png",
      "Metadata/pick_1.png",
    )
  }
}
