package org.crabcore.u1control.bambu

import org.json.JSONArray
import org.json.JSONObject

/** Pure construction and acknowledgement parsing for Bambu `project_file`. */
object BambuPrintProtocol {

  const val TOOL_COUNT = 4
  const val EXTERNAL_SPOOL = -1
  private const val UNUSED_AMS_ID = 255
  private const val UNUSED_SLOT_ID = 255
  private val MD5_PATTERN = Regex("^[0-9A-F]{32}$")

  data class ProjectFileCommand(
    val sequenceId: String,
    val fileName: String,
    val subtaskName: String,
    val md5: String,
    /** Zero-based file tool -> zero-based global AMS lane; -1 is external spool. */
    val toolToLane: Map<Int, Int>,
    val bedType: String,
    val useAms: Boolean,
    val bedLeveling: Boolean,
    val flowCalibration: Boolean,
    val timelapse: Boolean,
    val layerInspection: Boolean = true,
    val vibrationCalibration: Boolean = false,
    val autoBedLeveling: Int = 1,
    val extrudeCalibrationFlag: Int = 2,
    val extrudeCalibrationManualMode: Int = 0,
    val nozzleOffsetCalibration: Int = 2,
  )

  enum class Acknowledgement {
    NOT_MATCHING,
    SUCCESS,
    REJECTED,
  }

  fun buildProjectFilePayload(command: ProjectFileCommand): String {
    require(command.sequenceId.isNotBlank()) { "sequenceId is required" }
    require(command.fileName.isSafeRootFileName()) { "fileName must be a root filename" }
    require(command.fileName.endsWith(".gcode.3mf", ignoreCase = true)) {
      "Bambu print artifacts must end in .gcode.3mf"
    }
    require(command.subtaskName.isNotBlank()) { "subtaskName is required" }
    require(command.md5.uppercase().matches(MD5_PATTERN)) { "md5 must contain 32 hex digits" }
    require(command.bedType.isNotBlank()) { "bedType is required" }

    val mapping = normalizedMapping(command.toolToLane, command.useAms)
    val mapping2 = mapping.map(::detailedMapping)

    val print = JSONObject().apply {
      put("ams_mapping", JSONArray(mapping))
      put("ams_mapping2", JSONArray(mapping2))
      put("auto_bed_leveling", command.autoBedLeveling)
      put("bed_leveling", command.bedLeveling)
      put("bed_type", command.bedType)
      put("cfg", "0")
      put("command", "project_file")
      put("extrude_cali_flag", command.extrudeCalibrationFlag)
      put("extrude_cali_manual_mode", command.extrudeCalibrationManualMode)
      put("file", command.fileName)
      put("flow_cali", command.flowCalibration)
      put("layer_inspect", command.layerInspection)
      put("md5", command.md5.uppercase())
      put("nozzle_offset_cali", command.nozzleOffsetCalibration)
      put("param", "Metadata/plate_1.gcode")
      put("profile_id", "0")
      put("project_id", "0")
      put("sequence_id", command.sequenceId)
      put("subtask_id", "0")
      put("subtask_name", command.subtaskName)
      put("task_id", "0")
      put("timelapse", command.timelapse)
      put("use_ams", command.useAms)
      put("vibration_cali", command.vibrationCalibration)
      put("url", "ftp://${command.fileName}")
    }
    return JSONObject().put("print", print).toString()
  }

  /** Only a matching `project_file` response can resolve a start request. */
  fun acknowledgement(payload: String, expectedSequenceId: String): Acknowledgement {
    val print = runCatching { JSONObject(payload).optJSONObject("print") }.getOrNull()
      ?: return Acknowledgement.NOT_MATCHING
    if (print.optString("command") != "project_file") return Acknowledgement.NOT_MATCHING
    if (print.optString("sequence_id") != expectedSequenceId) return Acknowledgement.NOT_MATCHING
    return if (print.optString("result").equals("success", ignoreCase = true)) {
      Acknowledgement.SUCCESS
    } else {
      Acknowledgement.REJECTED
    }
  }

  private fun normalizedMapping(toolToLane: Map<Int, Int>, useAms: Boolean): List<Int> {
    require(toolToLane.keys.all { it in 0 until TOOL_COUNT }) { "tool index must be 0..3" }
    require(toolToLane.values.all { it == EXTERNAL_SPOOL || it >= 0 }) {
      "lane must be zero-based or -1 for the external spool"
    }
    return List(TOOL_COUNT) { tool ->
      if (useAms) toolToLane[tool] ?: EXTERNAL_SPOOL else EXTERNAL_SPOOL
    }
  }

  private fun detailedMapping(lane: Int): JSONObject = if (lane == EXTERNAL_SPOOL) {
    JSONObject().put("ams_id", UNUSED_AMS_ID).put("slot_id", UNUSED_SLOT_ID)
  } else {
    JSONObject().put("ams_id", lane / 4).put("slot_id", lane % 4)
  }

  private fun String.isSafeRootFileName(): Boolean =
    isNotBlank() && this != "." && this != ".." && !contains('/') && !contains('\\')
}
