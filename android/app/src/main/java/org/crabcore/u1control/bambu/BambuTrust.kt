// Shared TLS trust for Bambu's LAN services. Both MQTT (8883) and the chamber
// camera (6000) present the same device certificate:
//
//   subject = CN=<serial number>
//   issuer  = C=CN, O=BBL Technologies Co., Ltd, CN=BBL CA
//
// Self-signed against a CA no device trusts, so ordinary verification cannot
// work. Other Bambu clients answer that by trusting everything on the socket.
// We accept the untrusted chain but require the leaf CN to be the serial the
// user configured, which needs no CA yet still binds the session to one
// specific machine rather than to whatever is answering on that port.
// crabcore

package org.crabcore.u1control.bambu

import java.security.KeyStore
import java.security.Provider
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.ManagerFactoryParameters
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.TrustManagerFactorySpi
import javax.net.ssl.X509TrustManager

/** Marker text shared with the JS layer's error classification. */
const val BAMBU_SERIAL_MISMATCH = "serial number does not match"

class SerialPinningTrustManagerFactory(expectedSerial: String) : TrustManagerFactory(
  object : TrustManagerFactorySpi() {
    override fun engineInit(keyStore: KeyStore?) = Unit
    override fun engineInit(parameters: ManagerFactoryParameters?) = Unit
    override fun engineGetTrustManagers(): Array<TrustManager> =
      arrayOf(SerialPinningTrustManager(expectedSerial))
  },
  BambuSecurityProvider,
  "HelixBambuSerialPinning"
)

class SerialPinningTrustManager(private val expectedSerial: String) : X509TrustManager {

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    val leaf = chain?.firstOrNull()
      ?: throw CertificateException("The printer presented no certificate")

    // RFC 2253 form, e.g. "CN=01P00C611300996". Android has no javax.naming,
    // so this is parsed directly rather than with LdapName.
    val commonName = CN_PATTERN.find(leaf.subjectX500Principal.name)?.groupValues?.get(1)?.trim()

    if (commonName.isNullOrEmpty() || !commonName.equals(expectedSerial, ignoreCase = true)) {
      throw CertificateException(
        "This printer's $BAMBU_SERIAL_MISMATCH " +
          "(expected $expectedSerial, got ${commonName ?: "nothing"})"
      )
    }
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

  private companion object {
    val CN_PATTERN = Regex("CN=([^,]+)")
  }
}

/** Socket factory for the plain-TLS services; MQTT takes the factory instead. */
fun bambuSocketFactory(expectedSerial: String): SSLSocketFactory =
  SSLContext.getInstance("TLS").apply {
    init(null, arrayOf<TrustManager>(SerialPinningTrustManager(expectedSerial)), null)
  }.socketFactory

@Suppress("DEPRECATION") // The (String, String, String) constructor needs API 30; Helix targets 24.
private object BambuSecurityProvider : Provider(
  "HelixBambu",
  1.0,
  "Serial-pinned trust for Bambu Lab printers on the LAN"
)
