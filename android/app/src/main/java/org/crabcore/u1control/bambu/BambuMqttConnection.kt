// The Bambu LAN transport itself, deliberately free of any React Native
// imports so it can run — and be tested — on a plain JVM. The bridge lives in
// BambuMqttModule; everything that could actually fail against a real printer
// lives here.
//
// TLS notes, verified against a P1S (firmware cert issued 2026-01):
//
//   subject = CN=01P00C611300996          <- the printer's serial number
//   issuer  = C=CN, O=BBL Technologies Co., Ltd, CN=BBL CA
//
// The chain is self-signed and BBL CA is in no device trust store, so ordinary
// verification cannot work. Other clients (pybambu, Home Assistant, OctoApp)
// respond by trusting everything. We do better: the leaf CN carries the serial,
// so we accept the untrusted chain but require that CN to match the serial the
// user configured. That still needs no CA, yet binds the session to one
// specific machine instead of to whatever answers on port 8883.
// crabcore

package org.crabcore.u1control.bambu

import com.hivemq.client.mqtt.MqttClient
import com.hivemq.client.mqtt.datatypes.MqttQos
import com.hivemq.client.mqtt.mqtt3.Mqtt3AsyncClient
import java.nio.charset.StandardCharsets
import java.security.cert.CertificateException
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Failure with a stable code the JS layer can turn into a user-facing message. */
class BambuConnectException(
  val code: String,
  message: String,
  cause: Throwable? = null
) : Exception(message, cause)

/** Invalidates callbacks belonging to a replaced or intentionally closed client. */
internal class BambuConnectionSessionGate {
  @Volatile private var current = 0L

  @Synchronized fun begin(): Long = ++current
  @Synchronized fun invalidate() { current += 1 }
  fun owns(session: Long): Boolean = current == session
}

class BambuMqttConnection(private val listener: Listener) {

  interface Listener {
    /** Raw JSON from `device/{serial}/report`. Parsing belongs to the caller. */
    fun onReport(payload: String)
    fun onStateChange(state: String, message: String?)
  }

  /** Read from Netty callback threads, so not guarded by the monitor. */
  @Volatile private var client: Mqtt3AsyncClient? = null
  @Volatile private var serial: String = ""

  /**
   * Gates automatic reconnection. HiveMQ's builder-level auto-reconnect also
   * retries the *first* connect, which means a wrong access code or a typo'd
   * address never fails — the future just hangs while it retries forever. So
   * reconnection is opted into here, only once a session has been established.
   */
  @Volatile private var connectedOnce = false
  private val sessions = BambuConnectionSessionGate()

  @Synchronized
  fun connect(
    host: String,
    port: Int,
    printerSerial: String,
    accessCode: String
  ): CompletableFuture<Void> {
    close()
    val session = sessions.begin()
    serial = printerSerial

    val result = CompletableFuture<Void>()
    val mqtt = try {
      buildClient(host, port, printerSerial, session)
    } catch (e: Exception) {
      result.completeExceptionally(
        BambuConnectException("tls-setup-failed", e.message ?: "Could not configure TLS", e)
      )
      return result
    }
    client = mqtt

    mqtt.connectWith()
      .simpleAuth()
        .username(LAN_USERNAME)
        .password(accessCode.toByteArray(StandardCharsets.UTF_8))
        .applySimpleAuth()
      // The printer drops idle sockets aggressively; pybambu and OctoApp both
      // settled on 5s, and anything longer produces phantom disconnects.
      .keepAlive(KEEP_ALIVE_SECONDS)
      .cleanSession(true)
      .send()
      .whenComplete { _, error ->
        if (!owns(session, mqtt)) {
          result.completeExceptionally(cancelledConnection())
          return@whenComplete
        }
        if (error != null) {
          // Auto-reconnect would otherwise hammer a bad host forever.
          close()
          result.completeExceptionally(toConnectException(error))
        } else {
          subscribeToReports(mqtt, printerSerial, session, result)
        }
      }

    return result
  }

  @Synchronized
  fun publish(payload: String): CompletableFuture<Void> {
    val mqtt = client
    if (mqtt == null || serial.isEmpty()) {
      val failed = CompletableFuture<Void>()
      failed.completeExceptionally(
        BambuConnectException("not-connected", "Not connected to a Bambu printer")
      )
      return failed
    }

    val result = CompletableFuture<Void>()
    mqtt.publishWith()
      .topic("device/$serial/request")
      .qos(MqttQos.AT_MOST_ONCE)
      .payload(payload.toByteArray(StandardCharsets.UTF_8))
      .send()
      .whenComplete { _, error ->
        if (error != null) {
          result.completeExceptionally(
            BambuConnectException("publish-failed", error.message ?: "Could not send command", error)
          )
        } else {
          result.complete(null)
        }
      }
    return result
  }

  @Synchronized
  fun close() {
    sessions.invalidate()
    connectedOnce = false
    val existing = client
    client = null
    serial = ""
    existing?.let {
      try {
        it.disconnect()
      } catch (_: Exception) {
        // Already gone; nothing useful to report.
      }
    }
  }

