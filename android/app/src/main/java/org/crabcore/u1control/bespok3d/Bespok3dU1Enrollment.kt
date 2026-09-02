package org.crabcore.u1control.bespok3d

import org.json.JSONArray
import org.json.JSONObject

data class Bespok3dU1EnrollmentCredentials(
  val identity: String,
  val token: String,
)

data class Bespok3dU1EnrollmentConfig(
  val host: String,
  val password: String,
  val sshHostKeySha256: String,
  val label: String,
  val credentials: Bespok3dU1EnrollmentCredentials,
)

data class Bespok3dU1EnrollmentResult(
  val certificatePem: String,
  val daemonVersion: String,
  val jinniVersion: String,
  val completedSteps: List<String>,
)

class Bespok3dEnrollmentException(
  val stepId: String,
  cause: Throwable,
) : IllegalStateException("Bespok3d enrollment failed during $stepId: ${cause.message}", cause)

/** Pure, byte-for-byte-compatible patchers from the official Snapmaker U1 adapter. */
object Bespok3dU1EnrollmentProtocol {
  fun patchS90lmd(content: String): String {
    if (content.contains("S99bespok3d")) return content
    val lines = content.split('\n').toMutableList()
    require(lines.firstOrNull()?.startsWith("#!") == true) {
      "Unexpected S90lmd format: file does not start with a shebang"
    }
    lines.add(1, "[ -x /etc/init.d/S99bespok3d ] && exec /etc/init.d/S99bespok3d \"\$@\"")
    return lines.joinToString("\n")
  }

  fun patchNginx(content: String): String {
    if (content.contains("bespok3d/etc/nginx/locations")) return content
    val stripped = content.trimEnd()
    require(stripped.endsWith('}')) { "Unexpected nginx config format: file does not end with \"}\"" }
    return stripped.dropLast(1) +
      "    include /userdata/bespok3d/etc/nginx/locations/*.conf;\n}\n"
  }

  fun mergeAcl(existingText: String?, identity: String, token: String, label: String): String {
    val existing = runCatching { existingText?.let(::JSONObject) }.getOrNull() ?: JSONObject()
    val keys = existing.stringList("keys")
    val tokens = existing.stringList("tokens")
    val role = if (keys.isEmpty()) "admin" else existing.optJSONObject("roles")
      ?.optString(identity)?.takeIf(String::isNotEmpty) ?: "user"
    if (!keys.contains(identity)) keys += identity
    if (!tokens.contains(token)) tokens += token
    return JSONObject().apply {
      put("keys", JSONArray(keys))
      put("roles", copyObject(existing.optJSONObject("roles")).apply { put(identity, role) })
      put("labels", copyObject(existing.optJSONObject("labels")).apply { put(identity, label) })
      put("tokens", JSONArray(tokens))
      put(
        "token_identity",
        copyObject(existing.optJSONObject("token_identity")).apply { put(token, identity) },
      )
    }.toString(2)
  }

  private fun JSONObject.stringList(key: String): MutableList<String> {
    val array = optJSONArray(key) ?: return mutableListOf()
    return buildList {
      for (index in 0 until array.length()) {
        array.optString(index).takeIf(String::isNotEmpty)?.let(::add)
      }
    }.toMutableList()
  }

  private fun copyObject(source: JSONObject?): JSONObject =
    if (source == null) JSONObject() else JSONObject(source.toString())
}

/**
 * Installs only signature-verified bundled bytes, following the official U1 adapter's ordered,
 * idempotent enrollment recipe. Re-running after a disconnect resumes safely from preflight.
 */
