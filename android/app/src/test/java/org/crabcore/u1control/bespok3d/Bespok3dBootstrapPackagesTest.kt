package org.crabcore.u1control.bespok3d

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File

class Bespok3dBootstrapPackagesTest {
  private fun bundleBytes(): ByteArray {
    val appProject = System.getProperty("helix.appProjectDir")
      ?: throw IllegalStateException("helix.appProjectDir test property is missing")
    return File(appProject, "src/main/assets/${Bespok3dBootstrapPackages.ASSET_PATH}").readBytes()
  }

  @Test
  fun verifiesTheExactOfficialBootstrapReleaseAndEveryPayloadHash() {
    val packages = Bespok3dBootstrapPackages.load(ByteArrayInputStream(bundleBytes()))

    assertEquals("bespok3d-daemon", packages.daemon.name)
    assertEquals("0.12.24", packages.daemon.version)
    assertEquals(127, packages.daemon.files.size)
    assertTrue(packages.daemon.files.any { it.path == "S99bespok3d" })
    assertTrue(packages.daemon.files.any { it.path == "s10bespok3d-daemon" })
    assertTrue(packages.daemon.files.any { it.path.startsWith("wheels/") })

    assertEquals("bespok3d-jinni-snapmaker-u1", packages.jinni.name)
    assertEquals("0.1.10", packages.jinni.version)
    assertEquals(43, packages.jinni.files.size)
    assertTrue(packages.jinni.files.any { it.path == "bespok3d_jinni.py" })
    assertTrue(packages.jinni.files.any { it.path == "paths.json" })

    (packages.daemon.files + packages.jinni.files).forEach { file ->
      assertTrue(file.path.isNotBlank())
      assertTrue(file.bytes.isNotEmpty())
      assertTrue(file.mode in 0..0b111_111_111)
    }
  }

  @Test
  fun rejectsAnyChangeToThePinnedReleaseBytes() {
    val corrupted = bundleBytes()
    corrupted[corrupted.size / 2] = (corrupted[corrupted.size / 2].toInt() xor 0x01).toByte()

    assertThrows(Exception::class.java) {
      Bespok3dBootstrapPackages.load(ByteArrayInputStream(corrupted))
    }
  }

  @Test
  fun rejectsTraversalAbsoluteWindowsAndAmbiguousPaths() {
    for (path in listOf("../escape", "dir/../escape", "/absolute", "C:\\escape", "dir//file", "./file")) {
      assertThrows(IllegalArgumentException::class.java) {
        Bespok3dBootstrapPackages.validateRelativePath(path)
      }
    }
    assertEquals(
      "wheels/package.whl",
      Bespok3dBootstrapPackages.validateRelativePath("wheels/package.whl"),
    )
  }
}
