package org.crabcore.u1control.bespok3d

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class Bespok3dU1EnrollmentTest {
  @Test
  fun patchersAreExactAndIdempotent() {
    val init = "#!/bin/sh\necho stock\n"
    val patchedInit = Bespok3dU1EnrollmentProtocol.patchS90lmd(init)
    assertEquals(
      "#!/bin/sh\n[ -x /etc/init.d/S99bespok3d ] && exec /etc/init.d/S99bespok3d \"\$@\"\necho stock\n",
      patchedInit,
    )
    assertEquals(patchedInit, Bespok3dU1EnrollmentProtocol.patchS90lmd(patchedInit))

    val nginx = "server {\n    listen 80;\n}\n\n"
    val patchedNginx = Bespok3dU1EnrollmentProtocol.patchNginx(nginx)
    assertEquals(
      "server {\n    listen 80;\n    include /userdata/bespok3d/etc/nginx/locations/*.conf;\n}\n",
      patchedNginx,
    )
    assertEquals(patchedNginx, Bespok3dU1EnrollmentProtocol.patchNginx(patchedNginx))

    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dU1EnrollmentProtocol.patchS90lmd("echo no-shebang")
    }
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dU1EnrollmentProtocol.patchNginx("server {")
    }
  }

  @Test
  fun aclMergePreservesOtherClientsAndDoesNotDemoteAnExistingAdmin() {
    val original = """
      {
        "keys": ["helix-11111111-1111-1111-1111-111111111111"],
        "roles": {"helix-11111111-1111-1111-1111-111111111111": "admin"},
        "labels": {"helix-11111111-1111-1111-1111-111111111111": "Old phone"},
        "tokens": ["${"1".repeat(64)}"],
        "token_identity": {"${"1".repeat(64)}": "helix-11111111-1111-1111-1111-111111111111"}
      }
    """.trimIndent()
    val newIdentity = "helix-22222222-2222-2222-2222-222222222222"
    val merged = JSONObject(
      Bespok3dU1EnrollmentProtocol.mergeAcl(original, newIdentity, "2".repeat(64), "New phone"),
    )

    assertEquals(2, merged.getJSONArray("keys").length())
    assertEquals("admin", merged.getJSONObject("roles").getString("helix-11111111-1111-1111-1111-111111111111"))
    assertEquals("user", merged.getJSONObject("roles").getString(newIdentity))
    assertEquals("New phone", merged.getJSONObject("labels").getString(newIdentity))
    assertEquals(newIdentity, merged.getJSONObject("token_identity").getString("2".repeat(64)))

    val rerun = JSONObject(
      Bespok3dU1EnrollmentProtocol.mergeAcl(merged.toString(), newIdentity, "2".repeat(64), "Renamed"),
    )
    assertEquals(2, rerun.getJSONArray("keys").length())
    assertEquals(2, rerun.getJSONArray("tokens").length())
    assertEquals("user", rerun.getJSONObject("roles").getString(newIdentity))
    assertEquals("Renamed", rerun.getJSONObject("labels").getString(newIdentity))
  }

  @Test
  fun runsTheOfficialOrderedRecipeAndUploadsOnlyVerifiedPayload() {
    val remote = FakeSsh(overlayActive = false)
    val enrollment = enrollment(remote)

    val result = enrollment.run(config(), bootstrap())

    assertEquals(STEPS, result.completedSteps)
    assertEquals("0.12.24", result.daemonVersion)
    assertEquals("0.1.10", result.jinniVersion)
    assertTrue(result.certificatePem.contains("BEGIN CERTIFICATE"))
    assertEquals(1, remote.reconnects)
    assertTrue(remote.operations.indexOfFirst { it == "exec:reboot" } < remote.operations.indexOfFirst { it == "reconnect" })
    assertEquals("daemon", remote.files["/userdata/bespok3d/var/lib/daemon/daemon.py"]?.toString(Charsets.UTF_8))
    assertEquals("jinni", remote.files["/userdata/bespok3d/var/lib/daemon/bespok3d_jinni.py"]?.toString(Charsets.UTF_8))
    assertEquals("autostart", remote.files["/userdata/bespok3d/etc/init.d/autostart/s10bespok3d-daemon"]?.toString(Charsets.UTF_8))
    assertFalse(remote.files.containsKey("/userdata/bespok3d/var/lib/daemon/S99bespok3d"))
    assertTrue(remote.operations.any { it.startsWith("exec:/userdata/bespok3d/venv/bin/pip install --no-index --no-deps") })
    val acl = JSONObject(remote.files.getValue("/userdata/bespok3d/auth/acl.json").toString(Charsets.UTF_8))
    assertEquals("admin", acl.getJSONObject("roles").getString(IDENTITY))
    assertEquals(IDENTITY, acl.getJSONObject("token_identity").getString(TOKEN))
  }

  @Test
  fun anActiveOverlaySkipsTheRebootAndARepeatLeavesPatchesSingle() {
    val remote = FakeSsh(overlayActive = true)
    val enrollment = enrollment(remote)

    enrollment.run(config(), bootstrap())
    enrollment.run(config(), bootstrap())

    assertEquals(0, remote.reconnects)
    assertFalse(remote.operations.contains("exec:reboot"))
    val init = remote.files.getValue("/etc/init.d/S90lmd").toString(Charsets.UTF_8)
    val nginx = remote.files.getValue("/etc/nginx/sites-enabled/fluidd").toString(Charsets.UTF_8)
    assertEquals(
      1,
      init.lineSequence().count {
        it == "[ -x /etc/init.d/S99bespok3d ] && exec /etc/init.d/S99bespok3d \"\$@\""
      },
    )
    assertEquals(1, Regex("bespok3d/etc/nginx/locations").findAll(nginx).count())
  }

  @Test
  fun reportsTheExactFailedStepAndNeverContinuesPastIt() {
    val remote = FakeSsh(overlayActive = true, failCommand = "rm -rf /oem/dhcpcd")
    val error = assertThrows(Bespok3dEnrollmentException::class.java) {
      enrollment(remote).run(config(), bootstrap())
    }

    assertEquals("stable-network", error.stepId)
    assertFalse(remote.operations.any { it.contains("sites-enabled/fluidd") })
    assertFalse(remote.files.containsKey("/userdata/bespok3d/auth/acl.json"))
  }

  @Test
  fun refusesAChangedHostKeyBeforeOpeningTheMutationTransport() {
    var opened = false
    val enrollment = Bespok3dU1Enrollment(
      preflight = { _, _ -> eligiblePreflight("SHA256:${"B".repeat(43)}") },
      sshFactory = Bespok3dSshFactory { _, _, _ -> opened = true; FakeSsh(true) },
      pause = {},
    )

    assertThrows(IllegalArgumentException::class.java) {
      enrollment.run(config(), bootstrap())
    }
    assertFalse(opened)
  }

  private fun enrollment(remote: FakeSsh): Bespok3dU1Enrollment = Bespok3dU1Enrollment(
    preflight = { _, _ -> eligiblePreflight(FINGERPRINT) },
    sshFactory = Bespok3dSshFactory { host, password, fingerprint ->
      assertEquals("192.168.1.17", host)
      assertEquals("snapmaker", password)
      assertEquals(FINGERPRINT, fingerprint)
      remote
    },
    pause = {},
  )

  private fun eligiblePreflight(fingerprint: String) = Bespok3dU1PreflightResult(
    firmware = "stock",
    model = "Rockchip RK3562 EVB2 DDR4 V10 Board",
    overlayActive = false,
    workspacePresent = false,
    daemonRunning = false,
    printState = "standby",
    eligible = true,
    reason = null,
    sshHostKeySha256 = fingerprint,
  )

  private fun config() = Bespok3dU1EnrollmentConfig(
    host = "192.168.1.17",
    password = "snapmaker",
    sshHostKeySha256 = FINGERPRINT,
    label = "Helix test phone",
    credentials = Bespok3dU1EnrollmentCredentials(IDENTITY, TOKEN),
  )

  private fun bootstrap() = Bespok3dBootstrapSet(
    daemon = Bespok3dBootstrapPackage(
      "bespok3d-daemon",
      "0.12.24",
      listOf(
        Bespok3dBootstrapFile("daemon.py", 0b110100100, "daemon".toByteArray()),
        Bespok3dBootstrapFile("wheels/dependency.whl", 0b110100100, "wheel".toByteArray()),
        Bespok3dBootstrapFile("S99bespok3d", 0b111101101, "dispatcher".toByteArray()),
        Bespok3dBootstrapFile("s10bespok3d-daemon", 0b111101101, "autostart".toByteArray()),
      ),
    ),
    jinni = Bespok3dBootstrapPackage(
      "bespok3d-jinni-snapmaker-u1",
      "0.1.10",
      listOf(Bespok3dBootstrapFile("bespok3d_jinni.py", 0b110100100, "jinni".toByteArray())),
    ),
  )

  private class FakeSsh(
    private val overlayActive: Boolean,
    private val failCommand: String? = null,
  ) : Bespok3dSsh {
    val operations = mutableListOf<String>()
    val files = mutableMapOf(
      "/etc/init.d/S90lmd" to "#!/bin/sh\necho stock\n".toByteArray(),
      "/etc/nginx/sites-enabled/fluidd" to "server {\n}\n".toByteArray(),
      "/userdata/bespok3d/etc/daemon/server.crt" to
        "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n".toByteArray(),
    )
    var reconnects = 0

    override fun exec(command: String): String {
      operations += "exec:$command"
      if (failCommand != null && command.contains(failCommand)) error("fixture failure")
      return when {
        command == "test -e /oem/.debug && echo yes || echo no" -> if (overlayActive) "yes\n" else "no\n"
        command.startsWith("test -f /userdata/bespok3d/etc/daemon/server.crt") -> "yes\n"
        command.startsWith("test -f /userdata/bespok3d/auth/acl.json") ->
          if (files.containsKey("/userdata/bespok3d/auth/acl.json")) "yes\n" else "no\n"
        command.startsWith("test -x /userdata/bespok3d/venv/bin/python3") -> "yes\n"
        else -> ""
      }
    }

    override fun read(path: String): ByteArray {
      operations += "read:$path"
      return files.getValue(path)
    }

    override fun write(path: String, bytes: ByteArray, mode: Int) {
      operations += "write:$path:$mode"
      files[path] = bytes.copyOf()
    }

    override fun reconnect() {
      operations += "reconnect"
      reconnects += 1
    }

    override fun close() {
      operations += "close"
    }
  }

  private companion object {
    const val FINGERPRINT = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const val IDENTITY = "helix-12345678-1234-1234-1234-123456789abc"
    val TOKEN = "a".repeat(64)
    val STEPS = listOf(
      "preflight",
      "unlock-overlay",
      "fix-wifi-persistence",
      "reboot-and-reconnect",
      "create-workspace",
      "deploy-s99",
      "patch-s90lmd",
      "stable-network",
      "patch-nginx",
      "klipper-includes",
      "deploy-daemon",
      "generate-daemon-cert",
      "enroll-daemon-key",
      "start-daemon",
      "verify",
    )
  }
}
