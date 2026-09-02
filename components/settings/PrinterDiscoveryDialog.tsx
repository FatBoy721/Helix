import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import ThemedDialog from '../ThemedDialog';
import { alpha, COCKPIT as P } from '../dashboard/shared';
import {
  discoverPrinters,
  getSuggestedDiscoverySubnet,
  type DiscoveredPrinter,
  type PrinterDiscoveryProgress,
} from '../../services/printerDiscovery';
import { printerProfile } from '../../services/printerProfiles';
import type { PrinterEntry } from '../../services/settingsMigration';

interface Props {
  visible: boolean;
  existingPrinters: readonly PrinterEntry[];
  onClose: () => void;
  onSelect: (printer: DiscoveredPrinter) => void;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export default function PrinterDiscoveryDialog({
  visible,
  existingPrinters,
  onClose,
  onSelect,
}: Props) {
  const [subnet, setSubnet] = useState('');
  const [loadingSubnet, setLoadingSubnet] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<PrinterDiscoveryProgress | null>(null);
  const [results, setResults] = useState<DiscoveredPrinter[]>([]);
  const [error, setError] = useState('');
  const scanController = useRef<AbortController | null>(null);
  const subnetEditedByUser = useRef(false);
  const existingPrinterUrls = useMemo(
    () => existingPrinters.map((printer) => printer.url),
    [existingPrinters]
  );
  const existingHosts = useMemo(
    () => new Set(existingPrinterUrls.map(hostFromUrl).filter(Boolean)),
    [existingPrinterUrls]
  );

  useEffect(() => {
    if (!visible) {
      scanController.current?.abort();
      scanController.current = null;
      return;
    }

    subnetEditedByUser.current = false;
    setLoadingSubnet(true);
    setProgress(null);
    setResults([]);
    setError('');
    let disposed = false;
    getSuggestedDiscoverySubnet(existingPrinterUrls)
      .then((suggestedSubnet) => {
        if (!disposed && !subnetEditedByUser.current) setSubnet(suggestedSubnet);
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        if (!subnetEditedByUser.current) setSubnet('');
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!disposed) setLoadingSubnet(false);
      });

    return () => {
      disposed = true;
      scanController.current?.abort();
    };
  }, [existingPrinterUrls, visible]);

  const stopScan = () => {
    scanController.current?.abort();
    scanController.current = null;
    setScanning(false);
  };

  const close = () => {
    stopScan();
    onClose();
  };

  const startScan = async () => {
    scanController.current?.abort();
    const controller = new AbortController();
    scanController.current = controller;
    setScanning(true);
    setResults([]);
    setProgress(null);
    setError('');

    try {
      const discovered = await discoverPrinters(subnet, setProgress, controller.signal);
      if (!controller.signal.aborted) setResults(discovered);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (scanController.current === controller) {
        scanController.current = null;
        setScanning(false);
      }
    }
  };

  const progressRatio = progress && progress.total > 0 ? progress.scanned / progress.total : 0;
  const scanLabel = results.length > 0 || progress ? 'Scan again' : 'Scan network';

