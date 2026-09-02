package org.crabcore.u1control.bespok3d

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.Locale
import java.util.UUID
import java.util.zip.ZipInputStream
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

data class Bespok3dProbe(
  val version: String,
  val license: String,
  val source: String,
  val certificatePem: String,
  val certificateSha256: String,
)

data class Bespok3dAccessRequest(
  val identity: String,
  val token: String,
  val certificatePem: String,
  val certificateSha256: String,
)

data class Bespok3dStatus(
  val version: String,
  val printerUuid: String,
)

data class Bespok3dPluginConfigField(
  val key: String,
  val label: String,
  val type: String,
  val defaultValue: String?,
  val required: Boolean,
  val options: List<String>,
  val hint: String,
  val onValue: String,
  val offValue: String,
)

data class Bespok3dPlugin(
  val id: String,
  val title: String,
  val version: String,
  val tagline: String,
  val category: String,
  val repository: String,
  val dependencies: List<String>,
  val config: List<Bespok3dPluginConfigField>,
)

data class Bespok3dPluginCatalog(
  val plugins: List<Bespok3dPlugin>,
  val installed: Map<String, String>,
)

data class Bespok3dPluginInstallResult(
  val ok: Boolean,
  val installedIds: List<String>,
  val failures: Map<String, String>,
)

data class Bespok3dHelixScreenState(
  val installed: Boolean,
  val selected: String?,
)

data class Bespok3dBundledPluginIdentity(
  val id: String,
  val version: String,
)

class Bespok3dHttpException(val statusCode: Int, message: String) : Exception(message)

/** Pure validation and JSON parsing for the public Bespok3d daemon contract. */
object Bespok3dProtocol {
  private val identityPattern = Regex("^[A-Za-z0-9:._-]{1,128}$")
  private val tokenPattern = Regex("^[A-Za-z0-9]{16,128}$")

  fun validateAccessToken(token: String) {
    require(tokenPattern.matches(token)) { "Invalid Bespok3d access token" }
  }

  fun accessRequestBody(
    label: String,
    identity: String,
    token: String,
    publicKey: String = "",
  ): String {
    require(identityPattern.matches(identity)) { "Invalid Bespok3d client identity" }
    validateAccessToken(token)
    require(label.length <= 64 && label.all { !it.isISOControl() }) {
      "Invalid Bespok3d client label"
    }
    require(publicKey.length <= 8192) { "Bespok3d public key is too large" }
    return JSONObject()
      .put("label", label)
      .put("identity", identity)
      .put("token", token)
      .put("public_key", publicKey)
      .toString()
  }

  fun certificateSha256(encoded: ByteArray): String =
    MessageDigest.getInstance("SHA-256")
      .digest(encoded)
      .joinToString(":") { "%02X".format(it) }

  fun parseProbe(
    body: String,
    certificatePem: String,
    certificateSha256: String,
  ): Bespok3dProbe {
    val json = JSONObject(body)
    val license = json.optString("license")
    val source = json.optString("source")
    val version = json.optString("version")
    require(license == "AGPL-3.0-or-later") { "The service is not a Bespok3d daemon" }
    require(source == "https://github.com/Bespok3d/daemon") {
      "The service is not the official Bespok3d daemon"
    }
    require(version.isNotBlank()) { "Bespok3d returned no version" }
    require(certificatePem.contains("BEGIN CERTIFICATE")) { "Bespok3d returned no certificate" }
    require(Regex("^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$").matches(certificateSha256)) {
      "Bespok3d returned no certificate fingerprint"
    }
    return Bespok3dProbe(version, license, source, certificatePem, certificateSha256)
  }

  fun parseAccessResponse(body: String): String {
    val json = JSONObject(body)
    require(json.optBoolean("ok")) { "Bespok3d rejected the access request" }
    return json.optString("cert").takeIf { it.contains("BEGIN CERTIFICATE") }
      ?: throw IllegalArgumentException("Bespok3d returned no certificate")
  }

