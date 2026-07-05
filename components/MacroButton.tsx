import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, spacing } from '../constants/theme';

interface Props {
  name: string;
  onPress: () => void;
  disabled?: boolean;
  cooldownMs?: number;
}

export default function MacroButton({ name, onPress, disabled, cooldownMs = 3000 }: Props) {
  // fat-finger protection: lock the button for a few seconds after a tap.
  // ask me how many times I double-ran BED_MESH_CALIBRATE before this.
  // crabcore
  const [coolingDown, setCoolingDown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handlePress = () => {
    if (coolingDown) return;
    setCoolingDown(true);
    timerRef.current = setTimeout(() => setCoolingDown(false), cooldownMs);
    onPress();
  };

  return (
    <TouchableOpacity
      style={[styles.button, (disabled || coolingDown) && styles.disabled]}
      onPress={handlePress}
      disabled={disabled || coolingDown}
      activeOpacity={0.7}
    >
      <Text style={styles.text} numberOfLines={2}>
        {name.replace(/_/g, ' ')}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    width: '48.5%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  text: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
