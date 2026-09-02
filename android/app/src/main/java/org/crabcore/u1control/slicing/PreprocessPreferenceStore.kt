package org.crabcore.u1control.slicing

import android.content.Context

enum class AiDetectionSensitivity(val wireValue: String) {
  LOW("low"),
  HIGH("high");

  companion object {
    fun fromStoredValue(value: String?): AiDetectionSensitivity =
      values().firstOrNull { it.wireValue == value?.trim()?.lowercase() } ?: LOW

    fun fromWireValue(value: String): AiDetectionSensitivity =
      values().firstOrNull { it.wireValue == value.trim().lowercase() }
        ?: throw IllegalArgumentException("Unsupported AI detection sensitivity: $value")
  }
}

/**
 * User defaults for the native pre-print sheet.
 *
 * These are printer behaviours, not model/slice geometry, so they deliberately
 * live outside [HelixSliceSettings]. A 3MF may own its brim and supports, but it
 * must never decide whether the printer's failure monitoring is armed.
 */
object PreprocessPreferenceStore {
  private const val PREFS_NAME = "helix_preprocess_preferences"
  private const val KEY_AI_MONITORING = "ai_monitoring"
  private const val KEY_AI_SENSITIVITY = "ai_detection_sensitivity"

  internal fun aiMonitoringValue(saved: Boolean?): Boolean = saved ?: true

  fun aiMonitoringEnabled(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val saved = if (prefs.contains(KEY_AI_MONITORING)) {
      prefs.getBoolean(KEY_AI_MONITORING, true)
    } else {
      null
    }
    return aiMonitoringValue(saved)
  }

  fun setAiMonitoringEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_AI_MONITORING, enabled)
      .apply()
  }

  internal fun aiDetectionSensitivityValue(saved: String?): AiDetectionSensitivity =
    AiDetectionSensitivity.fromStoredValue(saved)

  fun aiDetectionSensitivity(context: Context): AiDetectionSensitivity {
    val saved = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_AI_SENSITIVITY, null)
    return aiDetectionSensitivityValue(saved)
  }

  fun setAiDetectionSensitivity(context: Context, sensitivity: AiDetectionSensitivity) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_AI_SENSITIVITY, sensitivity.wireValue)
      .apply()
  }
}