  fun parseStatus(body: String): Bespok3dStatus {
    val json = JSONObject(body)
    require(json.optBoolean("ok")) { "Bespok3d status was not healthy" }
    val version = json.optString("version").takeIf(String::isNotBlank)
      ?: throw IllegalArgumentException("Bespok3d returned no version")
    val printerUuid = json.optString("printer_uuid").takeIf(String::isNotBlank)
      ?: throw IllegalArgumentException("Bespok3d returned no printer identity")
    return Bespok3dStatus(version, printerUuid)
  }

  fun parsePluginCatalog(indexBody: String, capabilitiesBody: String): Bespok3dPluginCatalog {
    val index = JSONObject(indexBody)
    require(index.optInt("schema_version") == 1) { "Unsupported Bespok3d plugin catalog" }
    require(index.optString("publisher").uppercase(Locale.US) == OFFICIAL_PUBLISHER) {
      "Bespok3d plugin catalog has the wrong publisher"
    }
    val installedJson = JSONObject(capabilitiesBody).optJSONObject("installed") ?: JSONObject()
    val installed = installedJson.keys().asSequence().associateWith { installedJson.getString(it) }
    val pluginsJson = index.optJSONArray("plugins") ?: JSONArray()
    val plugins = buildList {
      for (position in 0 until pluginsJson.length()) {
        val plugin = pluginsJson.getJSONObject(position)
        val id = plugin.requiredPluginId("name")
        if (id.startsWith("bespok3d-daemon") || id.startsWith("bespok3d-jinni-")) continue
        val version = plugin.requiredVersion("version")
        val repository = repositoryFromDownloadUrl(plugin.getString("download_url"))
        val dependencies = plugin.optJSONArray("deps").strings().onEach(::validatePluginId)
        val configJson = plugin.optJSONArray("config") ?: JSONArray()
        val config = buildList {
          for (fieldIndex in 0 until configJson.length()) {
            val field = configJson.getJSONObject(fieldIndex)
            val key = field.getString("key")
            require(CONFIG_KEY.matches(key)) { "Bespok3d plugin config key is invalid" }
            add(
              Bespok3dPluginConfigField(
                key = key,
                label = field.optString("label", key).take(120),
                type = field.optString("type", "text").take(32),
                defaultValue = if (field.has("default") && !field.isNull("default")) {
                  field.get("default").toString()
                } else {
                  null
                },
                required = field.optBoolean("required", false),
                options = field.optJSONArray("options").strings().take(64),
                hint = field.optString("hint").take(500),
                onValue = field.optString("onValue", "true").take(MAX_CONFIG_FIELD_LENGTH),
                offValue = field.optString("offValue", "false").take(MAX_CONFIG_FIELD_LENGTH),
              ),
            )
          }
        }
        add(
          Bespok3dPlugin(
            id = id,
            title = plugin.optString("title", id).take(120),
            version = version,
            tagline = plugin.optString("tagline").take(500),
            category = plugin.optString("category", "other").take(64),
            repository = repository,
            dependencies = dependencies,
            config = config,
          ),
        )
      }
    }
    require(plugins.map { it.id }.distinct().size == plugins.size) {
      "Bespok3d plugin catalog repeats a package"
    }
    return Bespok3dPluginCatalog(plugins, installed)
  }

  fun dependencyOrder(catalog: Bespok3dPluginCatalog, selectedIds: List<String>): List<Bespok3dPlugin> {
    require(selectedIds.isNotEmpty()) { "Select at least one Bespok3d plugin" }
    val byId = catalog.plugins.associateBy { it.id }
    val visiting = mutableSetOf<String>()
    val visited = mutableSetOf<String>()
    val ordered = mutableListOf<Bespok3dPlugin>()
    fun visit(id: String, explicitlySelected: Boolean) {
      validatePluginId(id)
      if (id in visited || (!explicitlySelected && catalog.installed.containsKey(id))) return
      require(visiting.add(id)) { "Bespok3d plugin dependency cycle includes $id" }
      val plugin = byId[id] ?: throw IllegalArgumentException("Bespok3d catalog has no plugin $id")
      plugin.dependencies.forEach { dependencyId -> visit(dependencyId, false) }
      visiting.remove(id)
      visited.add(id)
      ordered += plugin
    }
    selectedIds.distinct().forEach { pluginId -> visit(pluginId, true) }
    return ordered
  }

