package org.crabcore.u1control.slicing

import android.app.Activity
import android.content.res.ColorStateList
import android.view.Gravity
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import org.crabcore.u1control.R

data class PaintFillSettings(
  /** Orca-style smart fill angle 0–90° (higher = larger fill regions). */
  var fillAngleDegrees: Int = 45,
  var respectColor: Boolean = true,
)

/** Fill-tool modal — Orca-style smart fill angle, themed like supports/brim. */
object HelixPaintFillUi {
  fun show(
    activity: Activity,
    accent: Int,
    state: PaintFillSettings,
    onApply: (PaintFillSettings) -> Unit,
  ) {
    val draft = state.copy()
    val density = activity.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()

    val hint = TextView(activity).apply {
      text = "Like Orca: higher angle fills larger connected areas across shallow curves."
      textSize = 12f
      setTextColor(HelixAppTheme.SUBTEXT)
      setPadding(0, 0, 0, dp(10))
    }

    val value = TextView(activity).apply {
      textSize = 13f
      setTextColor(HelixAppTheme.TEXT)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
    }
    fun refreshValue() {
      val deg = draft.fillAngleDegrees.coerceIn(0, 90)
      value.text = "Smart fill angle: ${deg}\u00B0"
    }
    refreshValue()

    val seek = SeekBar(activity).apply {
      max = 90
      progress = draft.fillAngleDegrees.coerceIn(0, 90)
      progressTintList = ColorStateList.valueOf(accent)
      thumbTintList = ColorStateList.valueOf(accent)
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
          draft.fillAngleDegrees = progress.coerceIn(0, 90)
          refreshValue()
        }
        override fun onStartTrackingTouch(seekBar: SeekBar?) {}
        override fun onStopTrackingTouch(seekBar: SeekBar?) {}
      })
    }

    val colorCheck = CheckBox(activity).apply {
      text = "Stop at current color boundary"
      textSize = 13f
      setTextColor(HelixAppTheme.TEXT)
      isChecked = draft.respectColor
      buttonTintList = ColorStateList.valueOf(accent)
      setOnCheckedChangeListener { _, checked -> draft.respectColor = checked }
    }

    val content = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      addView(hint)
      addView(value)
      addView(seek)
      addView(
        colorCheck,
        LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.MATCH_PARENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(12) },
      )
    }

    HelixThemedDialog.showFloatingCenter(
      activity = activity,
      accent = accent,
      title = "Fill tool",
      iconRes = R.drawable.ic_tool_paint,
      content = content,
      primaryLabel = "Use fill",
      onPrimary = { onApply(draft) },
    )
  }
}
