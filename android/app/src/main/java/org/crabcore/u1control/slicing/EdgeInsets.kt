package org.crabcore.u1control.slicing

import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Pads a root view by the system-bar insets so top bars don't clip under the
 * status/notification bar and bottom bars clear the nav bar (edge-to-edge is the
 * default on recent Android). The padded area shows the root's own background.
 */
object EdgeInsets {
  fun apply(root: View) {
    val basePadding = intArrayOf(root.paddingLeft, root.paddingTop, root.paddingRight, root.paddingBottom)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      v.setPadding(
        basePadding[0] + bars.left,
        basePadding[1] + bars.top,
        basePadding[2] + bars.right,
        basePadding[3] + bars.bottom,
      )
      insets
    }
    ViewCompat.requestApplyInsets(root)
  }
}
