package org.crabcore.u1control.bespok3d

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

class Bespok3dU1PreflightTest {
  @Test
  fun parsesStockU1AndAllowsIdleEnrollment() {
    val system = Bespok3dU1PreflightProtocol.parseSystemState(
      """
        firmware=stock
        model=Rockchip RK3562 EVB2 DDR4 V10 Board
        overlay=no
        workspace=no
        daemon=no
      """.trimIndent(),
    )
    val printState = Bespok3dU1PreflightProtocol.parsePrintState(
      """{"result":{"status":{"print_stats":{"state":"standby"}}}}""",
    )
    val result = Bespok3dU1PreflightProtocol.result(system, printState, "SHA256:fixture")

    assertEquals("stock", result.firmware)
    assertEquals("Rockchip RK3562 EVB2 DDR4 V10 Board", result.model)
    assertFalse(result.overlayActive)
    assertFalse(result.workspacePresent)
    assertFalse(result.daemonRunning)
    assertEquals("standby", result.printState)
    assertTrue(result.eligible)
    assertNull(result.reason)
  }

  @Test
  fun blocksExtendedFirmwareAndAnActivePrint() {
    val extended = Bespok3dU1SystemState(
      "extended",
      "Rockchip RK3562 EVB2 DDR4 V10 Board",
      true,
      false,
      false,
    )
    val extendedResult = Bespok3dU1PreflightProtocol.result(extended, "standby", "SHA256:key")
    assertFalse(extendedResult.eligible)
    assertEquals(
      "Bespok3d enrollment requires stock Snapmaker U1 firmware",
      extendedResult.reason,
    )

    val stock = extended.copy(firmware = "stock", overlayActive = false)
    for (state in listOf("printing", "paused")) {
      val activeResult = Bespok3dU1PreflightProtocol.result(stock, state, "SHA256:key")
      assertFalse(activeResult.eligible)
      assertEquals("The printer must be idle before Bespok3d enrollment", activeResult.reason)
    }

    val unrelatedHost = stock.copy(model = "Generic Linux Server")
    val unrelatedResult = Bespok3dU1PreflightProtocol.result(unrelatedHost, "standby", "SHA256:key")
    assertFalse(unrelatedResult.eligible)
    assertEquals("The SSH host is not a supported Snapmaker U1", unrelatedResult.reason)
  }

  @Test
  fun rejectsIncompleteSshOrMoonrakerResponses() {
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dU1PreflightProtocol.parseSystemState("firmware=stock\nmodel=Snapmaker U1")
    }
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dU1PreflightProtocol.parseSystemState(
        "firmware=unknown\nmodel=U1\noverlay=no\nworkspace=no\ndaemon=no",
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      Bespok3dU1PreflightProtocol.parsePrintState("""{"result":{"status":{}}}""")
    }
  }

  @Test
  fun liveStockU1Preflight() {
    val host = System.getenv("BESPOK3D_U1_HOST")
    val password = System.getenv("BESPOK3D_U1_PASSWORD")
    assumeTrue("Set BESPOK3D_U1_HOST and BESPOK3D_U1_PASSWORD for the live test", host != null && password != null)

    val result = Bespok3dU1Preflight().run(host!!, password!!)
    assertEquals("stock", result.firmware)
    assertTrue(result.model.contains("RK3562", ignoreCase = true))
    assertTrue(result.printState != "printing" && result.printState != "paused")
    assertTrue(result.eligible)
    assertTrue(Regex("^SHA256:[A-Za-z0-9+/]{43}$").matches(result.sshHostKeySha256))
  }
}
