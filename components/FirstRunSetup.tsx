import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { ConnectionMode, PrinterEntry, useSettings } from '../hooks/useSettings';
import { normalizeMoonrakerUrl, validatePrinterConnectionTarget } from '../services/moonraker';
import type { PrinterConnectionValidationError } from '../services/moonraker';
import { t } from '../services/i18n';

const CONNECTION_MODES: {
  value: ConnectionMode;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}[] = [
  { value: 'lan', label: 'LAN only', icon: 'wifi' },
  { value: 'auto', label: 'Auto', icon: 'swap-horizontal' },
  { value: 'tailscale', label: 'Tailscale only', icon: 'vpn' },
];

function connectionErrorMessage(error: PrinterConnectionValidationError | null): string {
  if (error === 'missing-tailscale-url') return 'Tailscale-only mode needs a Tailscale URL.';
  if (error === 'missing-printer-url') return 'Enter the printer IP or Moonraker URL.';
  return '';
}

export default function FirstRunSetup({ visible }: { visible: boolean }) {
  const { update } = useSettings();
  const [name, setName] = useState('Snapmaker U1');
  const [lanUrl, setLanUrl] = useState('');
  const [tailscaleUrl, setTailscaleUrl] = useState('');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('lan');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const normalizedLan = normalizeMoonrakerUrl(lanUrl);
    const normalizedTailscale = normalizeMoonrakerUrl(tailscaleUrl);
    const validationError = validatePrinterConnectionTarget(
      connectionMode,
      normalizedLan,
      normalizedTailscale
    );
    if (validationError) {
      setError(connectionErrorMessage(validationError));
      return;
    }

    setSaving(true);
    try {
      const entry: PrinterEntry = {
        id: `p${Date.now()}`,
        name: name.trim() || 'Snapmaker U1',
        url: normalizedLan,
        tailscaleUrl: normalizedTailscale,
        cameraUrl: '/webcam/webrtc',
        connectionMode,
      };

      await update({
        printers: [entry],
        activePrinterId: entry.id,
        primaryUrl: entry.url,
        tailscaleUrl: entry.tailscaleUrl,
        cameraUrl: entry.cameraUrl,
        connectionMode: entry.connectionMode,
      });
      setError('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Image source={require('../assets/icon.png')} style={styles.logo} />
          <Text style={styles.title}>{t('Welcome to Helix')}</Text>
          <Text style={styles.copy}>
            {t(
              'A mobile Fluidd-style controller for PAXX/Moonraker so you do not have to open the printer web UI every time.'
            )}
          </Text>

          <View style={styles.card}>
            <Field
              label={t('Printer name')}
              value={name}
              onChangeText={setName}
              placeholder="Snapmaker U1"
            />
            <Field
              label={
                connectionMode === 'tailscale'
                  ? t('Printer IP or Moonraker URL (optional)')
                  : t('Printer IP or Moonraker URL')
              }
              value={lanUrl}
              onChangeText={setLanUrl}
              placeholder={
                connectionMode === 'tailscale'
                  ? 'LAN URL optional'
                  : '192.168.1.x or http://192.168.1.x:7125'
              }
              keyboardType="url"
            />
            <Field
              label={
                connectionMode === 'tailscale'
                  ? t('Tailscale URL')
                  : t('Tailscale URL (optional)')
              }
              value={tailscaleUrl}
              onChangeText={setTailscaleUrl}
              placeholder="100.x.y.z or https://printer.tailnet.ts.net"
              keyboardType="url"
            />
            <Text style={styles.hint}>
              {t('Optional. Only add Tailscale if you already use it for remote access.')}
            </Text>

            <Text style={styles.fieldLabel}>{t('Connection mode')}</Text>
            <View style={styles.modeRow}>
              {CONNECTION_MODES.map((mode) => {
                const active = mode.value === connectionMode;
                return (
                  <TouchableOpacity
                    key={mode.value}
                    style={[styles.modeBtn, active && { backgroundColor: colors.primary }]}
                    onPress={() => setConnectionMode(mode.value)}
                  >
                    <MaterialCommunityIcons
                      name={mode.icon}
                      size={17}
                      color={active ? '#fff' : colors.text}
                    />
                    <Text style={[styles.modeText, active && { color: '#fff' }]}>
                      {t(mode.label)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.hint}>
              {t('Tailscale only never falls back to Wi-Fi. Auto tries LAN first.')}
            </Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[
                styles.saveBtn,
                { backgroundColor: colors.primary },
                saving && { opacity: 0.5 },
              ]}
              disabled={saving}
              onPress={save}
            >
              <MaterialCommunityIcons name="printer-3d" size={18} color="#fff" />
              <Text style={styles.saveText}>{saving ? t('Saving...') : t('Start using Helix')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'url';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  logo: {
    width: 104,
    height: 104,
    borderRadius: 24,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  copy: {
    color: colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  field: {
    gap: 5,
  },
  fieldLabel: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  hint: {
    color: colors.subtext,
    fontSize: 11,
    lineHeight: 16,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: spacing.sm,
  },
  modeText: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  saveBtn: {
    minHeight: 48,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  saveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});
