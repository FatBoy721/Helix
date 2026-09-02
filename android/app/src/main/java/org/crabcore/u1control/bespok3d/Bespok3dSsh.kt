package org.crabcore.u1control.bespok3d

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.ChannelSftp
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

internal interface Bespok3dSsh : Closeable {
  fun exec(command: String): String
  fun read(path: String): ByteArray
  fun write(path: String, bytes: ByteArray, mode: Int = 0b110100100)
  fun reconnect()
}

internal fun interface Bespok3dSshFactory {
  fun open(host: String, password: String, expectedHostKeySha256: String): Bespok3dSsh
}

/** SSH transport used only after the user has confirmed the fingerprint returned by preflight. */
internal class JschBespok3dSsh(
  host: String,
  password: String,
  expectedHostKeySha256: String,
) : Bespok3dSsh {
  private val cleanHost = validateHost(host)
  private val passwordBytes = password.toByteArray(Charsets.UTF_8)
  private val expectedFingerprint = validateFingerprint(expectedHostKeySha256)
  private var session: Session? = null
  private var sftpSession: Session? = null
  private var sftpChannel: ChannelSftp? = null

  init {
    require(passwordBytes.isNotEmpty()) { "SSH password is required" }
    connect()
  }

  override fun exec(command: String): String {
    require(command.isNotBlank()) { "SSH command is required" }
    val active = connectedSession()
    val errors = ByteArrayOutputStream()
    val channel = active.openChannel("exec") as ChannelExec
    try {
      channel.setCommand(command)
      channel.setInputStream(null)
      channel.setErrStream(errors)
      val output = channel.inputStream
      channel.connect(TIMEOUT_MS)
      val text = output.readLimited(MAX_COMMAND_OUTPUT_BYTES).toString(Charsets.UTF_8)
      if (channel.awaitExitStatus(TIMEOUT_MS) != 0) {
        val detail = errors.toByteArray().take(MAX_ERROR_BYTES).toByteArray()
          .toString(Charsets.UTF_8).trim()
        throw IllegalStateException(detail.ifEmpty { "Bespok3d SSH command failed" })
      }
      return text
    } finally {
      channel.disconnect()
    }
  }

  override fun read(path: String): ByteArray {
    validateRemotePath(path)
    try {
      return connectedSftpChannel().get(path).use { it.readLimited(MAX_REMOTE_FILE_BYTES) }
    } catch (error: Throwable) {
      disconnectSftp()
      throw error
    }
  }

  override fun write(path: String, bytes: ByteArray, mode: Int) {
    validateRemotePath(path)
    require(mode in 0..0b111111111) { "Remote file mode is invalid" }
    require(bytes.size <= MAX_REMOTE_FILE_BYTES) { "Remote file exceeds upload limit" }
    val temporary = "$path.helix-${UUID.randomUUID()}"
    val channel = connectedSftpChannel()
    try {
      channel.put(bytes.inputStream(), temporary)
      channel.chmod(mode, temporary)
      channel.rename(temporary, path)
    } catch (error: Throwable) {
      runCatching { channel.rm(temporary) }
      disconnectSftp()
      throw error
    }
  }

  override fun reconnect() {
    disconnectSftp()
    session?.disconnect()
    session = null
    connect()
  }

  override fun close() {
    disconnectSftp()
    session?.disconnect()
    session = null
    passwordBytes.fill(0)
  }

  private fun connect() {
    session = createVerifiedSession()
  }

  private fun createVerifiedSession(): Session {
    val next = JSch().getSession(SSH_USER, cleanHost, SSH_PORT)
    try {
      next.setPassword(passwordBytes)
      next.setConfig("StrictHostKeyChecking", "no")
      next.setConfig("PreferredAuthentications", "password,keyboard-interactive")
      next.timeout = TIMEOUT_MS
      next.connect(TIMEOUT_MS)
      val actual = hostKeyFingerprint(next)
      require(MessageDigest.isEqual(actual.toByteArray(), expectedFingerprint.toByteArray())) {
        "U1 SSH host key changed; run preflight again before enrollment"
      }
      return next
    } catch (error: Throwable) {
      next.disconnect()
      throw error
    }
  }

  /**
   * Stock U1 closes the subsystem pipe after Helix disconnects an SFTP channel,
   * so a second channel on that SSH session fails with "Pipe closed". Keep one
   * separately authenticated channel for the enrollment's ordered transfers.
   */
  private fun connectedSftpChannel(): ChannelSftp {
    sftpChannel?.takeIf(ChannelSftp::isConnected)?.let { return it }
    disconnectSftp()
    val transferSession = createVerifiedSession()
    var channel: ChannelSftp? = null
    try {
      channel = transferSession.openChannel("sftp") as ChannelSftp
      channel.connect(TIMEOUT_MS)
      sftpSession = transferSession
      sftpChannel = channel
      return channel
    } catch (error: Throwable) {
      channel?.disconnect()
      transferSession.disconnect()
      throw error
    }
  }

  private fun disconnectSftp() {
    sftpChannel?.disconnect()
    sftpChannel = null
    sftpSession?.disconnect()
    sftpSession = null
  }

  private fun connectedSession(): Session = session?.takeIf(Session::isConnected)
    ?: throw IllegalStateException("Bespok3d SSH session is disconnected")

  private fun hostKeyFingerprint(active: Session): String {
    val hostKey = Base64.getDecoder().decode(active.hostKey.key)
    return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(
      MessageDigest.getInstance("SHA-256").digest(hostKey),
    )
  }

  private fun java.io.InputStream.readLimited(limit: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    while (true) {
      val count = read(buffer)
      if (count < 0) break
      require(output.size() + count <= limit) { "Bespok3d SSH response exceeds its size limit" }
      output.write(buffer, 0, count)
    }
    return output.toByteArray()
  }

  private companion object {
    const val SSH_USER = "root"
    const val SSH_PORT = 22
    const val TIMEOUT_MS = 8_000
    const val MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024
    const val MAX_ERROR_BYTES = 16 * 1024
    const val MAX_REMOTE_FILE_BYTES = 12 * 1024 * 1024

    fun validateHost(raw: String): String {
      val host = raw.trim().removePrefix("[").removeSuffix("]")
      require(host.isNotEmpty() && host.length <= 253) { "U1 host is required" }
      require(!host.contains('/') && !host.contains("//") && host.none(Char::isWhitespace)) {
        "U1 host must not include a URL or path"
      }
      return host
    }

    fun validateFingerprint(raw: String): String {
      val value = raw.trim()
      require(value.matches(Regex("^SHA256:[A-Za-z0-9+/]{43}$"))) {
        "Confirmed SSH host-key fingerprint is invalid"
      }
      return value
    }

    fun validateRemotePath(path: String) {
      require(path.startsWith('/') && path.length <= 512 && !path.contains('\u0000')) {
        "Remote path is invalid"
      }
      require(path.split('/').none { it == "." || it == ".." }) { "Remote path is unsafe" }
    }
  }
}