  fun parseReleaseAssetUrl(body: String, plugin: Bespok3dPlugin): String {
    val expectedName = "${plugin.id}-${plugin.version}.b3"
    val releases = JSONArray(body)
    for (releaseIndex in 0 until releases.length()) {
      val assets = releases.getJSONObject(releaseIndex).optJSONArray("assets") ?: continue
      for (assetIndex in 0 until assets.length()) {
        val asset = assets.getJSONObject(assetIndex)
        if (asset.optString("name") != expectedName) continue
        val url = asset.optString("browser_download_url")
        require(url.startsWith("https://github.com/${plugin.repository}/releases/download/") &&
          url.endsWith("/$expectedName")) { "Bespok3d release returned an unsafe package URL" }
        return url
      }
    }
    throw IllegalArgumentException("Bespok3d release package is unavailable for ${plugin.id} ${plugin.version}")
  }

  fun parseInstallResult(body: String): Bespok3dPluginInstallResult {
    val result = JSONObject(body)
    val rows = result.optJSONArray("results") ?: JSONArray()
    val installed = mutableListOf<String>()
    val failures = linkedMapOf<String, String>()
    for (position in 0 until rows.length()) {
      val row = rows.getJSONObject(position)
      val rawId = row.getString("plugin_id")
      val id = if (rawId == SERVICES_RESULT_ID) rawId else rawId.also(::validatePluginId)
      if (row.optBoolean("ok")) {
        if (id != SERVICES_RESULT_ID) installed += id
      } else {
        failures[id] = row.optString("reason", "Installation failed").take(500)
      }
    }
    return Bespok3dPluginInstallResult(result.optBoolean("ok") && failures.isEmpty(), installed, failures)
  }

  /**
   * Verifies every byte before the locally built HelixScreen package can bypass
   * the official Bespok3d catalog. The APK signature then protects these pinned bytes.
   */
  fun verifyBundledHelixScreenPackage(bytes: ByteArray): Bespok3dBundledPluginIdentity {
    require(bytes.size <= MAX_BUNDLED_PACKAGE_BYTES) { "Bundled HelixScreen package is too large" }
    val sha256 = MessageDigest.getInstance("SHA-256")
      .digest(bytes)
      .joinToString("") { "%02x".format(it) }
    require(sha256 == BUNDLED_HELIXSCREEN_SHA256) {
      "Bundled HelixScreen package failed integrity verification"
    }
    val manifest = ZipInputStream(ByteArrayInputStream(bytes)).use { archive ->
      var parsed: JSONObject? = null
      while (true) {
        val entry = archive.nextEntry ?: break
        if (entry.name != "manifest.json") continue
        require(parsed == null) { "Bundled HelixScreen package repeats its manifest" }
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (true) {
          val count = archive.read(buffer)
          if (count < 0) break
          output.write(buffer, 0, count)
          require(output.size() <= MAX_BUNDLED_MANIFEST_BYTES) {
            "Bundled HelixScreen manifest is too large"
          }
        }
        parsed = JSONObject(output.toString(StandardCharsets.UTF_8.name()))
      }
      parsed ?: throw IllegalArgumentException("Bundled HelixScreen package has no manifest")
    }
    require(manifest.optString("name") == BUNDLED_HELIXSCREEN_ID) {
      "Bundled HelixScreen package has the wrong id"
    }
    require(manifest.optString("version") == BUNDLED_HELIXSCREEN_VERSION) {
      "Bundled HelixScreen package has the wrong version"
    }
    return Bespok3dBundledPluginIdentity(BUNDLED_HELIXSCREEN_ID, BUNDLED_HELIXSCREEN_VERSION)
  }

