package org.crabcore.u1control.bespok3d

import android.content.Context
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.openpgp.PGPPublicKeyRingCollection
import org.bouncycastle.openpgp.PGPSignatureList
import org.bouncycastle.openpgp.PGPUtil
import org.bouncycastle.openpgp.jcajce.JcaPGPObjectFactory
import org.bouncycastle.openpgp.operator.jcajce.JcaKeyFingerprintCalculator
import org.bouncycastle.openpgp.operator.jcajce.JcaPGPContentVerifierBuilderProvider
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.zip.ZipInputStream

data class Bespok3dBootstrapFile(
  val path: String,
  val mode: Int,
  val bytes: ByteArray,
)

data class Bespok3dBootstrapPackage(
  val name: String,
  val version: String,
  val files: List<Bespok3dBootstrapFile>,
)

data class Bespok3dBootstrapSet(
  val daemon: Bespok3dBootstrapPackage,
  val jinni: Bespok3dBootstrapPackage,
)

/**
 * Opens only the release artifacts pinned into this Helix build. Both OpenPGP
 * signatures and every signed payload hash are checked before bytes are exposed.
 */
object Bespok3dBootstrapPackages {
  const val ASSET_PATH = "bespok3d/bootstrap-v0.7.3.zip"

  fun load(context: Context): Bespok3dBootstrapSet =
    context.assets.open(ASSET_PATH).use(::load)

  fun load(input: InputStream): Bespok3dBootstrapSet {
    val bundled = readZip(input, MAX_BUNDLE_BYTES, MAX_PACKAGE_BYTES)
    require(bundled.keys == EXPECTED_BUNDLE_MEMBERS.keys) {
      "Bespok3d bootstrap bundle contains unexpected files"
    }
    EXPECTED_BUNDLE_MEMBERS.forEach { (name, sha256) ->
      require(sha256(bundled.getValue(name)) == sha256) {
        "Bespok3d bootstrap artifact $name failed its release checksum"
      }
    }

    val indexBytes = bundled.getValue(INDEX_NAME)
    verifySignature(indexBytes, bundled.getValue(INDEX_SIGNATURE_NAME))
    val releases = parseIndex(indexBytes)
    val daemon = verifyPackage(
      bundled.getValue(DAEMON_ARCHIVE),
      releases.getValue(DAEMON_NAME),
    )
    val jinni = verifyPackage(
      bundled.getValue(JINNI_ARCHIVE),
      releases.getValue(JINNI_NAME),
    )
    return Bespok3dBootstrapSet(daemon, jinni)
  }

  /**
   * Applies the same pinned-publisher signature, identity, and payload-hash checks to a
   * store package before the daemon is allowed to see it.
   */
  fun verifyOfficialInstallPackage(bytes: ByteArray, name: String, version: String) {
    require(bytes.size <= MAX_STORE_PACKAGE_BYTES) { "Bespok3d package exceeds its size limit" }
    require(PLUGIN_NAME.matches(name)) { "Bespok3d package name is invalid" }
    require(VERSION.matches(version)) { "Bespok3d package version is invalid" }
    verifyPackage(bytes, ListedRelease(name, version, ""), MAX_STORE_UNPACKED_BYTES)
  }

  /** Verifies exact catalog bytes against Helix's pinned Bespok3d publisher key. */
  fun verifyOfficialSignature(content: ByteArray, armoredSignature: ByteArray) {
    verifySignature(content, armoredSignature)
  }

  internal fun validateRelativePath(path: String): String {
    require(path.isNotEmpty() && path.length <= 512) { "Bespok3d package path is invalid" }
    require(!path.startsWith('/') && !path.contains('\\')) { "Bespok3d package path is unsafe" }
    require(path.split('/').none { it.isEmpty() || it == "." || it == ".." }) {
      "Bespok3d package path is unsafe"
    }
    return path
  }

  private data class ListedRelease(val name: String, val version: String, val archive: String)

