import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ConnectionMode, PrinterEntry } from '../../hooks/useSettings';
import {
  normalizeMoonrakerUrl,
  validatePrinterConnectionTarget,
} from '../../services/moonraker';
import { t } from '../../services/i18n';
import { alpha } from '../dashboard/shared';
import PrinterIcon from '../PrinterIcon';
import TailscaleIcon from '../TailscaleIcon';
import { colors } from './cockpitTheme';

const CONNECTION_MODES: {
  value: ConnectionMode;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}[] = [
  { value: 'lan', label: 'LAN only', icon: 'wifi' },
  { value: 'auto', label: 'Auto', icon: 'swap-horizontal' },
  { value: 'tailscale', label: 'Tailscale only', icon: 'vpn' },
];

export default function PrinterEditorModal({
  printer,
  mode = 'edit',
  onClose,
  onSave,
}: {
  printer: PrinterEntry | null;
  mode?: 'add' | 'edit';
  onClose: () => void;
  onSave: (printer: PrinterEntry) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [tailscaleUrl, setTailscaleUrl] = useState('');
  const [cameraUrl, setCameraUrl] = useState('');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('lan');
  const [saving, setSaving] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!printer) return;
    setName(printer.name);
    setUrl(printer.url);
    setTailscaleUrl(printer.tailscaleUrl);
    setCameraUrl(printer.cameraUrl);
    setConnectionMode(printer.connectionMode);
    setValidationMessage(null);
  }, [printer]);

  if (!printer) return null;

  const save = async () => {
    const normalizedUrl = normalizeMoonrakerUrl(url);
    const normalizedTailscaleUrl = normalizeMoonrakerUrl(tailscaleUrl);
    const connectionError = validatePrinterConnectionTarget(
      connectionMode,
      normalizedUrl,
      normalizedTailscaleUrl
    );
    if (connectionError) {
      setValidationMessage(
        connectionError === 'missing-tailscale-url'
          ? t('Tailscale-only mode needs a Tailscale URL.')
          : t('Enter the printer IP or Moonraker URL.')
      );
      return;
    }

    setSaving(true);
    setValidationMessage(null);
    try {
      const saved = await onSave({
        ...printer,
        name: name.trim() || 'Snapmaker U1',
        url: normalizedUrl,
        tailscaleUrl: normalizedTailscaleUrl,
        cameraUrl: cameraUrl.trim() || '/webcam/webrtc',
        connectionMode,
      });
      if (saved) onClose();
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : t('Could not save this printer.')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={saving ? undefined : onClose}
        />
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <PrinterIcon size={26} />
          </View>
          <Text style={styles.modalTitle}>
            {mode === 'add' ? t('Add printer') : t('Edit printer')}
          </Text>
          {validationMessage ? (
            <Text style={styles.validationMessage}>{validationMessage}</Text>
          ) : null}
          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <Field
              label={t('Printer name')}
              value={name}
              onChange={setName}
              placeholder="Snapmaker U1"
              keyboardType="default"
              autoCapitalize="words"
            />
            <Field
              label={
                connectionMode === 'tailscale'
                  ? t('Printer URL (LAN, optional)')
                  : t('Printer URL (LAN)')
              }
              value={url}
              onChange={setUrl}
              placeholder={
                connectionMode === 'tailscale'
                  ? 'LAN URL optional'
                  : 'http://192.168.1.x:7125'
              }
            />
            <Field
              label={
                connectionMode === 'tailscale'
                  ? t('Printer URL (Tailscale)')
                  : t('Printer URL (Tailscale, optional)')
              }
              value={tailscaleUrl}
              onChange={setTailscaleUrl}
              placeholder="http://100.x.y.z:7125"
            />
            <Field
              label={t('Camera stream (path or full URL)')}
              value={cameraUrl}
              onChange={setCameraUrl}
              placeholder="/webcam/webrtc"
            />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('Connection mode')}</Text>
              <ConnectionModeSelector value={connectionMode} onChange={setConnectionMode} />
            </View>
            <Text style={styles.note}>
              {t(
                'LAN only never uses Tailscale. Tailscale only never falls back to Wi-Fi. Auto tries LAN, then Tailscale.'
              )}
            </Text>
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.secondaryAction} onPress={onClose} disabled={saving}>
              <Text style={styles.secondaryActionText}>{t('Cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryAction, saving && { opacity: 0.5 }]}
              onPress={() => void save()}
              disabled={saving}
            >
              <MaterialCommunityIcons
                name={mode === 'add' ? 'plus' : 'content-save-outline'}
                size={18}
                color="#fff"
              />
              <Text style={styles.primaryActionText}>
                {saving
                  ? t('Saving...')
                  : mode === 'add'
                    ? t('Add printer')
                    : t('Save printer')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ConnectionModeSelector({
  value,
  onChange,
}: {
  value: ConnectionMode;
  onChange: (mode: ConnectionMode) => void;
}) {
  return (
    <View style={styles.modeRow}>
      {CONNECTION_MODES.map((mode) => {
        const active = value === mode.value;
        return (
          <TouchableOpacity
            key={mode.value}
            style={[styles.modeBtn, active && styles.modeBtnOn]}
            onPress={() => onChange(mode.value)}
          >
            {mode.value === 'tailscale' ? (
              <TailscaleIcon size={17} color={active ? '#fff' : colors.text} />
            ) : (
              <MaterialCommunityIcons
                name={mode.icon}
                size={17}
                color={active ? '#fff' : colors.text}
              />
            )}
            <Text style={[styles.modeText, active && styles.modeTextOn]}>
              {t(mode.label)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType = 'url',
  autoCapitalize = 'none',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  autoCapitalize?: React.ComponentProps<typeof TextInput>['autoCapitalize'];
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.74)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '82%',
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    gap: 13,
    alignItems: 'center',
  },
  modalIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.primary, 0.12),
  },
  modalTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  validationMessage: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  modalContent: { gap: 13 },
  field: { gap: 4 },
  fieldLabel: { color: colors.subtext, fontSize: 12, fontWeight: '600' },
  fieldInput: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  modeRow: { flexDirection: 'row', gap: 8 },
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
  },
  modeBtnOn: { backgroundColor: colors.primary },
  modeText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  modeTextOn: { color: '#fff' },
  note: { color: colors.subtext, fontSize: 11, fontStyle: 'italic' },
  modalActions: { width: '100%', flexDirection: 'row', gap: 8 },
  secondaryAction: {
    flex: 1,
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  primaryAction: {
    flex: 1,
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryActionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
