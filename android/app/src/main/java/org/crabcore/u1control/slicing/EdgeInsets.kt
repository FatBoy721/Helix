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

  /**
   * Pads only the bottom of [view] by the nav-bar inset, on top of the padding it
   * already has. For bottom sheets, which sit against the bottom edge but must
   * keep their own top and side padding untouched.
   */
  fun applyBottom(view: View) {
    val base = view.paddingBottom
    ViewCompat.setOnApplyWindowInsetsListener(view) { target, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      target.setPadding(target.paddingLeft, target.paddingTop, target.paddingRight, base + bars.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(view)
  }
}