  private fun parseIndex(bytes: ByteArray): Map<String, ListedRelease> {
    val index = JSONObject(bytes.toString(Charsets.UTF_8))
    require(index.optInt("schema_version") == 1) { "Unsupported Bespok3d bootstrap index" }
    require(index.optString("publisher").uppercase(Locale.US) == OFFICIAL_FINGERPRINT) {
      "Bespok3d bootstrap index has the wrong publisher"
    }
    val plugins = index.getJSONArray("plugins")
    val releases = buildMap {
      for (position in 0 until plugins.length()) {
        val plugin = plugins.getJSONObject(position)
        val name = plugin.getString("name")
        put(name, ListedRelease(name, plugin.getString("version"), plugin.getString("download_url")))
      }
    }
    require(releases.keys == setOf(DAEMON_NAME, JINNI_NAME)) {
      "Bespok3d bootstrap index contains unexpected packages"
    }
    require(releases.getValue(DAEMON_NAME).archive == DAEMON_ARCHIVE)
    require(releases.getValue(JINNI_NAME).archive == JINNI_ARCHIVE)
    return releases
  }

  private fun verifyPackage(
    bytes: ByteArray,
    listed: ListedRelease,
    maxUnpackedBytes: Int = MAX_PACKAGE_UNPACKED_BYTES,
  ): Bespok3dBootstrapPackage {
    val archive = readZip(ByteArrayInputStream(bytes), maxUnpackedBytes, MAX_STORE_ENTRY_BYTES)
    val manifestBytes = archive[MANIFEST_NAME]
      ?: throw IllegalArgumentException("Bespok3d package has no manifest")
    val signatureBytes = archive[MANIFEST_SIGNATURE_NAME]
      ?: throw IllegalArgumentException("Bespok3d package has no signature")
    verifySignature(manifestBytes, signatureBytes)

    val manifest = JSONObject(manifestBytes.toString(Charsets.UTF_8))
    require(manifest.getString("name") == listed.name) { "Bespok3d package identity mismatch" }
    require(manifest.getString("version") == listed.version) { "Bespok3d package version mismatch" }
    require(manifest.getString("publisher").uppercase(Locale.US) == OFFICIAL_FINGERPRINT) {
      "Bespok3d package has the wrong publisher"
    }

    val declared = manifest.getJSONArray("files")
    require(declared.length() in 1..MAX_ENTRIES) { "Bespok3d package declares no usable payload" }
    val payload = ArrayList<Bespok3dBootstrapFile>(declared.length())
    val declaredArchivePaths = mutableSetOf<String>()
    for (position in 0 until declared.length()) {
      val file = declared.getJSONObject(position)
      val archivePath = validateRelativePath(file.getString("path"))
      require(declaredArchivePaths.add(archivePath)) { "Bespok3d manifest repeats a file path" }
      val fileBytes = archive[archivePath]
        ?: throw IllegalArgumentException("Bespok3d package is missing $archivePath")
      require(sha256(fileBytes) == file.getString("sha256").lowercase(Locale.US)) {
        "Bespok3d file hash failed for $archivePath"
      }
      val modeText = file.optString("mode", "644")
      require(modeText.matches(Regex("^[0-7]{3,4}$"))) { "Bespok3d file mode is invalid" }
      if (archivePath.startsWith(PAYLOAD_PREFIX)) {
        payload += Bespok3dBootstrapFile(
          path = validateRelativePath(archivePath.removePrefix(PAYLOAD_PREFIX)),
          mode = modeText.toInt(8),
          bytes = fileBytes,
        )
      }
    }
    require(payload.isNotEmpty()) { "Bespok3d package declares no installable payload" }
    val actualSignedPaths = archive.keys
      .filterTo(mutableSetOf()) { it != MANIFEST_NAME && it != MANIFEST_SIGNATURE_NAME }
    require(actualSignedPaths == declaredArchivePaths) {
      "Bespok3d package contains an undeclared file"
    }
    return Bespok3dBootstrapPackage(listed.name, listed.version, payload)
  }

