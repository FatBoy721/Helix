package org.crabcore.u1control.slicing

import java.io.File
import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink

/**
 * A file body that reports how much of itself has been written, so an upload can
 * drive a real progress bar instead of an indeterminate spinner. Multi-MB G-code
 * over WiFi or Tailscale is slow enough that the difference matters.
 */
class ProgressRequestBody(
  private val file: File,
  private val mediaType: MediaType?,
  private val onProgress: (Float) -> Unit,
) : RequestBody() {
  override fun contentType(): MediaType? = mediaType

  override fun contentLength(): Long = file.length()

  override fun writeTo(sink: BufferedSink) {
    val total = file.length().coerceAtLeast(1L)
    var written = 0L
    var reported = -1
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        sink.write(buffer, 0, read)
        written += read
        // Only on whole-percent changes — OkHttp writes in small chunks and the
        // UI has no use for thousands of updates.
        val percent = ((written * 100) / total).toInt()
        if (percent != reported) {
          reported = percent
          onProgress(percent / 100f)
        }
      }
    }
  }
}
