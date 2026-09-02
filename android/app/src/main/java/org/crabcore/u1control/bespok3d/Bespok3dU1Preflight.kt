package org.crabcore.u1control.bespok3d

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.JSch
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Base64

data class Bespok3dU1PreflightResult(
  val firmware: String,
  val model: String,
  val overlayActive: Boolean,
  val workspacePresent: Boolean,
  val daemonRunning: Boolean,
  val printState: String,
  val eligible: Boolean,
  val reason: String?,
  val sshHostKeySha256: String,
)

data class Bespok3dU1SystemState(
  val firmware: String,
  val model: String,
  val overlayActive: Boolean,
  val workspacePresent: Boolean,
  val daemonRunning: Boolean,
)

/** Pure parsing and eligibility rules for the stock Snapmaker U1 preflight. */
object Bespok3dU1PreflightProtocol {
  fun parseSystemState(output: String): Bespok3dU1SystemState {
    val values = output.lineSequence()
      .mapNotNull { line ->
        val separator = line.indexOf('=')
        if (separator <= 0) null else line.substring(0, separator) to line.substring(separator + 1).trim()
      }
      .toMap()
    val firmware = values.required("firmware")
    require(firmware == "stock" || firmware == "extended") { "Unknown U1 firmware state" }
    val model = values.required("model")
    return Bespok3dU1SystemState(
      firmware = firmware,
      model = model,
      overlayActive = values.requiredFlag("overlay"),
      workspacePresent = values.requiredFlag("workspace"),
      daemonRunning = values.requiredFlag("daemon"),
    )
  }

  fun parsePrintState(body: String): String =
    JSONObject(body)
      .optJSONObject("result")
      ?.optJSONObject("status")
      ?.optJSONObject("print_stats")
      ?.optString("state")
      ?.trim()
      ?.lowercase()
      ?.takeIf(String::isNotEmpty)
      ?: throw IllegalArgumentException("Moonraker returned no print state")

  fun result(
    system: Bespok3dU1SystemState,
    printState: String,
    sshHostKeySha256: String,
  ): Bespok3dU1PreflightResult {
    val reason = when {
      !system.model.contains("RK3562", ignoreCase = true) ->
        "The SSH host is not a supported Snapmaker U1"
      system.firmware == "extended" ->
        "Bespok3d enrollment requires stock Snapmaker U1 firmware"
      printState == "printing" || printState == "paused" ->
        "The printer must be idle before Bespok3d enrollment"
      else -> null
    }
    return Bespok3dU1PreflightResult(
      firmware = system.firmware,
      model = system.model,
      overlayActive = system.overlayActive,
      workspacePresent = system.workspacePresent,
      daemonRunning = system.daemonRunning,
      printState = printState,
      eligible = reason == null,
      reason = reason,
      sshHostKeySha256 = sshHostKeySha256,
    )
  }

  private fun Map<String, String>.required(key: String): String =
    get(key)?.takeIf(String::isNotEmpty)
      ?: throw IllegalArgumentException("U1 preflight returned no $key")

  private fun Map<String, String>.requiredFlag(key: String): Boolean = when (required(key)) {
    "yes" -> true
    "no" -> false
    else -> throw IllegalArgumentException("U1 preflight returned an invalid $key value")
  }
}

/** Performs only read operations over SSH and Moonraker; it never changes the printer. */
class Bespok3dU1Preflight {
  fun run(host: String, password: String): Bespok3dU1PreflightResult {
    val cleanHost = validatedHost(host)
    require(password.isNotEmpty()) { "SSH password is required" }
    val passwordBytes = password.toByteArray(Charsets.UTF_8)
    val session = JSch().getSession(SSH_USER, cleanHost, SSH_PORT)
    try {
      session.setPassword(passwordBytes)
      session.setConfig("StrictHostKeyChecking", "no")
      session.setConfig("PreferredAuthentications", "password,keyboard-interactive")
      session.timeout = TIMEOUT_MS
      session.connect(TIMEOUT_MS)
      val hostKey = Base64.getDecoder().decode(session.hostKey.key)
      val fingerprint = "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(
        MessageDigest.getInstance("SHA-256").digest(hostKey),
      )
      val system = Bespok3dU1PreflightProtocol.parseSystemState(exec(session, PREFLIGHT_COMMAND))
      val printState = readPrintState(cleanHost)
      return Bespok3dU1PreflightProtocol.result(system, printState, fingerprint)
    } finally {
      passwordBytes.fill(0)
      session.disconnect()
    }
  }

  private fun exec(session: com.jcraft.jsch.Session, command: String): String {
    val errors = ByteArrayOutputStream()
    val channel = session.openChannel("exec") as ChannelExec
    try {
      channel.setCommand(command)
      channel.setInputStream(null)
      channel.setErrStream(errors)
      val output = channel.inputStream
      channel.connect(TIMEOUT_MS)
      val text = output.bufferedReader().use { it.readText() }
      if (channel.awaitExitStatus(TIMEOUT_MS) != 0) {
        val detail = errors.toString(Charsets.UTF_8.name()).trim()
        throw IllegalStateException(detail.ifEmpty { "U1 SSH preflight failed" })
      }
      return text
    } finally {
      channel.disconnect()
    }
  }

  private fun readPrintState(host: String): String {
    val urlHost = if (host.contains(':') && !host.startsWith('[')) "[$host]" else host
    val connection = URL("http://$urlHost:$MOONRAKER_PORT/printer/objects/query?print_stats")
      .openConnection() as HttpURLConnection
    connection.connectTimeout = TIMEOUT_MS
    connection.readTimeout = TIMEOUT_MS
    connection.requestMethod = "GET"
    connection.setRequestProperty("Accept", "application/json")
    try {
      val status = connection.responseCode
      if (status !in 200..299) throw IllegalStateException("Moonraker returned HTTP $status")
      return Bespok3dU1PreflightProtocol.parsePrintState(
        connection.inputStream.bufferedReader().use { it.readText() },
      )
    } finally {
      connection.disconnect()
    }
  }

  private fun validatedHost(raw: String): String {
    val host = raw.trim().removePrefix("[").removeSuffix("]")
    require(host.isNotEmpty() && host.length <= 253) { "U1 host is required" }
    require(!host.contains('/') && !host.contains("//") && host.none(Char::isWhitespace)) {
      "U1 host must not include a URL or path"
    }
    return host
  }

  private companion object {
    const val SSH_USER = "root"
    const val SSH_PORT = 22
    const val MOONRAKER_PORT = 7125
    const val TIMEOUT_MS = 8_000
    val PREFLIGHT_COMMAND = """
      printf 'firmware='; if [ -e /usr/local/bin/extended-config.py ]; then echo extended; else echo stock; fi
      printf 'model='; tr -d '\000' </proc/device-tree/model 2>/dev/null || uname -m; echo
      printf 'overlay='; if [ -e /oem/.debug ]; then echo yes; else echo no; fi
      printf 'workspace='; if [ -d /userdata/bespok3d ]; then echo yes; else echo no; fi
      printf 'daemon='; if [ -r /userdata/bespok3d/run/bespok3d-daemon.pid ] && kill -0 "${'$'}(cat /userdata/bespok3d/run/bespok3d-daemon.pid)" 2>/dev/null; then echo yes; else echo no; fi
    """.trimIndent()
  }
}
