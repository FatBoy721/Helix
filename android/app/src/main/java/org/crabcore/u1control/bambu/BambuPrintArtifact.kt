package org.crabcore.u1control.bambu

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Builds the sliced project archive consumed by Bambu's `project_file` command.
 *
 * The archive layout follows BambuStudio output and the independently
 * hardware-tested MIT-licensed bambox packer. This builder deliberately does
 * not translate generic G-code: it accepts only output that already contains
 * Bambu's header blocks and a machine marker matching the bundled project
 * settings. Wrapping U1 or another model's G-code in a Bambu-looking ZIP would
 * send unsafe commands to hardware.
 */
object BambuPrintArtifact {
  private const val GCODE_ENTRY = "Metadata/plate_1.gcode"
  private const val MIN_PROJECT_SETTING_KEYS = 500
  private const val COPY_BUFFER_SIZE = 64 * 1024

  private enum class Target(
    val modelName: String,
    val settingsToken: String,
    val machineMarker: String,
    val modelId: String,
  ) {
    P1S("Bambu Lab P1S", "P1S", "machine: P1S-0.4", "C12"),
    // Trailing separators prevent the A1 marker from accepting "A1 mini".
    A1("Bambu Lab A1", "A1", "machine: A1 ===", "N2S"),
  }

  data class Metadata(
    val predictionSeconds: Int,
    val weightGrams: Double,
    val filamentType: String,
    val filamentColor: String,
    val nozzleDiameter: Double = 0.4,
  )

  data class Result(
    val file: File,
    val archiveMd5: String,
    val gcodeMd5: String,
    val objects: List<PrintableObject>,
  )

  data class PrintableObject(
    val identifyId: Int,
    val name: String,
  )

  fun build(
    gcodeFile: File,
    outputFile: File,
    projectSettingsJson: String,
    thumbnailPng: ByteArray,
    metadata: Metadata,
  ): Result {
    require(gcodeFile.isFile && gcodeFile.length() > 0L) { "Sliced G-code is missing or empty" }
    require(outputFile.name.endsWith(".gcode.3mf", ignoreCase = true)) {
      "Bambu print artifacts must end in .gcode.3mf"
    }
    require(!outputFile.exists()) { "Refusing to overwrite an existing Bambu print artifact" }
    requireValidThumbnail(thumbnailPng)
    val (projectSettings, target) = validatedProjectSettings(projectSettingsJson)
    requireValidGcode(gcodeFile, target)
    val cleanMetadata = validateMetadata(metadata)
    val printableObjects = extractPrintableObjects(gcodeFile)

    outputFile.parentFile?.mkdirs()
    val partial = File(outputFile.parentFile, ".${outputFile.name}.partial")
    check(!partial.exists() || partial.delete()) { "Could not clear stale Bambu artifact staging file" }
    val gcodeMd5 = md5(gcodeFile)

    try {
      ZipOutputStream(FileOutputStream(partial).buffered()).use { zip ->
        zip.writeText("[Content_Types].xml", CONTENT_TYPES_XML)
        zip.writeText("_rels/.rels", RELATIONSHIPS_XML)
        zip.writeText("3D/3dmodel.model", MODEL_XML)
        zip.writeText("Metadata/project_settings.config", projectSettings.toString(2) + "\n")
        zip.writeText("Metadata/plate_1.json", plateJson(cleanMetadata).toString())
        zip.writeText("Metadata/plate_1.gcode.md5", gcodeMd5)
        zip.putNextEntry(ZipEntry(GCODE_ENTRY))
        BufferedInputStream(FileInputStream(gcodeFile)).use { input -> input.copyTo(zip, COPY_BUFFER_SIZE) }
        zip.closeEntry()
        zip.writeText("Metadata/_rels/model_settings.config.rels", MODEL_SETTINGS_RELS_XML)
        zip.writeText("Metadata/model_settings.config", MODEL_SETTINGS_XML)
        zip.writeText(
          "Metadata/slice_info.config",
          sliceInfoXml(cleanMetadata, target, printableObjects),
        )
        THUMBNAIL_ENTRIES.forEach { entry -> zip.writeBytes(entry, thumbnailPng) }
      }
      check(partial.renameTo(outputFile)) { "Could not publish Bambu print artifact" }
      return Result(outputFile, md5(outputFile), gcodeMd5, printableObjects)
    } catch (error: Throwable) {
      partial.delete()
      throw error
    }
  }

