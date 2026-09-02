// Live tests against a real Bambu printer in LAN Only Mode. These are the only
// way to prove the TLS and auth path actually works — the rest of the suite can
// only prove it compiles.
//
// They skip unless the printer's details are in the environment, so CI and
// anyone without the hardware stay green:
//
//   BAMBU_HOST=192.168.1.x BAMBU_SERIAL=01P... BAMBU_ACCESS_CODE=12345678 \
//     ./gradlew :app:testDebugUnitTest --tests '*BambuLiveConnectionTest*'
//
// Nothing machine-specific belongs in this file.
// crabcore

package org.crabcore.u1control.bambu

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit

class BambuLiveConnectionTest {

  @Test
  fun replacedSessionCannotOwnNewConnectionCallbacks() {
    val sessions = BambuConnectionSessionGate()
    val first = sessions.begin()
    assertTrue(sessions.owns(first))

    val replacement = sessions.begin()
    assertFalse(sessions.owns(first))
    assertTrue(sessions.owns(replacement))

    sessions.invalidate()
    assertFalse(sessions.owns(replacement))
  }

  private val host = System.getenv("BAMBU_HOST").orEmpty()
  private val serial = System.getenv("BAMBU_SERIAL").orEmpty()
  private val accessCode = System.getenv("BAMBU_ACCESS_CODE").orEmpty()

  private fun requirePrinter() {
    assumeTrue(
      "Set BAMBU_HOST, BAMBU_SERIAL and BAMBU_ACCESS_CODE to run the live Bambu tests",
      host.isNotEmpty() && serial.isNotEmpty() && accessCode.isNotEmpty()
    )
  }

  @Test
  fun connectsAndReceivesFullState() {
    requirePrinter()

    val reports = CopyOnWriteArrayList<String>()
    val firstReport = CountDownLatch(1)
    val connection = BambuMqttConnection(object : BambuMqttConnection.Listener {
      override fun onReport(payload: String) {
        reports.add(payload)
        firstReport.countDown()
      }

      override fun onStateChange(state: String, message: String?) {
        println("[bambu] state=$state ${message.orEmpty()}")
      }
    })

    try {
      connection.connect(host, BambuMqttConnection.DEFAULT_PORT, serial, accessCode)
        .get(20, TimeUnit.SECONDS)
      println("[bambu] connected and subscribed")

      // Bambu only pushes deltas after the first report, so without pushall a
      // freshly connected client can sit there seeing almost nothing.
      connection.publish("""{"pushing":{"sequence_id":"1","command":"pushall"}}""")
        .get(10, TimeUnit.SECONDS)

      assertTrue(
        "No report arrived within 30s of pushall",
        firstReport.await(30, TimeUnit.SECONDS)
      )

      // Give the printer a moment to finish a multi-message dump before saving.
      Thread.sleep(3000)

      val dump = dumpDirectory().resolve("bambu-report-dump.json")
      dump.writeText(reports.joinToString(separator = ",\n", prefix = "[\n", postfix = "\n]"))
      println("[bambu] captured ${reports.size} report(s) -> ${dump.absolutePath}")
    } finally {
      connection.close()
    }
  }

  /**
   * The whole point of pinning the certificate CN: a printer that is not the one
   * we configured must be refused, rather than silently dropping the connection
   * the way a bad serial does at the MQTT layer.
   */
  @Test
  fun rejectsMismatchedSerial() {
    requirePrinter()

    val connection = BambuMqttConnection(object : BambuMqttConnection.Listener {
      override fun onReport(payload: String) = Unit
      override fun onStateChange(state: String, message: String?) = Unit
    })

    try {
      connection.connect(host, BambuMqttConnection.DEFAULT_PORT, "01PDEADBEEF000000", accessCode)
        .get(20, TimeUnit.SECONDS)
      fail("Expected the handshake to be refused for a serial the printer does not have")
    } catch (e: ExecutionException) {
      val cause = e.cause
      assertTrue(
        "Expected a wrong-serial failure, got: $cause",
        cause is BambuConnectException && cause.code == "wrong-serial"
      )
      println("[bambu] serial mismatch correctly refused: ${cause?.message}")
    } finally {
      connection.close()
    }
  }

  /**
   * Pins down what a bad access code actually looks like on the wire, so the
   * settings screen can say "wrong access code" instead of "connection failed".
   */
  @Test
  fun reportsBadAccessCodeDistinctly() {
    requirePrinter()

    val connection = BambuMqttConnection(object : BambuMqttConnection.Listener {
      override fun onReport(payload: String) = Unit
      override fun onStateChange(state: String, message: String?) = Unit
    })

    try {
      connection.connect(host, BambuMqttConnection.DEFAULT_PORT, serial, "00000000")
        .get(20, TimeUnit.SECONDS)
      fail("Expected the printer to refuse a bad access code")
    } catch (e: ExecutionException) {
      val cause = e.cause
      assertTrue(
        "Expected a wrong-access-code failure, got: $cause",
        cause is BambuConnectException && cause.code == "wrong-access-code"
      )
      println("[bambu] bad access code correctly refused: ${cause?.message}")
    } finally {
      connection.close()
    }
  }

  /**
   * Proves a command actually reaches the printer. The chamber light is the
   * only thing safe to drive from a test: it is instantly visible, and it moves
   * no filament and starts no print. Restores itself either way.
   */
  @Test
  fun togglesChamberLight() {
    requirePrinter()

    val connection = BambuMqttConnection(object : BambuMqttConnection.Listener {
      override fun onReport(payload: String) = Unit
      override fun onStateChange(state: String, message: String?) = Unit
    })

    fun light(on: String) =
      """{"system":{"sequence_id":"1","command":"ledctrl","led_node":"chamber_light",""" +
        """"led_mode":"$on","led_on_time":500,"led_off_time":500,"loop_times":0,"interval_time":0}}"""

    try {
      connection.connect(host, BambuMqttConnection.DEFAULT_PORT, serial, accessCode)
        .get(20, TimeUnit.SECONDS)

      connection.publish(light("off")).get(10, TimeUnit.SECONDS)
      println("[bambu] chamber light OFF")
      Thread.sleep(3000)
      connection.publish(light("on")).get(10, TimeUnit.SECONDS)
      println("[bambu] chamber light ON")
    } finally {
      connection.close()
    }
  }

  private fun dumpDirectory(): File {
    val configured = System.getenv("BAMBU_DUMP_DIR").orEmpty()
    val dir = if (configured.isNotEmpty()) File(configured) else File("build/reports/bambu")
    dir.mkdirs()
    return dir
  }
}
