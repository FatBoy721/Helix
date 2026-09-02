package org.crabcore.u1control.slicing

import com.u1.slicer.viewer.MachineProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The preprocess sheet used to carry its own hardcoded toggle list, which drifted
 * from the RN one: an AD5X was offered a time-lapse despite having no TIMELAPSE_*
 * macros, and injecting those aborts the print on "Unknown command".
 */
class PreprocessPrefsTest {
  @Test
  fun ad5xIsOfferedOnlyLevellingAndItsMaterialStation() {
    val offered = PreprocessRouting.offeredPrefs(listOf("autoLevel", "ifs"))
    assertEquals(
      listOf(PreprocessRouting.Pref.AUTO_LEVEL, PreprocessRouting.Pref.IFS),
      offered,
    )
  }

  @Test
  fun theU1KeepsItsPaxxToggles() {
    val offered = PreprocessRouting.offeredPrefs(
      listOf("autoLevel", "flowCal", "timelapse"),
      supportsAiMonitoring = true,
    )
    assertEquals(4, offered.size)
    assertEquals(PreprocessRouting.Pref.AI_MONITORING, offered.first())
    assertTrue(offered.contains(PreprocessRouting.Pref.FLOW_CAL))
    assertTrue(offered.contains(PreprocessRouting.Pref.TIMELAPSE))
    assertTrue(!offered.contains(PreprocessRouting.Pref.IFS))
  }

  @Test
  fun anEmptyListFallsBackToEveryToggle() {
    // An older JS bundle sends no list. Showing an empty options fold would look
    // broken, so the sheet keeps its full set rather than nothing.
    assertEquals(
      PreprocessRouting.Pref.values().filterNot { it == PreprocessRouting.Pref.AI_MONITORING },
      PreprocessRouting.offeredPrefs(emptyList()),
    )
  }

  @Test
  fun aiMonitoringUsesTheU1DefectDetectionCommand() {
    assertEquals(
      "DEFECT_DETECTION_CONFIG MAIN_ENABLE=1 CLEAN_BED_ENABLE=1 " +
        "NOODLE_ENABLE=1 SENSITIVITY=low",
      PreprocessRouting.aiMonitoringCommand(true),
    )
    assertEquals(
      "DEFECT_DETECTION_CONFIG MAIN_ENABLE=1 CLEAN_BED_ENABLE=1 " +
        "NOODLE_ENABLE=1 SENSITIVITY=high",
      PreprocessRouting.aiMonitoringCommand(true, AiDetectionSensitivity.HIGH),
    )
    assertEquals(
      "DEFECT_DETECTION_CONFIG MAIN_ENABLE=0",
      PreprocessRouting.aiMonitoringCommand(false),
    )
  }

  @Test
  fun aiMonitoringDefaultsOnAndPreservesAnExplicitChoice() {
    assertTrue(PreprocessPreferenceStore.aiMonitoringValue(null))
    assertTrue(PreprocessPreferenceStore.aiMonitoringValue(true))
    assertFalse(PreprocessPreferenceStore.aiMonitoringValue(false))
  }

  @Test
  fun aiSensitivityDefaultsLowAndRejectsUnsupportedBridgeValues() {
    assertEquals(
      AiDetectionSensitivity.LOW,
      PreprocessPreferenceStore.aiDetectionSensitivityValue(null),
    )
    assertEquals(
      AiDetectionSensitivity.HIGH,
      PreprocessPreferenceStore.aiDetectionSensitivityValue(" HIGH "),
    )
    assertEquals(
      AiDetectionSensitivity.LOW,
      PreprocessPreferenceStore.aiDetectionSensitivityValue("medium"),
    )

    var rejected = false
    try {
      AiDetectionSensitivity.fromWireValue("medium")
    } catch (_: IllegalArgumentException) {
      rejected = true
    }
    assertTrue(rejected)
  }

  @Test
  fun unknownKeysAreIgnoredRatherThanCrashing() {
    val offered = PreprocessRouting.offeredPrefs(listOf("autoLevel", "somethingNew"))
    assertEquals(listOf(PreprocessRouting.Pref.AUTO_LEVEL), offered)
  }

  @Test
  fun machineProfileParsesTheOfferedPrefs() {
    val parsed = MachineProfile.fromJson(
      """{"bed":{"sizeX":220,"sizeY":220,"height":220,"modelAsset":"ad5x_bed.stl"},
          "sliceProfileAsset":"flashforge_ad5x.json","supportsPrintPreferences":false,
          "printPrefs":["autoLevel","ifs"]}"""
    )
    assertEquals(listOf("autoLevel", "ifs"), parsed.printPrefs)
    assertEquals(220f, parsed.bed.sizeX, 0.001f)

    // A payload without the field must not wipe the sheet's toggles.
    val legacy = MachineProfile.fromJson("""{"bed":{"sizeX":270,"sizeY":270,"height":270}}""")
    assertTrue(legacy.printPrefs.isEmpty())
  }

  @Test
  fun onlyTheVerifiedBambuProfileReturnsToHelixForSending() {
    val p1s = MachineProfile.fromJson(
      """{"bed":{"sizeX":256,"sizeY":256,"height":250},
          "sliceProfileAsset":"bambu_p1s.json","supportsPrintPreferences":false}"""
    )
    assertTrue(usesHelixBambuSend(p1s))
    assertTrue(!usesHelixBambuSend(MachineProfile.U1))

    val ad5x = MachineProfile.fromJson(
      """{"bed":{"sizeX":220,"sizeY":220,"height":220},
          "sliceProfileAsset":"flashforge_ad5x.json","supportsPrintPreferences":false}"""
    )
    assertTrue(!usesHelixBambuSend(ad5x))
  }
}
