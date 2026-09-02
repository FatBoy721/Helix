package org.crabcore.u1control.slicing

import android.content.Context
import android.text.format.DateFormat
import java.util.Calendar
import java.util.Date

/**
 * Routing and preflight checks for the print preprocess sheet — a port of
 * [services/printPreprocess.ts], kept close to it so the native sheet and its RN
 * counterpart never disagree about a job.
 *
 * Auto-routing exists because identity mapping alone blocks healthy setups:
 * spools in lanes 1 and 3 with a file that wants tools 1 and 2 is printable, and
 * demanding a hand-fix is the app refusing arithmetic it can do. Blocking is
 * reserved for genuinely unsatisfiable jobs — fewer usable lanes than the file
 * needs, printer busy, or offline.
 */
object PreprocessRouting {
  /** A physical lane on the machine. Mirrors RN `PreprocessLane`. */
  data class Lane(
    val index: Int,
    val color: Int,
    val brand: String = "",
    val material: String = "PLA",
    val mainType: String = "",
    val subType: String = "",
    val status: String = "unknown",
  ) {
    val isEmpty: Boolean get() = status == "empty"
  }

  enum class RouteSource { IDENTITY, AUTO, MANUAL }

  /** A file tool paired with the lane that will feed it. */
  data class Tool(
    val fileTool: Int,
    val assigned: Int,
    val grams: Double,
    val lane: Lane,
    val source: RouteSource,
  )

  enum class Tone { PASS, WARN, FAIL }

  data class Check(
    val key: String,
    val detail: String,
    val tone: Tone,
    val blocking: Boolean,
  )

  /**
   * [key] matches services/printerProfiles.ts, which decides which of these a
   * given machine actually offers — an AD5X has no flow-calibration macro and
   * no TIMELAPSE_* macros, and printing with either injected aborts the job.
   */
  enum class Pref(val key: String, val label: String, val hint: String, val icon: Int) {
    AI_MONITORING(
      "aiMonitoring",
      "AI Monitoring",
      "Detects spaghetti failures and build-plate obstructions, then automatically pauses the print",
      HelixIcons.ROBOT_OUTLINE,
    ),
    AUTO_LEVEL("autoLevel", "Auto leveling", "Probe the bed before the first layer", HelixIcons.GRID),
    FLOW_CAL("flowCal", "Flow calibration", "Calibrate extrusion on the way in", HelixIcons.TUNE),
    TIMELAPSE("timelapse", "Time-lapse", "Capture a frame every layer", HelixIcons.VIDEO),
    IFS("ifs", "Enable IFS", "Feed colors from the material station", HelixIcons.TUNE),
  }

  /**
   * The toggles [printPrefs] permits, in enum order. AI monitoring is a U1
   * firmware capability rather than a slicer preference, so its availability
   * travels separately from the machine-profile key list.
   */
  @JvmStatic
  fun offeredPrefs(printPrefs: List<String>, supportsAiMonitoring: Boolean = false): List<Pref> {
    val allowed = printPrefs.toSet()
    return Pref.values().filter { pref ->
      if (pref == Pref.AI_MONITORING) supportsAiMonitoring
      else printPrefs.isEmpty() || allowed.contains(pref.key)
    }
  }

  /** U1/PAXX command applied immediately before a print starts. */
  @JvmStatic
  fun aiMonitoringCommand(
    enabled: Boolean,
    sensitivity: AiDetectionSensitivity = AiDetectionSensitivity.LOW,
  ): String = if (enabled) {
    "DEFECT_DETECTION_CONFIG MAIN_ENABLE=1 CLEAN_BED_ENABLE=1 " +
      "NOODLE_ENABLE=1 SENSITIVITY=${sensitivity.wireValue}"
  } else {
    "DEFECT_DETECTION_CONFIG MAIN_ENABLE=0"
  }

  /**
   * How a machine names its material feeds. "tool" — U1/generic: tools are
   * "T0"–"T3", the physical feeds are plain "lanes". "lane" — AD5X/Bambu: the
   * feeds themselves are the unit, shown as "Lane 1"–"Lane 4". Mirrors
   * `LaneNaming` in services/printPreprocess.ts.
   */
  /** The noun for a physical feed: "lane" on the U1, "Lane" where the machine names them. */
  fun laneWord(laneNaming: String): String = if (laneNaming == "lane") "Lane" else "lane"

  /** Chip label: "T2" on the U1, the bare number "3" where the feeds are named lanes. */
  fun toolChipLabel(fileTool: Int, laneNaming: String): String =
    if (laneNaming == "lane") "${fileTool + 1}" else "T$fileTool"

  /** Full reference: "T0" on the U1, "Lane 1" where the feeds are named lanes. */
  fun toolLabel(fileTool: Int, laneNaming: String): String =
    if (laneNaming == "lane") "Lane ${fileTool + 1}" else "T$fileTool"