  private fun verifySignature(content: ByteArray, armoredSignature: ByteArray) {
    val signatures = PGPUtil.getDecoderStream(ByteArrayInputStream(armoredSignature)).use { decoded ->
      JcaPGPObjectFactory(decoded).nextObject() as? PGPSignatureList
    } ?: throw IllegalArgumentException("Bespok3d signature is malformed")
    require(signatures.size() == 1) { "Bespok3d signature count is invalid" }
    val signature = signatures[0]
    val keyRings = PGPUtil.getDecoderStream(
      ByteArrayInputStream(OFFICIAL_PUBLIC_KEY.toByteArray(Charsets.US_ASCII)),
    ).use { decoded -> PGPPublicKeyRingCollection(decoded, JcaKeyFingerprintCalculator()) }
    val signingKey = keyRings.getPublicKey(signature.keyID)
      ?: throw IllegalArgumentException("Bespok3d signature was not made by the official key")
    val primaryFingerprint = keyRings.keyRings.asSequence()
      .firstOrNull { it.getPublicKey(signature.keyID) != null }
      ?.publicKey
      ?.fingerprint
      ?.joinToString("") { "%02X".format(it) }
    require(primaryFingerprint == OFFICIAL_FINGERPRINT) {
      "Bespok3d signature was not made by the pinned publisher"
    }
    signature.init(JcaPGPContentVerifierBuilderProvider().setProvider(BouncyCastleProvider()), signingKey)
    signature.update(content)
    require(signature.verify()) { "Bespok3d signature verification failed" }
  }