  fun parseHelixScreenConfig(body: String): Bespok3dHelixScreenState {
    val selected = JSONObject(body).optJSONObject("vars")?.optString(HELIX_SCREEN_CONFIG_KEY)
    require(selected in HELIX_SCREEN_CHOICES) { "HelixScreen returned an invalid touchscreen selection" }
    return Bespok3dHelixScreenState(installed = true, selected = selected)
  }

  fun helixScreenReconfigureBody(selected: String): String {
    require(selected in HELIX_SCREEN_CHOICES) { "Invalid touchscreen selection" }
    return JSONObject().put(HELIX_SCREEN_CONFIG_KEY, selected).toString()
  }

  fun parseHelixScreenReconfigure(body: String, selected: String): Bespok3dHelixScreenState {
    require(selected in HELIX_SCREEN_CHOICES) { "Invalid touchscreen selection" }
    val result = JSONObject(body)
    require(result.optBoolean("ok")) { "Bespok3d did not switch the touchscreen" }
    require(result.optString("plugin_id") == HELIX_SCREEN_PLUGIN_ID) {
      "Bespok3d reconfigured the wrong plugin"
    }
    val log = result.optJSONArray("log") ?: JSONArray()
    for (position in 0 until log.length()) {
      require(log.getJSONObject(position).optBoolean("ok")) {
        "Bespok3d could not restart the touchscreen services"
      }
    }
    return Bespok3dHelixScreenState(installed = true, selected = selected)
  }

  private fun JSONObject.requiredPluginId(key: String): String =
    getString(key).also(::validatePluginId)

  private fun JSONObject.requiredVersion(key: String): String =
    getString(key).also { require(VERSION.matches(it)) { "Bespok3d plugin version is invalid" } }

  private fun repositoryFromDownloadUrl(value: String): String {
    val match = DOWNLOAD_API.matchEntire(value)
      ?: throw IllegalArgumentException("Bespok3d plugin has an unsupported download source")
    return "${match.groupValues[1]}/${match.groupValues[2]}"
  }

  private fun validatePluginId(id: String) {
    require(PLUGIN_ID.matches(id)) { "Bespok3d plugin id is invalid" }
  }

  private fun JSONArray?.strings(): List<String> {
    if (this == null) return emptyList()
    return buildList { for (position in 0 until length()) add(getString(position)) }
  }

  private const val OFFICIAL_PUBLISHER = "679939555819FB5F6423DC68C4388E76BFA9B4E0"
  private const val SERVICES_RESULT_ID = "(services)"
  const val BUNDLED_HELIXSCREEN_ASSET = "bespok3d/helixscreen-ui-0.1.0.b3"
  private const val BUNDLED_HELIXSCREEN_ID = "helixscreen-ui"
  private const val BUNDLED_HELIXSCREEN_VERSION = "0.1.0"
  private const val BUNDLED_HELIXSCREEN_SHA256 =
    "ad888897f08f4129dc80b92f1f1d10f07f29c854169a85e5996e00d1f1f4bbb4"
  private const val MAX_BUNDLED_PACKAGE_BYTES = 64 * 1024 * 1024
  private const val MAX_BUNDLED_MANIFEST_BYTES = 256 * 1024
  private const val HELIX_SCREEN_PLUGIN_ID = BUNDLED_HELIXSCREEN_ID
  private const val HELIX_SCREEN_CONFIG_KEY = "SCREEN_UI"
  private val HELIX_SCREEN_CHOICES = setOf("snapmaker", "helixscreen")
  private const val MAX_CONFIG_FIELD_LENGTH = 2_048
  private val PLUGIN_ID = Regex("^[a-z0-9][a-z0-9-]{0,63}$")
  private val CONFIG_KEY = Regex("^[A-Z][A-Z0-9_]{0,63}$")
  private val VERSION = Regex("^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
  private val DOWNLOAD_API = Regex("^https://api\\.github\\.com/repos/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/releases/assets/[0-9]+$")
}

/** HTTPS client for the certificate-pinned daemon and signature-pinned official plugin catalog. */
class Bespok3dClient {
  fun probe(host: String): Bespok3dProbe {
    val response = request(host, "/license", "GET", null, null, null)
    return Bespok3dProtocol.parseProbe(
      response.body,
      pem(response.leaf),
      Bespok3dProtocol.certificateSha256(response.leaf.encoded),
    )
  }

