package org.crabcore.u1control.slicing

import org.json.JSONObject

/**
 * Answers zmod's "Select print materials" prompt from the preprocess sheet that
 * already asked the same question.
 *
 * A FlashForge AD5X running zmod raises a Klipper prompt on every print start,
 * asking which IFS lane feeds each tool. The operator has just answered exactly
 * that on Helix's own sheet, so asking again is pure friction — and until this
 * existed the print simply sat there unanswered.
 *
 * This lives natively, beside the screen that starts the print, rather than
 * leaning on the RN layer: the prompt arrives within a second or two of the
 * start, while Android is still handing control back, and a handoff that races
 * the printer is a handoff that sometimes loses.
 *
 * Indexing: Helix holds slots 0-based, the macro takes `T<tool>=<lane>` with a
 * 1-based lane. Slot s becomes lane s + 1.
 */
object ZmodPrintPrompt {

  private val TOOL_ARG = Regex("""(^|\s)T(\d+)=(-?\d+)""")
  private val LEVELING_ARG = Regex("""(^|\s)LEVELING=(-?\d+)""", RegexOption.IGNORE_CASE)
  private val FILENAME_ARG = Regex("""FILENAME\s*=\s*(?:"([^"]*)"|(\S+))""", RegexOption.IGNORE_CASE)
  private val PROMPT_DIRECTIVE = Regex("""^\s*(?://)?\s*action:\s*(prompt_[a-z_]+)\s*(.*)$""",
    setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))

  /** The commit macro of an open, shown material prompt, or null. */
  fun pendingCommitMacro(messages: List<String>): String? {
    var open = false
    var shown = false
    var commit: String? = null

    for (line in messages) {
      val match = PROMPT_DIRECTIVE.find(line) ?: continue
      val directive = match.groupValues[1].lowercase()
      val rest = match.groupValues[2].trim()
      when (directive) {
        // A fresh prompt discards whatever the last one was mid-composing.
        "prompt_begin" -> { open = true; shown = false; commit = null }
        "prompt_end" -> { open = false; shown = false; commit = null }
        "prompt_show" -> if (open) shown = true
        "prompt_footer_button", "prompt_button" -> {
          if (!open) continue
          val gcode = rest.split('|').getOrNull(1)?.trim().orEmpty()
          if (gcode.startsWith("PRINT_ZCOLOR", ignoreCase = true)) commit = gcode
        }
      }
    }
    return if (open && shown) commit else null
  }

  /** The file a macro names, unquoted. */
  fun macroFilename(gcode: String): String? {
    val match = FILENAME_ARG.find(gcode) ?: return null
    val value = match.groupValues[1].ifBlank { match.groupValues[2] }
    return value.trim().ifBlank { null }
  }

  /** Basename, case-insensitive — the printer's path and ours can differ. */
  private fun fileKey(name: String): String =
    name.substringAfterLast('/').substringAfterLast('\\').trim().lowercase()

  fun macroTargetsFile(gcode: String, filename: String): Boolean {
    val target = macroFilename(gcode) ?: return false
    if (filename.isBlank()) return false
    return fileKey(target) == fileKey(filename)
  }

  /**
   * Rewrites lane arguments from [toolToSlot] (0-based tool → 0-based slot).
   *
   * Only arguments the macro already carries are touched, and only tools that
   * were actually mapped — inventing a lane for a tool we know nothing about
   * would point the printer at a spool the operator never chose.
   */
  fun applyToolSlots(gcode: String, toolToSlot: Map<Int, Int>): String =
    TOOL_ARG.replace(gcode) { match ->
      val lead = match.groupValues[1]
      val tool = match.groupValues[2]
      val slot = toolToSlot[tool.toIntOrNull() ?: -1]
      if (slot == null || slot < 0) match.value else "${lead}T$tool=${slot + 1}"
    }

  /** Sets LEVELING=, which is the only way bed levelling reaches this machine. */
  fun applyLeveling(gcode: String, autoLevel: Boolean?): String {
    if (autoLevel == null) return gcode
    return LEVELING_ARG.replace(gcode) { match ->
      "${match.groupValues[1]}LEVELING=${if (autoLevel) 1 else 0}"
    }
  }

  /**
   * The macro that starts [filename] with the operator's own choices, or null
   * when there is no matching prompt waiting.
   */
  fun answerFor(
    messages: List<String>,
    filename: String,
    toolToSlot: Map<Int, Int>,
    autoLevel: Boolean?,
  ): String? {
    val commit = pendingCommitMacro(messages) ?: return null
    if (!macroTargetsFile(commit, filename)) return null
    return applyLeveling(applyToolSlots(commit, toolToSlot), autoLevel)
  }

  /** Pulls the response strings out of a Moonraker `server/gcode_store` reply. */
  fun messagesFromStore(json: String): List<String> = try {
    val arr = JSONObject(json).optJSONObject("result")?.optJSONArray("gcode_store")
    if (arr == null) emptyList() else (0 until arr.length()).mapNotNull {
      arr.optJSONObject(it)?.optString("message")?.takeIf(String::isNotBlank)
    }
  } catch (_: Throwable) {
    emptyList()
  }

  /**
   * Starts [filename] without the material station — zmod's per-print IFS-off
   * path. Its own UI button "Hide color selection, print without IFS" sends
   * exactly this: SILENT=2 skips the material-selection prompt entirely, and
   * the print runs from the external side spool with every T-command in the
   * G-code ignored. Nothing is persisted; the next print asks again.
   *
   * There is no per-tool variant of this: PRINT_ZCOLOR rejects slot 0, so an
   * external spool can never be mapped in as one lane among several — IFS-off
   * is all-or-nothing.
   */
  fun ifsOffPrintGcode(filename: String, autoLevel: Boolean): String =
    """SET_ZCOLOR FILENAME="$filename" SILENT=2 LEVELING=${if (autoLevel) 1 else 0}"""
}
