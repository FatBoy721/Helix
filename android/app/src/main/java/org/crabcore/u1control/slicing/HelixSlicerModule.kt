package org.crabcore.u1control.slicing

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.CookieManager
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.u1.slicer.NativeLibrary
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit

class HelixSlicerModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {
  override fun getName(): String = NAME

  private var native: NativeLibrary? = null
  private var makerWorldDownloaderPromise: Promise? = null
  private var pickModelPromise: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val status = Arguments.createMap()
    status.putString("platform", "android")
    status.putBoolean("available", true)
    status.putBoolean("loaded", NativeLibrary.isLoaded)
    status.putString("loadError", NativeLibrary.loadError)

    if (!NativeLibrary.isLoaded) {
      status.putString("coreVersion", null)
      promise.resolve(status)
      return
    }

    try {
      status.putString("coreVersion", NativeLibrary().getCoreVersion())
      status.putString("coreError", null)
    } catch (error: Throwable) {
      status.putString("coreVersion", null)
      status.putString("coreError", "${error::class.java.simpleName}: ${error.message}")
    }

    promise.resolve(status)
  }

  @ReactMethod
  fun getSharedLink(promise: Promise) {
    val intent = getCurrentActivity()?.intent
    val result = Arguments.createMap()
    val action = intent?.action
    val rawText = when (action) {
      Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
      Intent.ACTION_VIEW -> intent.dataString
      else -> null
    }
    val link = rawText?.let { extractMakerWorldLink(it) }

    result.putString("action", action)
    result.putString("rawText", rawText)
    result.putString("makerWorldUrl", link)
    result.putBoolean("hasMakerWorldUrl", link != null)
    promise.resolve(result)
  }

  /**
   * When the app was launched by tapping a .3mf/.stl (ACTION_VIEW) or receiving
   * one via the share sheet (ACTION_SEND with a stream), copies that file into
   * app storage and returns { fileName, filePath, sizeBytes }. Returns null when
   * there's no model to open. Marks the intent consumed so it imports only once.
   */
  @ReactMethod
  fun getSharedModelFile(promise: Promise) {
    try {
      val activity = getCurrentActivity()
      val intent = activity?.intent
      if (intent == null || intent.getBooleanExtra(EXTRA_MODEL_CONSUMED, false)) {
        promise.resolve(null)
        return
      }

      val uri: Uri? = when (intent.action) {
        Intent.ACTION_VIEW -> intent.data
        Intent.ACTION_SEND ->
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
          } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
          }
        else -> null
      }

      val scheme = uri?.scheme?.lowercase()
      if (uri == null || (scheme != "content" && scheme != "file")) {
        promise.resolve(null)
        return
      }

      val imported = importModelUri(reactApplicationContext.contentResolver, uri, "opened")
      if (imported == null) {
        promise.resolve(null)
        return
      }

      // Mark handled only after a successful import so a failed copy can retry.
      intent.putExtra(EXTRA_MODEL_CONSUMED, true)
      activity.intent = intent

      promise.resolve(imported)
    } catch (error: Throwable) {
      promise.reject("E_OPEN_FILE", error.message, error)
    }
  }

  /** Opens the system file picker for .3mf / .stl and imports into app storage. */
  @ReactMethod
  fun pickModelFile(promise: Promise) {
    val activity = getCurrentActivity()
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No active activity for file picker.")
      return
    }
    if (pickModelPromise != null) {
      promise.reject("E_BUSY", "A file picker is already open.")
      return
    }
    pickModelPromise = promise
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(
        Intent.EXTRA_MIME_TYPES,
        arrayOf(
          "model/3mf",
          "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
          "application/vnd.ms-3mfdocument",
          "model/stl",
          "application/sla",
          "application/vnd.ms-pki.stl",
          "application/octet-stream",
        ),
      )
    }
    try {
      activity.startActivityForResult(intent, REQUEST_PICK_MODEL)
    } catch (error: Throwable) {
      pickModelPromise = null
      promise.reject("E_PICKER", error.message, error)
    }
  }

  private fun importModelUri(
    resolver: ContentResolver,
    uri: Uri,
    prefix: String = "picked",
  ): com.facebook.react.bridge.WritableMap? {
    val displayName = queryDisplayName(resolver, uri)
      ?: uri.lastPathSegment?.substringAfterLast('/')
    val ext = modelExtension(displayName, resolver.getType(uri))
    if (ext == null) return null

    val safeBase = (displayName ?: "model")
      .substringAfterLast('/')
      .substringAfterLast('\\')
      .replace(Regex("""[/\\:*?"<>|]"""), "_")
      .removeSuffix(".$ext")
      .removeSuffix(".${ext.uppercase()}")
      .ifBlank { "model" }
    val outFile = File(reactApplicationContext.filesDir, "${prefix}_$safeBase.$ext")

    val copied = try {
      resolver.openInputStream(uri)?.use { input ->
        outFile.outputStream().use { input.copyTo(it) }
      } != null
    } catch (_: Throwable) {
      false
    }

    if (!copied || !outFile.exists() || outFile.length() == 0L) return null

    return Arguments.createMap().apply {
      putString("fileName", "$safeBase.$ext")
      putString("filePath", outFile.absolutePath)
      putDouble("sizeBytes", outFile.length().toDouble())
    }
  }

  private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? {
    if (uri.scheme?.lowercase() != "content") return null
    return try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (idx >= 0) c.getString(idx) else null
        } else {
          null
        }
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun modelExtension(name: String?, mime: String?): String? {
    val lower = name?.lowercase() ?: ""
    val type = mime?.substringBefore(';')?.trim()?.lowercase()
    return when {
      lower.endsWith(".3mf") -> "3mf"
      lower.endsWith(".stl") -> "stl"
      type == "model/3mf" ||
        type == "application/vnd.ms-package.3dmanufacturing-3dmodel+xml" ||
        type == "application/vnd.ms-3mfdocument" -> "3mf"
      type == "model/stl" || type == "application/sla" ||
        type == "application/vnd.ms-pki.stl" -> "stl"
      (type == "application/octet-stream" || type == "binary/octet-stream" ||
        type == "application/zip" || type == "application/x-zip-compressed") &&
        lower.endsWith(".3mf") -> "3mf"
      (type == "application/octet-stream" || type == "binary/octet-stream") &&
        lower.endsWith(".stl") -> "stl"
      else -> null
    }
  }

  /**
   * Lists the plates in a Bambu/Orca multi-plate 3MF. Each entry:
   * { id, name, objectCount, thumbnail (data: URI or null) }. Empty array for
   * single-plate 3MFs and STLs.
   */
  @ReactMethod
  fun getModelPlates(path: String, promise: Promise) {
    try {
      val file = File(path.removePrefix("file://"))
      val arr = Arguments.createArray()
      if (!file.exists()) {
        promise.resolve(arr)
        return
      }
      for (plate in PlateExtractor.readPlates(file)) {
        arr.pushMap(Arguments.createMap().apply {
          putInt("id", plate.id)
          putString("name", plate.name)
          putInt("objectCount", plate.objectIds.size)
          putString("thumbnail", PlateExtractor.readThumbnailDataUri(file, plate.thumbnailEntry))
        })
      }
      promise.resolve(arr)
    } catch (error: Throwable) {
      promise.reject("E_PLATES", error.message, error)
    }
  }

  /**
   * Repacks a single plate of a multi-plate 3MF into its own temp 3MF (only that
   * plate's objects). Resolves { filePath, fileName, objectCount }. The caller
   * should open it with autoArrange=true so the objects re-center on the bed.
   */
  @ReactMethod
  fun extractPlate(path: String, plateId: Int, promise: Promise) {
    try {
      val file = File(path.removePrefix("file://"))
      if (!file.exists()) {
        promise.reject("E_NO_FILE", "Model file not found: ${file.absolutePath}")
        return
      }
      val plate = PlateExtractor.readPlates(file).firstOrNull { it.id == plateId }
      if (plate == null) {
        promise.reject("E_NO_PLATE", "Plate $plateId not found in this model.")
        return
      }
      if (plate.objectIds.isEmpty()) {
        promise.reject("E_EMPTY_PLATE", "That plate has no printable objects.")
        return
      }
      val safeName = plate.name
        .replace(Regex("""[/\\:*?"<>|]"""), "_")
        .trim()
        .ifBlank { "plate_$plateId" }
      val outFile = File(reactApplicationContext.filesDir, "plate_${plateId}_$safeName.3mf")
      PlateExtractor.extractPlate(file, plate, outFile)
      if (!outFile.exists() || outFile.length() == 0L) {
        promise.reject("E_EXTRACT", "Failed to extract plate $plateId.")
        return
      }
      promise.resolve(Arguments.createMap().apply {
        putString("filePath", outFile.absolutePath)
        putString("fileName", "$safeName.3mf")
        putInt("objectCount", plate.objectIds.size)
      })
    } catch (error: Throwable) {
      promise.reject("E_EXTRACT", error.message, error)
    }
  }

  @ReactMethod
  fun openMakerWorldDownloader(
    designId: String,
    instanceId: String?,
    startUrl: String?,
    promise: Promise,
  ) {
    val activity = getCurrentActivity()
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No Android Activity is attached.")
      return
    }
    if (makerWorldDownloaderPromise != null) {
      promise.reject("E_BUSY", "MakerWorld downloader is already open.")
      return
    }

    makerWorldDownloaderPromise = promise
    val intent = Intent(activity, MakerWorldDownloaderActivity::class.java).apply {
      putExtra(MakerWorldDownloaderActivity.EXTRA_DESIGN_ID, designId)
      if (!instanceId.isNullOrBlank()) {
        putExtra(MakerWorldDownloaderActivity.EXTRA_INSTANCE_ID, instanceId)
      }
      if (!startUrl.isNullOrBlank()) {
        putExtra(MakerWorldDownloaderActivity.EXTRA_START_URL, startUrl)
      }
    }

    try {
      activity.startActivityForResult(intent, REQUEST_MAKERWORLD_DOWNLOADER)
    } catch (error: Throwable) {
      makerWorldDownloaderPromise = null
      promise.reject("E_OPEN_DOWNLOADER", error.message, error)
    }
  }

  @ReactMethod
  fun openModelPreview(
    path: String,
    title: String?,
    slotColors: ReadableArray?,
    accentColor: String?,
    moonrakerUrl: String?,
    initialTool: Int,
    loadedToolMask: Int,
    autoArrange: Boolean,
    promise: Promise,
  ) {
    val activity = getCurrentActivity()
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No Android Activity is attached.")
      return
    }

    val file = File(path.removePrefix("file://"))
    if (!file.exists()) {
      promise.reject("E_NO_FILE", "Model file not found: ${file.absolutePath}")
      return
    }

    try {
      val intent = Intent(activity, HelixModelPreviewActivity::class.java).apply {
        putExtra(HelixModelPreviewActivity.EXTRA_FILE_PATH, file.absolutePath)
        if (!accentColor.isNullOrBlank()) {
          putExtra(HelixModelPreviewActivity.EXTRA_ACCENT, accentColor)
        }
        if (!moonrakerUrl.isNullOrBlank()) {
          putExtra(HelixModelPreviewActivity.EXTRA_MOONRAKER, moonrakerUrl)
        }
        putExtra(HelixModelPreviewActivity.EXTRA_INITIAL_TOOL, initialTool.coerceIn(0, 3))
        putExtra(HelixModelPreviewActivity.EXTRA_LOADED_TOOL_MASK, loadedToolMask)
        putExtra(HelixModelPreviewActivity.EXTRA_AUTO_ARRANGE, autoArrange)
        putExtra(HelixModelPreviewActivity.EXTRA_TITLE, title ?: file.name)
        // User-declared filament colours (Slice Lab "Your filaments" row).
        if (slotColors != null && slotColors.size() > 0) {
          val list = ArrayList<String>(slotColors.size())
          for (i in 0 until slotColors.size()) {
            list.add(slotColors.getString(i) ?: "")
          }
          putStringArrayListExtra(HelixModelPreviewActivity.EXTRA_SLOT_COLORS, list)
        } else {
          putStringArrayListExtra(
            HelixModelPreviewActivity.EXTRA_SLOT_COLORS,
            ArrayList(FilamentSlotColors.read(reactApplicationContext)),
          )
        }
      }
      activity.startActivity(intent)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("E_OPEN_PREVIEW", error.message, error)
    }
  }

  /**
   * Extracts the largest embedded PNG thumbnail from a sliced .gcode and returns
   * it as a data: URI (the same render baked in at slice time). Lets the Slice
   * card show a preview immediately, without waiting for a Moonraker upload.
   */
  @ReactMethod
  fun getGcodeThumbnail(path: String, promise: Promise) {
    try {
      val file = File(path.removePrefix("file://"))
      if (!file.exists()) {
        promise.resolve(null)
        return
      }
      var bestArea = 0
      var best: String? = null
      var curArea = 0
      var cur: StringBuilder? = null
      file.bufferedReader().use { reader ->
        var line: String?
        while (reader.readLine().also { line = it } != null) {
          val t = (line ?: "").trim()
          when {
            t.startsWith("; thumbnail begin") -> {
              val dims = t.removePrefix("; thumbnail begin").trim().split(" ").firstOrNull()?.split("x")
              val w = dims?.getOrNull(0)?.toIntOrNull() ?: 0
              val h = dims?.getOrNull(1)?.toIntOrNull() ?: 0
              curArea = w * h
              cur = StringBuilder()
            }
            t.startsWith("; thumbnail end") -> {
              val c = cur
              if (c != null && curArea > bestArea) {
                bestArea = curArea
                best = c.toString()
              }
              cur = null
            }
            cur != null && t.startsWith(";") -> cur!!.append(t.removePrefix(";").trim())
            // Thumbnails live in the header; stop once real motion starts.
            best != null && (t.startsWith("G1") || t.startsWith("G0")) -> return@use
          }
        }
      }
      promise.resolve(best?.let { "data:image/png;base64,$it" })
    } catch (error: Throwable) {
      promise.reject("E_THUMB", error.message, error)
    }
  }

  /**
   * Per-filament weights (grams) from a sliced .gcode. OrcaSlicer writes
   * `; filament used [g] = a, b, c` in the config block (footer), so we tail-read
   * first, then fall back to a header scan. Index order = the slicer's filament
   * indices. Empty when not present.
   */
  @ReactMethod
  fun getGcodeFilamentGrams(path: String, promise: Promise) {
    try {
      val file = File(path.removePrefix("file://"))
      val arr = Arguments.createArray()
      if (!file.exists()) {
        promise.resolve(arr)
        return
      }
      parseFilamentGrams(file).forEach { arr.pushDouble(it) }
      promise.resolve(arr)
    } catch (error: Throwable) {
      promise.reject("E_GRAMS", error.message, error)
    }
  }

  private val filamentGramsRegex =
    Regex("""filament used \[g\]\s*=\s*(.+)""", RegexOption.IGNORE_CASE)

  private fun matchGrams(line: String): List<Double>? {
    if (!line.startsWith(";")) return null
    val m = filamentGramsRegex.find(line) ?: return null
    val nums = m.groupValues[1].split(",").mapNotNull { it.trim().toDoubleOrNull() }
    return nums.ifEmpty { null }
  }

  private fun parseFilamentGrams(file: File): List<Double> {
    // 1) Footer (Orca's summary block lives at the end of the file).
    tailText(file, 256 * 1024)?.lineSequence()?.forEach { line ->
      matchGrams(line.trim())?.let { return it }
    }
    // 2) Header fallback.
    file.bufferedReader().use { reader ->
      var line: String?
      var scanned = 0
      while (reader.readLine().also { line = it } != null && scanned < 20000) {
        scanned++
        matchGrams((line ?: "").trim())?.let { return it }
      }
    }
    return emptyList()
  }

  private fun tailText(file: File, maxBytes: Int): String? = try {
    RandomAccessFile(file, "r").use { raf ->
      val len = raf.length()
      val from = maxOf(0L, len - maxBytes)
      raf.seek(from)
      val bytes = ByteArray((len - from).toInt())
      raf.readFully(bytes)
      String(bytes, Charsets.UTF_8)
    }
  } catch (_: Throwable) {
    null
  }

  @ReactMethod
  fun getLastSliceResult(promise: Promise) {
    val model = LastSliceStore.modelPath
    val gcode = LastSliceStore.gcodePath
    if (model.isNullOrBlank() || gcode.isNullOrBlank()) {
      promise.resolve(null)
      return
    }
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("success", true)
        putString("modelPath", model)
        putString("gcodePath", gcode)
        putInt("totalLayers", LastSliceStore.totalLayers)
        putDouble("estimatedTimeSeconds", LastSliceStore.estimatedTimeSeconds.toDouble())
        putDouble("estimatedFilamentGrams", LastSliceStore.estimatedFilamentGrams.toDouble())
        putInt("initialTool", LastSliceStore.initialTool)
        putInt("usedToolMask", LastSliceStore.usedToolMask)
      },
    )
  }

  @ReactMethod
  fun clearLastSlice(promise: Promise) {
    LastSliceStore.clear()
    promise.resolve(true)
  }

  /** Mirrors the RN printer list into native prefs for the print dialog's picker. */
  @ReactMethod
  fun setPrinters(printers: ReadableArray, promise: Promise) {
    try {
      val list = (0 until printers.size()).mapNotNull { i ->
        val map = printers.getMap(i) ?: return@mapNotNull null
        val url = map.getString("url")?.trim().orEmpty()
        if (url.isEmpty()) return@mapNotNull null
        HelixPrinterStore.Printer(map.getString("name")?.trim().orEmpty().ifEmpty { "Printer" }, url)
      }
      HelixPrinterStore.write(reactApplicationContext, list)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("E_PRINTERS", error.message, error)
    }
  }

  @ReactMethod
  fun setFilamentSlotColors(colors: ReadableArray, promise: Promise) {
    try {
      val list = (0 until colors.size()).mapNotNull { i ->
        FilamentSlotColors.normalizeHex(colors.getString(i))
      }
      if (list.isNotEmpty()) {
        FilamentSlotColors.write(reactApplicationContext, list)
      }
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("E_FILAMENT_COLORS", error.message, error)
    }
  }

  /**
   * Opens the native 3D G-code toolpath preview (layer slider, travel toggle,
   * feature-type colors) for a sliced .gcode file.
   */
  @ReactMethod
  fun openGcodePreview(
    path: String,
    title: String?,
    accentColor: String?,
    moonrakerUrl: String?,
    initialTool: Int,
    loadedToolMask: Int,
    usedToolMask: Int,
    promise: Promise,
  ) {
    val activity = getCurrentActivity()
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No Android Activity is attached.")
      return
    }

    val file = File(path.removePrefix("file://"))
    if (!file.exists()) {
      promise.reject("E_NO_FILE", "G-code file not found: ${file.absolutePath}")
      return
    }

    try {
      val intent = Intent(activity, HelixGcodePreviewActivity::class.java).apply {
        putExtra(HelixGcodePreviewActivity.EXTRA_FILE_PATH, file.absolutePath)
        putExtra(HelixGcodePreviewActivity.EXTRA_TITLE, title ?: file.name)
        if (!accentColor.isNullOrBlank()) putExtra(HelixGcodePreviewActivity.EXTRA_ACCENT, accentColor)
        if (!moonrakerUrl.isNullOrBlank()) putExtra(HelixGcodePreviewActivity.EXTRA_MOONRAKER, moonrakerUrl)
        putExtra(HelixGcodePreviewActivity.EXTRA_INITIAL_TOOL, initialTool.coerceIn(0, 3))
        putExtra(HelixGcodePreviewActivity.EXTRA_LOADED_TOOL_MASK, loadedToolMask)
        putExtra(HelixGcodePreviewActivity.EXTRA_USED_TOOL_MASK, usedToolMask)
        LastSliceStore.modelPath?.let { putExtra(HelixGcodePreviewActivity.EXTRA_MODEL_PATH, it) }
      }
      activity.startActivity(intent)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("E_OPEN_PREVIEW", error.message, error)
    }
  }

  /**
   * Slices an STL/3MF at an absolute path with the native engine.
   * Emits "HelixSliceProgress" events { percentage, stage } while running.
   * Resolves { success, cancelled, gcodePath, totalLayers, estimatedTimeSeconds,
   * estimatedFilamentGrams, errorMessage }.
   *
   * options (all optional): layerHeight, fillDensity (0..1), nozzleTemp, bedTemp,
   * supportEnabled, supportType, supportAngle, supportFilament,
   * supportInterfaceFilament, supportBuildPlateOnly, supportPattern,
   * brimWidth, skirtLoops.
   */
  @ReactMethod
  fun sliceFile(path: String, options: ReadableMap?, promise: Promise) {
    if (!NativeLibrary.isLoaded) {
      promise.reject("E_NO_LIB", "Native slicer library not loaded: ${NativeLibrary.loadError}")
      return
    }
    if (!File(path).exists()) {
      promise.reject("E_NO_FILE", "Model file not found: $path")
      return
    }

    Thread {
      try {
        val lib = native ?: NativeLibrary().also { native = it }
        val initialTool = options
          ?.takeIf { it.hasKey("initialTool") }
          ?.getInt("initialTool")
          ?.coerceIn(0, 3)
          ?: 0
        val o = options
        val sliceSettings = HelixSliceSettings.fromBridgeOptions(
          supportEnabled = o?.takeIf { it.hasKey("supportEnabled") }?.getBoolean("supportEnabled"),
          supportType = o?.takeIf { it.hasKey("supportType") }?.getString("supportType"),
          supportAngle = o?.takeIf { it.hasKey("supportAngle") }?.getDouble("supportAngle"),
          supportFilament = o?.takeIf { it.hasKey("supportFilament") }?.getInt("supportFilament"),
          supportInterfaceFilament = o?.takeIf { it.hasKey("supportInterfaceFilament") }
            ?.getInt("supportInterfaceFilament"),
          supportBuildPlateOnly = o?.takeIf { it.hasKey("supportBuildPlateOnly") }
            ?.getBoolean("supportBuildPlateOnly"),
          supportPattern = o?.takeIf { it.hasKey("supportPattern") }?.getString("supportPattern"),
          brimWidth = o?.takeIf { it.hasKey("brimWidth") }?.getDouble("brimWidth"),
        )
        val outcome = HelixSliceRunner.run(
          reactApplicationContext,
          lib,
          path,
          onProgress = { pct, stage -> emitProgress(pct, stage) },
          initialTool = initialTool,
          sliceSettings = sliceSettings,
        ) {
          o?.let { opts ->
            if (opts.hasKey("layerHeight")) layerHeight = opts.getDouble("layerHeight").toFloat()
            if (opts.hasKey("fillDensity")) fillDensity = opts.getDouble("fillDensity").toFloat()
            if (opts.hasKey("nozzleTemp")) nozzleTemp = opts.getInt("nozzleTemp")
            if (opts.hasKey("bedTemp")) bedTemp = opts.getInt("bedTemp")
            if (opts.hasKey("skirtLoops")) skirtLoops = opts.getInt("skirtLoops")
          }
        }

        val result = outcome.result
        val map = Arguments.createMap().apply {
          if (result == null) {
            putBoolean("success", false)
            putString("errorMessage", "Engine returned no result")
          } else {
            putBoolean("success", result.success)
            putBoolean("cancelled", result.cancelled)
            putString("errorMessage", result.errorMessage)
            putString("gcodePath", result.gcodePath)
            putBoolean("thumbnailsInjected", outcome.thumbnailsInjected)
            putInt("totalLayers", result.totalLayers)
            putDouble("estimatedTimeSeconds", result.estimatedTimeSeconds.toDouble())
            putDouble("estimatedFilamentGrams", result.estimatedFilamentGrams.toDouble())
            putInt("initialTool", outcome.initialTool)
            putInt("usedToolMask", outcome.usedToolMask)
          }
        }
        promise.resolve(map)
      } catch (error: HelixSliceRunner.BusyError) {
        promise.reject("E_BUSY", error.message, error)
      } catch (error: HelixSliceRunner.LoadError) {
        promise.reject("E_LOAD", error.message, error)
      } catch (error: Throwable) {
        promise.reject("E_SLICE", "${error::class.java.simpleName}: ${error.message}", error)
      }
    }.start()
  }

  // ---- MakerWorld authenticated download (native OkHttp, matches reference app) ----

  /**
   * Downloads a MakerWorld model's 3MF using the stored session cookie, exactly
   * like the reference app: visit page → resolve design→instance → hit the
   * instance f3mf endpoint → follow the signed URL. Native OkHttp is used (not
   * RN fetch) because RN's Android networking mangles a manually-set Cookie
   * header. Resolves { designId, instanceId, fileName, filePath, sizeBytes }.
   */
  @ReactMethod
  fun downloadMakerWorld(shareUrl: String, promise: Promise) {
    val designId = MW_DESIGN_ID.find(shareUrl.trim())?.groupValues?.get(1)
    if (designId == null) {
      promise.reject("E_MW_URL", "That does not look like a MakerWorld model link.")
      return
    }

    Thread {
      try {
        val cookies = (securePrefs().getString(KEY_MW_COOKIE, "") ?: "")
          .replace("\r", "").replace("\n", "").trim()

        // MakerWorld's /api/v1 download endpoint authorizes with the real API JWT
        // captured from the web app's localStorage at login (the `token` cookie is
        // only a session id and yields "no access rights"). Fall back to the cookie
        // token if no localStorage JWT was captured.
        val storedBearer = (securePrefs().getString(KEY_MW_BEARER, "") ?: "").trim()
        val cookieToken = Regex("(?:^|;\\s*)token=([^;]+)").find(cookies)?.groupValues?.get(1)?.trim()
        val bearer = if (storedBearer.isNotBlank()) storedBearer else cookieToken
        val bearerSource = if (storedBearer.isNotBlank()) "localStorage" else if (!cookieToken.isNullOrBlank()) "cookie" else "none"

        val client = OkHttpClient.Builder()
          .connectTimeout(30, TimeUnit.SECONDS)
          .readTimeout(120, TimeUnit.SECONDS)
          .followRedirects(true)
          .build()

        val pageUrl = "https://makerworld.com/en/models/$designId"

        fun Request.Builder.browser(isApi: Boolean): Request.Builder {
          header("User-Agent", MW_UA)
          header("Accept-Language", "en-US,en;q=0.9")
          header("DNT", "1")
          header("Sec-Ch-Ua", "\"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"")
          header("Sec-Ch-Ua-Mobile", "?1")
          header("Sec-Ch-Ua-Platform", "\"Android\"")
          if (isApi) {
            header("Accept", "application/json, text/plain, */*")
            header("Origin", "https://makerworld.com")
            header("Sec-Fetch-Dest", "empty")
            header("Sec-Fetch-Mode", "cors")
            header("Sec-Fetch-Site", "same-origin")
            header("X-BBL-Client-Type", "web")
            header("X-BBL-Client-Name", "MakerWorld")
            if (!bearer.isNullOrBlank()) header("Authorization", "Bearer $bearer")
          } else {
            header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
            header("Sec-Fetch-Dest", "document")
            header("Sec-Fetch-Mode", "navigate")
            header("Sec-Fetch-Site", "none")
            header("Sec-Fetch-User", "?1")
            header("Upgrade-Insecure-Requests", "1")
          }
          if (cookies.isNotBlank()) header("Cookie", cookies)
          return this
        }

        // Step 0: visit the model page (establishes session, avoids bot detection)
        emitProgress(0, "opening page")
        try {
          client.newCall(Request.Builder().url(pageUrl).browser(false).get().build())
            .execute().use { /* consume + close */ }
        } catch (_: Throwable) { /* best effort */ }
        Thread.sleep((500..1400).random().toLong())

        // Step 1: design id → instance id
        emitProgress(0, "resolving model")
        val designApi = "https://makerworld.com/api/v1/design-service/design/$designId"
        var instanceId = designId
        var designCode = -1
        client.newCall(Request.Builder().url(designApi).browser(true).header("Referer", pageUrl).get().build())
          .execute().use { resp ->
            designCode = resp.code
            if (resp.isSuccessful) {
              val id = JSONObject(resp.body?.string() ?: "{}").optLong("defaultInstanceId", 0L)
              if (id > 0) instanceId = id.toString()
            }
          }

        // Step 2: instance f3mf endpoint
        emitProgress(0, "requesting 3mf")
        val downloadApi = "https://makerworld.com/api/v1/design-service/instance/$instanceId/f3mf?type=download"
        val outFile = File(reactApplicationContext.filesDir, "makerworld_$designId.3mf")

        client.newCall(Request.Builder().url(downloadApi).browser(true).header("Referer", pageUrl).get().build())
          .execute().use { resp ->
            if (!resp.isSuccessful) {
              val body = try { resp.body?.string()?.take(300) } catch (_: Throwable) { null }
              val base = classifyDownloadError(resp.code, body)
              val diag = "[design=$designId→instance=$instanceId designApi=$designCode bearer=$bearerSource]"
              // Surface MakerWorld's raw reason + resolution diagnostics.
              throw MwError("$base\n\n$diag" + if (body.isNullOrBlank()) "" else "\n[MW ${resp.code}]: $body")
            }
            val contentType = resp.header("Content-Type") ?: ""
            if (contentType.contains("json", ignoreCase = true)) {
              // API returns JSON with a signed file URL — follow it
              val json = JSONObject(resp.body?.string() ?: "{}")
              if (json.has("error") && !json.has("url")) {
                throw MwError(json.optString("error", "MakerWorld returned an error."))
              }
              val fileUrl = json.optString("url", "")
              if (fileUrl.isBlank()) throw MwError("No download URL in MakerWorld response.")
              emitProgress(0, "downloading")
              client.newCall(Request.Builder().url(fileUrl).header("User-Agent", MW_UA).get().build())
                .execute().use { fileResp ->
                  if (!fileResp.isSuccessful) throw MwError("File download failed: HTTP ${fileResp.code}")
                  fileResp.body?.byteStream()?.use { input -> outFile.outputStream().use { input.copyTo(it) } }
                }
            } else {
              // Direct binary
              emitProgress(0, "downloading")
              resp.body?.byteStream()?.use { input -> outFile.outputStream().use { input.copyTo(it) } }
            }
          }

        if (!outFile.exists() || outFile.length() == 0L) {
          throw MwError("Downloaded file is empty.")
        }

        promise.resolve(Arguments.createMap().apply {
          putString("designId", designId)
          putString("instanceId", instanceId)
          putString("fileName", outFile.name)
          putString("filePath", outFile.absolutePath)
          putDouble("sizeBytes", outFile.length().toDouble())
        })
      } catch (error: MwError) {
        promise.reject("E_MW_DOWNLOAD", error.message, error)
      } catch (error: Throwable) {
        promise.reject("E_MW_DOWNLOAD", "${error::class.java.simpleName}: ${error.message}", error)
      }
    }.start()
  }

  private class MwError(msg: String) : Exception(msg)

  private fun classifyDownloadError(code: Int, body: String?): String = when {
    body?.contains("captcha", ignoreCase = true) == true ->
      "MakerWorld wants CAPTCHA verification. Open the model in MakerWorld first, then share it again."
    body?.contains("log in", ignoreCase = true) == true || body?.contains("unlogged", ignoreCase = true) == true ->
      "MakerWorld requires login. Log in via the MakerWorld Account card, then share the model again."
    code == 403 -> "MakerWorld blocked the download (403). Your login session may be expired — re-login and retry."
    code == 429 -> "MakerWorld rate limit. Wait a minute and try again."
    else -> "Download failed: HTTP $code"
  }

  // ---- MakerWorld session cookie (encrypted at rest) ----

  /**
   * Reads the live MakerWorld cookies from the app's WebView CookieManager (set
   * after the user logs in via the in-app login WebView). If they contain a real
   * auth token, persists them encrypted and returns them. Otherwise falls back to
   * the last stored (decrypted) cookies. Empty string if none.
   */
  @ReactMethod
  fun captureMakerWorldCookies(promise: Promise) {
    try {
      val live = (CookieManager.getInstance().getCookie("https://makerworld.com") ?: "")
        .replace("\r", "").replace("\n", "").trim()
      if (hasAuthCookies(live)) {
        securePrefs().edit().putString(KEY_MW_COOKIE, live).apply()
        promise.resolve(mwResult(live, true))
        return
      }
      val stored = securePrefs().getString(KEY_MW_COOKIE, "") ?: ""
      promise.resolve(mwResult(stored, hasAuthCookies(stored)))
    } catch (error: Throwable) {
      promise.reject("E_COOKIE", error.message, error)
    }
  }

  /** Returns the stored (decrypted) cookie string for attaching to downloads. */
  @ReactMethod
  fun getMakerWorldCookies(promise: Promise) {
    try {
      val stored = securePrefs().getString(KEY_MW_COOKIE, "") ?: ""
      promise.resolve(mwResult(stored, hasAuthCookies(stored)))
    } catch (error: Throwable) {
      promise.reject("E_COOKIE", error.message, error)
    }
  }

  /**
   * Diagnostic view of what we actually have — cookie NAMES only (no values, so
   * no token leaks), plus the live vs stored auth-token presence. Lets us see if
   * a real `token`/`sessionid` cookie was captured or just Cloudflare junk.
   */
  @ReactMethod
  fun getMakerWorldCookieDebug(promise: Promise) {
    try {
      val stored = (securePrefs().getString(KEY_MW_COOKIE, "") ?: "").trim()
      val live = (CookieManager.getInstance().getCookie("https://makerworld.com") ?: "").trim()
      fun names(c: String) = c.split(";").mapNotNull { it.substringBefore("=").trim().ifBlank { null } }
      val bearer = (securePrefs().getString(KEY_MW_BEARER, "") ?: "").trim()
      promise.resolve(Arguments.createMap().apply {
        putInt("storedLength", stored.length)
        putInt("liveLength", live.length)
        putBoolean("storedHasToken", stored.contains("token="))
        putBoolean("liveHasToken", live.contains("token="))
        putString("storedNames", names(stored).joinToString(", "))
        putString("liveNames", names(live).joinToString(", "))
        putInt("bearerLength", bearer.length)
        putBoolean("hasBearer", bearer.length > 20)
      })
    } catch (error: Throwable) {
      promise.reject("E_COOKIE", error.message, error)
    }
  }

  /** Stores the MakerWorld API JWT (from the web app's localStorage), encrypted. */
  @ReactMethod
  fun saveMakerWorldBearer(jwt: String, promise: Promise) {
    try {
      if (jwt.isNotBlank()) securePrefs().edit().putString(KEY_MW_BEARER, jwt.trim()).apply()
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("E_BEARER", error.message, error)
    }
  }

  /** Clears both the encrypted store and the WebView cookie jar for makerworld.com. */
  @ReactMethod
  fun clearMakerWorldCookies(promise: Promise) {
    try {
      securePrefs().edit().remove(KEY_MW_COOKIE).apply()
      val cm = CookieManager.getInstance()
      cm.setCookie("https://makerworld.com", "token=; Max-Age=0")
      cm.flush()
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("E_COOKIE", error.message, error)
    }
  }

  private fun mwResult(cookies: String, authed: Boolean) = Arguments.createMap().apply {
    putString("cookies", cookies)
    putBoolean("hasAuth", authed)
    putInt("length", cookies.length)
  }

  private fun securePrefs() = EncryptedSharedPreferences.create(
    reactApplicationContext,
    "helix_makerworld_secure",
    MasterKey.Builder(reactApplicationContext)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
  )

  @ReactMethod
  fun cancelSlice(promise: Promise) {
    try {
      if (NativeLibrary.isLoaded) native?.cancelSlice()
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("E_CANCEL", error.message, error)
    }
  }

  @ReactMethod
  fun uploadGcode(baseUrl: String, filename: String, path: String, promise: Promise) {
    val file = File(path.removePrefix("file://"))
    if (baseUrl.isBlank()) {
      promise.reject("E_UPLOAD_URL", "Printer URL is blank.")
      return
    }
    if (!file.exists() || !file.isFile) {
      promise.reject("E_UPLOAD_FILE", "G-code file not found: ${file.absolutePath}")
      return
    }
    if (file.length() <= 0L) {
      promise.reject("E_UPLOAD_FILE", "G-code file is empty: ${file.absolutePath}")
      return
    }

    Thread {
      try {
        val uploadName = buildGcodeUploadName(filename.ifBlank { file.name })
        val base = normalizeHttpBase(baseUrl)
        val sizeMb = file.length() / (1024L * 1024L)
        val timeout = maxOf(30L, minOf(300L, sizeMb + 30L))
        val client = OkHttpClient.Builder()
          .connectTimeout(20, TimeUnit.SECONDS)
          .writeTimeout(timeout, TimeUnit.SECONDS)
          .readTimeout(timeout, TimeUnit.SECONDS)
          .build()
        val body = MultipartBody.Builder()
          .setType(MultipartBody.FORM)
          .addFormDataPart(
            "file",
            uploadName,
            file.asRequestBody("application/octet-stream".toMediaType()),
          )
          .build()
        val request = Request.Builder()
          .url("$base/server/files/upload")
          .post(body)
          .build()

        client.newCall(request).execute().use { response ->
          val text = response.body?.string().orEmpty()
          if (!response.isSuccessful) {
            throw UploadError(
              "HTTP ${response.code}" + if (text.isBlank()) "" else ": ${text.take(300)}",
            )
          }
          promise.resolve(Arguments.createMap().apply {
            putString("filename", uploadName)
            putString("path", file.absolutePath)
            putDouble("sizeBytes", file.length().toDouble())
            putInt("status", response.code)
            putString("body", text.take(500))
          })
        }
      } catch (error: UploadError) {
        promise.reject("E_UPLOAD", error.message, error)
      } catch (error: Throwable) {
        promise.reject("E_UPLOAD", "${error::class.java.simpleName}: ${error.message}", error)
      }
    }.start()
  }

  private class UploadError(msg: String) : Exception(msg)

  private fun normalizeHttpBase(input: String): String {
    var value = input.trim()
    if (!value.startsWith("http://", ignoreCase = true) && !value.startsWith("https://", ignoreCase = true)) {
      value = "http://$value"
    }
    return value.trimEnd('/')
  }

  private fun buildGcodeUploadName(raw: String): String {
    val cleaned = raw
      .substringAfterLast('/')
      .substringAfterLast('\\')
      .replace(Regex("""[/\\:*?"<>|]"""), "_")
      .trim()
      .ifBlank { "helix-slice.gcode" }
    return if (cleaned.endsWith(".gcode", ignoreCase = true)) cleaned else "$cleaned.gcode"
  }

  private fun emitProgress(percentage: Int, stage: String) {
    val params = Arguments.createMap()
    params.putInt("percentage", percentage)
    params.putString("stage", stage)
    try {
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("HelixSliceProgress", params)
    } catch (ignored: Throwable) {
      // JS context torn down mid-slice; nothing to notify.
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == REQUEST_PICK_MODEL) {
      val promise = pickModelPromise ?: return
      pickModelPromise = null
      if (resultCode != Activity.RESULT_OK || data?.data == null) {
        promise.reject("E_CANCELLED", "File picker was cancelled.")
        return
      }
      val imported = importModelUri(reactApplicationContext.contentResolver, data.data!!)
      if (imported == null) {
        promise.reject("E_BAD_FILE", "Choose a .3mf or .stl file.")
        return
      }
      promise.resolve(imported)
      return
    }

    if (requestCode != REQUEST_MAKERWORLD_DOWNLOADER) return

    val promise = makerWorldDownloaderPromise ?: return
    makerWorldDownloaderPromise = null

    if (resultCode != Activity.RESULT_OK || data == null) {
      promise.reject("E_CANCELLED", "MakerWorld downloader was closed before a file was downloaded.")
      return
    }

    val path = data.getStringExtra(MakerWorldDownloaderActivity.EXTRA_FILE_PATH)
    if (path.isNullOrBlank()) {
      promise.reject("E_NO_FILE", "MakerWorld downloader returned no file path.")
      return
    }

    val file = File(path)
    promise.resolve(Arguments.createMap().apply {
      putString("designId", data.getStringExtra(MakerWorldDownloaderActivity.EXTRA_DESIGN_ID))
      putString("instanceId", data.getStringExtra(MakerWorldDownloaderActivity.EXTRA_INSTANCE_ID))
      putString(
        "fileName",
        data.getStringExtra(MakerWorldDownloaderActivity.EXTRA_FILE_NAME) ?: file.name,
      )
      putString("filePath", path)
      putDouble(
        "sizeBytes",
        data.getLongExtra(MakerWorldDownloaderActivity.EXTRA_SIZE_BYTES, file.length()).toDouble(),
      )
      putString("sourceUrl", data.getStringExtra(MakerWorldDownloaderActivity.EXTRA_SOURCE_URL))
    })
  }

  override fun onNewIntent(intent: Intent) {
    // MainActivity handles shared-link intents; this listener only waits for downloader results.
  }

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(this)
    makerWorldDownloaderPromise = null
    pickModelPromise = null
    super.invalidate()
  }

  companion object {
    const val NAME = "HelixSlicer"
    private const val EXTRA_MODEL_CONSUMED = "helix_model_consumed"
    private const val REQUEST_MAKERWORLD_DOWNLOADER = 7121
    private const val REQUEST_PICK_MODEL = 7122
    private const val KEY_MW_COOKIE = "makerworld_cookies"
    private const val KEY_MW_BEARER = "makerworld_bearer"
    private const val MW_UA =
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
    private val MW_DESIGN_ID =
      Regex("""(?:https?://)?(?:www\.)?makerworld\.com/(?:\w+/)?models/(\d+)""")

    private val makerWorldUrlPattern =
      Regex("https?://(?:www\\.)?makerworld\\.com/[^\\s]+", RegexOption.IGNORE_CASE)

    fun extractMakerWorldLink(text: String): String? =
      makerWorldUrlPattern.find(text)?.value?.trimEnd('.', ',', ')', ']')

    /**
     * True when the cookie string carries a real MakerWorld auth token, not just
     * Cloudflare bot-management cookies. Two-stage login only sets auth after the
     * user clicks Continue. (Same heuristic as the reference app.)
     */
    fun hasAuthCookies(cookies: String): Boolean =
      cookies.contains("token=") || cookies.contains("sessionid") || cookies.length > 500
  }
}
