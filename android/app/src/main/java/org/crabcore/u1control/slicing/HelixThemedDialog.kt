package org.crabcore.u1control.slicing

import android.app.Activity
import android.app.Dialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.annotation.DrawableRes

/** Helix RN theme tokens ([constants/theme.ts]) for native floating dialogs. */
object HelixAppTheme {
  const val BG = 0xFF0D0F12.toInt()
  const val CARD = 0xFF171A1F.toInt()
  const val CARD_ALT = 0xFF23272F.toInt()
  const val BORDER = 0xFF303640.toInt()
  const val TEXT = 0xFFF4F7FB.toInt()
  const val SUBTEXT = 0xFF9AA4AF.toInt()
  const val SCRIM = 0x99000000.toInt()
}

/**
 * Native counterpart to RN `ThemedDialog` (center placement).
 */
object HelixThemedDialog {
  fun showFloatingCenter(
    activity: Activity,
    accent: Int,
    title: String,
    @DrawableRes iconRes: Int,
    content: View,
    secondaryLabel: String = "Cancel",
    primaryLabel: String = "Done",
    onSecondary: () -> Unit = {},
    onPrimary: () -> Unit,
  ) {
    val density = activity.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()
    val screenW = activity.resources.displayMetrics.widthPixels
    val cardW = minOf(dp(380), (screenW * 0.92f).toInt())

    fun actionButton(
      label: String,
      fill: Int,
      stroke: Int?,
      textColor: Int,
      onClick: () -> Unit,
    ) = TextView(activity).apply {
      text = label
      textSize = 13f
      gravity = Gravity.CENTER
      setTextColor(textColor)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      minHeight = dp(44)
      setPadding(dp(12), dp(10), dp(12), dp(10))
      background = GradientDrawable().apply {
        cornerRadius = dp(8).toFloat()
        setColor(fill)
        stroke?.let { setStroke(dp(1), it) }
      }
      setOnClickListener { onClick() }
    }

    val dialog = Dialog(activity)
    fun dismiss() = dialog.dismiss()

    val titleRow = LinearLayout(activity).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      addView(
        FrameLayout(activity).apply {
          background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(HelixAppTheme.CARD)
            setStroke(dp(1), HelixAppTheme.BORDER)
          }
          addView(
            ImageView(activity).apply {
              setImageResource(iconRes)
              imageTintList = ColorStateList.valueOf(accent)
              layoutParams = FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER)
            },
          )
        },
        LinearLayout.LayoutParams(dp(34), dp(34)),
      )
      addView(
        TextView(activity).apply {
          text = title
          textSize = 16f
          setTextColor(HelixAppTheme.TEXT)
          typeface = android.graphics.Typeface.DEFAULT_BOLD
          setPadding(dp(8), 0, 0, 0)
        },
        LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        ),
      )
    }

    val header = LinearLayout(activity).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(0, 0, 0, dp(12))
      addView(titleRow)
      addView(
        TextView(activity).apply {
          text = "\u00D7"
          textSize = 22f
          setTextColor(HelixAppTheme.SUBTEXT)
          setPadding(dp(4), 0, 0, 0)
          setOnClickListener {
            onSecondary()
            dismiss()
          }
        },
      )
    }

    val scroll = ScrollView(activity).apply {
      isVerticalScrollBarEnabled = false
      addView(content)
    }

    val card = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(16), dp(16), dp(16), dp(16))
      background = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(HelixAppTheme.BG)
        setStroke(dp(1), HelixAppTheme.BORDER)
      }
      addView(header)
      addView(scroll)
      addView(
        LinearLayout(activity).apply {
          orientation = LinearLayout.HORIZONTAL
          setPadding(0, dp(16), 0, 0)
          addView(
            actionButton(secondaryLabel, HelixAppTheme.CARD_ALT, HelixAppTheme.BORDER, HelixAppTheme.TEXT) {
              onSecondary()
              dismiss()
            },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
              marginEnd = dp(8)
            },
          )
          addView(
            actionButton(primaryLabel, accent, null, Color.WHITE) {
              onPrimary()
              dismiss()
            },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
              marginStart = dp(8)
            },
          )
        },
      )
      layoutParams = FrameLayout.LayoutParams(cardW, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
        gravity = Gravity.CENTER
      }
    }

    val root = FrameLayout(activity).apply {
      setBackgroundColor(HelixAppTheme.SCRIM)
      setOnClickListener {
        onSecondary()
        dismiss()
      }
      addView(card)
      card.isClickable = true
    }

    dialog.apply {
      setContentView(root)
      window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
      window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      show()
    }
  }
}