  private fun requireValidGcode(file: File, target: Target) {
    var headerStart = false
    var headerEnd = false
    var executableStart = false
    var targetMachine = false
    file.bufferedReader().useLines { lines ->
      lines.take(2_000).forEach { line ->
        headerStart = headerStart || line.trim() == "; HEADER_BLOCK_START"
        headerEnd = headerEnd || line.trim() == "; HEADER_BLOCK_END"
        executableStart = executableStart || line.trim() == "; EXECUTABLE_BLOCK_START"
        targetMachine = targetMachine || line.contains(target.machineMarker, ignoreCase = true)
      }
    }
    require(headerStart && headerEnd && executableStart) {
      "G-code is not Bambu firmware-ready (required header blocks are missing)"
    }
    require(targetMachine) { "G-code was not sliced with the verified ${target.modelName} profile" }
  }

  private fun validatedProjectSettings(raw: String): Pair<JSONObject, Target> {
    val settings = JSONObject(raw)
    require(settings.length() >= MIN_PROJECT_SETTING_KEYS) {
      "Bambu project settings are incomplete (${settings.length()} keys)"
    }
    val target = Target.entries.singleOrNull {
      settings.optString("printer_model") == it.modelName
    } ?: throw IllegalArgumentException("Bambu project settings target an unsupported printer model")
    require(settings.optString("printer_settings_id").contains(target.settingsToken, ignoreCase = true)) {
      "Bambu project settings do not identify a ${target.modelName} printer profile"
    }
    require(settings.optString("machine_start_gcode").contains(target.machineMarker, ignoreCase = true)) {
      "Bambu project settings do not contain the verified ${target.modelName} startup sequence"
    }
    return settings to target
  }

  private fun validateMetadata(metadata: Metadata): Metadata {
    require(metadata.predictionSeconds >= 0) { "Prediction cannot be negative" }
    require(metadata.weightGrams.isFinite() && metadata.weightGrams >= 0.0) {
      "Filament weight must be finite and non-negative"
    }
    require(metadata.nozzleDiameter in 0.2..1.0) { "Unsupported nozzle diameter" }
    require(metadata.filamentType.matches(Regex("[A-Za-z0-9+_.-]{1,32}"))) {
      "Invalid filament type"
    }
    val color = metadata.filamentColor.removePrefix("#").uppercase()
    require(color.matches(Regex("[0-9A-F]{6}"))) { "Filament color must be #RRGGBB" }
    return metadata.copy(filamentColor = "#$color")
  }

  private fun requireValidThumbnail(png: ByteArray) {
    require(png.size >= 24 && png.copyOfRange(0, 8).contentEquals(PNG_MAGIC)) {
      "Bambu project thumbnail must be a PNG"
    }
    val width = png.readBigEndianInt(16)
    val height = png.readBigEndianInt(20)
    require(width > 1 && height > 1) { "Bambu project thumbnail must be larger than 1x1" }
  }

  private fun plateJson(metadata: Metadata) = JSONObject()
    .put("bed_type", "textured_plate")
    .put("filament_colors", listOf(metadata.filamentColor))
    .put("filament_ids", listOf(0))
    .put("first_extruder", 0)
    .put("is_seq_print", false)
    .put("nozzle_diameter", metadata.nozzleDiameter)
    .put("version", 2)

  private fun sliceInfoXml(
    metadata: Metadata,
    target: Target,
    printableObjects: List<PrintableObject>,
  ): String {
    val type = xmlEscape(metadata.filamentType)
    val color = xmlEscape(metadata.filamentColor)
    val objects = printableObjects.joinToString(
      separator = "\n",
      postfix = if (printableObjects.isEmpty()) "" else "\n",
    ) {
      "    <object identify_id=\"${it.identifyId}\" " +
        "name=\"${xmlEscape(it.name)}\" skipped=\"false\"/>"
    }
    return """<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.07.01.62"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="extruder_type" value="0"/>
    <metadata key="nozzle_volume_type" value="0"/>
    <metadata key="printer_model_id" value="${target.modelId}"/>
    <metadata key="nozzle_diameters" value="${metadata.nozzleDiameter}"/>
    <metadata key="timelapse_type" value="0"/>
    <metadata key="prediction" value="${metadata.predictionSeconds}"/>
    <metadata key="weight" value="${"%.2f".format(java.util.Locale.US, metadata.weightGrams)}"/>
    <metadata key="outside" value="false"/>
    <metadata key="support_used" value="false"/>
    <metadata key="label_object_enabled" value="true"/>
    <metadata key="filament_maps" value="1 1 1 1 1"/>
    <metadata key="limit_filament_maps" value="0 0 0 0 0"/>
$objects    <filament id="1" tray_info_idx="GFL99" type="$type" color="$color" used_m="0.00" used_g="${"%.2f".format(java.util.Locale.US, metadata.weightGrams)}" used_for_object="true" used_for_support="false" group_id="0" nozzle_diameter="${"%.2f".format(java.util.Locale.US, metadata.nozzleDiameter)}" volume_type="Standard"/>
  </plate>
</config>
"""
  }

