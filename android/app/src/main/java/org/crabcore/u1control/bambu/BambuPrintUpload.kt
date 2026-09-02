package org.crabcore.u1control.bambu

import android.content.Context
import java.io.File
import java.util.Base64
import java.util.UUID

/** Builds, uploads, and then removes one validated model-specific Bambu artifact. */
class BambuPrintUpload internal constructor(
  private val cacheDirectory: File,
  private val loadProjectSettings: (String) -> String,
  private val uploadArtifact: (BambuFtpsConfig, File, String) -> BambuFtpsUploadResult,
) {
  constructor(context: Context) : this(
    cacheDirectory = context.cacheDir,
    loadProjectSettings = { serial ->
      context.assets.open(projectSettingsAsset(serial)).bufferedReader().use { it.readText() }
    },
    uploadArtifact = { config, artifact, remoteName ->
      BambuFtpsClient().upload(config, artifact, remoteName)
    },
  )

  internal constructor(
    cacheDirectory: File,
    projectSettingsJson: String,
    uploader: (BambuFtpsConfig, File, String) -> BambuFtpsUploadResult,
  ) : this(cacheDirectory, { projectSettingsJson }, uploader)

  data class Request(
    val host: String,
    val serial: String,
    val accessCode: String,
    val gcodeFile: File,
    val remoteName: String,
    val usedToolMask: Int,
    val predictionSeconds: Int,
    val weightGrams: Double,
    val filamentType: String,
    val filamentColor: String,
  )

  data class Result(
    val remoteName: String,
    val verifiedBytes: Long,
    val archiveMd5: String,
    val gcodeMd5: String,
    val objects: List<BambuPrintArtifact.PrintableObject>,
  )

  fun upload(request: Request): Result {
    require(request.usedToolMask == SINGLE_TOOL_ZERO_MASK) {
      "Bambu LAN printing currently supports one logical filament (tool 0) only"
    }
    require(request.remoteName.matches(SAFE_ARTIFACT_NAME)) {
      "Invalid Bambu print filename"
    }
    val projectSettings = loadProjectSettings(request.serial)

    val thumbnail = extractLargestThumbnail(request.gcodeFile)
      ?: throw IllegalArgumentException("Sliced G-code has no valid embedded PNG preview")
    cacheDirectory.mkdirs()
    val artifact = File(cacheDirectory, "helix-bambu-${UUID.randomUUID()}.gcode.3mf")

    try {
      val built = BambuPrintArtifact.build(
        gcodeFile = request.gcodeFile,
        outputFile = artifact,
        projectSettingsJson = projectSettings,
        thumbnailPng = thumbnail,
        metadata = BambuPrintArtifact.Metadata(
          predictionSeconds = request.predictionSeconds,
          weightGrams = request.weightGrams,
          filamentType = request.filamentType,
          filamentColor = request.filamentColor,
        ),
      )
      val uploaded = uploadArtifact(
        BambuFtpsConfig(request.host, request.serial, request.accessCode),
        built.file,
        request.remoteName,
      )
      return Result(
        uploaded.remoteName,
        uploaded.verifiedBytes,
        built.archiveMd5,
        built.gcodeMd5,
        built.objects,
      )
    } finally {
      artifact.delete()
    }
  }

  private fun extractLargestThumbnail(gcodeFile: File): ByteArray? {
    if (!gcodeFile.isFile) return null
    var collecting = false
    var expectedLength = -1
    var largest: ByteArray? = null
    val encoded = StringBuilder()

    gcodeFile.bufferedReader().useLines { lines ->
      lines.take(MAX_HEADER_LINES).forEach { line ->
        val match = THUMBNAIL_START.matchEntire(line.trim())
        if (match != null) {
          collecting = true
          expectedLength = match.groupValues[3].toIntOrNull() ?: -1
          encoded.clear()
        } else if (collecting && line.trim() == "; thumbnail end") {
          val text = encoded.toString()
          val candidate = if (text.length == expectedLength) {
            runCatching { Base64.getDecoder().decode(text) }.getOrNull()
          } else {
            null
          }
          if (candidate != null && isPng(candidate) && candidate.size > (largest?.size ?: -1)) {
            largest = candidate
          }
          collecting = false
        } else if (collecting) {
          val trimmed = line.trim()
          if (trimmed.startsWith(";")) encoded.append(trimmed.removePrefix(";").trim())
        }
      }
    }
    return largest
  }

  private fun isPng(bytes: ByteArray): Boolean =
    bytes.size >= PNG_MAGIC.size && bytes.copyOfRange(0, PNG_MAGIC.size).contentEquals(PNG_MAGIC)

  private companion object {
    fun projectSettingsAsset(serial: String): String = when {
      serial.trim().uppercase().startsWith("01P") -> "orca_profiles/printer/bambu_p1s.json"
      serial.trim().uppercase().startsWith("039") -> "orca_profiles/printer/bambu_a1.json"
      else -> throw IllegalArgumentException("Bambu LAN printing supports the P1S and full-size A1 only")
    }
    const val SINGLE_TOOL_ZERO_MASK = 1
    const val MAX_HEADER_LINES = 8_000
    val SAFE_ARTIFACT_NAME = Regex("[A-Za-z0-9._-]{1,120}\\.gcode\\.3mf", RegexOption.IGNORE_CASE)
    val THUMBNAIL_START = Regex("; thumbnail begin (\\d+)x(\\d+) (\\d+)")
    val PNG_MAGIC = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
  }
}