  fun requestAccess(host: String, label: String, publicKey: String = ""): Bespok3dAccessRequest {
    val identity = "helix-${UUID.randomUUID()}"
    val token = ByteArray(32).also(SecureRandom()::nextBytes).joinToString("") { "%02x".format(it) }
    val body = Bespok3dProtocol.accessRequestBody(label.trim(), identity, token, publicKey)
    val response = request(host, "/access/request", "POST", body, null, null)
    val returnedPem = Bespok3dProtocol.parseAccessResponse(response.body)
    val returnedCertificate = certificate(returnedPem)
    if (!returnedCertificate.encoded.contentEquals(response.leaf.encoded)) {
      throw CertificateException("Bespok3d pairing certificate did not match the connected printer")
    }
    return Bespok3dAccessRequest(
      identity,
      token,
      returnedPem,
      Bespok3dProtocol.certificateSha256(returnedCertificate.encoded),
    )
  }

  fun status(host: String, token: String, certificatePem: String): Bespok3dStatus {
    Bespok3dProtocol.validateAccessToken(token)
    val response = request(host, "/status", "GET", null, token, certificatePem)
    return Bespok3dProtocol.parseStatus(response.body)
  }

  fun helixScreenState(
    host: String,
    token: String,
    certificatePem: String,
  ): Bespok3dHelixScreenState {
    Bespok3dProtocol.validateAccessToken(token)
    return try {
      val response = request(
        host,
        "/plugins/helixscreen-ui/config",
        "GET",
        null,
        token,
        certificatePem,
      )
      Bespok3dProtocol.parseHelixScreenConfig(response.body)
    } catch (error: Bespok3dHttpException) {
      if (error.statusCode != HttpURLConnection.HTTP_NOT_FOUND) throw error
      Bespok3dHelixScreenState(installed = false, selected = null)
    }
  }

  fun configureHelixScreen(
    host: String,
    token: String,
    certificatePem: String,
    selected: String,
  ): Bespok3dHelixScreenState {
    Bespok3dProtocol.validateAccessToken(token)
    val body = Bespok3dProtocol.helixScreenReconfigureBody(selected)
    val response = requestBytes(
      host = host,
      path = "/plugins/helixscreen-ui/reconfigure",
      method = "POST",
      body = body.toByteArray(StandardCharsets.UTF_8),
      contentType = "application/json",
      token = token,
      certificatePem = certificatePem,
      timeoutMs = RECONFIGURE_TIMEOUT_MS,
    )
    Bespok3dProtocol.parseHelixScreenReconfigure(response.body, selected)
    return helixScreenState(host, token, certificatePem).also { state ->
      require(state.installed && state.selected == selected) {
        "Bespok3d did not persist the touchscreen selection"
      }
    }
  }

  fun plugins(host: String, token: String, certificatePem: String): Bespok3dPluginCatalog {
    Bespok3dProtocol.validateAccessToken(token)
    val indexBytes = download(CATALOG_URL, MAX_CATALOG_BYTES, "application/json")
    val signatureBytes = download(CATALOG_SIGNATURE_URL, MAX_SIGNATURE_BYTES, "application/pgp-signature")
    Bespok3dBootstrapPackages.verifyOfficialSignature(indexBytes, signatureBytes)
    val capabilities = request(host, "/capabilities", "GET", null, token, certificatePem).body
    return Bespok3dProtocol.parsePluginCatalog(indexBytes.toString(Charsets.UTF_8), capabilities)
  }

