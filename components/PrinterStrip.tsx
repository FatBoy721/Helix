import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, normalizeMoonrakerUrl } from '../services/moonraker';
import type { PrinterEntry } from '../hooks/useSettings';
import { colors, spacing } from '../constants/theme';

interface Props {
  printers: PrinterEntry[];
  activeId: string;
  // live values for the active printer (from the websocket, no need to poll it)
  activeState: string;
  activeProgress: number;
  onSwitch: (p: PrinterEntry) => void;
}

interface PolledStatus {
  state: string;
  progress: number;
}

function dotColor(state: string): string {
  switch (state) {
    case 'printing': return colors.primary;
    case 'paused': return colors.warning;
    case 'error': return colors.danger;
    case 'complete': return colors.success;
    case 'offline': return colors.border;
    default: return colors.subtext;
  }
}

// non-active printers get a light REST poll every 15s — cheap enough, and a
// second websocket per printer would be overkill for a status chip
export default function PrinterStrip({
  printers,
  activeId,
  activeState,
  activeProgress,
  onSwitch,
}: Props) {
  const [polled, setPolled] = useState<Record<string, PolledStatus>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let live = true;
    const poll = async () => {
      const others = printers.filter((p) => p.id !== activeId);
      for (const p of others) {
        try {
          const res: any = await api.queryObjects(normalizeMoonrakerUrl(p.url), [
            'print_stats',
            'display_status',
          ]);
          if (!live) return;
          setPolled((prev) => ({
            ...prev,
            [p.id]: {
              state: res?.status?.print_stats?.state ?? 'unknown',
              progress: res?.status?.display_status?.progress ?? 0,
            },
          }));
        } catch {
          if (!live) return;
          setPolled((prev) => ({ ...prev, [p.id]: { state: 'offline', progress: 0 } }));
        }
      }
    };
    poll();
    timerRef.current = setInterval(poll, 15000);
    return () => {
      live = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [printers, activeId]);

  if (printers.length < 2) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
      {printers.map((p) => {
        const isActive = p.id === activeId;
        const st = isActive
          ? { state: activeState, progress: activeProgress }
          : polled[p.id] ?? { state: 'unknown', progress: 0 };
        return (
          <TouchableOpacity
            key={p.id}
            style={[styles.chip, isActive && { borderColor: colors.primary }]}
            onPress={() => !isActive && onSwitch(p)}
          >
            <View style={[styles.dot, { backgroundColor: dotColor(st.state) }]} />
            <Text style={[styles.name, isActive && { color: colors.text }]} numberOfLines={1}>
              {p.name}
            </Text>
            {st.state === 'printing' && (
              <Text style={styles.pct}>{Math.round(st.progress * 100)}%</Text>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexGrow: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  name: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 120,
  },
  pct: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
});
