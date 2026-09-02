// React Native bridge for the Bambu Lab LAN transport. All the protocol and
// TLS work lives in BambuMqttConnection, which has no RN dependencies so it can
// be exercised against a real printer from a plain JVM test.
//
// This module is deliberately dumb: it moves bytes and reports connection
// state. Parsing reports, and mapping them onto the Klipper-shaped status the
// dashboard consumes, happens in JS — see services/bambuMqtt.ts.
// crabcore

package org.crabcore.u1control.bambu

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.concurrent.CompletionException
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

class BambuMqttModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /** One printer at a time, mirroring MoonrakerProvider's single connection. */
  private val connection = BambuMqttConnection(object : BambuMqttConnection.Listener {
    override fun onReport(payload: String) {
      resolvePrintStart(payload)
      emit(EVENT_MESSAGE, Arguments.createMap().apply { putString("payload", payload) })
    }

    override fun onStateChange(state: String, message: String?) {
      emit(
        EVENT_STATE,
        Arguments.createMap().apply {
          putString("state", state)
          putString("message", message)
        }
      )
    }
  })

  private val camera = BambuChamberCamera {
    emit(EVENT_CAMERA_STOPPED, Arguments.createMap())
  }
  private val printUpload = BambuPrintUpload(reactContext)
  private val startTimeouts = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "helix-bambu-print-ack").apply { isDaemon = true }
  }
  private val nextSequence = AtomicLong(System.currentTimeMillis())
  private val pendingStart = AtomicReference<PendingPrintStart?>(null)

  @ReactMethod
  fun connect(config: ReadableMap, promise: Promise) {
    val host = config.getString("host")?.trim().orEmpty()
    val serial = config.getString("serial")?.trim().orEmpty()
    val accessCode = config.getString("accessCode")?.trim().orEmpty()
    val port = if (config.hasKey("port")) config.getInt("port") else BambuMqttConnection.DEFAULT_PORT

    if (host.isEmpty() || serial.isEmpty() || accessCode.isEmpty()) {
      promise.reject("bad-config", "host, serial and accessCode are all required")
      return
    }

    connection.connect(host, port, serial, accessCode).whenComplete { _, error ->
      if (error != null) reject(promise, error) else promise.resolve(null)
    }
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    connection.close()
    promise.resolve(null)
  }

  /** Performs one independent, read-only status request for an inactive printer. */
  @ReactMethod
  fun probeStatus(config: ReadableMap, promise: Promise) {
    val request = runCatching {
      BambuStatusProbeConfig(
        host = config.requiredString("host"),
        serial = config.requiredString("serial"),
        accessCode = config.requiredString("accessCode"),
      )
    }.getOrElse { error ->
      promise.reject("bad-config", error.message ?: "Invalid Bambu status settings", error)
      return
    }

    BambuStatusProbe().probe(request).whenComplete { payload, error ->
      if (error != null) reject(promise, error) else promise.resolve(payload)
    }
  }

  /**
   * `payload` is a JSON string built in JS — the command vocabulary is Bambu's,
   * not ours, so there is nothing for Kotlin to validate here.
   */
  @ReactMethod
  fun publish(payload: String, promise: Promise) {
    connection.publish(payload).whenComplete { _, error ->
      if (error != null) reject(promise, error) else promise.resolve(null)
    }
  }

  /**
   * Converts one already-sliced, single-filament P1S job into a validated
   * `.gcode.3mf` and uploads it to the printer's FTPS root. This does not start
   * the print; MQTT acknowledgement handling remains a separate operation.
   */
  @ReactMethod
  fun uploadPrintArtifact(config: ReadableMap, promise: Promise) {
    val request = runCatching {
      BambuPrintUpload.Request(
        host = config.requiredString("host"),
        serial = config.requiredString("serial"),
        accessCode = config.requiredString("accessCode"),
        gcodeFile = File(config.requiredString("gcodePath")),
        remoteName = config.requiredString("remoteName"),
        usedToolMask = config.getInt("usedToolMask"),
        predictionSeconds = config.getInt("predictionSeconds"),
        weightGrams = config.getDouble("weightGrams"),
        filamentType = config.requiredString("filamentType"),
        filamentColor = config.requiredString("filamentColor"),
      )
    }.getOrElse { error ->
      promise.reject("bad-print-artifact", error.message ?: "Invalid Bambu upload settings", error)
      return
    }

    Thread({
      try {
        val result = printUpload.upload(request)
        promise.resolve(Arguments.createMap().apply {
          putString("remoteName", result.remoteName)
          putDouble("verifiedBytes", result.verifiedBytes.toDouble())
          putString("archiveMd5", result.archiveMd5)
          putString("gcodeMd5", result.gcodeMd5)
          putArray("objects", Arguments.createArray().apply {
            result.objects.forEach { printableObject ->
              pushMap(Arguments.createMap().apply {
                putInt("identifyId", printableObject.identifyId)
                putString("name", printableObject.name)
              })
            }
          })
        })
      } catch (e: BambuConnectException) {
        promise.reject(e.code, e.message, e)
      } catch (e: IllegalArgumentException) {
        promise.reject("bad-print-artifact", e.message, e)
      } catch (e: Exception) {
        promise.reject("upload-failed", e.message ?: "Could not upload the Bambu print artifact", e)
      }
    }, "helix-bambu-print-upload").start()
  }

  /** Publishes the verified `project_file` command and resolves only on its matching printer reply. */
  @ReactMethod
  fun startProjectFile(config: ReadableMap, promise: Promise) {
    val sequenceId = nextSequence.incrementAndGet().toString()
    val payload = runCatching {
      BambuPrintProtocol.buildProjectFilePayload(
        BambuPrintProtocol.ProjectFileCommand(
          sequenceId = sequenceId,
          fileName = config.requiredString("remoteName"),
          subtaskName = config.requiredString("subtaskName"),
          md5 = config.requiredString("archiveMd5"),
          toolToLane = config.requiredIntMap("toolToLane"),
          bedType = config.requiredString("bedType"),
          useAms = config.getBoolean("useAms"),
          bedLeveling = config.getBoolean("bedLeveling"),
          flowCalibration = config.getBoolean("flowCalibration"),
          timelapse = config.getBoolean("timelapse"),
          vibrationCalibration = config.getBoolean("vibrationCalibration"),
        )
      )
    }.getOrElse { error ->
      promise.reject("bad-print-command", error.message ?: "Invalid Bambu print command", error)
      return
    }

    val pending = PendingPrintStart(sequenceId, promise)
    if (!pendingStart.compareAndSet(null, pending)) {
      promise.reject("print-start-busy", "Another Bambu print start is awaiting confirmation")
      return
    }
    pending.timeout = startTimeouts.schedule({
      if (pendingStart.compareAndSet(pending, null)) {
        promise.reject("print-start-timeout", "The printer did not confirm the print start")
      }
    }, PRINT_START_TIMEOUT_SECONDS, TimeUnit.SECONDS)

    connection.publish(payload).whenComplete { _, error ->
      if (error != null && pendingStart.compareAndSet(pending, null)) {
        pending.timeout?.cancel(false)
        reject(promise, error)
      }
    }
  }

  /**
   * Opens the chamber stream and returns a loopback MJPEG URL that
   * components/CameraFeed.tsx can play like any Moonraker webcam. Blocks until
   * a frame has actually arrived, so a resolved URL always shows a picture.
   */
  @ReactMethod
  fun startCamera(config: ReadableMap, promise: Promise) {
    val host = config.getString("host")?.trim().orEmpty()
    val serial = config.getString("serial")?.trim().orEmpty()
    val accessCode = config.getString("accessCode")?.trim().orEmpty()

    if (host.isEmpty() || serial.isEmpty() || accessCode.isEmpty()) {
      promise.reject("bad-config", "host, serial and accessCode are all required")
      return
    }

    // start() blocks on the first frame, so it must not run on the bridge thread.
    Thread({
      try {
        promise.resolve(camera.start(host, serial, accessCode))
      } catch (e: BambuConnectException) {
        promise.reject(e.code, e.message, e)
      } catch (e: Exception) {
        promise.reject("camera-failed", e.message ?: "Could not open the chamber camera", e)
      }
    }, "helix-bambu-cam-start").start()
  }

  @ReactMethod
  fun stopCamera(promise: Promise) {
    camera.stop()
    promise.resolve(null)
  }

  override fun invalidate() {
    pendingStart.getAndSet(null)?.let { pending ->
      pending.timeout?.cancel(false)
      pending.promise.reject("print-start-cancelled", "Bambu connection closed before print confirmation")
    }
    startTimeouts.shutdownNow()
    connection.close()
    camera.stop()
    super.invalidate()
  }

  /** Unwraps CompletableFuture's wrapper so JS sees our own stable codes. */
  private fun reject(promise: Promise, error: Throwable) {
    val cause = if (error is CompletionException && error.cause != null) error.cause!! else error
    val code = (cause as? BambuConnectException)?.code ?: "unknown"
    promise.reject(code, cause.message ?: "Bambu connection failed", cause)
  }

  private fun emit(event: String, params: WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, params)
  }

  private fun ReadableMap.requiredString(key: String): String =
    getString(key)?.trim()?.takeIf { it.isNotEmpty() }
      ?: throw IllegalArgumentException("$key is required")

  private fun ReadableMap.requiredIntMap(key: String): Map<Int, Int> {
    val map = getMap(key) ?: throw IllegalArgumentException("$key is required")
    val out = mutableMapOf<Int, Int>()
    val keys = map.keySetIterator()
    while (keys.hasNextKey()) {
      val rawKey = keys.nextKey()
      val tool = rawKey.toIntOrNull() ?: throw IllegalArgumentException("$key has an invalid tool")
      out[tool] = map.getInt(rawKey)
    }
    return out
  }

  private fun resolvePrintStart(payload: String) {
    val pending = pendingStart.get() ?: return
    when (BambuPrintProtocol.acknowledgement(payload, pending.sequenceId)) {
      BambuPrintProtocol.Acknowledgement.NOT_MATCHING -> return
      BambuPrintProtocol.Acknowledgement.SUCCESS -> {
        if (pendingStart.compareAndSet(pending, null)) {
          pending.timeout?.cancel(false)
          pending.promise.resolve(null)
        }
      }
      BambuPrintProtocol.Acknowledgement.REJECTED -> {
        if (pendingStart.compareAndSet(pending, null)) {
          pending.timeout?.cancel(false)
          pending.promise.reject("print-start-rejected", "The printer rejected the print start")
        }
      }
    }
  }

  private data class PendingPrintStart(
    val sequenceId: String,
    val promise: Promise,
    var timeout: ScheduledFuture<*>? = null,
  )

  companion object {
    const val NAME = "HelixBambuMqtt"
    private const val EVENT_MESSAGE = "HelixBambuMessage"
    private const val EVENT_STATE = "HelixBambuState"
    private const val EVENT_CAMERA_STOPPED = "HelixBambuCameraStopped"
    private const val PRINT_START_TIMEOUT_SECONDS = 20L
  }
}
