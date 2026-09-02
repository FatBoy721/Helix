package org.crabcore.u1control.bespok3d

import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

class Bespok3dSshExitStatusTest {
  @Test
  fun waitsForExitStatusPacketAfterCommandEof() {
    val statuses = ArrayDeque(listOf(-1, -1, 0))
    var now = 0L

    val result = awaitSshExitStatus(
      readStatus = { statuses.removeFirst() },
      timeoutMs = 100,
      nanoTime = { now },
      pause = { milliseconds -> now += milliseconds * 1_000_000 },
    )

    assertEquals(0, result)
    assertEquals(20_000_000L, now)
  }

  @Test
  fun preservesRealNonzeroExitStatus() {
    assertEquals(127, awaitSshExitStatus({ 127 }, timeoutMs = 100))
  }

  @Test
  fun timesOutWhenServerNeverSendsExitStatus() {
    var now = 0L
    assertThrows(SocketTimeoutException::class.java) {
      awaitSshExitStatus(
        readStatus = { -1 },
        timeoutMs = 20,
        nanoTime = { now },
        pause = { milliseconds -> now += milliseconds * 1_000_000 },
      )
    }
  }

  @Test
  fun liveStockU1SupportsSequentialSftpChannels() {
    val host = System.getenv("BESPOK3D_U1_HOST")
    val password = System.getenv("BESPOK3D_U1_PASSWORD")
    assumeTrue(
      "Set BESPOK3D_U1_HOST and BESPOK3D_U1_PASSWORD for the live test",
      host != null && password != null,
    )
    val fingerprint = Bespok3dU1Preflight().run(host!!, password!!).sshHostKeySha256

    JschBespok3dSsh(host, password, fingerprint).use { ssh ->
      repeat(3) { attempt ->
        val init = try {
          ssh.read("/etc/init.d/S90lmd").toString(Charsets.UTF_8)
        } catch (error: Throwable) {
          throw IllegalStateException("Sequential SFTP read ${attempt + 1} failed", error)
        }
        assertTrue(init.startsWith("#!"))
      }
    }
  }
}
