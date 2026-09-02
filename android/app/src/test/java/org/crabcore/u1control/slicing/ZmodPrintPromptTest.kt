package org.crabcore.u1control.slicing

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Captured verbatim from a FlashForge AD5X (zmod) accepting a print. This is the
 * run that left Helix reporting the job as sent while the printer sat waiting.
 */
class ZmodPrintPromptTest {
  private val commit =
    """PRINT_ZCOLOR LEVELING=1 FILENAME="1+Mini+Turtle.gcode" ALLOWED_TOOL_COUNT=4 T0=2 T1=2 T2=2 T3=2"""

  private val promptLines = listOf(
    "// action:prompt_end",
    "// action:prompt_begin Select print materials",
    "// action:prompt_text 1+Mini+Turtle.gcode | Extruder: None (2)",
    """// action:prompt_button Leveling Off|SET_ZCOLOR SILENT=0 FILENAME="1+Mini+Turtle.gcode" LEVELING=1| |808080""",
    "// action:prompt_footer_button Start print|$commit|red",
    "// action:prompt_footer_button Cancel|RESPOND TYPE=command MSG=action:prompt_end",
    "// action:prompt_show",
  )

  @Test
  fun findsTheCommitMacroOfAnOpenPrompt() {
    assertEquals(commit, ZmodPrintPrompt.pendingCommitMacro(promptLines))
  }

  @Test
  fun aPromptNotYetShownIsNotAnswered() {
    // Everything except prompt_show — the printer is still composing it.
    assertNull(ZmodPrintPrompt.pendingCommitMacro(promptLines.dropLast(1)))
  }

  @Test
  fun anAlreadyClosedPromptIsNotAnswered() {
    // The dangerous one: a stale prompt in the buffer must not make Helix fire
    // a print macro at a printer that has moved on.
    assertNull(ZmodPrintPrompt.pendingCommitMacro(promptLines + "// action:prompt_end"))
  }

  @Test
  fun ordinaryConsoleOutputIsInert() {
    val noise = listOf("ok", "// H1 > command H1 ok. 7913595", """!! Unknown command:"T0"""")
    assertNull(ZmodPrintPrompt.pendingCommitMacro(noise))
    assertNotNull(ZmodPrintPrompt.pendingCommitMacro(noise + promptLines))
  }

  @Test
  fun lanesAreRewrittenFromZeroBasedSlotsToOneBasedLanes() {
    val out = ZmodPrintPrompt.applyToolSlots(commit, mapOf(0 to 0, 1 to 1, 2 to 2, 3 to 3))
    assertTrue(out, out.contains("T0=1 T1=2 T2=3 T3=4"))
    // The tool count is not a lane argument.
    assertTrue(out, out.contains("ALLOWED_TOOL_COUNT=4"))
  }

  @Test
  fun unmappedToolsKeepThePrinterOwnProposal() {
    val out = ZmodPrintPrompt.applyToolSlots(commit, mapOf(0 to 3))
    assertTrue(out, out.contains("T0=4 T1=2 T2=2 T3=2"))
  }

  @Test
  fun levellingIsAppliedAndOnlyToItsOwnArgument() {
    assertTrue(ZmodPrintPrompt.applyLeveling(commit, false).contains("LEVELING=0"))
    assertTrue(ZmodPrintPrompt.applyLeveling(commit, true).contains("LEVELING=1"))
    // Null leaves the printer's own value alone.
    assertEquals(commit, ZmodPrintPrompt.applyLeveling(commit, null))
    val similar = "PRINT_ZCOLOR AUTO_LEVELING_MODE=3 LEVELING=0"
    assertTrue(ZmodPrintPrompt.applyLeveling(similar, true).contains("AUTO_LEVELING_MODE=3"))
  }

  @Test
  fun answersOnlyForOurOwnFile() {
    val mine = ZmodPrintPrompt.answerFor(promptLines, "1+Mini+Turtle.gcode", mapOf(0 to 1), false)
    assertNotNull(mine)
    assertTrue(mine!!, mine.contains("T0=2"))
    assertTrue(mine, mine.contains("LEVELING=0"))

    // A job started at the printer is the operator's to answer.
    assertNull(ZmodPrintPrompt.answerFor(promptLines, "someone-elses.gcode", mapOf(0 to 1), false))
  }

  @Test
  fun matchesOnBasenameSoAPathStillCounts() {
    assertTrue(ZmodPrintPrompt.macroTargetsFile(commit, "gcodes/1+Mini+Turtle.gcode"))
    assertTrue(!ZmodPrintPrompt.macroTargetsFile(commit, "other.gcode"))
  }

  @Test
  fun readsMessagesOutOfAMoonrakerStoreReply() {
    // Built rather than hand-written: the macro contains quotes, and splicing it
    // into a JSON literal produces a payload the parser rightly rejects.
    val store = JSONArray()
    for (line in promptLines) {
      store.put(JSONObject().put("message", line).put("type", "response"))
    }
    val json = JSONObject().put("result", JSONObject().put("gcode_store", store)).toString()

    val messages = ZmodPrintPrompt.messagesFromStore(json)
    assertEquals(promptLines.size, messages.size)
    assertEquals(commit, ZmodPrintPrompt.pendingCommitMacro(messages))
  }

  @Test
  fun malformedStoreRepliesYieldNothingRatherThanThrowing() {
    for (bad in listOf("", "not json", "{}", """{"result":{}}""")) {
      assertEquals(bad, emptyList<String>(), ZmodPrintPrompt.messagesFromStore(bad))
    }
  }
}