  fun installPlugins(
    host: String,
    token: String,
    certificatePem: String,
    selectedIds: List<String>,
    requestedVars: Map<String, Map<String, String>>,
  ): Bespok3dPluginInstallResult {
    val catalog = plugins(host, token, certificatePem)
    val ordered = Bespok3dProtocol.dependencyOrder(catalog, selectedIds)
    if (ordered.isEmpty()) return Bespok3dPluginInstallResult(true, emptyList(), emptyMap())
    require(requestedVars.keys.all { requestedId -> selectedIds.contains(requestedId) }) {
      "Bespok3d config was supplied for an unselected plugin"
    }
    val packages = ordered.map { plugin ->
      val releasesUrl = "https://api.github.com/repos/${plugin.repository}/releases?per_page=100"
      val releases = download(releasesUrl, MAX_RELEASES_BYTES, "application/vnd.github+json")
      val assetUrl = Bespok3dProtocol.parseReleaseAssetUrl(releases.toString(Charsets.UTF_8), plugin)
      val bytes = download(assetUrl, MAX_PACKAGE_BYTES, "application/octet-stream")
      Bespok3dBootstrapPackages.verifyOfficialInstallPackage(bytes, plugin.id, plugin.version)
      DownloadedPlugin(plugin, bytes, resolvedVars(plugin, requestedVars[plugin.id].orEmpty()))
    }
    val boundary = "----HelixB3${UUID.randomUUID().toString().replace("-", "")}"
    val body = buildBatchMultipart(boundary, packages)
    val response = requestBytes(
      host = host,
      path = "/packages/install-batch",
      method = "POST",
      body = body,
      contentType = "multipart/form-data; boundary=$boundary",
      token = token,
      certificatePem = certificatePem,
      timeoutMs = INSTALL_TIMEOUT_MS,
    )
    return Bespok3dProtocol.parseInstallResult(response.body)
  }

  /** Uploads only the exact HelixScreen package shipped in this APK. */
  fun installBundledHelixScreen(
    host: String,
    token: String,
    certificatePem: String,
    bytes: ByteArray,
  ): Bespok3dPluginInstallResult {
    Bespok3dProtocol.validateAccessToken(token)
    val identity = Bespok3dProtocol.verifyBundledHelixScreenPackage(bytes)
    if (helixScreenState(host, token, certificatePem).installed) {
      return Bespok3dPluginInstallResult(true, listOf(identity.id), emptyMap())
    }
    val plugin = Bespok3dPlugin(
      id = identity.id,
      title = "HelixScreen Touchscreen",
      version = identity.version,
      tagline = "",
      category = "screen",
      repository = "",
      dependencies = emptyList(),
      config = emptyList(),
    )
    val boundary = "----HelixB3${UUID.randomUUID().toString().replace("-", "")}"
    val body = buildBatchMultipart(
      boundary,
      listOf(DownloadedPlugin(plugin, bytes, mapOf("SCREEN_UI" to "snapmaker"))),
    )
    val response = requestBytes(
      host = host,
      path = "/packages/install-batch",
      method = "POST",
      body = body,
      contentType = "multipart/form-data; boundary=$boundary",
      token = token,
      certificatePem = certificatePem,
      timeoutMs = INSTALL_TIMEOUT_MS,
    )
    val result = Bespok3dProtocol.parseInstallResult(response.body)
    require(result.installedIds.all { it == identity.id }) {
      "Bespok3d reported the wrong installed plugin"
    }
    if (result.ok) {
      require(result.installedIds == listOf(identity.id)) {
        "Bespok3d did not confirm the HelixScreen installation"
      }
      helixScreenState(host, token, certificatePem).also { state ->
        require(state.installed && state.selected == "snapmaker") {
          "HelixScreen was not installed with the stock touchscreen selected"
        }
      }
    }
    return result
  }

  private data class DownloadedPlugin(
    val plugin: Bespok3dPlugin,
    val bytes: ByteArray,
    val vars: Map<String, String>,
  )