  private fun buildClient(
    host: String,
    port: Int,
    printerSerial: String,
    session: Long
  ): Mqtt3AsyncClient {
    lateinit var mqtt: Mqtt3AsyncClient
    mqtt = MqttClient.builder()
      .useMqttVersion3()
      .identifier("helix-${UUID.randomUUID()}")
      .serverHost(host)
      .serverPort(port)
      .sslConfig()
        .trustManagerFactory(SerialPinningTrustManagerFactory(printerSerial))
        // The certificate names the serial, never the LAN address we dialled,
        // so hostname matching can only ever fail. Identity is enforced by the
        // trust manager above instead.
        .hostnameVerifier { _, _ -> true }
        .applySslConfig()
      .addConnectedListener {
        if (!owns(session, mqtt)) return@addConnectedListener
        val recovered = connectedOnce
        connectedOnce = true
        listener.onStateChange(STATE_CONNECTED, null)
        // cleanSession means the broker forgets our subscription across a drop,
        // so a recovered link is live but silent until we ask again.
        if (recovered) resubscribe(mqtt, printerSerial, session)
      }
      .addDisconnectedListener { context ->
        // disconnect() from an older client can complete after its replacement
        // is already Ready. Without this guard that stale callback marks the
        // new session Offline and can even reanimate the old client.
        if (!owns(session, mqtt)) return@addDisconnectedListener
        listener.onStateChange(STATE_DISCONNECTED, context.cause.message)
        if (!connectedOnce) return@addDisconnectedListener
        // Exponential up to a ceiling: a printer that is simply switched off
        // should not be polled every second for hours.
        val delaySeconds = minOf(
          MAX_RECONNECT_DELAY_SECONDS,
          1L shl minOf(context.reconnector.attempts, RECONNECT_BACKOFF_CAP)
        )
        context.reconnector.reconnect(true).delay(delaySeconds, TimeUnit.SECONDS)
      }
      .buildAsync()
    return mqtt
  }

  /**
   * Re-arms the report subscription after an automatic reconnect. Failures are
   * reported as a state change rather than thrown: the initial connect has long
   * since resolved, and there is no caller left to receive an exception.
   */
  private fun resubscribe(
    mqtt: Mqtt3AsyncClient,
    printerSerial: String,
    session: Long
  ) {
    subscribeWithCallback(mqtt, printerSerial).whenComplete { _, error ->
      if (owns(session, mqtt) && error != null) {
        listener.onStateChange(STATE_DISCONNECTED, "Lost the report feed: ${error.message}")
      }
    }
  }

  private fun subscribeWithCallback(mqtt: Mqtt3AsyncClient, printerSerial: String) =
    mqtt.subscribeWith()
      .topicFilter("device/$printerSerial/report")
      .qos(MqttQos.AT_MOST_ONCE)
      .callback { message ->
        listener.onReport(String(message.payloadAsBytes, StandardCharsets.UTF_8))
      }
      .send()

  private fun subscribeToReports(
    mqtt: Mqtt3AsyncClient,
    printerSerial: String,
    session: Long,
    result: CompletableFuture<Void>
  ) {
    subscribeWithCallback(mqtt, printerSerial)
      .whenComplete { _, error ->
        if (!owns(session, mqtt)) {
          result.completeExceptionally(cancelledConnection())
          return@whenComplete
        }
        if (error != null) {
          close()
          result.completeExceptionally(
            BambuConnectException("subscribe-failed", error.message ?: "Could not subscribe", error)
          )
        } else {
          result.complete(null)
        }
      }
  }

  private fun owns(session: Long, mqtt: Mqtt3AsyncClient): Boolean =
    sessions.owns(session) && client === mqtt

  private fun cancelledConnection() =
    BambuConnectException("connect-cancelled", "Bambu connection was replaced")

  private fun toConnectException(error: Throwable): BambuConnectException {
    // A serial mismatch surfaces as a TLS failure wrapping our own message,
    // several frames down. Recovering the code beats reporting "handshake
    // failed" to someone who simply mistyped a digit.
    var cursor: Throwable? = error
    while (cursor != null) {
      if (cursor is CertificateException && cursor.message?.contains(SERIAL_MISMATCH) == true) {
        return BambuConnectException("wrong-serial", cursor.message ?: SERIAL_MISMATCH, error)
      }
      cursor = cursor.cause
    }

    // Verified against a P1S: a bad access code comes back as
    // "CONNECT failed as CONNACK contained an Error Code: NOT_AUTHORIZED."
    if (error.message?.contains(NOT_AUTHORIZED, ignoreCase = true) == true) {
      return BambuConnectException(
        "wrong-access-code",
        "The printer rejected the access code",
        error
      )
    }

    return BambuConnectException(
      "connect-failed",
      error.message ?: "Could not reach the printer",
      error
    )
  }

  companion object {
    const val DEFAULT_PORT = 8883
    const val SERIAL_MISMATCH = BAMBU_SERIAL_MISMATCH
    private const val NOT_AUTHORIZED = "NOT_AUTHORIZED"
    private const val KEEP_ALIVE_SECONDS = 5
    private const val MAX_RECONNECT_DELAY_SECONDS = 30L
    /** 2^5s already exceeds the ceiling; keeps the shift from overflowing. */
    private const val RECONNECT_BACKOFF_CAP = 5
    /** Fixed for every Bambu printer in LAN mode; the access code is the secret. */
    private const val LAN_USERNAME = "bblp"
    private const val STATE_CONNECTED = "connected"
    private const val STATE_DISCONNECTED = "disconnected"
  }
}
