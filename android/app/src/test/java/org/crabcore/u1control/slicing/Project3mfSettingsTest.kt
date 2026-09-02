package org.crabcore.u1control.slicing

import com.u1.slicer.data.SliceConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class Project3mfSettingsTest {
  @get:Rule
  val temp = TemporaryFolder()

  private fun project3mf(name: String, settings: String?): File {
    val file = temp.newFile(name)
    ZipOutputStream(FileOutputStream(file)).use { zip ->
      zip.putNextEntry(ZipEntry("3D/3dmodel.model"))
      zip.write("<model/>".toByteArray())
      zip.closeEntry()
      if (settings != null) {
        zip.putNextEntry(ZipEntry("Metadata/project_settings.config"))
        zip.write(settings.toByteArray())
        zip.closeEntry()
      }
    }
    return file
  }

  // ---- Value reading ----

  @Test
  fun `reads Bambu's string-valued keys`() {
    val parsed = Project3mfSettings.parse(
      """{"enable_prime_tower": "1", "prime_tower_width": "35"}""",
    )

    assertEquals(true, parsed.primeTowerEnabled)
    assertEquals(35f, parsed.primeTowerWidth!!, 0.001f)
  }

  @Test
  fun `an explicit off is not the same as unset`() {
    assertEquals(false, Project3mfSettings.parse("""{"enable_prime_tower": "0"}""").primeTowerEnabled)
    assertNull(Project3mfSettings.parse("""{"layer_height": "0.2"}""").primeTowerEnabled)
  }

  @Test
  fun `per-variant arrays read their primary entry`() {
    // Bambu stores speeds once per extruder variant; Helix slices the first.
    val parsed = Project3mfSettings.parse("""{"outer_wall_speed": ["200", "350"]}""")

    assertEquals(200f, parsed.float("outer_wall_speed")!!, 0.001f)
  }

  @Test
  fun `percentages read as fractions and bare numbers pass through`() {
    assertEquals(0.15f, Project3mfSettings.parse("""{"d": "15%"}""").fraction("d")!!, 0.0001f)
    assertEquals(0.15f, Project3mfSettings.parse("""{"d": "0.15"}""").fraction("d")!!, 0.0001f)
    assertNull(Project3mfSettings.parse("""{"d": "wide"}""").fraction("d"))
  }

  @Test
  fun `nonsense values read as unset rather than as a decision`() {
    val parsed = Project3mfSettings.parse(
      """{"enable_prime_tower": "maybe", "prime_tower_width": "wide"}""",
    )

    assertNull(parsed.primeTowerEnabled)
    assertNull(parsed.primeTowerWidth)
    assertFalse(Project3mfSettings.parse("{").isPresent)
  }

  @Test
  fun `a non-positive prime tower width is refused`() {
    assertNull(Project3mfSettings.parse("""{"prime_tower_width": "0"}""").primeTowerWidth)
    assertNull(Project3mfSettings.parse("""{"prime_tower_width": "-5"}""").primeTowerWidth)
  }

  // ---- Bed temperature ----

  @Test
  fun `bed temperature follows the plate the project is set up for`() {
    val settings = """
      {"curr_bed_type": "Supertack Plate", "supertack_plate_temp": ["45"],
       "hot_plate_temp": ["65"], "textured_plate_temp": ["65"], "cool_plate_temp": ["35"]}
    """.trimIndent()

    assertEquals(45, Project3mfSettings.parse(settings).bedTemperature)
  }

  @Test
  fun `every plate label the engine knows maps to a temperature`() {
    val labels = mapOf(
      "Cool Plate" to "cool_plate_temp",
      "Textured Cool Plate" to "textured_cool_plate_temp",
      "Cool Plate (SuperTack)" to "supertack_plate_temp",
      "Engineering Plate" to "eng_plate_temp",
      "High Temp Plate" to "hot_plate_temp",
      "Textured PEI Plate" to "textured_plate_temp",
    )
    labels.entries.forEachIndexed { index, (label, key) ->
      val temp = 40 + index
      // A decoy under a different plate's key, so a mapping that ignored
      // curr_bed_type would read the wrong number rather than none at all.
      val decoy = if (key == "hot_plate_temp") "cool_plate_temp" else "hot_plate_temp"
      val parsed = Project3mfSettings.parse(
        """{"curr_bed_type": "$label", "$key": ["$temp"], "$decoy": ["99"]}""",
      )
      assertEquals("$label should read $key", temp, parsed.bedTemperature)
    }
  }

  @Test
  fun `an unknown plate falls back to the high temp figure`() {
    val parsed = Project3mfSettings.parse(
      """{"curr_bed_type": "Mystery Plate", "hot_plate_temp": ["70"]}""",
    )

    assertEquals(70, parsed.bedTemperature)
  }

  @Test
  fun `a zeroed plate temperature is not a reading`() {
    assertNull(
      Project3mfSettings.parse("""{"curr_bed_type": "Cool Plate", "cool_plate_temp": ["0"]}""")
        .bedTemperature,
    )
  }

  // ---- SliceConfig seeding ----

  @Test
  fun `the project's settings reach SliceConfig instead of Helix defaults`() {
    val config = SliceConfig()
    val settings = """
      {
        "layer_height": "0.16", "initial_layer_print_height": "0.2",
        "wall_loops": "3", "top_shell_layers": "4", "bottom_shell_layers": "3",
        "sparse_infill_density": "25%", "sparse_infill_pattern": "grid",
        "outer_wall_speed": ["200", "350"], "travel_speed": ["500", "500"],
        "initial_layer_speed": ["50", "50"],
        "skirt_loops": "1", "skirt_distance": "2", "brim_width": "5",
        "enable_support": "1", "support_type": "tree(auto)",
        "support_threshold_angle": "30", "support_on_build_plate_only": "1",
        "support_base_pattern": "rectilinear", "support_filament": "2",
        "support_interface_filament": "3",
        "nozzle_diameter": ["0.4"], "filament_diameter": ["1.75"],
        "filament_type": ["PETG"], "nozzle_temperature": ["245"],
        "curr_bed_type": "Textured PEI Plate", "textured_plate_temp": ["70"],
        "retraction_length": ["0.8"], "retraction_speed": ["30"]
      }
    """.trimIndent()

    Project3mfSettings.parse(settings).applyTo(config)

    assertEquals(0.16f, config.layerHeight, 0.0001f)
    assertEquals(0.2f, config.firstLayerHeight, 0.0001f)
    assertEquals(3, config.perimeters)
    assertEquals(4, config.topSolidLayers)
    assertEquals(3, config.bottomSolidLayers)
    assertEquals(0.25f, config.fillDensity, 0.0001f)
    assertEquals("grid", config.fillPattern)
    assertEquals(200f, config.printSpeed, 0.001f)
    assertEquals(500f, config.travelSpeed, 0.001f)
    assertEquals(50f, config.firstLayerSpeed, 0.001f)
    assertEquals(1, config.skirtLoops)
    assertEquals(2f, config.skirtDistance, 0.001f)
    assertEquals(5f, config.brimWidth, 0.001f)
    assertTrue(config.supportEnabled)
    assertEquals("tree(auto)", config.supportType)
    assertEquals(30f, config.supportAngle, 0.001f)
    assertTrue(config.supportBuildPlateOnly)
    assertEquals("rectilinear", config.supportPattern)
    assertEquals(2, config.supportFilament)
    assertEquals(3, config.supportInterfaceFilament)
    assertEquals(0.4f, config.nozzleDiameter, 0.0001f)
    assertEquals(1.75f, config.filamentDiameter, 0.0001f)
    assertEquals("PETG", config.filamentType)
    assertEquals(245, config.nozzleTemp)
    assertEquals(70, config.bedTemp)
    assertEquals(0.8f, config.retractLength, 0.0001f)
    assertEquals(30f, config.retractSpeed, 0.001f)
  }

  @Test
  fun `a key the project omits leaves the Helix default standing`() {
    val defaults = SliceConfig()
    val config = SliceConfig()

    Project3mfSettings.parse("""{"layer_height": "0.16"}""").applyTo(config)

    assertEquals(0.16f, config.layerHeight, 0.0001f)
    assertEquals(defaults.perimeters, config.perimeters)
    assertEquals(defaults.fillPattern, config.fillPattern)
    assertEquals(defaults.bedTemp, config.bedTemp)
    assertEquals(defaults.supportEnabled, config.supportEnabled)
  }

  @Test
  fun `a file with no project settings changes nothing`() {
    val defaults = SliceConfig()
    val config = SliceConfig()

    Project3mfSettings.NONE.applyTo(config)

    assertEquals(defaults.layerHeight, config.layerHeight, 0.0001f)
    assertEquals(defaults.bedTemp, config.bedTemp)
    assertEquals(defaults.fillDensity, config.fillDensity, 0.0001f)
  }

  // ---- Reading from disk ----

  @Test
  fun `reads the config out of a real 3MF`() {
    val file = project3mf("project.3mf", """{"enable_prime_tower": "1", "prime_tower_width": "42"}""")

    val parsed = Project3mfSettings.read(file.absolutePath)

    assertTrue(parsed.isPresent)
    assertEquals(true, parsed.primeTowerEnabled)
    assertEquals(42f, parsed.primeTowerWidth!!, 0.001f)
  }

  @Test
  fun `anything unreadable yields NONE instead of throwing`() {
    val noSettings = project3mf("bare.3mf", null)
    val notAZip = temp.newFile("broken.3mf").apply { writeText("not a zip") }
    val stl = temp.newFile("model.stl")

    listOf(
      noSettings.absolutePath,
      notAZip.absolutePath,
      stl.absolutePath,
      File(temp.root, "gone.3mf").absolutePath,
      null,
      "  ",
    ).forEach { path ->
      assertFalse("$path should read as absent", Project3mfSettings.read(path).isPresent)
    }
  }

  @Test
  fun `NONE decides nothing`() {
    assertFalse(Project3mfSettings.NONE.isPresent)
    assertNull(Project3mfSettings.NONE.primeTowerEnabled)
    assertNull(Project3mfSettings.NONE.primeTowerWidth)
    assertNull(Project3mfSettings.NONE.bedTemperature)
    assertTrue(Project3mfSettings.DEFAULT_PRIME_TOWER_WIDTH_MM > 0f)
  }

  // ---- Project settings sheet ----

  @Test
  fun `the sheet reports the project's values against the profile's`() {
    val project = Project3mfSettings.parse(
      """{"layer_height": "0.16", "wall_loops": "3", "sparse_infill_density": "25%"}""",
    )
    val profile = Project3mfSettings.parse(
      """{"layer_height": "0.2", "wall_loops": "3", "sparse_infill_density": "15%"}""",
    )

    val rows = project.summarize(profile).associateBy { it.label }

    assertEquals("0.16 mm", rows["Layer height"]!!.value)
    assertEquals("0.2 mm", rows["Layer height"]!!.default)
    assertTrue(rows["Layer height"]!!.differs)
    // Same value on both sides is not a change.
    assertFalse(rows["Walls"]!!.differs)
    assertTrue(rows["Infill"]!!.differs)
  }

  @Test
  fun `a setting the project omits is left off the sheet`() {
    val rows = Project3mfSettings.parse("""{"layer_height": "0.2"}""").summarize()

    assertEquals(listOf("Layer height"), rows.map { it.label })
  }

  @Test
  fun `with no profile to compare against nothing reads as changed`() {
    val project = Project3mfSettings.parse("""{"layer_height": "0.16", "wall_loops": "3"}""")

    val rows = project.summarize(Project3mfSettings.NONE)

    assertEquals(2, rows.size)
    assertTrue(rows.none { it.differs })
    assertTrue(rows.all { it.default == null })
  }

  @Test
  fun `an STL has no sheet`() {
    assertTrue(Project3mfSettings.NONE.summarize().isEmpty())
  }

  @Test
  fun `booleans read as words rather than digits`() {
    val rows = Project3mfSettings.parse(
      """{"enable_support": "1", "enable_prime_tower": "0"}""",
    ).associateRows()

    assertEquals("On", rows["Supports"]!!.value)
    assertEquals("Off", rows["Prime tower"]!!.value)
  }

  private fun Project3mfSettings.associateRows() = summarize().associateBy { it.label }

  // ---- Seeding the prepare screen ----

  @Test
  fun `the prepare screen opens showing what the project asks for`() {
    val project = Project3mfSettings.parse(
      """
      {"enable_support": "1", "support_type": "tree(auto)", "support_threshold_angle": "30",
       "support_on_build_plate_only": "1", "support_base_pattern": "rectilinear",
       "brim_type": "outer_only", "brim_width": "5",
       "sparse_infill_density": "25%", "sparse_infill_pattern": "grid",
       "ironing_type": "top", "ironing_flow": "20%", "ironing_speed": "25"}
      """.trimIndent(),
    )

    val seeded = HelixSliceSettings.seededFrom(project)

    assertTrue(seeded.supportsEnabled)
    assertEquals("tree(auto)", seeded.supportType)
    assertEquals(30, seeded.supportAngle)
    assertTrue(seeded.supportBuildPlateOnly)
    assertEquals("rectilinear", seeded.supportPattern)
    assertEquals(5f, seeded.brimWidthMm, 0.001f)
    assertEquals(0.25f, seeded.infillDensity, 0.0001f)
    assertEquals("grid", seeded.infillPattern)
    assertEquals("top", seeded.ironingType)
    assertEquals(20, seeded.ironingFlow)
    assertEquals(25, seeded.ironingSpeed)
  }

  @Test
  fun `seeded values are not treated as user overrides`() {
    val project = Project3mfSettings.parse("""{"enable_support": "1", "brim_width": "5"}""")

    val seeded = HelixSliceSettings.seededFrom(project)

    // Showing the file's supports must not write them back as a Helix override,
    // or every project would be re-stamped with its own values on every slice.
    assertTrue(seeded.chosen.isEmpty())
    assertTrue(seeded.toProfileKeyOverrides().isEmpty())
  }

  @Test
  fun `a project with its brim switched off shows no brim width`() {
    val seeded = HelixSliceSettings.seededFrom(
      Project3mfSettings.parse("""{"brim_type": "no_brim", "brim_width": "5"}"""),
    )

    assertEquals(0f, seeded.brimWidthMm, 0.001f)
    assertFalse(seeded.hasBrimEnabled())
  }

  @Test
  fun `an STL seeds the prepare screen with plain defaults`() {
    assertEquals(HelixSliceSettings(), HelixSliceSettings.seededFrom(Project3mfSettings.NONE))
  }
}