  /** A lane that can feed a print. `unknown` counts — refusing on no evidence is worse. */
  private fun usable(lane: Lane?): Boolean = lane != null && !lane.isEmpty

  /**
   * Works out which lane feeds each tool.
   *
   * Manual choices are reserved first. A tool then feeds from its own lane when
   * that lane has filament; otherwise it takes the next usable lane nothing else
   * has claimed.
   */
  fun routeTools(
    required: List<Int>,
    lanes: List<Lane>,
    manual: Map<Int, Int> = emptyMap(),
  ): Map<Int, Pair<Int, RouteSource>> {
    val out = mutableMapOf<Int, Pair<Int, RouteSource>>()
    val taken = mutableSetOf<Int>()

    for (tool in required) {
      val picked = manual[tool]
      if (picked != null && lanes.getOrNull(picked) != null) {
        out[tool] = picked to RouteSource.MANUAL
        taken.add(picked)
      }
    }

    for (tool in required) {
      if (out.containsKey(tool)) continue

      if (tool !in taken && usable(lanes.getOrNull(tool))) {
        out[tool] = tool to RouteSource.IDENTITY
        taken.add(tool)
        continue
      }

      val spare = lanes.firstOrNull { usable(it) && it.index !in taken }
      if (spare != null) {
        out[tool] = spare.index to RouteSource.AUTO
        taken.add(spare.index)
      } else {
        out[tool] = tool to RouteSource.IDENTITY
      }
    }

    return out
  }

  /** Builds the tool list the sheet renders. */
  fun buildTools(
    required: List<Int>,
    lanes: List<Lane>,
    manual: Map<Int, Int>,
    perToolGrams: List<Double>,
  ): List<Tool> {
    val routing = routeTools(required, lanes, manual)
    return required.map { fileTool ->
      val route = routing[fileTool] ?: (fileTool to RouteSource.IDENTITY)
      val lane = lanes.getOrNull(route.first)
        ?: lanes.getOrNull(fileTool)
        ?: Lane(index = route.first, color = 0xFF888888.toInt(), status = "empty")
      Tool(
        fileTool = fileTool,
        assigned = route.first,
        grams = perToolGrams.getOrNull(fileTool) ?: 0.0,
        lane = lane,
        source = route.second,
      )
    }
  }

  fun buildChecks(
    connected: Boolean,
    printerBusy: Boolean,
    printerName: String,
    tools: List<Tool>,
    lanes: List<Lane>,
    laneNaming: String = "tool",
  ): List<Check> {
    val word = laneWord(laneNaming)
    val starved = tools.filter { it.lane.isEmpty }
    val loadedCount = lanes.count { it.status == "loaded" }
    val rerouted = tools.filter { it.source == RouteSource.AUTO }

    val filament = when {
      starved.isNotEmpty() -> Check(
        key = "filament",
        detail = "This file needs ${tools.size} materials and only $loadedCount " +
          (if (loadedCount == 1) "$word has" else "${word}s have") + " filament",
        tone = Tone.FAIL,
        blocking = true,
      )
      rerouted.isNotEmpty() -> Check(
        key = "filament",
        detail = rerouted.joinToString(", ") {
          "${toolLabel(it.fileTool, laneNaming)} to $word ${it.assigned + 1}"
        } + " — your own ${word}s were empty",
        tone = Tone.PASS,
        blocking = true,
      )
      else -> Check(
        key = "filament",
        detail = "${tools.size} of ${lanes.size} ${word}s feed this print",
        tone = Tone.PASS,
        blocking = true,
      )
    }

    return listOf(
      Check(
        key = "connection",
        detail = if (connected) "$printerName responded" else "Not connected — cannot upload the file",
        tone = if (connected) Tone.PASS else Tone.FAIL,
        blocking = true,
      ),
      Check(
        key = "state",
        detail = if (printerBusy) "A print is already running" else "Idle and accepting jobs",
        tone = if (printerBusy) Tone.FAIL else Tone.PASS,
        blocking = true,
      ),
      filament,
    )
  }

  /** Clock time the print would finish — "4:12 PM" beats doing the arithmetic. */
  fun finishClock(context: Context, seconds: Float): String {
    val done = Date(System.currentTimeMillis() + (maxOf(0f, seconds) * 1000L).toLong())
    val time = DateFormat.getTimeFormat(context).format(done)
    val midnight = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    val days = ((done.time - midnight.timeInMillis) / 86_400_000L).toInt()
    return when {
      days <= 0 -> time
      days == 1 -> "$time tomorrow"
      else -> "$time +${days}d"
    }
  }

  fun laneLabel(lane: Lane): String =
    if (lane.isEmpty) "Empty" else lane.mainType.ifBlank { lane.material.ifBlank { "PLA" } }

  fun laneDetail(lane: Lane): String {
    if (lane.isEmpty) return "No spool loaded"
    val bits = listOf(lane.subType, lane.brand).filter { it.isNotBlank() }
    return if (bits.isEmpty()) "Loaded" else bits.joinToString(" · ")
  }
}
