package org.crabcore.u1control.slicing

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/**
 * Reads and splits Bambu/OrcaSlicer multi-plate 3MFs.
 *
 * The native engine has no plate concept — loadModel() drops every object from
 * every plate onto one bed (they're laid out across world-X in the source file,
 * so they land off the 270mm bed / overlapping). To print a single plate we
 * repack a temp 3MF whose <build> keeps only that plate's objects, then let the
 * prepare screen auto-arrange them back onto the bed.
 *
 * Plate → object mapping lives in Metadata/model_settings.config:
 *   <plate>
 *     <metadata key="plater_id" value="2"/>
 *     <metadata key="plater_name" value="Body"/>
 *     <metadata key="thumbnail_file" value="Metadata/plate_2.png"/>
 *     <model_instance><metadata key="object_id" value="14"/>...</model_instance>
 *   </plate>
 * and the geometry/placement in 3D/3dmodel.model's <build><item objectid=.../>.
 */
object PlateExtractor {

  data class Plate(
    val id: Int,
    val name: String,
    val objectIds: List<Int>,
    val thumbnailEntry: String?,
  )

  private val PLATE_BLOCK =
    Regex("<plate\\b[^>]*>(.*?)</plate>", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val META =
    Regex("<metadata\\s+key=\"([^\"]+)\"\\s+value=\"([^\"]*)\"", RegexOption.IGNORE_CASE)
  private val OBJECT_ID =
    Regex("<metadata\\s+key=\"object_id\"\\s+value=\"(\\d+)\"", RegexOption.IGNORE_CASE)

  private val BUILD_BLOCK =
    Regex("(<build\\b[^>]*>)(.*?)(</build>)", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val ITEM =
    Regex("<item\\b[^>]*?/>|<item\\b[^>]*?>.*?</item>", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val ITEM_OBJECT_ID = Regex("objectid=\"(\\d+)\"", RegexOption.IGNORE_CASE)
  private val OBJECT_BLOCK =
    Regex("<object\\b[^>]*\\bid=\"(\\d+)\"[^>]*(?:/>|>.*?</object>)", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val MODEL_INSTANCE =
    Regex("<model_instance\\b[^>]*>.*?</model_instance>", setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
  private val ASSEMBLE_ITEM = Regex("<assemble_item\\b[^>]*?/>", RegexOption.IGNORE_CASE)
  private val ASSEMBLE_ITEM_OBJECT_ID = Regex("\\bobject_id=\"(\\d+)\"", RegexOption.IGNORE_CASE)

  /** Plate definitions in file order. Empty when the 3MF isn't multi-plate. */
  fun readPlates(file: File): List<Plate> {
    val config = readEntryText(file, "Metadata/model_settings.config") ?: return emptyList()
    val plates = ArrayList<Plate>()
    var index = 0
    for (match in PLATE_BLOCK.findAll(config)) {
      index++
      val block = match.groupValues[1]
      var id = index
      var name = ""
      var thumbnail: String? = null
      for (meta in META.findAll(block)) {
        val key = meta.groupValues[1]
        val value = meta.groupValues[2]
        when (key) {
          "plater_id" -> value.toIntOrNull()?.let { id = it }
          "plater_name" -> name = value
          "thumbnail_file" -> if (value.isNotBlank()) thumbnail = value
        }
      }
      val objectIds = OBJECT_ID.findAll(block)
        .mapNotNull { it.groupValues[1].toIntOrNull() }
        .toList()
      plates.add(Plate(id, name.ifBlank { "Plate $id" }, objectIds, thumbnail))
    }
    return plates
  }

  /**
   * Writes a single-plate copy of [src] to [outFile]: every zip entry is copied
   * verbatim except 3D/3dmodel.model, whose <build> is filtered to the plate's
   * objects. Returns [outFile].
   */
  fun extractPlate(src: File, plate: Plate, outFile: File): File {
    val keep = plate.objectIds.toHashSet()
    ZipFile(src).use { zip ->
      ZipOutputStream(outFile.outputStream().buffered()).use { out ->
        val entries = zip.entries()
        while (entries.hasMoreElements()) {
          val entry = entries.nextElement()
          if (entry.isDirectory) continue
          out.putNextEntry(ZipEntry(entry.name))
          if (entry.name.equals("3D/3dmodel.model", ignoreCase = true)) {
            val xml = zip.getInputStream(entry).bufferedReader().use { it.readText() }
            out.write(filterBuild(xml, keep).toByteArray())
          } else {
            zip.getInputStream(entry).use { it.copyTo(out) }
          }
          out.closeEntry()
        }
      }
    }
    return outFile
  }

  private val COMPONENT_PATH = Regex("<component\\b[^>]*\\bp:path=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
  private val RELATIONSHIP = Regex("<Relationship\\b[^>]*\\bTarget=\"([^\"]+)\"[^>]*/?>", RegexOption.IGNORE_CASE)

  /**
   * Writes a copy of [src] to [outFile] with the [index]-th <build><item> removed
   * (used by the prepare screen's Delete). Returns false — and leaves no useful
   * output — when the model has 0/1 items or the index is out of range.
   *
   * Production-extension 3MFs (Bambu/Orca) split each object's mesh into its own
   * part file (3D/Objects/object_N.model), referenced from the root model via
   * <component p:path="..."> and declared in 3D/_rels/3dmodel.model.rels. Dropping
   * the <item>+<object> alone leaves that part file's relationship dangling, which
   * the native loader rejects — so we also drop the orphaned part file and its
   * relationship entry.
   */
  private data class DropResult(
    val xml: String,
    val removed: Boolean,
    val orphanedPaths: Set<String>,
    val removedObjectId: Int?,
  )

  fun removeBuildItem(src: File, index: Int, outFile: File): Boolean {
    var result: DropResult? = null
    ZipFile(src).use { zip ->
      val modelEntry = zip.getEntry("3D/3dmodel.model")
      if (modelEntry != null) {
        val xml = zip.getInputStream(modelEntry).bufferedReader().use { it.readText() }
        result = dropBuildItem(xml, index)
      }
      val res = result
      if (res == null || !res.removed) return false

      val skipEntries = res.orphanedPaths.map { it.removePrefix("/") }.toHashSet()
      ZipOutputStream(outFile.outputStream().buffered()).use { out ->
        val entries = zip.entries()
        while (entries.hasMoreElements()) {
          val entry = entries.nextElement()
          if (entry.isDirectory || entry.name in skipEntries) continue
          out.putNextEntry(ZipEntry(entry.name))
          when {
            entry.name.equals("3D/3dmodel.model", ignoreCase = true) -> {
              out.write(res.xml.toByteArray())
            }
            entry.name.equals("3D/_rels/3dmodel.model.rels", ignoreCase = true) && res.orphanedPaths.isNotEmpty() -> {
              val rels = zip.getInputStream(entry).bufferedReader().use { it.readText() }
              out.write(dropRelationships(rels, res.orphanedPaths).toByteArray())
            }
            entry.name.equals("Metadata/model_settings.config", ignoreCase = true) && res.removedObjectId != null -> {
              val config = zip.getInputStream(entry).bufferedReader().use { it.readText() }
              out.write(dropConfigObject(config, res.removedObjectId!!).toByteArray())
            }
            else -> zip.getInputStream(entry).use { it.copyTo(out) }
          }
          out.closeEntry()
        }
      }
    }
    return true
  }

  /** Drops <Relationship> entries whose Target matches one of [targets] (leading-slash tolerant). */
  private fun dropRelationships(xml: String, targets: Set<String>): String {
    val normalized = targets.map { it.removePrefix("/") }.toHashSet()
    return RELATIONSHIP.replace(xml) { m ->
      if (m.groupValues[1].removePrefix("/") in normalized) "" else m.value
    }
  }

  /**
   * Metadata/model_settings.config duplicates the object/plate/assembly wiring
   * independently of 3D/3dmodel.model (that's how the plate picker maps objects
   * to plates at all) — so a deleted object needs to come out here too, or the
   * config keeps pointing at an object_id that no longer exists anywhere.
   */
  private fun dropConfigObject(xml: String, objectId: Int): String {
    var out = OBJECT_BLOCK.replace(xml) { m -> if (m.groupValues[1].toIntOrNull() == objectId) "" else m.value }
    out = MODEL_INSTANCE.replace(out) { m ->
      if (OBJECT_ID.find(m.value)?.groupValues?.get(1)?.toIntOrNull() == objectId) "" else m.value
    }
    out = ASSEMBLE_ITEM.replace(out) { m ->
      if (ASSEMBLE_ITEM_OBJECT_ID.find(m.value)?.groupValues?.get(1)?.toIntOrNull() == objectId) "" else m.value
    }
    return out
  }

  private fun dropBuildItem(xml: String, index: Int): DropResult {
    val match = BUILD_BLOCK.find(xml) ?: return DropResult(xml, false, emptySet(), null)
    val open = match.groupValues[1]
    val body = match.groupValues[2]
    val close = match.groupValues[3]
    val items = ITEM.findAll(body).map { it.value }.toList()
    if (items.size <= 1 || index !in items.indices) return DropResult(xml, false, emptySet(), null)

    val removedObjectId = ITEM_OBJECT_ID.find(items[index])?.groupValues?.get(1)?.toIntOrNull()

    val kept = StringBuilder()
    items.forEachIndexed { i, item -> if (i != index) kept.append("\n  ").append(item.trim()) }
    var rebuilt = xml.substring(0, match.range.first) +
      open + kept.toString() + "\n " + close +
      xml.substring(match.range.last + 1)

    // 3MF requires every <resources><object> to be referenced by a build item or
    // a component — dropping the item alone leaves its object orphaned, which our
    // (strict) native loader rejects outright. Drop the object resource too, but
    // only if nothing else still points at it (another item, or a component of a
    // still-present assembly object).
    var orphanedPaths = emptySet<String>()
    if (removedObjectId != null && !Regex("objectid=\"$removedObjectId\"", RegexOption.IGNORE_CASE).containsMatchIn(rebuilt)) {
      rebuilt = OBJECT_BLOCK.replace(rebuilt) { m ->
        if (m.groupValues[1].toIntOrNull() == removedObjectId) {
          orphanedPaths = COMPONENT_PATH.findAll(m.value).map { it.groupValues[1] }.toHashSet()
          ""
        } else {
          m.value
        }
      }
    }
    return DropResult(rebuilt, true, orphanedPaths, removedObjectId)
  }

  /** The plate thumbnail PNG as a data: URI, or null. */
  fun readThumbnailDataUri(file: File, entry: String?): String? {
    if (entry.isNullOrBlank()) return null
    val bytes = readEntryBytes(file, entry) ?: return null
    return "data:image/png;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
  }

  /** Keeps only <item> elements whose objectid is in [keep]. */
  private fun filterBuild(xml: String, keep: Set<Int>): String {
    if (keep.isEmpty()) return xml
    val match = BUILD_BLOCK.find(xml) ?: return xml
    val open = match.groupValues[1]
    val body = match.groupValues[2]
    val close = match.groupValues[3]

    val kept = StringBuilder()
    for (item in ITEM.findAll(body)) {
      val id = ITEM_OBJECT_ID.find(item.value)?.groupValues?.get(1)?.toIntOrNull() ?: continue
      if (id in keep) kept.append("\n  ").append(item.value.trim())
    }
    // Never emit an empty build — fall back to the original if nothing matched.
    if (kept.isEmpty()) return xml

    return xml.substring(0, match.range.first) +
      open + kept.toString() + "\n " + close +
      xml.substring(match.range.last + 1)
  }

  private fun readEntryText(file: File, entryName: String): String? = try {
    ZipFile(file).use { zip ->
      zip.getEntry(entryName)?.let { entry ->
        zip.getInputStream(entry).bufferedReader().use { it.readText() }
      }
    }
  } catch (_: Throwable) {
    null
  }

  private fun readEntryBytes(file: File, entryName: String): ByteArray? = try {
    ZipFile(file).use { zip ->
      zip.getEntry(entryName)?.let { entry ->
        zip.getInputStream(entry).use { it.readBytes() }
      }
    }
  } catch (_: Throwable) {
    null
  }
}
