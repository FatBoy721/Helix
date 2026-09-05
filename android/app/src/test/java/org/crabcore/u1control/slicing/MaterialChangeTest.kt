package org.crabcore.u1control.slicing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Routing a tool to another lane only rewrites T-codes; the gcode keeps the
 * temperatures and flow of the material it was sliced with. So the decision
 * "does this reroute need a re-slice?" is what stands between a correct print
 * and PETG extruded at PLA temps (issue #18).
 *
 * It has to be wrong in neither direction: missing a real material change
 * prints at the wrong temperature, and flagging a false one costs the user a
 * ~30s re-slice for an identical result.
 */
class MaterialChangeTest {

  @Test
  fun `same polymer across brands and sub types does not re-slice`() {
    // The reported-lane strings really do vary this much between spools.
    assertFalse(MaterialChange.needsReslice("PLA", "PLA BASIC"))
    assertFalse(MaterialChange.needsReslice("PLA BASIC", "PLA"))
    assertFalse(MaterialChange.needsReslice("PLA", "PLA SnapSpeed"))
    assertFalse(MaterialChange.needsReslice("PLA SNAPSPEED", "pla basic"))
    assertFalse(MaterialChange.needsReslice("PETG", "PETG"))
  }

  @Test
  fun `different polymer re-slices`() {
    // The exact case from the issue: a PLA slice routed onto a PETG lane.
    assertTrue(MaterialChange.needsReslice("PLA", "PETG HF"))
    assertTrue(MaterialChange.needsReslice("PLA", "TPU 90A"))
    assertTrue(MaterialChange.needsReslice("PETG", "ABS"))
    assertTrue(MaterialChange.needsReslice("ABS", "ASA"))
  }

  @Test
  fun `composites are their own material, not their base polymer`() {
    // PETG-CF wants different flow and temps than plain PETG, so treating it as
    // "PETG" would skip a re-slice that genuinely matters.
    assertTrue(MaterialChange.needsReslice("PETG", "PETG-CF"))
    assertTrue(MaterialChange.needsReslice("PLA", "PLA-CF"))
    assertTrue(MaterialChange.needsReslice("PA", "PA6-CF"))
    assertFalse(MaterialChange.needsReslice("PETG-CF", "PETG CF"))
  }

  @Test
  fun `longest match wins so composites never collapse to their prefix`() {
    assertEquals("PETG-CF", MaterialChange.mainType("PETG-CF"))
    assertEquals("PETG-HF", MaterialChange.mainType("PETG HF"))
    assertEquals("PA6-CF", MaterialChange.mainType("PA6-CF"))
    assertEquals("PC-ABS", MaterialChange.mainType("PC-ABS"))
    assertEquals("PETG", MaterialChange.mainType("PETG"))
    assertEquals("PA", MaterialChange.mainType("PA"))
  }

  @Test
  fun `unknown and blank spools fall back to PLA like the engine does`() {
    // FilamentSlotDetails.UNKNOWN and an empty lane both surface as PLA, so a
    // lane the app knows nothing about must not trigger a spurious re-slice.
    assertEquals("PLA", MaterialChange.mainType(null))
    assertEquals("PLA", MaterialChange.mainType(""))
    assertEquals("PLA", MaterialChange.mainType("   "))
    assertEquals("PLA", MaterialChange.mainType("Empty"))
    assertFalse(MaterialChange.needsReslice("PLA", null))
    assertFalse(MaterialChange.needsReslice(null, "Empty"))
  }

  @Test
  fun `an unrecognised material keeps its own identity`() {
    // A spool the catalog has never heard of should still compare as itself
    // rather than silently becoming PLA, or every exotic filament would print
    // at PLA temps without a re-slice.
    assertEquals("PEEK", MaterialChange.mainType("PEEK"))
    assertTrue(MaterialChange.needsReslice("PLA", "PEEK"))
    assertFalse(MaterialChange.needsReslice("PEEK", "peek"))
  }

  @Test
  fun `real U1 lane strings from print_task_config`() {
    // Captured live from the U1 2026-09-04 (filament_type / filament_sub_type):
    //   T0 "PLA" ""      T1 "PLA" "BASIC"    T2 "PETG" "Basic"    T3 "NONE" "NONE"
    // A PLA slice routed onto T2 is exactly the issue #18 case and must re-slice.
    assertEquals("PLA", MaterialChange.mainType("PLA"))
    assertEquals("PLA", MaterialChange.mainType("PLA BASIC"))
    assertEquals("PETG", MaterialChange.mainType("PETG Basic"))
    assertTrue(MaterialChange.needsReslice("PLA", "PETG Basic"))
    assertTrue(MaterialChange.needsReslice("PLA BASIC", "PETG Basic"))
    // T3 reports the literal string "NONE" when empty. filamentSlots.ts strips
    // it before native sees it, so this guards the classifier itself, not a
    // reachable path - an unguarded "NONE" compares as its own polymer.
    assertEquals("PLA", MaterialChange.mainType("NONE"))
    assertFalse(MaterialChange.needsReslice("PLA", "NONE"))
  }
}