  /**
   * Orca writes a readable object line immediately before Bambu's unique label
   * ID. Pair those lines while streaming so even very large G-code files stay
   * bounded in memory. Repeated layer markers are deduplicated by identify ID.
   */
  internal fun extractPrintableObjects(gcodeFile: File): List<PrintableObject> {
    data class ParsedObject(val identifyId: Int, val baseName: String, val copyIndex: Int)

    val parsed = linkedMapOf<Int, ParsedObject>()
    var pendingName: Pair<String, Int>? = null
    gcodeFile.bufferedReader().useLines { lines ->
      lines.forEach { line ->
        PRINTING_OBJECT.matchEntire(line.trim())?.let { match ->
          val name = match.groupValues[1].trim().take(MAX_OBJECT_NAME_LENGTH)
          val copy = match.groupValues[2].toIntOrNull()
          pendingName = if (name.isNotEmpty() && copy != null && copy >= 0) name to copy else null
          return@forEach
        }

        val id = UNIQUE_LABEL_ID.matchEntire(line.trim())?.groupValues?.get(1)?.toIntOrNull()
        val pending = pendingName
        if (id != null && id >= 0 && pending != null && parsed.size < MAX_PRINTABLE_OBJECTS) {
          parsed.putIfAbsent(id, ParsedObject(id, pending.first, pending.second))
          pendingName = null
        }
      }
    }

    val duplicateNames = parsed.values.groupingBy { it.baseName }.eachCount()
    return parsed.values.map { item ->
      val name = if ((duplicateNames[item.baseName] ?: 0) > 1) {
        "${item.baseName} (copy ${item.copyIndex + 1})"
      } else {
        item.baseName
      }
      PrintableObject(item.identifyId, name)
    }
  }

  private fun ZipOutputStream.writeText(name: String, text: String) =
    writeBytes(name, text.toByteArray(Charsets.UTF_8))

  private fun ZipOutputStream.writeBytes(name: String, bytes: ByteArray) {
    putNextEntry(ZipEntry(name))
    write(bytes)
    closeEntry()
  }

  private fun md5(file: File): String {
    val digest = MessageDigest.getInstance("MD5")
    BufferedInputStream(FileInputStream(file)).use { input ->
      val buffer = ByteArray(COPY_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02X".format(it) }
  }

  private fun ByteArray.readBigEndianInt(offset: Int): Int =
    ((this[offset].toInt() and 0xff) shl 24) or
      ((this[offset + 1].toInt() and 0xff) shl 16) or
      ((this[offset + 2].toInt() and 0xff) shl 8) or
      (this[offset + 3].toInt() and 0xff)

  private fun xmlEscape(value: String): String = value
    .replace("&", "&amp;")
    .replace("\"", "&quot;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")

  private val PNG_MAGIC = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
  private const val MAX_PRINTABLE_OBJECTS = 64
  private const val MAX_OBJECT_NAME_LENGTH = 200
  private val PRINTING_OBJECT = Regex("; printing object (.+) id:\\d+ copy (\\d+)")
  private val UNIQUE_LABEL_ID = Regex("; start printing object, unique label id: (\\d+)")

  private val THUMBNAIL_ENTRIES = listOf(
    "Metadata/plate_1.png",
    "Metadata/plate_1_small.png",
    "Metadata/plate_no_light_1.png",
    "Metadata/top_1.png",
    "Metadata/pick_1.png",
  )

  private const val CONTENT_TYPES_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>"""

  private const val RELATIONSHIPS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>
 <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>
</Relationships>"""

  private const val MODEL_XML = """<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.07.01.62</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="ProfileCover"></metadata>
 <metadata name="ProfileDescription"></metadata>
 <metadata name="ProfileTitle"></metadata>
 <resources></resources>
 <build/>
</model>"""

  private const val MODEL_SETTINGS_RELS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/Metadata/plate_1.gcode" Id="rel-1" Type="http://schemas.bambulab.com/package/2021/gcode"/>
</Relationships>"""

  private const val MODEL_SETTINGS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="filament_map_mode" value="Auto For Flush"/>
    <metadata key="filament_maps" value="1 1 1 1 1"/>
    <metadata key="filament_volume_maps" value="0 0 0 0 0"/>
    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>
    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>
    <metadata key="top_file" value="Metadata/top_1.png"/>
    <metadata key="pick_file" value="Metadata/pick_1.png"/>
    <metadata key="pattern_bbox_file" value="Metadata/plate_1.json"/>
  </plate>
</config>
"""
}