  return (
    <ThemedDialog
      visible={visible}
      title="Discover printers"
      message="Find printers connected to the same local network as this phone."
      icon="radar"
      onClose={close}
      actions={
        scanning
          ? [{ text: 'Stop scanning', icon: 'stop-circle-outline', onPress: stopScan }]
          : [
              {
                text: scanLabel,
                icon: 'radar',
                variant: 'primary',
                disabled: loadingSubnet || !subnet.trim(),
                onPress: () => void startScan(),
              },
              { text: 'Close', onPress: close },
            ]
      }
    >
      <View style={styles.content}>
        <Text style={styles.label}>Wi-Fi subnet</Text>
        <TextInput
          style={styles.input}
          value={subnet}
          onChangeText={(value) => {
            subnetEditedByUser.current = true;
            setSubnet(value);
          }}
          editable={!scanning}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          showSoftInputOnFocus
          selectionColor={P.accent}
          cursorColor={P.accent}
          accessibilityLabel="Wi-Fi subnet"
          placeholder={loadingSubnet ? 'Detecting network…' : '192.168.1.0/24'}
          placeholderTextColor={P.dim}
        />
        <Text style={styles.hint}>
          Helix scans only this private /24 network. Tailscale and internet addresses are not scanned.
        </Text>

        {progress ? (
          <View style={styles.progressBlock}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.round(progressRatio * 100)}%`, backgroundColor: P.accent },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {scanning ? 'Scanning' : 'Scanned'} {progress.scanned} of {progress.total} addresses
              {progress.found > 0 ? ` • ${progress.found} found` : ''}
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorRow}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={P.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!scanning && progress && !error && results.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="printer-search" size={28} color={P.dim} />
            <Text style={styles.emptyTitle}>No printers found</Text>
            <Text style={styles.emptyText}>
              Make sure the phone and printer are on the same Wi-Fi, then check the subnet and scan again.
            </Text>
          </View>
        ) : null}

        {results.map((printer) => {
          const alreadyAdded = existingHosts.has(printer.ip);
          return (
            <View key={printer.ip} style={styles.resultCard}>
              <View style={styles.resultHeading}>
                <View style={[styles.printerIcon, { backgroundColor: alpha(P.accent, 0.12) }]}>
                  <MaterialCommunityIcons name="printer-3d" size={22} color={P.accent} />
                </View>
                <View style={styles.resultIdentity}>
                  <Text style={styles.resultName} numberOfLines={1}>
                    {printer.name}
                  </Text>
                  <Text style={styles.resultAddress}>{printer.moonrakerUrl}</Text>
                </View>
              </View>
              <View style={styles.details}>
                <Text style={styles.detailText}>
                  {printer.machineType || printerProfile(printer.kind).label}
                  {printer.serial ? ` • ${printer.serial}` : ''}
                </Text>
                <View style={styles.cameraRow}>
                  <MaterialCommunityIcons
                    name={printer.cameraUrl ? 'camera-outline' : 'camera-off-outline'}
                    size={16}
                    color={printer.cameraUrl ? P.success : P.dim}
                  />
                  <Text style={styles.detailText}>
                    {printer.cameraUrl
                      ? `Print camera: ${printer.cameraName || 'detected'}`
                      : 'Print camera was not reported'}
                  </Text>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.addButton,
                  { backgroundColor: alreadyAdded ? P.surfaceAlt : P.accentFill },
                  pressed && !alreadyAdded && { opacity: 0.78 },
                ]}
                disabled={alreadyAdded}
                onPress={() => onSelect(printer)}
              >
                <MaterialCommunityIcons
                  name={alreadyAdded ? 'check' : 'plus'}
                  size={18}
                  color={alreadyAdded ? P.dim : P.onAccent}
                />
                <Text style={[styles.addButtonText, { color: alreadyAdded ? P.dim : P.onAccent }]}>
                  {alreadyAdded ? 'Already added' : 'Review & add'}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </ThemedDialog>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', marginTop: 22, gap: 10 },
  label: { color: P.text, fontSize: 13, fontWeight: '700' },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    color: P.text,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  hint: { color: P.dim, fontSize: 12, lineHeight: 18 },
  progressBlock: { gap: 7, marginTop: 4 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: P.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressText: { color: P.dim, fontSize: 12 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: alpha(P.danger, 0.12),
  },
  errorText: { flex: 1, color: P.danger, fontSize: 13, lineHeight: 18 },
  emptyState: { alignItems: 'center', gap: 7, paddingVertical: 18 },
  emptyTitle: { color: P.text, fontSize: 15, fontWeight: '700' },
  emptyText: { color: P.dim, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  resultCard: {
    marginTop: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    gap: 12,
  },
  resultHeading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  printerIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultIdentity: { flex: 1, gap: 2 },
  resultName: { color: P.text, fontSize: 15, fontWeight: '700' },
  resultAddress: { color: P.dim, fontSize: 12 },
  details: { gap: 5 },
  detailText: { color: P.dim, fontSize: 12, lineHeight: 17 },
  cameraRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addButton: {
    height: 44,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  addButtonText: { fontSize: 14, fontWeight: '800' },
});
