package org.crabcore.u1control.slicing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * The project-settings sheet against real bundled profile data.
 *
 * The curated key list is only useful if those keys exist in the files users
 * actually open; a typo in one would silently drop its row and nothing else
 * would notice.
 */
class ProjectSettingsSheetAssetTest {

  private fun asset(name: String): File? = listOf(
    File("src/main/assets/orca_profiles/printer/$name"),
    File("app/src/main/assets/orca_profiles/printer/$name"),
    File("android/app/src/main/assets/orca_profiles/printer/$name"),
  ).firstOrNull { it.exists() }

  private fun settings(name: String): Project3mfSettings? =
    asset(name)?.let { Project3mfSettings.parse(it.readText()) }

  @Test
  fun `every curated setting is present in a real Bambu profile`() {
    val profile = settings("bambu_a1.json")
    assumeTrue("bundled A1 profile not reachable from the test working directory", profile != null)

    val rows = profile!!.summarize()

    // Every row the sheet can show should resolve against real data.
    assertEquals(20, rows.size)
    assertTrue(rows.all { it.value.isNotBlank() })
    assertEquals("0.2 mm", rows.first { it.label == "Layer height" }.value)
    assertEquals("Supertack Plate", rows.first { it.label == "Build plate" }.value)
    // The A1's Supertack PLA figure, not the High Temp plate's.
    assertEquals("45°C", rows.first { it.label == "Bed temp" }.value)
  }

  @Test
  fun `a profile compared against itself reports no changes`() {
    val profile = settings("bambu_a1.json")
    assumeTrue("bundled A1 profile not reachable from the test working directory", profile != null)

    assertTrue(profile!!.summarize(profile).none { it.differs })
  }

  @Test
  fun `a project that changed something is reported as changed`() {
    val profile = settings("bambu_a1.json")
    assumeTrue("bundled A1 profile not reachable from the test working directory", profile != null)

    val project = Project3mfSettings.parse("""{"layer_height": "0.28", "wall_loops": "2"}""")
    val rows = project.summarize(profile!!).associateBy { it.label }

    assertEquals("0.28 mm", rows["Layer height"]!!.value)
    assertEquals("0.2 mm", rows["Layer height"]!!.default)
    assertTrue(rows["Layer height"]!!.differs)
    assertEquals(false, rows["Walls"]!!.differs)
  }
}
