package org.crabcore.u1control.bambu

import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** One bounded, read-only MQTT status check for an inactive Bambu printer. */
class BambuStatusProbe private constructor(
  private val connectionFactory: BambuProbeConnectionFactory,
  private val timeoutMs: Long,
) {
  constructor() : this(BambuProbeConnectionFactory(::LiveBambuProbeConnection), DEFAULT_TIMEOUT_MS)

  internal constructor(
    timeoutMs: Long,
    connectionFactory: (BambuMqttConnection.Listener) -> BambuProbeConnection,
  ) : this(BambuProbeConnectionFactory(connectionFactory), timeoutMs)

  fun probe(config: BambuStatusProbeConfig): CompletableFuture<String> {
    require(config.host.isNotBlank()) { "Bambu printer address is required" }
    require(config.serial.isNotBlank()) { "Bambu printer serial number is required" }
    require(config.accessCode.isNotBlank()) { "Bambu printer access code is required" }

    val result = CompletableFuture<String>()
    val timer = Executors.newSingleThreadScheduledExecutor { runnable ->
      Thread(runnable, "helix-bambu-status-timeout").apply { isDaemon = true }
    }
    lateinit var connection: BambuProbeConnection
    val listener = object : BambuMqttConnection.Listener {
      override fun onReport(payload: String) {
        if (isFullStatus(payload)) result.complete(payload)
      }

      override fun onStateChange(state: String, message: String?) {
        if (state == "disconnected" && !result.isDone) {
          result.completeExceptionally(
            BambuConnectException("probe-disconnected", message ?: "Bambu status connection closed")
          )
        }
      }
    }
    connection = connectionFactory.create(listener)
    val timeout = timer.schedule({
      result.completeExceptionally(
        BambuConnectException("probe-timeout", "The Bambu printer did not return its status")
      )
    }, timeoutMs, TimeUnit.MILLISECONDS)

    result.whenComplete { _, _ ->
      timeout.cancel(false)
      connection.close()
      timer.shutdownNow()
    }
    connection.connect(config).whenComplete { _, connectError ->
      if (connectError != null) {
        result.completeExceptionally(connectError)
        return@whenComplete
      }
      connection.publish(PUSH_ALL).whenComplete { _, publishError ->
        if (publishError != null) result.completeExceptionally(publishError)
      }
    }
    return result
  }

  private fun isFullStatus(payload: String): Boolean = runCatching {
    JSONObject(payload).optJSONObject("print")?.has("gcode_state") == true
  }.getOrDefault(false)

  private companion object {
    const val DEFAULT_TIMEOUT_MS = 4_000L
    const val PUSH_ALL = "{\"pushing\":{\"sequence_id\":\"0\",\"command\":\"pushall\"}}"
  }
}

internal fun interface BambuProbeConnectionFactory {
  fun create(listener: BambuMqttConnection.Listener): BambuProbeConnection
}

internal interface BambuProbeConnection {
  fun connect(config: BambuStatusProbeConfig): CompletableFuture<Void>
  fun publish(payload: String): CompletableFuture<Void>
  fun close()
}

private class LiveBambuProbeConnection(listener: BambuMqttConnection.Listener) : BambuProbeConnection {
  private val connection = BambuMqttConnection(listener)

  override fun connect(config: BambuStatusProbeConfig): CompletableFuture<Void> = connection.connect(
    config.host,
    BambuMqttConnection.DEFAULT_PORT,
    config.serial,
    config.accessCode,
  )

  override fun publish(payload: String): CompletableFuture<Void> = connection.publish(payload)

  override fun close() = connection.close()
}

data class BambuStatusProbeConfig(
  val host: String,
  val serial: String,
  val accessCode: String,
)
