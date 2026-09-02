import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import type { PrinterKind } from '../../services/printerProfiles';
import {
  normalizeBaseUrl,
  normalizeMoonrakerUrl,
  validatePrinterConnectionTarget,
} from '../../services/moonraker';
import { t } from '../../services/i18n';
import { bambuConnectionFailureMessage } from '../../services/bambuConnection';
import { BambuError, probeBambuStatus } from '../../services/bambuMqtt';
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

// Discovery sets this automatically, but a printer typed in by hand has nothing
// to detect from — and the AD5X's Wi-Fi drops often enough that discovery
// regularly misses it, so picking the model manually has to be possible.
const PRINTER_KINDS: {
  value: PrinterKind;
  label: string;
  hint: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}[] = [
  {
    value: 'snapmaker-u1',
    label: 'Snapmaker U1',
    hint: '4 toolheads, ACE filament system',
    icon: 'printer-3d-nozzle',
  },
  {
    value: 'flashforge-ad5x',
    label: 'FlashForge AD5X',
    hint: 'Klipper mod, 4-slot material station',
    icon: 'printer-3d',
  },
  {
    value: 'bambu-lan',
    label: 'Bambu Lab',
    // The LAN protocol is the same across the range — A1, P1, X1, H2D — so
    // there is no reason to list models and get the list wrong.
    hint: 'Any Bambu in LAN Only Mode',
    icon: 'printer-3d',
  },
  {
    value: 'generic-klipper',
    label: 'Other Klipper printer',
    hint: 'Anything running Moonraker',
    icon: 'cog-outline',
  },
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
  const [kind, setKind] = useState<PrinterKind>('snapmaker-u1');
  const [kindOpen, setKindOpen] = useState(false);
  const [serialNumber, setSerialNumber] = useState('');
  const [checkCode, setCheckCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTest, setConnectionTest] = useState<{
    tone: 'pass' | 'fail';
    message: string;
  } | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!printer) return;
    setName(printer.name);
    setUrl(printer.url);
    setTailscaleUrl(printer.tailscaleUrl);
    setCameraUrl(printer.cameraUrl);
    setConnectionMode(printer.connectionMode);
    setKind(printer.kind);
    setSerialNumber(printer.serialNumber ?? '');
    setCheckCode(printer.checkCode ?? '');
    setConnectionTest(null);
    setValidationMessage(null);
    setKindOpen(false);
  }, [printer]);

  useEffect(() => {
    setConnectionTest(null);
  }, [url, serialNumber, checkCode, kind]);

  if (!printer) return null;

  const selectedKind = PRINTER_KINDS.find((option) => option.value === kind) ?? PRINTER_KINDS[0];
  const isAd5x = kind === 'flashforge-ad5x';
  // Bambu needs the same two fields, but as credentials rather than extras:
  // without them there is no connection at all, not just no filament data.
  const isBambu = kind === 'bambu-lan';
  const wantsCredentials = isAd5x || isBambu;

  const testBambuConnection = async () => {
    const normalizedUrl = normalizeBaseUrl(url);
    let host = '';
    try {
      host = new URL(normalizedUrl).hostname;
    } catch {
      // Validation below presents the same actionable message as a blank IP.
    }
    if (!host || !serialNumber.trim() || !checkCode.trim()) {
      setConnectionTest({
        tone: 'fail',
        message: t('Enter the printer IP, serial number, and LAN access code.'),
      });
      return;
    }

    setTestingConnection(true);
    setConnectionTest(null);
    setValidationMessage(null);
    try {
      await probeBambuStatus({
        host,
        serial: serialNumber.trim(),
        accessCode: checkCode.trim(),
      });
      setConnectionTest({
        tone: 'pass',
        message: t('Connected — the printer returned its live status.'),
      });
    } catch (error: unknown) {
      const reason = error instanceof BambuError ? error.reason : 'unknown';
      const fallback = error instanceof Error ? error.message : String(error);
      setConnectionTest({
        tone: 'fail',
        message: t(bambuConnectionFailureMessage(reason, fallback)),
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const save = async () => {
    // Bambu speaks MQTT on 8883, so tacking Moonraker's 7125 onto its address
    // would be a lie the connection screen then shows back to the user.
    const normalizedUrl = isBambu ? normalizeBaseUrl(url) : normalizeMoonrakerUrl(url);
    const normalizedTailscaleUrl = isBambu ? '' : normalizeMoonrakerUrl(tailscaleUrl);

    const effectiveConnectionMode: ConnectionMode = isBambu ? 'lan' : connectionMode;
    const connectionError = validatePrinterConnectionTarget(
      effectiveConnectionMode,
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

    // Unlike the AD5X, a Bambu cannot connect at all without these: the serial
    // is the MQTT topic and the certificate's identity, and the access code is
    // the password. Saving without them would produce a printer that silently
    // never connects.
    if (isBambu && (!serialNumber.trim() || !checkCode.trim())) {
      setValidationMessage(
        t('Bambu printers need both the serial number and the LAN access code.')
      );
      return;
    }

    const defaultName = isAd5x ? 'FlashForge AD5X' : isBambu ? 'Bambu Lab' : 'Snapmaker U1';

    setSaving(true);
    setValidationMessage(null);
    try {
      const saved = await onSave({
        ...printer,
        name: name.trim() || defaultName,
        url: normalizedUrl,
        tailscaleUrl: normalizedTailscaleUrl,
        // Bambu's camera is a per-session loopback URL the transport creates,
        // so there is no path to store here.
        cameraUrl: isBambu
          ? ''
          : cameraUrl.trim() || (isAd5x ? '/webcam/?action=stream' : '/webcam/webrtc'),
        connectionMode: effectiveConnectionMode,
        kind,
        serialNumber: wantsCredentials ? serialNumber.trim() : '',
        checkCode: wantsCredentials ? checkCode.trim() : '',
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
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('Printer model')}</Text>
              <TouchableOpacity
                style={styles.kindTrigger}
                onPress={() => setKindOpen((value) => !value)}
                accessibilityRole="button"
                accessibilityState={{ expanded: kindOpen }}
              >
                <MaterialCommunityIcons
                  name={selectedKind.icon}
                  size={18}
                  color={colors.subtext}
                />
                <Text style={styles.kindTriggerText} numberOfLines={1}>
                  {t(selectedKind.label)}
                </Text>
                <MaterialCommunityIcons
                  name={kindOpen ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.subtext}
                />
              </TouchableOpacity>
              {kindOpen ? (
                <View style={styles.kindList}>
                  {PRINTER_KINDS.map((option) => {
                    const active = option.value === kind;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[styles.kindRow, active && styles.kindRowOn]}
                        onPress={() => {
                          setKind(option.value);
                          setKindOpen(false);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={option.label}
                      >
                        <MaterialCommunityIcons
                          name={option.icon}
                          size={20}
                          color={active ? colors.primary : colors.subtext}
                        />
                        <View style={styles.kindLabels}>
                          <Text style={[styles.kindName, active && styles.kindNameOn]}>
                            {t(option.label)}
                          </Text>
                          <Text style={styles.kindHint}>{t(option.hint)}</Text>
                        </View>
                        <MaterialCommunityIcons
                          name={active ? 'radiobox-marked' : 'radiobox-blank'}
                          size={18}
                          color={active ? colors.primary : colors.border}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>
            <Field
              label={t('Name')}
              value={name}
              onChange={setName}
              placeholder={t('Printer name')}
              keyboardType="default"
              autoCapitalize="words"
            />
            <Field
              label={
                isBambu
                  ? t('Printer IP')
                  : connectionMode === 'tailscale'
                    ? t('Printer URL (LAN, optional)')
                    : t('Printer URL (LAN)')
              }
              value={url}
              onChange={setUrl}
              placeholder={
                isBambu
                  ? '192.168.1.x'
                  : connectionMode === 'tailscale'
                    ? 'LAN URL optional'
                    : 'http://192.168.1.x:7125'
              }
            />
            {/* Bambu's LAN MQTT protocol has no Helix Tailscale transport.
                Every Moonraker printer, including the AD5X, supports all
                three connection modes. */}
            {!isBambu ? (
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
            ) : null}
            {/* AD5X camera routing follows its LAN/Tailscale host automatically. */}
            {!wantsCredentials ? (
              <Field
                label={t('Camera stream (path or full URL)')}
                value={cameraUrl}
                onChange={setCameraUrl}
                placeholder="/webcam/webrtc"
              />
            ) : null}
            {wantsCredentials ? (
              <>
                <Field
                  label={t('Serial number')}
                  value={serialNumber}
                  onChange={setSerialNumber}
                  placeholder={isBambu ? t('Serial number') : 'SN...'}
                  autoCapitalize="characters"
                />
                <Field
                  label={isBambu ? t('LAN access code') : t('Printer ID (check code)')}
                  value={checkCode}
                  onChange={setCheckCode}
                  placeholder="8-character code"
                />
                <Text style={styles.note}>
                  {isBambu
                    ? t(
                        'Both are on the printer under Settings → Network, which must be in LAN Only Mode. The access code grants full control of the printer.'
                      )
                    : t(
                        'Needed only to read the filament slots. Both are on the printer under Settings → Network, which must have Network mode switched on.'
                      )}
                </Text>
                {isBambu ? (
                  <>
                    <TouchableOpacity
                      style={styles.testConnectionAction}
                      onPress={() => void testBambuConnection()}
                      disabled={testingConnection || saving}
                      accessibilityRole="button"
                      accessibilityLabel={t('Test connection')}
                    >
                      {testingConnection ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <MaterialCommunityIcons
                          name="lan-check"
                          size={18}
                          color={colors.primary}
                        />
                      )}
                      <Text style={styles.testConnectionText}>
                        {testingConnection ? t('Testing connection...') : t('Test connection')}
                      </Text>
                    </TouchableOpacity>
                    {connectionTest ? (
                      <View style={styles.connectionTestResult}>
                        <MaterialCommunityIcons
                          name={connectionTest.tone === 'pass' ? 'check-circle' : 'alert-circle'}
                          size={17}
                          color={connectionTest.tone === 'pass' ? colors.success : colors.danger}
                        />
                        <Text
                          style={[
                            styles.connectionTestText,
                            {
                              color:
                                connectionTest.tone === 'pass' ? colors.success : colors.danger,
                            },
                          ]}
                        >
                          {connectionTest.message}
                        </Text>
                      </View>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            {!isBambu ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>{t('Connection mode')}</Text>
                  <ConnectionModeSelector value={connectionMode} onChange={setConnectionMode} />
                </View>
                <Text style={styles.note}>
                  {t(
                    'LAN only never uses Tailscale. Tailscale only never falls back to Wi-Fi. Auto tries LAN, then Tailscale.'
                  )}
                </Text>
              </>
            ) : null}
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

// Compact chips: connection mode is a short, fixed set that fits one row.
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
  // Inline expanding picker, not a Modal popover: PrinterEditorModal is already
  // a Modal, and nesting a second Modal flickers/jumps on Android.
  kindTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  kindTriggerText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  kindList: { gap: 6, marginTop: 6 },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.text, 0.03),
  },
  kindRowOn: {
    borderColor: colors.primary,
    backgroundColor: alpha(colors.primary, 0.1),
  },
  kindLabels: { flex: 1, gap: 2 },
  kindName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  kindNameOn: { color: colors.primary },
  kindHint: { color: colors.subtext, fontSize: 11 },
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
  testConnectionAction: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: alpha(colors.primary, 0.45),
    backgroundColor: alpha(colors.primary, 0.08),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  testConnectionText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  connectionTestResult: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  connectionTestText: { flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 17 },
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
