package org.crabcore.u1control.bespok3d

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class Bespok3dProtocolTest {
  private fun bundledHelixScreenBytes(): ByteArray {
    val appProject = System.getProperty("helix.appProjectDir")
      ?: throw IllegalStateException("helix.appProjectDir test property is missing")
    return File(
      appProject,
      "src/main/assets/${Bespok3dProtocol.BUNDLED_HELIXSCREEN_ASSET}",
    ).readBytes()
  }

  @Test
  fun buildsThePublishedAccessRequestContractExactly() {
    val json = JSONObject(
      Bespok3dProtocol.accessRequestBody(
        label = "Crabman's Pixel",
        identity = "helix-1234_abcd",
        token = "0123456789abcdef0123456789abcdef",
        publicKey = "PUBLIC KEY",
      )
    )

    assertEquals(
      setOf("label", "identity", "token", "public_key"),
      json.keys().asSequence().toSet(),
    )
    assertEquals("Crabman's Pixel", json.getString("label"))
    assertEquals("helix-1234_abcd", json.getString("identity"))
    assertEquals("0123456789abcdef0123456789abcdef", json.getString("token"))
    assertEquals("PUBLIC KEY", json.getString("public_key"))
  }

  @Test
  fun rejectsCredentialsTheDaemonWouldReject() {
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.accessRequestBody("Phone", "identity with spaces", "0123456789abcdef")
    }
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.accessRequestBody("Phone", "helix-phone", "too-short")
    }
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.accessRequestBody("Phone\nInjected", "helix-phone", "0123456789abcdef")
    }
  }

  @Test
  fun recognizesOnlyTheOfficialDaemonSourceOffer() {
    val cert = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----"
    val fingerprint = Bespok3dProtocol.certificateSha256("fixture".toByteArray())
    val probe = Bespok3dProtocol.parseProbe(
      """{"version":"0.12.24","license":"AGPL-3.0-or-later","source":"https://github.com/Bespok3d/daemon"}""",
      cert,
      fingerprint,
    )
    assertEquals("0.12.24", probe.version)
    assertEquals(cert, probe.certificatePem)
    assertEquals(fingerprint, probe.certificateSha256)
    assertEquals(32, fingerprint.split(':').size)

    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.parseProbe(
        """{"version":"0.12.24","license":"AGPL-3.0-or-later","source":"https://example.com/lookalike"}""",
        cert,
        fingerprint,
      )
    }
  }

  @Test
  fun parsesPendingAccessAndHealthyStatusWithoutExposingExtraFields() {
    val cert = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----"
    assertEquals(cert, Bespok3dProtocol.parseAccessResponse(JSONObject()
      .put("ok", true)
      .put("cert", cert)
      .toString()))

    assertEquals(
      Bespok3dStatus("0.12.24", "printer-uuid"),
      Bespok3dProtocol.parseStatus(
        """{"ok":true,"version":"0.12.24","printer_uuid":"printer-uuid"}"""
      ),
    )
  }

  @Test
  fun parsesOnlyOfficialCatalogPackagesAndLiveInstalledVersions() {
    val catalog = Bespok3dProtocol.parsePluginCatalog(
      """{
        "schema_version":1,
        "publisher":"679939555819fb5f6423dc68c4388e76bfa9b4e0",
        "plugins":[
          {
            "name":"bespok3d-daemon","version":"0.12.24",
            "download_url":"https://api.github.com/repos/Bespok3d/daemon/releases/assets/1"
          },
          {
            "name":"camera-hw-accel","title":"Camera HW Accel","version":"0.1.10",
            "tagline":"Fast camera","category":"camera",
            "download_url":"https://api.github.com/repos/Bespok3d/u1-hw-camera/releases/assets/42",
            "deps":["moonraker-auth"],
            "config":[{
              "key":"WEBRTC_ENABLED","label":"WebRTC stream","type":"toggle",
              "default":"1","required":true,"options":["0","1"],"hint":"Uses less CPU",
              "onValue":"1","offValue":"0"
            }]
          },
          {
            "name":"moonraker-auth","title":"Moonraker Login","version":"0.1.1",
            "download_url":"https://api.github.com/repos/Bespok3d/moonraker-auth/releases/assets/43",
            "deps":[]
          }
        ]
      }""".trimIndent(),
      """{"installed":{"moonraker-auth":"0.1.1"}}""",
    )

    assertEquals(listOf("camera-hw-accel", "moonraker-auth"), catalog.plugins.map { it.id })
    assertEquals(mapOf("moonraker-auth" to "0.1.1"), catalog.installed)
    val camera = catalog.plugins.first()
    assertEquals("Bespok3d/u1-hw-camera", camera.repository)
    assertEquals(listOf("moonraker-auth"), camera.dependencies)
    assertEquals("1", camera.config.single().defaultValue)
    assertEquals("1", camera.config.single().onValue)
    assertEquals("0", camera.config.single().offValue)
    assertTrue(camera.config.single().required)
  }

  @Test
  fun ordersMissingDependenciesBeforeExplicitSelections() {
    val dependency = Bespok3dPlugin("dep", "Dependency", "1.0.0", "", "system", "Bespok3d/dep", emptyList(), emptyList())
    val app = Bespok3dPlugin("app", "App", "1.0.0", "", "ui", "Bespok3d/app", listOf("dep"), emptyList())
    val catalog = Bespok3dPluginCatalog(listOf(app, dependency), emptyMap())
    assertEquals(listOf("dep", "app"), Bespok3dProtocol.dependencyOrder(catalog, listOf("app")).map { it.id })

    val alreadyInstalled = catalog.copy(installed = mapOf("dep" to "1.0.0"))
    assertEquals(listOf("app"), Bespok3dProtocol.dependencyOrder(alreadyInstalled, listOf("app")).map { it.id })
    assertEquals(listOf("dep"), Bespok3dProtocol.dependencyOrder(alreadyInstalled, listOf("dep")).map { it.id })
  }

  @Test
  fun acceptsOnlyTheExactReleaseAssetForTheCatalogIdentity() {
    val plugin = Bespok3dPlugin(
      "camera-hw-accel", "Camera", "0.1.10", "", "camera",
      "Bespok3d/u1-hw-camera", emptyList(), emptyList(),
    )
    val expected = "https://github.com/Bespok3d/u1-hw-camera/releases/download/camera-hw-accel-v0.1.10/camera-hw-accel-0.1.10.b3"
    assertEquals(
      expected,
      Bespok3dProtocol.parseReleaseAssetUrl(
        """[{"assets":[{"name":"camera-hw-accel-0.1.10.b3","browser_download_url":"$expected"}]}]""",
        plugin,
      ),
    )
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.parseReleaseAssetUrl(
        """[{"assets":[{"name":"camera-hw-accel-0.1.10.b3","browser_download_url":"https://evil.example/package.b3"}]}]""",
        plugin,
      )
    }
  }

  @Test
  fun preservesPerPluginBatchFailures() {
    val result = Bespok3dProtocol.parseInstallResult(
      """{"ok":false,"results":[
        {"plugin_id":"fluidd","ok":true},
        {"plugin_id":"camera-hw-accel","ok":false,"reason":"camera service did not start"},
        {"plugin_id":"(services)","ok":true}
      ]}""",
    )
    assertFalse(result.ok)
    assertEquals(listOf("fluidd"), result.installedIds)
    assertEquals(mapOf("camera-hw-accel" to "camera service did not start"), result.failures)
  }

  @Test
  fun preservesTheDaemonServiceRestartFailureWithoutTreatingItAsAPluginId() {
    val result = Bespok3dProtocol.parseInstallResult(
      """{"ok":false,"results":[
        {"plugin_id":"camera-hw-accel","ok":true},
        {"plugin_id":"(services)","ok":false,"reason":"moonraker did not restart"}
      ]}""",
    )

    assertFalse(result.ok)
    assertEquals(listOf("camera-hw-accel"), result.installedIds)
    assertEquals(mapOf("(services)" to "moonraker did not restart"), result.failures)
  }

  @Test
  fun validatesHelixScreenConfigAndBuildsTheExactReconfigureContract() {
    assertEquals(
      Bespok3dHelixScreenState(installed = true, selected = "helixscreen"),
      Bespok3dProtocol.parseHelixScreenConfig(
        """{"vars":{"SCREEN_UI":"helixscreen"}}""",
      ),
    )
    assertEquals(
      """{"SCREEN_UI":"snapmaker"}""",
      Bespok3dProtocol.helixScreenReconfigureBody("snapmaker"),
    )
    assertEquals(
      Bespok3dHelixScreenState(installed = true, selected = "snapmaker"),
      Bespok3dProtocol.parseHelixScreenReconfigure(
        """{"plugin_id":"helixscreen-ui","ok":true,"log":[]}""",
        "snapmaker",
      ),
    )
  }

  @Test
  fun rejectsUnknownTouchscreenValuesAndWrongPluginResponses() {
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.parseHelixScreenConfig("""{"vars":{"SCREEN_UI":"other"}}""")
    }
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.helixScreenReconfigureBody("other")
    }
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.parseHelixScreenReconfigure(
        """{"plugin_id":"camera-hw-accel","ok":true,"log":[]}""",
        "helixscreen",
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.parseHelixScreenReconfigure(
        """{"plugin_id":"helixscreen-ui","ok":true,"log":[{"id":"restart","ok":false}]}""",
        "helixscreen",
      )
    }
  }

  @Test
  fun verifiesTheExactBundledHelixScreenIdentityAndBytes() {
    assertEquals(
      Bespok3dBundledPluginIdentity(id = "helixscreen-ui", version = "0.1.0"),
      Bespok3dProtocol.verifyBundledHelixScreenPackage(bundledHelixScreenBytes()),
    )
  }

  @Test
  fun rejectsAnyChangeToTheBundledHelixScreenPackage() {
    val corrupted = bundledHelixScreenBytes()
    corrupted[corrupted.size / 2] = (corrupted[corrupted.size / 2].toInt() xor 0x01).toByte()

    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dProtocol.verifyBundledHelixScreenPackage(corrupted)
    }
  }
}
