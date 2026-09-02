// Live chamber-camera test. Skips without a printer, like the MQTT ones:
//
//   BAMBU_HOST=192.168.1.x BAMBU_SERIAL=01P... BAMBU_ACCESS_CODE=12345678 \
//     ./gradlew :app:testDebugUnitTest --tests '*BambuLiveCameraTest*'
//
// crabcore

package org.crabcore.u1control.bambu

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.lang.reflect.InvocationTargetException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicReference

class BambuLiveCameraTest {

  private val host = System.getenv("BAMBU_HOST").orEmpty()
  private val serial = System.getenv("BAMBU_SERIAL").orEmpty()
  private val accessCode = System.getenv("BAMBU_ACCESS_CODE").orEmpty()

  private fun requirePrinter() {
    assumeTrue(
      "Set BAMBU_HOST, BAMBU_SERIAL and BAMBU_ACCESS_CODE to run the live camera test",
      host.isNotEmpty() && serial.isNotEmpty() && accessCode.isNotEmpty()
    )
  }

  @Test
  fun servesChamberFramesAsMjpeg() {
    requirePrinter()
    val camera = BambuChamberCamera()

    try {
      val url = camera.start(host, serial, accessCode)
      println("[bambu] camera serving at $url")
      assertTrue("Must serve on loopback only", url.startsWith("http://127.0.0.1:"))

      val connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 5000
        readTimeout = 20000
      }
      assertEquals(200, connection.responseCode)
      assertTrue(
        "Expected an MJPEG content type, got ${connection.contentType}",
        connection.contentType.startsWith("multipart/x-mixed-replace")
      )

      val frames = readFrames(BufferedInputStream(connection.inputStream), wanted = 2)
      connection.disconnect()

      assertEquals("Expected two frames", 2, frames.size)
      frames.forEachIndexed { index, frame ->
        assertTrue("Frame $index is too small at ${frame.size} bytes", frame.size > 1000)
        // JPEG start- and end-of-image markers.
        assertEquals("Frame $index has no JPEG SOI", 0xFFD8, marker(frame, 0))
        assertEquals("Frame $index has no JPEG EOI", 0xFFD9, marker(frame, frame.size - 2))
      }

      val saved = dumpDirectory().resolve("bambu-chamber-frame.jpg")
      saved.writeBytes(frames.last())
      println("[bambu] ${frames.size} frames, last ${frames.last().size} bytes -> ${saved.absolutePath}")
    } finally {
      camera.stop()
    }
  }

  @Test
  fun refusesAPrinterWithADifferentSerial() {
    requirePrinter()
    val camera = BambuChamberCamera()

    try {
      camera.start(host, "01PDEADBEEF000000", accessCode)
      fail("Expected the camera handshake to be refused for a mismatched serial")
    } catch (e: BambuConnectException) {
      assertEquals("wrong-serial", e.code)
      println("[bambu] camera serial mismatch refused: ${e.message}")
    } finally {
      camera.stop()
    }
  }

  @Test
  fun interruptingIdleViewerIsNormalShutdown() {
    val camera = BambuChamberCamera()
    val running = BambuChamberCamera::class.java.getDeclaredField("running").apply {
      isAccessible = true
      setBoolean(camera, true)
    }
    val streamTo = BambuChamberCamera::class.java
      .getDeclaredMethod("streamTo", java.io.OutputStream::class.java)
      .apply { isAccessible = true }
    val failure = AtomicReference<Throwable?>(null)

    val viewer = Thread {
      try {
        streamTo.invoke(camera, ByteArrayOutputStream())
      } catch (error: InvocationTargetException) {
        failure.set(error.targetException)
      } catch (error: Throwable) {
        failure.set(error)
      }
    }
    viewer.start()

    val deadline = System.currentTimeMillis() + 2000
    while (viewer.state != Thread.State.TIMED_WAITING && System.currentTimeMillis() < deadline) {
      Thread.yield()
    }
    viewer.interrupt()
    viewer.join(2000)
    running.setBoolean(camera, false)

    assertFalse("Interrupted camera viewer did not stop", viewer.isAlive)
    assertNull("Normal camera shutdown escaped as an exception", failure.get())
  }

  private fun marker(frame: ByteArray, offset: Int): Int =
    ((frame[offset].toInt() and 0xFF) shl 8) or (frame[offset + 1].toInt() and 0xFF)

  /** Minimal multipart reader: enough to prove the stream is well-formed. */
  private fun readFrames(input: BufferedInputStream, wanted: Int): List<ByteArray> {
    val frames = mutableListOf<ByteArray>()

    while (frames.size < wanted) {
      var length = -1
      // Headers run until a blank line; Content-Length tells us the frame size.
      while (true) {
        val line = readLine(input) ?: return frames
        if (line.isEmpty() && length >= 0) break
        if (line.startsWith("Content-Length:", ignoreCase = true)) {
          length = line.substringAfter(':').trim().toInt()
        }
      }

      val frame = ByteArray(length)
      var read = 0
      while (read < length) {
        val count = input.read(frame, read, length - read)
        if (count < 0) return frames
        read += count
      }
      frames.add(frame)
    }

    return frames
  }

  private fun readLine(input: BufferedInputStream): String? {
    val builder = StringBuilder()
    while (true) {
      val byte = input.read()
      if (byte < 0) return null
      if (byte == '\n'.code) return builder.toString().trimEnd('\r')
      builder.append(byte.toChar())
    }
  }

  private fun dumpDirectory(): File {
    val configured = System.getenv("BAMBU_DUMP_DIR").orEmpty()
    val dir = if (configured.isNotEmpty()) File(configured) else File("build/reports/bambu")
    dir.mkdirs()
    return dir
  }
}