  private fun readZip(input: InputStream, maxTotalBytes: Int, maxEntryBytes: Int): Map<String, ByteArray> {
    val files = linkedMapOf<String, ByteArray>()
    var totalBytes = 0
    ZipInputStream(input.buffered()).use { zip ->
      while (true) {
        val entry = zip.nextEntry ?: break
        require(!entry.isDirectory) { "Bespok3d archive contains a directory entry" }
        val name = validateRelativePath(entry.name)
        require(files.size < MAX_ENTRIES && !files.containsKey(name)) {
          "Bespok3d archive contains too many or duplicate entries"
        }
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
          val count = zip.read(buffer)
          if (count < 0) break
          output.write(buffer, 0, count)
          totalBytes += count
          require(output.size() <= maxEntryBytes && totalBytes <= maxTotalBytes) {
            "Bespok3d archive exceeds its size limit"
          }
        }
        files[name] = output.toByteArray()
        zip.closeEntry()
      }
    }
    return files
  }

  private fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  private const val INDEX_NAME = "index.json"
  private const val INDEX_SIGNATURE_NAME = "index.json.sig"
  private const val MANIFEST_NAME = "manifest.json"
  private const val MANIFEST_SIGNATURE_NAME = "manifest.json.sig"
  private const val PAYLOAD_PREFIX = "files/"
  private const val DAEMON_NAME = "bespok3d-daemon"
  private const val JINNI_NAME = "bespok3d-jinni-snapmaker-u1"
  private const val DAEMON_ARCHIVE = "bespok3d-daemon-0.12.24.b3"
  private const val JINNI_ARCHIVE = "bespok3d-jinni-snapmaker-u1-0.1.10.b3"
  private const val OFFICIAL_FINGERPRINT = "679939555819FB5F6423DC68C4388E76BFA9B4E0"
  private const val MAX_ENTRIES = 512
  private const val MAX_BUNDLE_BYTES = 12 * 1024 * 1024
  private const val MAX_PACKAGE_BYTES = 10 * 1024 * 1024
  private const val MAX_PACKAGE_UNPACKED_BYTES = 16 * 1024 * 1024
  private const val MAX_STORE_PACKAGE_BYTES = 64 * 1024 * 1024
  private const val MAX_STORE_UNPACKED_BYTES = 128 * 1024 * 1024
  private const val MAX_STORE_ENTRY_BYTES = 64 * 1024 * 1024
  private val PLUGIN_NAME = Regex("^[a-z0-9][a-z0-9-]{0,63}$")
  private val VERSION = Regex("^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")

  private val EXPECTED_BUNDLE_MEMBERS = mapOf(
    DAEMON_ARCHIVE to "f2721e686efffa352aacb6174a2a280afae446817f0c0c0643c3ac62d46c5980",
    JINNI_ARCHIVE to "7b1d6d4eda4e5035853c21db3d1d4cdd4930bc5af7719c8883ecc3f643e4a765",
    INDEX_NAME to "69282901be04796e9e8c2c39073d0948cd3ddd2affdde1237da46587672ffa8f",
    INDEX_SIGNATURE_NAME to "c89c1ff9d4a3efb36d74578389795229385047d3f81fa201cc427c1dfd1ac530",
  )

  private const val OFFICIAL_PUBLIC_KEY = """-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBGoe+wUBEADJjkI85zRmpx2XmaU2e7eb1OGR0Khw0z5dByvQ0odMovBhInK4
mmWR1d+DL2yLt8QNh421LGuBd1iWXSx6jTKPi8PcxBSxfhfJydJWIji58HFN/sTd
dyk+I20Ln9k0B0A8BpLnSzVUTEKYrqYiRSAJcPVkrA1myp3X4kUt/DyqERHE/HF+
bmwMsW0pgpdvs1umUOV7EdpADWorfWcWFOGKFJSGbd8K3hjFR9IPt6sPeKsUGU5U
01hdFp89a/DAX/Q2LGQP/v+WNUpNQtj6CMPRPc2sjNcyH16m9EsIugkWoimxsoSk
gKAoINq+gQtp/qckQiXoApXnB1ewQfWmz0C+zAoSL/qXd/QEpStZhgvlDX4eOeUl
LdOLleRnwqorNgz4Qr96C1uETJF2ew8iZm5v4nPOidP9eG0OOrYsiHjmiOubD3A9
V6GLGiaVuRNJ1dIew615bOmOhQY/8Sa32QoUeDYVDEL4pZxyk+fuxObvBGfvRFdG
wuuVvEXX0L+Ne7KSHSVUXQGGobjfrektB8OSOFpAM9iGAhtH/lCXq8OjogjzoetE
47JflKHZLmAaspl16WrsRk+GPxGwAf8ckAs7GxgaxbTECkeauG2Iqcmme1k+3kmK
NQBrQq5NMz4A+OMN0g/4BO/S8RkLtxC1cjDCZ72MNgzh4lt+to91Vr8R6wARAQAB
tFFCZXNwb2szZCBSZWdpc3RyeSBTaWduaW5nIEtleSAob2ZmaWNpYWwgbGlzdCBz
aWduaW5nIGtleSkgPHJlZ2lzdHJ5QGJlc3BvazNkLm9yZz6JAm0EEwEIAFcWIQRn
mTlVWBn7X2Qj3GjEOI52v6m04AUCah77BRsUgAAAAAAEAA5tYW51MiwyLjUrMS4x
MiwwLDMCGwMFCwkIBwICIgIGFQoJCAsCBBYCAwECHgcCF4AACgkQxDiOdr+ptOAq
7BAAlCoYtauXk8As3ajW2IJLUOYHxtal+h4UUaXiiNKwgtZBbnIZByfDZ68veDoP
SQ3PfKLKgypuJqGNRKCORiP/zw2Co7AqwHgsG9G5B48SsDIQlRX1nad5Acc5XyHN
GKqDu0mxQd9GVU96zhOknZoF4f2yrrHhrv1OYrbzHsp9ktyddfyO4izurs0zPh6B
6ln1AgbOwc+yMG3NjqpmjEgXn/5B+WCXU/9wwOC8TmOGdZHtdVgzExZEbEgRkqe+
Wzq8Or8at+CLn2BCyYyKJcRQVDNYubjpE0BsYw4t/n01PwDKlgk4Kc4JPmjAXgqh
7ZJDegBIb14+rhwptKBpr/bGHJxJQBqAPmeqIPjNYNSkXlVbToS8RRsy5/7wWm7E
UKQChOBY4CZ9+d6H7IEIkj6Cay0NRDNRGBJ8H1ePsA9P8xCU567F0iEXwKKmWPiL
lB1lLI5KScW7kfx9iHQ8NKGxhmiDbB7J/Zd+et5WZIKONit+xifU4YVOpELbhRYA
6G7i1pFOQhXLZG832pKMqHCPCpBqT5imrJ2NKYqCHyZ2aVi3gK6mpYWnzSh5Xcpv
HGkr0kOBhL1zF6g4Cn/wU26QI4mQ2eEOqBRhUTFBbBZ7fQTbFgA4AV9Gwi8L6tNB
At5hzMkILtyaJ1gDVIBv/Qmet5QtOB22Sq54rRL4W+igroM=
=DgD7
-----END PGP PUBLIC KEY BLOCK-----"""
}
