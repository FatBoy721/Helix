package org.crabcore.u1control.slicing

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/**
 * Writes prepare-screen slice overrides into a 3MF's embedded
 * [Metadata/project_settings.config] so MakerWorld/Bambu files honour them
 * (the native engine reads embedded profile keys instead of [SliceConfig] support
 * fields when a Snapmaker profile is present).
 */
object SliceSettings3mfPatcher {
  private const val PROJECT_SETTINGS = "Metadata/project_settings.config"

  fun resolvePath(context: Context, sourcePath: String, settings: HelixSliceSettings): String {
    if (!sourcePath.endsWith(".3mf", ignoreCase = true)) return sourcePath
    val overrides = settings.toProfileKeyOverrides()
    if (overrides.isEmpty()) return sourcePath

    val source = File(sourcePath)
    if (!source.exists()) return sourcePath

    ZipFile(source).use { zip ->
      val entry = zip.getEntry(PROJECT_SETTINGS) ?: return sourcePath
      val merged = JSONObject(
        zip.getInputStream(entry).bufferedReader().use { it.readText() },
      )
      for ((key, value) in overrides) {
        merged.put(key, value)
      }
      val payload = merged.toString(2).toByteArray(Charsets.UTF_8)

      val out = File(context.cacheDir, "helix_settings_${source.name}")
      ZipOutputStream(FileOutputStream(out)).use { dest ->
        zip.entries().asIterator().forEach { item ->
          if (item.name == PROJECT_SETTINGS) return@forEach
          dest.putNextEntry(ZipEntry(item.name))
          zip.getInputStream(item).use { input -> input.copyTo(dest) }
          dest.closeEntry()
        }
        dest.putNextEntry(ZipEntry(PROJECT_SETTINGS))
        dest.write(payload)
        dest.closeEntry()
      }
      return out.absolutePath
    }
  }
}
