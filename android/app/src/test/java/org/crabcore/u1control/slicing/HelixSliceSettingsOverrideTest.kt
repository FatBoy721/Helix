package org.crabcore.u1control.slicing

import com.u1.slicer.data.SliceConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A 3MF's own settings survive unless the user actually overrode them.
 *
 * These overrides are written into the project's `project_settings.config`, so
 * emitting a key for a group nobody touched replaced the file's answer with a
 * constructor default — which is how downloaded models arrived at the engine
 * with their supports and brim switched off.
 */
class HelixSliceSettingsOverrideTest {

  @Test
  fun `an untouched prepare screen writes no project overrides at all`() {
    assertTrue(HelixSliceSettings().toProfileKeyOverrides().isEmpty())
  }

  @Test
  fun `supports a project asked for are not switched off by an untouched dialog`() {
    val overrides = HelixSliceSettings().toProfileKeyOverrides()

    assertFalse("enable_support" in overrides)
    assertFalse("brim_width" in overrides)
    assertFalse("brim_type" in overrides)
  }

  @Test
  fun `applying the supports dialog writes supports and nothing else`() {
    val settings = HelixSliceSettings(supportsEnabled = true, supportType = "tree(auto)")
      .choosing(SliceSettingGroup.SUPPORTS)

    val overrides = settings.toProfileKeyOverrides()

    assertEquals("1", overrides["enable_support"])
    assertEquals("tree(auto)", overrides["support_type"])
    assertFalse("brim_width" in overrides)
    assertFalse("sparse_infill_density" in overrides)
    assertFalse("ironing_type" in overrides)
  }

  @Test
  fun `switching supports off is still recorded once the dialog was applied`() {
    val overrides = HelixSliceSettings(supportsEnabled = false)
      .choosing(SliceSettingGroup.SUPPORTS)
      .toProfileKeyOverrides()

    assertEquals("0", overrides["enable_support"])
  }

  @Test
  fun `an applied brim of zero still turns the project's brim off`() {
    val overrides = HelixSliceSettings(brimWidthMm = 0f)
      .choosing(SliceSettingGroup.BRIM)
      .toProfileKeyOverrides()

    assertEquals("no_brim", overrides["brim_type"])
    assertEquals("0.0", overrides["brim_width"])
  }

  @Test
  fun `an applied ironing dialog switched off still overrides the project`() {
    val overrides = HelixSliceSettings(ironingType = "no ironing")
      .choosing(SliceSettingGroup.IRONING)
      .toProfileKeyOverrides()

    assertEquals("no ironing", overrides["ironing_type"])
    assertFalse("ironing_speed" in overrides)
  }

  @Test
  fun `untouched groups leave SliceConfig alone for the project to fill`() {
    val defaults = SliceConfig()
    val config = SliceConfig(supportEnabled = true, brimWidth = 5f, fillDensity = 0.25f)

    HelixSliceSettings().applyTo(config)

    assertTrue("an untouched dialog must not disable supports", config.supportEnabled)
    assertEquals(5f, config.brimWidth, 0.001f)
    assertEquals(0.25f, config.fillDensity, 0.0001f)
    assertEquals(defaults.supportPattern, config.supportPattern)
  }

  @Test
  fun `a chosen group does reach SliceConfig`() {
    val config = SliceConfig(supportEnabled = true, brimWidth = 5f)

    HelixSliceSettings(supportsEnabled = false, brimWidthMm = 0f)
      .choosing(SliceSettingGroup.SUPPORTS)
      .choosing(SliceSettingGroup.BRIM)
      .applyTo(config)

    assertFalse(config.supportEnabled)
    assertEquals(0f, config.brimWidth, 0.001f)
  }

  @Test
  fun `the user's choice outranks the project`() {
    val config = SliceConfig()
    val project = Project3mfSettings.parse(
      """{"enable_support": "1", "sparse_infill_density": "15%"}""",
    )

    project.applyTo(config)
    HelixSliceSettings(supportsEnabled = false, infillDensity = 0.4f)
      .choosing(SliceSettingGroup.SUPPORTS)
      .choosing(SliceSettingGroup.INFILL)
      .applyTo(config)

    assertFalse(config.supportEnabled)
    assertEquals(0.4f, config.fillDensity, 0.0001f)
  }

  // ---- Round-tripping ----

  @Test
  fun `chosen groups survive the re-slice round trip`() {
    val settings = HelixSliceSettings(supportsEnabled = true)
      .choosing(SliceSettingGroup.SUPPORTS)
      .choosing(SliceSettingGroup.IRONING)

    val restored = HelixSliceSettings.fromJson(settings.toJson())

    assertEquals(
      setOf(SliceSettingGroup.SUPPORTS, SliceSettingGroup.IRONING),
      restored.chosen,
    )
    assertEquals(settings.toProfileKeyOverrides(), restored.toProfileKeyOverrides())
  }

  @Test
  fun `an untouched screen round-trips as untouched`() {
    val restored = HelixSliceSettings.fromJson(HelixSliceSettings().toJson())

    assertTrue(restored.chosen.isEmpty())
    assertTrue(restored.toProfileKeyOverrides().isEmpty())
  }

  @Test
  fun `a record written before chosen existed replays as fully chosen`() {
    // Those records are re-slices of a print the user had already set up, so
    // reproducing them means honouring every value they carry.
    val legacy = """{"supportsEnabled": true, "brimWidthMm": 5.0, "ironingType": "top"}"""

    val restored = HelixSliceSettings.fromJson(legacy)

    assertEquals(SliceSettingGroup.entries.toSet(), restored.chosen)
    assertEquals("1", restored.toProfileKeyOverrides()["enable_support"])
    assertEquals("5.0", restored.toProfileKeyOverrides()["brim_width"])
  }

  @Test
  fun `bridge options mark only the groups the caller sent`() {
    val supportsOnly = HelixSliceSettings.fromBridgeOptions(
      supportEnabled = true, supportType = null, supportAngle = null,
      supportFilament = null, supportInterfaceFilament = null,
      supportBuildPlateOnly = null, supportPattern = null, brimWidth = null,
    )

    assertEquals(setOf(SliceSettingGroup.SUPPORTS), supportsOnly.chosen)
    assertFalse("brim_width" in supportsOnly.toProfileKeyOverrides())
  }

  @Test
  fun `bridge options that say nothing choose nothing`() {
    val nothing = HelixSliceSettings.fromBridgeOptions(
      supportEnabled = null, supportType = null, supportAngle = null,
      supportFilament = null, supportInterfaceFilament = null,
      supportBuildPlateOnly = null, supportPattern = null, brimWidth = null,
    )

    assertTrue(nothing.chosen.isEmpty())
    assertTrue(nothing.toProfileKeyOverrides().isEmpty())
  }
}
