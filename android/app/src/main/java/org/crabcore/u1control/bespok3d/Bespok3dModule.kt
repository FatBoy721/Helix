package org.crabcore.u1control.bespok3d

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.ViewManager
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.UUID

class Bespok3dModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  private val client = Bespok3dClient()
  private val u1Preflight = Bespok3dU1Preflight()
  private val u1Enrollment = Bespok3dU1Enrollment()

  override fun getName(): String = NAME

  /** Read-only daemon detection. This does not create a client or change the printer. */
  @ReactMethod
  fun probe(config: ReadableMap, promise: Promise) = background(promise) {
    val result = client.probe(config.requiredString("host"))
    Arguments.createMap().apply {
      putString("version", result.version)
      putString("license", result.license)
      putString("source", result.source)
      putString("certificatePem", result.certificatePem)
      putString("certificateSha256", result.certificateSha256)
    }
  }

  /** Adds a pending phone request; an already-authorized Bespok3d client must approve it. */
  @ReactMethod
  fun requestAccess(config: ReadableMap, promise: Promise) = background(promise) {
    val result = client.requestAccess(
      host = config.requiredString("host"),
      label = config.requiredString("label"),
      publicKey = config.optionalString("publicKey"),
    )
    Arguments.createMap().apply {
      putString("identity", result.identity)
      putString("token", result.token)
      putString("certificatePem", result.certificatePem)
      putString("certificateSha256", result.certificateSha256)
    }
  }

  /** Returns granted=false only for the daemon's explicit 401 pending response. */
  @ReactMethod
  fun checkAccess(config: ReadableMap, promise: Promise) = background(promise) {
    try {
      val result = client.status(
        host = config.requiredString("host"),
        token = config.requiredString("token"),
        certificatePem = config.requiredString("certificatePem"),
      )
      Arguments.createMap().apply {
        putBoolean("granted", true)
        putString("version", result.version)
        putString("printerUuid", result.printerUuid)
      }
    } catch (error: Bespok3dHttpException) {
      if (error.statusCode != 401) throw error
      Arguments.createMap().apply { putBoolean("granted", false) }
    }
  }

  /** Reads which touchscreen UI the locally installed HelixScreen plugin selected. */
  @ReactMethod
  fun helixScreenState(config: ReadableMap, promise: Promise) =
    background(promise, "helixscreen-status-failed") {
      client.helixScreenState(
        host = config.requiredString("host"),
        token = config.requiredSecret("token"),
        certificatePem = config.requiredString("certificatePem"),
      ).toWritableMap()
    }

  /** Reconfigures only helixscreen-ui and accepts only stock or HelixScreen as the target. */
  @ReactMethod
  fun configureHelixScreen(config: ReadableMap, promise: Promise) =
    background(promise, "helixscreen-switch-failed") {
      client.configureHelixScreen(
        host = config.requiredString("host"),
        token = config.requiredSecret("token"),
        certificatePem = config.requiredString("certificatePem"),
        selected = config.requiredString("selected"),
      ).toWritableMap()
    }

  /** Returns the signed official catalog alongside the printer's live installed versions. */
  @ReactMethod
  fun plugins(config: ReadableMap, promise: Promise) = background(promise, "plugin-catalog-failed") {
    val result = client.plugins(
      host = config.requiredString("host"),
      token = config.requiredSecret("token"),
      certificatePem = config.requiredString("certificatePem"),
    )
    Arguments.createMap().apply {
      putArray("plugins", Arguments.createArray().apply {
        result.plugins.forEach { plugin ->
          pushMap(Arguments.createMap().apply {
            putString("id", plugin.id)
            putString("title", plugin.title)
            putString("version", plugin.version)
            putString("tagline", plugin.tagline)
            putString("category", plugin.category)
            putArray("dependencies", Arguments.fromList(plugin.dependencies))
            putArray("config", Arguments.createArray().apply {
              plugin.config.forEach { field ->
                pushMap(Arguments.createMap().apply {
                  putString("key", field.key)
                  putString("label", field.label)
                  putString("type", field.type)
                  if (field.defaultValue == null) putNull("defaultValue")
                  else putString("defaultValue", field.defaultValue)
                  putBoolean("required", field.required)
                  putArray("options", Arguments.fromList(field.options))
                  putString("hint", field.hint)
                  putString("onValue", field.onValue)
                  putString("offValue", field.offValue)
                })
              }
            })
          })
        }
      })
      putMap("installed", Arguments.createMap().apply {
        result.installed.forEach(::putString)
      })
    }
  }

  /** Downloads, verifies, and batch-installs only the package ids explicitly selected by the user. */
  @ReactMethod
  fun installPlugins(config: ReadableMap, promise: Promise) = background(promise, "plugin-install-failed") {
    val selectedIds = config.requiredArray("pluginIds").strings()
    val requestedVars = parsePluginVars(config.optionalString("varsJson"))
    val result = client.installPlugins(
      host = config.requiredString("host"),
      token = config.requiredSecret("token"),
      certificatePem = config.requiredString("certificatePem"),
      selectedIds = selectedIds,
      requestedVars = requestedVars,
    )
    Arguments.createMap().apply {
      putBoolean("ok", result.ok)
      putArray("installedIds", Arguments.fromList(result.installedIds))
      putMap("failures", Arguments.createMap().apply {
        result.failures.forEach(::putString)
      })
    }
  }

  /** Installs the exact hash-pinned HelixScreen package embedded in the APK. */
  @ReactMethod
  fun installBundledHelixScreen(config: ReadableMap, promise: Promise) =
    background(promise, "helixscreen-install-failed") {
      val bytes = reactApplicationContext.assets
        .open(Bespok3dProtocol.BUNDLED_HELIXSCREEN_ASSET)
        .use { it.readBytes() }
      val result = client.installBundledHelixScreen(
        host = config.requiredString("host"),
        token = config.requiredSecret("token"),
        certificatePem = config.requiredString("certificatePem"),
        bytes = bytes,
      )
      Arguments.createMap().apply {
        putBoolean("ok", result.ok)
        putArray("installedIds", Arguments.fromList(result.installedIds))
        putMap("failures", Arguments.createMap().apply {
          result.failures.forEach(::putString)
        })
      }
    }

  /** Verifies a stock, idle U1 using read-only SSH and Moonraker requests. */
  @ReactMethod
  fun preflightU1(config: ReadableMap, promise: Promise) =
    background(promise, "u1-preflight-failed") {
      val result = u1Preflight.run(
        host = config.requiredString("host"),
        password = config.requiredSecret("password"),
      )
      Arguments.createMap().apply {
        putString("firmware", result.firmware)
        putString("model", result.model)
        putBoolean("overlayActive", result.overlayActive)
        putBoolean("workspacePresent", result.workspacePresent)
        putBoolean("daemonRunning", result.daemonRunning)
        putString("printState", result.printState)
        putBoolean("eligible", result.eligible)
        if (result.reason == null) putNull("reason") else putString("reason", result.reason)
        putString("sshHostKeySha256", result.sshHostKeySha256)
      }
    }

  /** Creates credentials before mutation so the UI can persist them securely for retry. */
  @ReactMethod
  fun prepareU1Enrollment(promise: Promise) = background(promise, "u1-credentials-failed") {
    val credentials = newEnrollmentCredentials()
    Arguments.createMap().apply {
      putString("identity", credentials.identity)
      putString("token", credentials.token)
    }
  }

  /** Runs the official signed, idempotent stock-U1 enrollment recipe. */
  @ReactMethod
  fun enrollU1(config: ReadableMap, promise: Promise) = background(promise, "u1-enroll-failed") {
    // Signature verification intentionally finishes before the first enrollment SSH write.
    val bootstrap = Bespok3dBootstrapPackages.load(reactApplicationContext)
    val credentials = Bespok3dU1EnrollmentCredentials(
      identity = config.requiredString("identity"),
      token = config.requiredSecret("token"),
    )
    val result = u1Enrollment.run(
      Bespok3dU1EnrollmentConfig(
        host = config.requiredString("host"),
        password = config.requiredSecret("password"),
        sshHostKeySha256 = config.requiredString("sshHostKeySha256"),
        label = config.requiredString("label"),
        credentials = credentials,
      ),
      bootstrap,
    )
    val certificate = CertificateFactory.getInstance("X.509")
      .generateCertificate(ByteArrayInputStream(result.certificatePem.toByteArray(Charsets.US_ASCII))) as X509Certificate
    Arguments.createMap().apply {
      putString("identity", credentials.identity)
      putString("token", credentials.token)
      putString("certificatePem", result.certificatePem)
      putString("certificateSha256", Bespok3dProtocol.certificateSha256(certificate.encoded))
      putString("daemonVersion", result.daemonVersion)
      putString("jinniVersion", result.jinniVersion)
      putArray("completedSteps", Arguments.fromList(result.completedSteps))
    }
  }

  private fun background(
    promise: Promise,
    fallbackCode: String = "daemon-unreachable",
    operation: () -> Any?,
  ) {
    Thread({
      try {
        promise.resolve(operation())
      } catch (error: Throwable) {
        val code = when (error) {
          is Bespok3dEnrollmentException -> "u1-enroll-${error.stepId}"
          is IllegalArgumentException -> "bad-config"
          is CertificateException -> "certificate-mismatch"
          is Bespok3dHttpException -> "daemon-http-${error.statusCode}"
          else -> fallbackCode
        }
        promise.reject(code, error.message ?: "Bespok3d request failed", error)
      }
    }, "helix-bespok3d").start()
  }

  private fun ReadableMap.requiredString(key: String): String =
    getString(key)?.trim()?.takeIf(String::isNotEmpty)
      ?: throw IllegalArgumentException("$key is required")

  private fun ReadableMap.requiredSecret(key: String): String =
    getString(key)?.takeIf(String::isNotEmpty)
      ?: throw IllegalArgumentException("$key is required")

  private fun ReadableMap.optionalString(key: String): String =
    if (hasKey(key) && !isNull(key)) getString(key)?.trim().orEmpty() else ""

  private fun ReadableMap.requiredArray(key: String): ReadableArray =
    getArray(key) ?: throw IllegalArgumentException("$key is required")

  private fun ReadableArray.strings(): List<String> = buildList {
    for (position in 0 until size()) {
      add(getString(position) ?: throw IllegalArgumentException("pluginIds must contain strings"))
    }
  }

  private fun parsePluginVars(json: String): Map<String, Map<String, String>> {
    if (json.isBlank()) return emptyMap()
    val root = JSONObject(json)
    return root.keys().asSequence().associateWith { pluginId ->
      val fields = root.getJSONObject(pluginId)
      fields.keys().asSequence().associateWith(fields::getString)
    }
  }

  private fun Bespok3dHelixScreenState.toWritableMap() = Arguments.createMap().apply {
    putBoolean("installed", installed)
    if (selected == null) putNull("selected") else putString("selected", selected)
  }

  private fun newEnrollmentCredentials(): Bespok3dU1EnrollmentCredentials =
    Bespok3dU1EnrollmentCredentials(
      identity = "helix-${UUID.randomUUID()}",
      token = ByteArray(32).also(SecureRandom()::nextBytes).joinToString("") { "%02x".format(it) },
    )

  companion object {
    const val NAME = "HelixBespok3d"
  }
}

class Bespok3dPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(Bespok3dModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<in Nothing, in Nothing>> = emptyList()
}
