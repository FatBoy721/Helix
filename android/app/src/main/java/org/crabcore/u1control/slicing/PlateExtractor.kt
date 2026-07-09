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

  /**
   * Writes a copy of [src] to [outFile] with the [index]-th <build><item> removed
   * (used by the prepare screen's Delete). Returns false — and leaves no useful
   * output — when the model has 0/1 items or the index is out of range.
   */
  fun removeBuildItem(src: File, index: Int, outFile: File): Boolean {
    var removed = false
    ZipFile(src).use { zip ->
      ZipOutputStream(outFile.outputStream().buffered()).use { out ->
        val entries = zip.entries()
        while (entries.hasMoreElements()) {
          val entry = entries.nextElement()
          if (entry.isDirectory) continue
          out.putNextEntry(ZipEntry(entry.name))
          if (entry.name.equals("3D/3dmodel.model", ignoreCase = true)) {
            val xml = zip.getInputStream(entry).bufferedReader().use { it.readText() }
            val (rebuilt, ok) = dropBuildItem(xml, index)
            removed = ok
            out.write(rebuilt.toByteArray())
          } else {
            zip.getInputStream(entry).use { it.copyTo(out) }
          }
          out.closeEntry()
        }
      }
    }
    return removed
  }

  private fun dropBuildItem(xml: String, index: Int): Pair<String, Boolean> {
    val match = BUILD_BLOCK.find(xml) ?: return xml to false
    val open = match.groupValues[1]
    val body = match.groupValues[2]
    val close = match.groupValues[3]
    val items = ITEM.findAll(body).map { it.value }.toList()
    if (items.size <= 1 || index !in items.indices) return xml to false

    val kept = StringBuilder()
    items.forEachIndexed { i, item -> if (i != index) kept.append("\n  ").append(item.trim()) }
    val rebuilt = xml.substring(0, match.range.first) +
      open + kept.toString() + "\n " + close +
      xml.substring(match.range.last + 1)
    return rebuilt to true
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
