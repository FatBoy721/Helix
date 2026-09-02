package org.crabcore.u1control.bambu

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit

class BambuStatusProbeTest {
  @Test
  fun `probe requests full state ignores deltas and closes after full report`() {
    lateinit var fake: FakeConnection
    val subject = BambuStatusProbe(1_000) { listener ->
      FakeConnection(listener).also { fake = it }
    }

    val result = subject.probe(CONFIG)

    assertEquals(PUSH_ALL, fake.published)
    fake.listener.onReport("{\"print\":{\"mc_percent\":12}}")
    assertFalse(result.isDone)
    val full = "{\"print\":{\"gcode_state\":\"IDLE\",\"mc_percent\":0}}"
    fake.listener.onReport(full)
    assertEquals(full, result.get(1, TimeUnit.SECONDS))
    assertTrue(fake.closed)
  }

  @Test
  fun `probe fails and closes when connection fails`() {
    lateinit var fake: FakeConnection
    val subject = BambuStatusProbe(1_000) { listener ->
      FakeConnection(listener, BambuConnectException("connect-failed", "offline")).also { fake = it }
    }

    val error = runCatching { subject.probe(CONFIG).get(1, TimeUnit.SECONDS) }.exceptionOrNull()

    assertTrue(error is ExecutionException)
    assertTrue(error?.cause is BambuConnectException)
    assertTrue(fake.closed)
  }

  @Test
  fun `probe times out when printer never returns a full state`() {
    lateinit var fake: FakeConnection
    val subject = BambuStatusProbe(25) { listener ->
      FakeConnection(listener).also { fake = it }
    }

    val error = runCatching { subject.probe(CONFIG).get(1, TimeUnit.SECONDS) }.exceptionOrNull()

    assertTrue(error is ExecutionException)
    assertEquals("probe-timeout", (error?.cause as BambuConnectException).code)
    assertTrue(fake.closed)
  }

  private class FakeConnection(
    val listener: BambuMqttConnection.Listener,
    private val connectError: Throwable? = null,
  ) : BambuProbeConnection {
    var published: String? = null
    var closed = false

    override fun connect(config: BambuStatusProbeConfig): CompletableFuture<Void> =
      if (connectError == null) CompletableFuture.completedFuture(null)
      else CompletableFuture<Void>().apply { completeExceptionally(connectError) }

    override fun publish(payload: String): CompletableFuture<Void> {
      published = payload
      return CompletableFuture.completedFuture(null)
    }

    override fun close() {
      closed = true
    }
  }

  private companion object {
    val CONFIG = BambuStatusProbeConfig("192.0.2.1", "01P00A000000001", "12345678")
    const val PUSH_ALL = "{\"pushing\":{\"sequence_id\":\"0\",\"command\":\"pushall\"}}"
  }
}