  private fun resolvedVars(
    plugin: Bespok3dPlugin,
    requested: Map<String, String>,
  ): Map<String, String> {
    val declared = plugin.config.associateBy { it.key }
    require(requested.keys.all(declared::containsKey)) {
      "Bespok3d config contains an unknown field for ${plugin.id}"
    }
    require(requested.values.all { it.length <= MAX_CONFIG_VALUE_LENGTH && it.all { char -> !char.isISOControl() } }) {
      "Bespok3d config value is invalid"
    }
    return buildMap {
      plugin.config.forEach { field ->
        val value = requested[field.key] ?: field.defaultValue
        require(!field.required || !value.isNullOrBlank()) {
          "${field.label} is required for ${plugin.title}"
        }
        if (value != null) put(field.key, value)
      }
    }
  }

  private fun buildBatchMultipart(boundary: String, packages: List<DownloadedPlugin>): ByteArray {
    val newline = "\r\n"
    val output = ByteArrayOutputStream()
    packages.forEach { item ->
      output.write(
        ("--$boundary$newline" +
          "Content-Disposition: form-data; name=\"files\"; filename=\"${item.plugin.id}.b3\"$newline" +
          "Content-Type: application/octet-stream$newline$newline").toByteArray(StandardCharsets.US_ASCII),
      )
      output.write(item.bytes)
      output.write(newline.toByteArray(StandardCharsets.US_ASCII))
    }
    val vars = JSONObject()
    packages.filter { it.vars.isNotEmpty() }.forEach { item -> vars.put(item.plugin.id, JSONObject(item.vars)) }
    output.write(
      ("--$boundary$newline" +
        "Content-Disposition: form-data; name=\"vars_json\"$newline$newline" +
        vars.toString() + newline +
        "--$boundary--$newline").toByteArray(StandardCharsets.UTF_8),
    )
    require(output.size() <= MAX_BATCH_BYTES) { "Selected Bespok3d plugins exceed the batch size limit" }
    return output.toByteArray()
  }

  private data class Response(val body: String, val leaf: X509Certificate)

  private fun request(
    host: String,
    path: String,
    method: String,
    body: String?,
    token: String?,
    certificatePem: String?,
  ): Response = requestBytes(
    host = host,
    path = path,
    method = method,
    body = body?.toByteArray(StandardCharsets.UTF_8),
    contentType = if (body == null) null else "application/json",
    token = token,
    certificatePem = certificatePem,
    timeoutMs = TIMEOUT_MS,
  )

  private fun requestBytes(
    host: String,
    path: String,
    method: String,
    body: ByteArray?,
    contentType: String?,
    token: String?,
    certificatePem: String?,
    timeoutMs: Int,
  ): Response {
    val cleanHost = validatedHost(host)
    val urlHost = if (cleanHost.contains(':') && !cleanHost.startsWith('[')) "[$cleanHost]" else cleanHost
    val connection = URL("https://$urlHost:$PORT$path").openConnection() as HttpsURLConnection
    connection.connectTimeout = TIMEOUT_MS
    connection.readTimeout = timeoutMs
    connection.requestMethod = method
    connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
    connection.sslSocketFactory = socketFactory(certificatePem)
    connection.setRequestProperty("Accept", "application/json")
    if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
    if (body != null) {
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", contentType ?: "application/octet-stream")
      connection.setFixedLengthStreamingMode(body.size)
      connection.outputStream.use { it.write(body) }
    }

    try {
      val status = connection.responseCode
      val leaf = connection.serverCertificates.firstOrNull() as? X509Certificate
        ?: throw CertificateException("Bespok3d presented no certificate")
      val stream = if (status >= HttpURLConnection.HTTP_BAD_REQUEST) {
        connection.errorStream
      } else {
        connection.inputStream
      }
      val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
      if (status >= HttpURLConnection.HTTP_BAD_REQUEST) {
        throw Bespok3dHttpException(status, "Bespok3d returned HTTP $status")
      }
      return Response(text, leaf)
    } finally {
      connection.disconnect()
    }
  }

