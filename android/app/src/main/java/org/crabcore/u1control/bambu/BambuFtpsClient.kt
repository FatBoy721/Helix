package org.crabcore.u1control.bambu

import org.apache.commons.net.ftp.FTP
import org.apache.commons.net.ftp.FTPSClient
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.jsse.BCExtendedSSLSession
import org.bouncycastle.jsse.BCSSLSocket
import org.bouncycastle.jsse.provider.BouncyCastleJsseProvider
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.Socket
import java.security.SecureRandom
import java.time.Duration
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager

data class BambuFtpsConfig(
  val host: String,
  val serial: String,
  val accessCode: String,
  val connectTimeoutMs: Int = 15_000,
  val dataTimeoutMs: Int = 120_000,
)

data class BambuFtpsUploadResult(
  val remoteName: String,
  val verifiedBytes: Long,
)

/**
 * Uploads one print-ready archive to the printer's FTPS root.
 *
 * P1/X1 firmware runs an implicit-TLS vsftpd on port 990. Its protected data
 * connection must resume the control connection's TLS session. Android JSSE
 * cannot request a specific session, so the production session uses BCJSSE's
 * public [BCSSLSocket.setBCSessionToResume] API and pins TLS 1.2, where session
 * resumption is synchronous.
 */
class BambuFtpsClient private constructor(
  private val sessionFactory: BambuFtpsSessionFactory,
) {
  constructor() : this(BcBambuFtpsSessionFactory)

  internal constructor(sessionFactory: (BambuFtpsConfig) -> BambuFtpsSession) :
    this(BambuFtpsSessionFactory(sessionFactory))

  fun upload(config: BambuFtpsConfig, artifact: File, remoteName: String = artifact.name): BambuFtpsUploadResult {
    validate(config, artifact, remoteName)
    val expectedSize = artifact.length()
    sessionFactory.open(config).use { session ->
      session.connect(config.host, FTPS_PORT, config.connectTimeoutMs, config.dataTimeoutMs)
      check(session.login(USERNAME, config.accessCode)) { "Bambu FTPS login was rejected" }
      check(session.useBinaryTransfers()) { "Bambu FTPS rejected binary transfer mode" }
      session.protectDataChannel()
      session.usePassiveMode()
      FileInputStream(artifact).buffered().use { input ->
        check(session.store(remoteName, input)) { "Bambu FTPS upload was rejected" }
      }
      val remoteSize = session.size(remoteName)
      check(remoteSize == expectedSize) {
        "Bambu FTPS size verification failed (expected $expectedSize bytes, got ${remoteSize ?: "no SIZE reply"})"
      }
      session.logout()
      return BambuFtpsUploadResult(remoteName, remoteSize)
    }
  }

  private fun validate(config: BambuFtpsConfig, artifact: File, remoteName: String) {
    require(config.host.isNotBlank()) { "Bambu printer address is required" }
    require(config.serial.isNotBlank()) { "Bambu printer serial number is required" }
    require(config.accessCode.isNotBlank()) { "Bambu printer access code is required" }
    require(config.connectTimeoutMs in 1_000..120_000) { "Invalid FTPS connection timeout" }
    require(config.dataTimeoutMs in 1_000..600_000) { "Invalid FTPS data timeout" }
    require(artifact.isFile && artifact.length() > 0L) { "Bambu print artifact is missing or empty" }
    require(remoteName == remoteName.substringAfterLast('/').substringAfterLast('\\')) {
      "Bambu FTPS upload must target the printer root"
    }
    require(remoteName.matches(Regex("[A-Za-z0-9._-]{1,120}\\.gcode\\.3mf", RegexOption.IGNORE_CASE))) {
      "Invalid Bambu print filename"
    }
  }

  private companion object {
    const val FTPS_PORT = 990
    const val USERNAME = "bblp"
  }
}

internal fun interface BambuFtpsSessionFactory {
  fun open(config: BambuFtpsConfig): BambuFtpsSession
}

internal interface BambuFtpsSession : Closeable {
  fun connect(host: String, port: Int, connectTimeoutMs: Int, dataTimeoutMs: Int)
  fun login(username: String, password: String): Boolean
  fun useBinaryTransfers(): Boolean
  fun protectDataChannel()
  fun usePassiveMode()
  fun store(remoteName: String, input: java.io.InputStream): Boolean
  fun size(remoteName: String): Long?
  fun logout()
}

private object BcBambuFtpsSessionFactory : BambuFtpsSessionFactory {
  override fun open(config: BambuFtpsConfig): BambuFtpsSession = ApacheBambuFtpsSession(config.serial)
}

private class ApacheBambuFtpsSession(expectedSerial: String) : BambuFtpsSession {
  private val client = SessionResumingFtpsClient(sslContext(expectedSerial)).apply {
    setEnabledProtocols(arrayOf("TLSv1.2"))
    setIpAddressFromPasvResponse(false)
    setRemoteVerificationEnabled(false)
    setUseEPSVwithIPv4(false)
  }

  override fun connect(host: String, port: Int, connectTimeoutMs: Int, dataTimeoutMs: Int) {
    client.connectTimeout = connectTimeoutMs
    client.defaultTimeout = connectTimeoutMs
    client.setDataTimeout(Duration.ofMillis(dataTimeoutMs.toLong()))
    client.connect(host, port)
    check(client.replyCode in 200..299) { "Bambu FTPS connection was rejected (${client.replyCode})" }
  }

  override fun login(username: String, password: String): Boolean = client.login(username, password)

  override fun useBinaryTransfers(): Boolean = client.setFileType(FTP.BINARY_FILE_TYPE)

  override fun protectDataChannel() {
    client.execPBSZ(0)
    client.execPROT("P")
  }

  override fun usePassiveMode() = client.enterLocalPassiveMode()

  override fun store(remoteName: String, input: java.io.InputStream): Boolean =
    client.storeFile(remoteName, input)

  override fun size(remoteName: String): Long? = client.getSize(remoteName)?.trim()?.toLongOrNull()

  override fun logout() {
    if (client.isConnected && !client.logout()) throw IOException("Bambu FTPS logout was rejected")
  }

  override fun close() {
    if (client.isConnected) runCatching { client.disconnect() }
  }

  private companion object {
    fun sslContext(expectedSerial: String): SSLContext {
      val cryptoProvider = BouncyCastleProvider()
      val jsseProvider = BouncyCastleJsseProvider(cryptoProvider)
      return SSLContext.getInstance("TLS", jsseProvider).apply {
        init(
          null,
          arrayOf<TrustManager>(SerialPinningTrustManager(expectedSerial)),
          SecureRandom(),
        )
      }
    }
  }
}

private class SessionResumingFtpsClient(context: SSLContext) : FTPSClient(true, context) {
  private var controlSession: BCExtendedSSLSession? = null

  override fun _connectAction_() {
    super._connectAction_()
    controlSession = (_socket_ as? BCSSLSocket)?.bcSession
      ?: throw IOException("BCJSSE did not create the Bambu FTPS control socket")
  }

  override fun _prepareDataSocket_(socket: Socket) {
    val dataSocket = socket as? BCSSLSocket
      ?: throw IOException("BCJSSE did not create the Bambu FTPS data socket")
    val session = controlSession
      ?: throw IOException("Bambu FTPS control session is unavailable for reuse")
    dataSocket.setBCSessionToResume(session)
  }
}
