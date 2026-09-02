package org.crabcore.u1control.bambu

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.InputStream

class BambuFtpsClientTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `upload uses implicit FTPS root contract and verifies remote size`() {
    val artifact = temporaryFolder.newFile("safe_job.gcode.3mf").apply {
      writeBytes(byteArrayOf(1, 2, 3, 4))
    }
    val session = RecordingSession(remoteSize = artifact.length())
    val client = BambuFtpsClient { session }

    val result = client.upload(CONFIG, artifact)

    assertEquals("safe_job.gcode.3mf", result.remoteName)
    assertEquals(4L, result.verifiedBytes)
    assertEquals(
      listOf(
        "connect:printer.local:990:15000:120000",
        "login:bblp",
        "binary",
        "pbsz0-protp",
        "passive",
        "store:safe_job.gcode.3mf:4",
        "size:safe_job.gcode.3mf",
        "logout",
        "close",
      ),
      session.calls,
    )
  }

  @Test
  fun `upload rejects paths and raw gcode before opening a connection`() {
    val artifact = temporaryFolder.newFile("safe_job.gcode.3mf").apply { writeText("archive") }
    var opened = false
    val client = BambuFtpsClient {
      opened = true
      RecordingSession(artifact.length())
    }

    val pathError = runCatching { client.upload(CONFIG, artifact, "cache/safe_job.gcode.3mf") }
      .exceptionOrNull()
    val typeError = runCatching { client.upload(CONFIG, artifact, "safe_job.gcode") }
      .exceptionOrNull()

    assertTrue(pathError?.message.orEmpty().contains("printer root"))
    assertTrue(typeError?.message.orEmpty().contains("filename"))
    assertTrue(!opened)
  }

  @Test
  fun `upload fails closed when SIZE does not match and always disconnects`() {
    val artifact = temporaryFolder.newFile("safe_job.gcode.3mf").apply { writeText("archive") }
    val session = RecordingSession(remoteSize = artifact.length() - 1)
    val client = BambuFtpsClient { session }

    val error = runCatching { client.upload(CONFIG, artifact) }.exceptionOrNull()

    assertTrue(error?.message.orEmpty().contains("size verification failed"))
    assertEquals("close", session.calls.last())
    assertTrue("logout" !in session.calls)
  }

  private class RecordingSession(private val remoteSize: Long?) : BambuFtpsSession {
    val calls = mutableListOf<String>()

    override fun connect(host: String, port: Int, connectTimeoutMs: Int, dataTimeoutMs: Int) {
      calls += "connect:$host:$port:$connectTimeoutMs:$dataTimeoutMs"
    }

    override fun login(username: String, password: String): Boolean {
      calls += "login:$username"
      return true
    }

    override fun useBinaryTransfers(): Boolean {
      calls += "binary"
      return true
    }

    override fun protectDataChannel() {
      calls += "pbsz0-protp"
    }

    override fun usePassiveMode() {
      calls += "passive"
    }

    override fun store(remoteName: String, input: InputStream): Boolean {
      calls += "store:$remoteName:${input.readBytes().size}"
      return true
    }

    override fun size(remoteName: String): Long? {
      calls += "size:$remoteName"
      return remoteSize
    }

    override fun logout() {
      calls += "logout"
    }

    override fun close() {
      calls += "close"
    }
  }

  private companion object {
    val CONFIG = BambuFtpsConfig(
      host = "printer.local",
      serial = "01P00C000000000",
      accessCode = "stored-code",
    )
  }
}