internal class Bespok3dU1Enrollment(
  private val preflight: (String, String) -> Bespok3dU1PreflightResult =
    { host, password -> Bespok3dU1Preflight().run(host, password) },
  private val sshFactory: Bespok3dSshFactory =
    Bespok3dSshFactory { host, password, fingerprint ->
      JschBespok3dSsh(host, password, fingerprint)
    },
  private val pause: (Long) -> Unit = Thread::sleep,
) {
  fun run(
    config: Bespok3dU1EnrollmentConfig,
    bootstrap: Bespok3dBootstrapSet,
  ): Bespok3dU1EnrollmentResult {
    validate(config)
    val checked = step("preflight") { preflight(config.host, config.password) }
    require(checked.sshHostKeySha256 == config.sshHostKeySha256) {
      "U1 SSH host key changed; run preflight again before enrollment"
    }
    require(checked.eligible) { checked.reason ?: "U1 is not eligible for Bespok3d enrollment" }

    val completed = mutableListOf("preflight")
    var certificatePem = ""
    sshFactory.open(config.host, config.password, config.sshHostKeySha256).use { ssh ->
      var overlayWasActive = false
      runStep(completed, "unlock-overlay") {
        overlayWasActive = ssh.exec("test -e /oem/.debug && echo yes || echo no").trim() == "yes"
        ssh.exec(
          "cp /oem/printer_data/gui/wpa_supplicant.conf /etc/wpa_supplicant.conf " +
            "2>/dev/null || true && touch /oem/.debug",
        )
      }
      runStep(completed, "fix-wifi-persistence") { ssh.exec(FIX_WIFI_COMMAND) }
      runStep(completed, "reboot-and-reconnect") {
        if (!overlayWasActive) {
          runCatching { ssh.exec("reboot") }
          reconnectAfterReboot(ssh)
        }
      }
      runStep(completed, "create-workspace") { ssh.exec(CREATE_WORKSPACE_COMMAND) }
      runStep(completed, "deploy-s99") {
        val script = bootstrap.daemon.files.requiredFile("S99bespok3d")
        ssh.write("/etc/init.d/S99bespok3d", script.bytes, 0b111101101)
      }
      runStep(completed, "patch-s90lmd") {
        patchRemote(ssh, "/etc/init.d/S90lmd", 0b111101101, Bespok3dU1EnrollmentProtocol::patchS90lmd)
      }
      runStep(completed, "stable-network") {
        ssh.exec("rm -rf /oem/dhcpcd")
        ssh.exec(STABLE_DHCP_COMMAND)
        ssh.exec(STABLE_MAC_COMMAND)
      }
      runStep(completed, "patch-nginx") {
        patchRemote(
          ssh,
          "/etc/nginx/sites-enabled/fluidd",
          0b110100100,
          Bespok3dU1EnrollmentProtocol::patchNginx,
        )
      }
      runStep(completed, "klipper-includes") {
        ssh.exec(CREATE_KLIPPER_DIRS_COMMAND)
        ssh.exec(includeCommand("/oem/printer_data/config/printer.cfg", "bespok3d/klipper", "[include bespok3d/klipper/*.cfg]"))
        ssh.exec(includeCommand("/oem/printer_data/config/moonraker.conf", "bespok3d/moonraker", "[include bespok3d/moonraker/*.cfg]"))
      }
      runStep(completed, "deploy-daemon") { deployDaemon(ssh, bootstrap) }
      runStep(completed, "generate-daemon-cert") {
        val exists = ssh.exec("test -f $CERT_PATH && echo yes || echo no").trim() == "yes"
        if (!exists) ssh.exec(GENERATE_CERT_COMMAND)
        certificatePem = ssh.read(CERT_PATH).toString(Charsets.UTF_8)
        require(certificatePem.contains("-----BEGIN CERTIFICATE-----")) {
          "Bespok3d daemon certificate is malformed"
        }
      }
      runStep(completed, "enroll-daemon-key") {
        ssh.exec("mkdir -p $AUTH_ROOT")
        val exists = ssh.exec("test -f $ACL_PATH && echo yes || echo no").trim() == "yes"
        val current = if (exists) ssh.read(ACL_PATH).toString(Charsets.UTF_8) else null
        val acl = Bespok3dU1EnrollmentProtocol.mergeAcl(
          current,
          config.credentials.identity,
          config.credentials.token,
          config.label,
        )
        ssh.write(ACL_PATH, acl.toByteArray(Charsets.UTF_8), 0b110000000)
      }
      runStep(completed, "start-daemon") {
        ssh.exec("[ -f $AUTOSTART_PATH ] && $AUTOSTART_PATH stop 2>/dev/null || true")
        ssh.exec("$AUTOSTART_PATH start")
        ssh.exec(VERIFY_DAEMON_COMMAND)
      }
      runStep(completed, "verify") { ssh.exec(VERIFY_INSTALL_COMMAND) }
    }
    return Bespok3dU1EnrollmentResult(
      certificatePem = certificatePem,
      daemonVersion = bootstrap.daemon.version,
      jinniVersion = bootstrap.jinni.version,
      completedSteps = completed,
    )
  }

  private fun deployDaemon(ssh: Bespok3dSsh, bootstrap: Bespok3dBootstrapSet) {
    val daemonFiles = bootstrap.daemon.files.filterNot { it.path in INIT_SCRIPTS }
    ssh.exec("rm -rf /userdata/bespok3d/var/lib/demon")
    replaceOwnedPayload(ssh, daemonFiles)
    replaceOwnedPayload(ssh, bootstrap.jinni.files)
    val autostart = bootstrap.daemon.files.requiredFile("s10bespok3d-daemon")
    ssh.write(AUTOSTART_PATH, autostart.bytes, 0b111101101)
    ssh.exec(CLEAN_SYSTEM_PYTHON_COMMAND)
    val venv = ssh.exec("test -x $BESPOK3D/venv/bin/python3 && echo yes || echo no").trim()
    if (venv != "yes") ssh.exec("python3 -m venv $BESPOK3D/venv")
    val wheels = daemonFiles.filter { it.path.startsWith("wheels/") }
    require(wheels.isNotEmpty()) { "Signed Bespok3d daemon package contains no wheels" }
    ssh.exec(
      "$BESPOK3D/venv/bin/pip install --no-index --no-deps " +
        wheels.joinToString(" ") { shellQuote("$DAEMON_ROOT/${it.path}") },
    )
  }

  private fun replaceOwnedPayload(ssh: Bespok3dSsh, files: List<Bespok3dBootstrapFile>) {
    require(files.isNotEmpty()) { "Signed Bespok3d package has no payload" }
    val owned = files.map { it.path.substringBefore('/') }.distinct()
    ssh.exec("rm -rf " + owned.joinToString(" ") { shellQuote("$DAEMON_ROOT/$it") })
    val directories = files.mapNotNull { file ->
      file.path.substringBeforeLast('/', "").takeIf(String::isNotEmpty)?.let { "$DAEMON_ROOT/$it" }
    }.distinct()
    ssh.exec("mkdir -p " + (listOf(DAEMON_ROOT) + directories).joinToString(" ", transform = ::shellQuote))
    files.forEach { file -> ssh.write("$DAEMON_ROOT/${file.path}", file.bytes, file.mode and 0b111111111) }
  }

  private fun patchRemote(
    ssh: Bespok3dSsh,
    path: String,
    mode: Int,
    patcher: (String) -> String,
  ) {
    val current = ssh.read(path).toString(Charsets.UTF_8)
    val patched = patcher(current)
    if (patched != current) ssh.write(path, patched.toByteArray(Charsets.UTF_8), mode)
  }

  private fun reconnectAfterReboot(ssh: Bespok3dSsh) {
    var lastError: Throwable? = null
    repeat(RECONNECT_ATTEMPTS) { attempt ->
      if (attempt > 0) pause(RECONNECT_DELAY_MS)
      try {
        ssh.reconnect()
        return
      } catch (error: Throwable) {
        lastError = error
      }
    }
    throw IllegalStateException("U1 did not reconnect after reboot", lastError)
  }

  private fun validate(config: Bespok3dU1EnrollmentConfig) {
    require(config.password.isNotEmpty()) { "SSH password is required" }
    require(config.label.isNotBlank() && config.label.length <= 64 && config.label.none(Char::isISOControl)) {
      "Enrollment label is invalid"
    }
    require(config.credentials.identity.matches(Regex("^helix-[a-f0-9-]{36}$"))) {
      "Enrollment identity is invalid"
    }
    require(config.credentials.token.matches(Regex("^[a-f0-9]{64}$"))) {
      "Enrollment token is invalid"
    }
  }

  private fun <T> step(id: String, operation: () -> T): T = try {
    operation()
  } catch (error: Throwable) {
    throw Bespok3dEnrollmentException(id, error)
  }

  private fun runStep(completed: MutableList<String>, id: String, operation: () -> Unit) {
    step(id, operation)
    completed += id
  }

  private fun includeCommand(path: String, pattern: String, line: String): String =
    """grep -q '$pattern' $path 2>/dev/null || python3 -c "
content = open('$path').read()
marker = '#*# <---------------------- SAVE_CONFIG'
at = content.find(marker)
head = (content if at < 0 else content[:at]).rstrip('\\n')
tail = '' if at < 0 else '\\n' + content[at:]
open('$path', 'w').write(head + '\\n\\n' + '$line' + '\\n' + tail)
"""".trimIndent()

  private fun shellQuote(value: String): String = "'${value.replace("'", "'\\''")}'"

  private fun List<Bespok3dBootstrapFile>.requiredFile(path: String): Bespok3dBootstrapFile =
    singleOrNull { it.path == path }
      ?: throw IllegalArgumentException("Signed Bespok3d package is missing $path")

  private companion object {
    const val BESPOK3D = "/userdata/bespok3d"
    const val DAEMON_ROOT = "$BESPOK3D/var/lib/daemon"
    const val AUTH_ROOT = "$BESPOK3D/auth"
    const val ACL_PATH = "$AUTH_ROOT/acl.json"
    const val CERT_PATH = "$BESPOK3D/etc/daemon/server.crt"
    const val AUTOSTART_PATH = "$BESPOK3D/etc/init.d/autostart/s10bespok3d-daemon"
    const val RECONNECT_ATTEMPTS = 100
    const val RECONNECT_DELAY_MS = 3_000L
    val INIT_SCRIPTS = setOf("s10bespok3d-daemon", "S99bespok3d")

    val FIX_WIFI_COMMAND = "mkdir -p /userdata/cfg" +
      " && { { grep -q 'network=' /tmp/wpa_supplicant.conf 2>/dev/null" +
      " && cp -p /tmp/wpa_supplicant.conf /userdata/cfg/wpa_config.conf; }" +
      " || { grep -q 'network=' /etc/wpa_supplicant.conf 2>/dev/null" +
      " && cp -p /etc/wpa_supplicant.conf /userdata/cfg/wpa_config.conf; } || true; }" +
      " && grep -q 'network=' /userdata/cfg/wpa_config.conf 2>/dev/null" +
      " && ln -sf /userdata/cfg/wpa_config.conf /etc/wpa_supplicant.conf || true"

    val CREATE_WORKSPACE_COMMAND = """
      mkdir -p $BESPOK3D/bin $BESPOK3D/sbin $BESPOK3D/etc/daemon \
        $BESPOK3D/etc/init.d/autostart $BESPOK3D/etc/nginx/locations $BESPOK3D/home \
        $BESPOK3D/root $BESPOK3D/run $BESPOK3D/usr/local/plugins $BESPOK3D/var/db \
        $BESPOK3D/var/lib $BESPOK3D/var/log &&
      ([ -f $BESPOK3D/etc/version ] || printf '%s\n' '0.0.1' > $BESPOK3D/etc/version) &&
      chmod +t $BESPOK3D/run && chown -R lava:lava $BESPOK3D && chmod -R 755 $BESPOK3D
    """.trimIndent()

    val STABLE_DHCP_COMMAND = """
      if [ ! -L /var/db/dhcpcd ]; then
        mkdir -p $BESPOK3D/var/db/dhcpcd
        [ -d /var/db/dhcpcd ] && cp -a /var/db/dhcpcd/. $BESPOK3D/var/db/dhcpcd/ 2>/dev/null || true
        rm -rf /var/db/dhcpcd
        ln -sf $BESPOK3D/var/db/dhcpcd /var/db/dhcpcd
      fi
    """.trimIndent()

    val STABLE_MAC_COMMAND = """
      MAC=${'$'}(cat /sys/class/net/wlan0/address 2>/dev/null)
      if [ -n "${'$'}MAC" ]; then
        mkdir -p /etc/udev/rules.d
        printf 'SUBSYSTEM=="net", ACTION=="add", KERNEL=="wlan0", RUN+="/sbin/ip link set wlan0 address %s"\n' "${'$'}MAC" > /etc/udev/rules.d/70-wlan0-mac.rules
      fi
    """.trimIndent()

    val CREATE_KLIPPER_DIRS_COMMAND = """
      mkdir -p /oem/printer_data/config/bespok3d/klipper \
        /oem/printer_data/config/bespok3d/moonraker /oem/printer_data/config/bespok3d/data &&
      touch /oem/printer_data/config/bespok3d/klipper/main.cfg \
        /oem/printer_data/config/bespok3d/moonraker/main.cfg &&
      chown -R lava:lava /oem/printer_data/config/bespok3d &&
      chmod -R 755 /oem/printer_data/config/bespok3d
    """.trimIndent()

    const val GENERATE_CERT_COMMAND =
      "openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 " +
        "-keyout $BESPOK3D/etc/daemon/server.key -out $CERT_PATH -sha256 -days 3650 " +
        "-nodes -subj '/CN=bespok3d-daemon' 2>&1"

    const val CLEAN_SYSTEM_PYTHON_COMMAND =
      "cd /oem/overlay/upper/usr/lib/python3.11/site-packages 2>/dev/null && " +
        "for p in fastapi uvicorn pydantic pydantic_core uvloop httptools websockets watchfiles " +
        "multipart dotenv pgpy annotated_types starlette click typing_inspection annotated_doc; " +
        "do rm -rf \"\$p\" \"\$p\"-*.dist-info 2>/dev/null; done; " +
        "rm -f typing_extensions.py typing_extensions.pyc; rm -rf __pycache__ 2>/dev/null; true"

    const val VERIFY_DAEMON_COMMAND =
      "sleep 5 && pid=\$(cat $BESPOK3D/run/bespok3d-daemon.pid 2>/dev/null) && " +
        "[ -n \"\$pid\" ] && kill -0 \"\$pid\" 2>/dev/null || " +
        "{ cat $BESPOK3D/var/log/daemon.log >&2; exit 1; }"

    const val VERIFY_INSTALL_COMMAND =
      "test -d $BESPOK3D && test -f /etc/init.d/S99bespok3d && " +
        "pid=\$(cat $BESPOK3D/run/bespok3d-daemon.pid 2>/dev/null) && " +
        "[ -n \"\$pid\" ] && kill -0 \"\$pid\" 2>/dev/null || " +
        "{ cat $BESPOK3D/var/log/daemon.log >&2; exit 1; }"
  }
}
