package org.crabcore.u1control.bambu

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.Base64
import java.util.zip.ZipFile

class BambuPrintUploadTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `upload packages verified single-tool gcode before FTPS transfer`() {
    val gcode = gcodeWithThumbnail()
    var transferCalled = false
    val subject = BambuPrintUpload(temporaryFolder.root, projectSettings()) { config, artifact, remote ->
      transferCalled = true
      assertEquals("192.0.2.1", config.host)
      assertEquals("safe_job.gcode.3mf", remote)
      ZipFile(artifact).use { zip ->
        assertTrue(zip.getEntry("Metadata/plate_1.gcode") != null)
        assertEquals(THUMBNAIL.toList(), zip.getInputStream(zip.getEntry("Metadata/plate_1.png")).readBytes().toList())
      }
      BambuFtpsUploadResult(remote, artifact.length())
    }

    val result = subject.upload(request(gcode))

    assertTrue(transferCalled)
    assertEquals("safe_job.gcode.3mf", result.remoteName)
    assertTrue(result.archiveMd5.matches(Regex("[0-9A-F]{32}")))
    assertFalse(temporaryFolder.root.listFiles().orEmpty().any { it.name.endsWith(".gcode.3mf") })
  }

  @Test
  fun `A1 serial selects A1 settings and N2S archive metadata`() {
    val gcode = gcodeWithThumbnail(A1_PREFIX, "a1.gcode")
    var selectedSerial = ""
    val subject = BambuPrintUpload(
      temporaryFolder.root,
      { serial ->
        selectedSerial = serial
        a1ProjectSettings()
      },
      { config, artifact, remote ->
        assertEquals("03900A000000001", config.serial)
        ZipFile(artifact).use { zip ->
          val project = JSONObject(zip.readText("Metadata/project_settings.config"))
          assertEquals("Bambu Lab A1", project.getString("printer_model"))
          assertTrue(zip.readText("Metadata/slice_info.config").contains("value=\"N2S\""))
        }
        BambuFtpsUploadResult(remote, artifact.length())
      },
    )

    subject.upload(request(gcode).copy(serial = "03900A000000001"))

    assertEquals("03900A000000001", selectedSerial)
  }

  @Test
  fun `A1 settings reject P1S gcode before transfer`() {
    val gcode = gcodeWithThumbnail(P1S_PREFIX, "wrong-model.gcode")
    var transferCalled = false
    val subject = BambuPrintUpload(temporaryFolder.root, { a1ProjectSettings() }) { _, _, _ ->
      transferCalled = true
      error("must not upload")
    }

    val error = runCatching {
      subject.upload(request(gcode).copy(serial = "03900A000000001"))
    }.exceptionOrNull()

    assertTrue(error?.message.orEmpty().contains("Bambu Lab A1 profile"))
    assertFalse(transferCalled)
  }

  @Test
  fun `upload refuses remapped or multicolor tool masks before transfer`() {
    val gcode = gcodeWithThumbnail()
    var transferCalled = false
    val subject = BambuPrintUpload(temporaryFolder.root, projectSettings()) { _, _, _ ->
      transferCalled = true
      error("must not upload")
    }

    for (mask in listOf(0, 2, 3, 15)) {
      val error = runCatching { subject.upload(request(gcode).copy(usedToolMask = mask)) }.exceptionOrNull()
      assertTrue(error?.message.orEmpty().contains("tool 0"))
    }
    assertFalse(transferCalled)
  }

  @Test
  fun `upload refuses missing thumbnails before transfer`() {
    val gcode = temporaryFolder.newFile("no-preview.gcode").apply { writeText(P1S_PREFIX + "G28\n") }
    var transferCalled = false
    val subject = BambuPrintUpload(temporaryFolder.root, projectSettings()) { _, _, _ ->
      transferCalled = true
      error("must not upload")
    }

    val error = runCatching { subject.upload(request(gcode)) }.exceptionOrNull()

    assertTrue(error?.message.orEmpty().contains("preview"))
    assertFalse(transferCalled)
  }

  private fun gcodeWithThumbnail(
    prefix: String = P1S_PREFIX,
    name: String = "plate.gcode",
  ): File {
    val encoded = Base64.getEncoder().encodeToString(THUMBNAIL)
    return temporaryFolder.newFile(name).apply {
      writeText("$prefix; thumbnail begin 2x2 ${encoded.length}\n; $encoded\n; thumbnail end\nG28\n")
    }
  }

  private fun request(gcode: File) = BambuPrintUpload.Request(
    host = "192.0.2.1",
    serial = "01P00A000000001",
    accessCode = "12345678",
    gcodeFile = gcode,
    remoteName = "safe_job.gcode.3mf",
    usedToolMask = 1,
    predictionSeconds = 710,
    weightGrams = 1.21,
    filamentType = "PLA",
    filamentColor = "#E4BD68",
  )

  private fun projectSettings(): String = JSONObject().apply {
    repeat(500) { put("verified_setting_$it", it.toString()) }
    put("printer_model", "Bambu Lab P1S")
    put("printer_settings_id", "Bambu Lab P1S 0.4 nozzle")
    put("machine_start_gcode", ";===== machine: P1S-0.4 ========================")
  }.toString()

  private fun a1ProjectSettings(): String = JSONObject().apply {
    repeat(500) { put("verified_setting_$it", it.toString()) }
    put("printer_model", "Bambu Lab A1")
    put("printer_settings_id", "Bambu Lab A1 0.4 nozzle")
    put("machine_start_gcode", ";===== machine: A1 =========================")
  }.toString()

  private fun ZipFile.readText(name: String): String =
    getInputStream(getEntry(name)).bufferedReader().use { it.readText() }

  private companion object {
    const val P1S_PREFIX = "; HEADER_BLOCK_START\n; HEADER_BLOCK_END\n; CONFIG_BLOCK_START\n; machine_start_gcode = ;===== machine: P1S-0.4 ========================\n; CONFIG_BLOCK_END\n; EXECUTABLE_BLOCK_START\n"
    const val A1_PREFIX = "; HEADER_BLOCK_START\n; HEADER_BLOCK_END\n; CONFIG_BLOCK_START\n; machine_start_gcode = ;===== machine: A1 =========================\n; CONFIG_BLOCK_END\n; EXECUTABLE_BLOCK_START\n"
    val THUMBNAIL: ByteArray = Base64.getDecoder().decode(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAADtGLyqAAAAGUlEQVQIHWNc1RfKyQAETOz8P1l+sXxhBQAmRQSkZjmXUAAAAABJRU5ErkJggg=="
    )
  }
}