  private fun download(url: String, maxBytes: Int, accept: String): ByteArray {
    require(url.startsWith("https://")) { "Bespok3d downloads require HTTPS" }
    val connection = URL(url).openConnection() as HttpsURLConnection
    connection.instanceFollowRedirects = true
    connection.connectTimeout = DOWNLOAD_TIMEOUT_MS
    connection.readTimeout = DOWNLOAD_TIMEOUT_MS
    connection.setRequestProperty("Accept", accept)
    connection.setRequestProperty("User-Agent", "Helix-Android/3.0")
    try {
      val status = connection.responseCode
      if (status >= HttpURLConnection.HTTP_BAD_REQUEST) {
        throw Bespok3dHttpException(status, "Bespok3d download returned HTTP $status")
      }
      val length = connection.contentLengthLong
      require(length < 0 || length <= maxBytes) { "Bespok3d download exceeds its size limit" }
      val output = ByteArrayOutputStream(if (length in 1..Int.MAX_VALUE) length.toInt() else 16 * 1024)
      connection.inputStream.use { input ->
        val buffer = ByteArray(16 * 1024)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          output.write(buffer, 0, count)
          require(output.size() <= maxBytes) { "Bespok3d download exceeds its size limit" }
        }
      }
      return output.toByteArray()
    } finally {
      connection.disconnect()
    }
  }

  private fun validatedHost(raw: String): String {
    val host = raw.trim().removePrefix("[").removeSuffix("]")
    require(host.isNotEmpty() && host.length <= 253) { "Bespok3d host is required" }
    require(!host.contains('/') && !host.contains("//") && host.none(Char::isWhitespace)) {
      "Bespok3d host must not include a URL or path"
    }
    return host
  }

  private fun socketFactory(pinnedPem: String?) = SSLContext.getInstance("TLS").apply {
    val manager = if (pinnedPem == null) TrustAnyCertificate else ExactCertificateTrust(certificate(pinnedPem))
    init(null, arrayOf<TrustManager>(manager), null)
  }.socketFactory

  private fun certificate(pem: String): X509Certificate =
    CertificateFactory.getInstance("X.509")
      .generateCertificate(ByteArrayInputStream(pem.toByteArray(StandardCharsets.US_ASCII))) as X509Certificate

  private fun pem(certificate: X509Certificate): String {
    val base64 = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(certificate.encoded)
    return "-----BEGIN CERTIFICATE-----\n$base64\n-----END CERTIFICATE-----\n"
  }

  private object TrustAnyCertificate : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
  }

  private class ExactCertificateTrust(private val pinned: X509Certificate) : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      val leaf = chain?.firstOrNull() ?: throw CertificateException("Bespok3d presented no certificate")
      if (!leaf.encoded.contentEquals(pinned.encoded)) {
        throw CertificateException("Bespok3d certificate does not match the paired printer")
      }
    }
    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf(pinned)
  }

  private companion object {
    const val PORT = 4269
    const val TIMEOUT_MS = 8_000
    const val DOWNLOAD_TIMEOUT_MS = 30_000
    const val INSTALL_TIMEOUT_MS = 300_000
    const val RECONFIGURE_TIMEOUT_MS = 60_000
    const val MAX_CONFIG_VALUE_LENGTH = 2_048
    const val MAX_SIGNATURE_BYTES = 16 * 1024
    const val MAX_CATALOG_BYTES = 2 * 1024 * 1024
    const val MAX_RELEASES_BYTES = 4 * 1024 * 1024
    const val MAX_PACKAGE_BYTES = 64 * 1024 * 1024
    const val MAX_BATCH_BYTES = 96 * 1024 * 1024
    const val CATALOG_URL = "https://raw.githubusercontent.com/Bespok3d/main-index/main/index.json"
    const val CATALOG_SIGNATURE_URL = "$CATALOG_URL.sig"
  }
}
