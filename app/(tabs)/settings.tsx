import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ConnectionMode,
  DashboardSections,
  PrinterEntry,
  Settings,
  useSettings,
} from '../../hooks/useSettings';
import { useMoonraker } from '../../hooks/useMoonraker';
import AboutCard from '../../components/settings/AboutCard';
import MacroDisplayCard from '../../components/settings/MacroDisplayCard';
import ThemedDialog from '../../components/ThemedDialog';
import { buildSettingsSavePatch, hasDraftChanges } from '../../services/settingsDraft';
import { generateNtfyTopic, notifyLocal, sendNtfy } from '../../services/notifications';
import { LANGUAGES, t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';
import {
  api,
  normalizeBaseUrl,
  normalizeMoonrakerUrl,
  printerConnectionUrl,
  restartMoonraker,
  uploadConfigFile,
  validatePrinterConnectionTarget,
} from '../../services/moonraker';
import type { PrinterConnectionValidationError } from '../../services/moonraker';

const ACCENTS = [
  { name: 'Fluidd Blue', hex: '#2196f3' },
  { name: 'Teal', hex: '#00bfa5' },
  { name: 'Green', hex: '#4caf50' },
  { name: 'Amber', hex: '#ffb300' },
  { name: 'Orange', hex: '#ff7043' },
  { name: 'Red', hex: '#ef5350' },
  { name: 'Pink', hex: '#ec407a' },
  { name: 'Purple', hex: '#ab47bc' },
];

const SECTION_LABELS: { key: keyof DashboardSections; label: string }[] = [
  { key: 'progress', label: 'Progress' },
  { key: 'actions', label: 'Quick actions' },
  { key: 'estop', label: 'Emergency stop' },
  { key: 'homeDock', label: 'Home & Dock' },
  { key: 'controls', label: 'Controls' },
  { key: 'pandaBreath', label: 'Panda Breath controls' },
  { key: 'temps', label: 'Temperatures' },
  { key: 'camera', label: 'Camera' },
  { key: 'macros', label: 'Macros' },
];

const NOTIFICATION_MODES: {
  value: Settings['notificationMode'];
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}[] = [
  { value: 'off', label: 'Off', icon: 'bell-off-outline' },
  { value: 'local', label: 'Local only', icon: 'cellphone' },
  { value: 'ntfy', label: 'ntfy', icon: 'broadcast' },
];

const CONNECTION_MODES: {
  value: ConnectionMode;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}[] = [
  { value: 'lan', label: 'LAN only', icon: 'wifi' },
  { value: 'auto', label: 'Auto', icon: 'swap-horizontal' },
  { value: 'tailscale', label: 'Tailscale only', icon: 'vpn' },
];

function alertPrinterConnectionError(error: PrinterConnectionValidationError | null): boolean {
  if (!error) return false;

  if (error === 'missing-tailscale-url') {
    Alert.alert(t('Missing Tailscale URL'), t('Tailscale-only mode needs a Tailscale URL.'));
    return true;
  }

  Alert.alert(t('Missing printer URL'), t('Enter the printer IP or Moonraker URL.'));
  return true;
}

export default function SettingsScreen() {
  const { settings, loaded, update } = useSettings();
  const { connection, activeUrl, klippyState, reconnect } = useMoonraker();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [addingPrinter, setAddingPrinter] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newTailscaleUrl, setNewTailscaleUrl] = useState('');
  const [newConnectionMode, setNewConnectionMode] = useState<ConnectionMode>('lan');
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    setDraft((current) => current ?? settings);
  }, [loaded, settings]);

  if (!draft) return <View style={styles.screen} />;

  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });
  const editingPrinter = editingPrinterId
    ? draft.printers.find((p) => p.id === editingPrinterId) ?? null
    : null;
  const activePrinterForDisplay =
    draft.printers.find((p) => p.id === draft.activePrinterId) ?? null;
  const visibleActiveUrl =
    activeUrl || (activePrinterForDisplay ? printerConnectionUrl(activePrinterForDisplay) : '');

  const dirty = hasDraftChanges(draft, settings);

  // theme + language apply instantly, no Save needed
  // crabcore
  const setLive = (patch: Partial<Settings>) => {
    setDraft({ ...draft, ...patch });
    update(patch);
  };

  const save = async () => {
    const primaryUrl = normalizeMoonrakerUrl(draft.primaryUrl);
    const tailscaleUrl = normalizeMoonrakerUrl(draft.tailscaleUrl);
    const patch = buildSettingsSavePatch(draft, settings, { primaryUrl, tailscaleUrl });
    setDraft({ ...draft, ...patch });
    await update(patch);
    setSaveDialogOpen(true);
  };

  const switchPrinter = (p: PrinterEntry) => {
    setDraft({
      ...draft,
      activePrinterId: p.id,
      primaryUrl: p.url,
      tailscaleUrl: p.tailscaleUrl,
      cameraUrl: p.cameraUrl,
      connectionMode: p.connectionMode,
    });
    update({
      activePrinterId: p.id,
      primaryUrl: p.url,
      tailscaleUrl: p.tailscaleUrl,
      cameraUrl: p.cameraUrl,
      connectionMode: p.connectionMode,
    });
  };

  const removePrinter = (p: PrinterEntry) => {
    if (settings.printers.length <= 1) return;
    Alert.alert(t('Remove printer?'), p.name, [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Remove'),
        style: 'destructive',
        onPress: () => {
          const printers = settings.printers.filter((x) => x.id !== p.id);
          const macroDisplayByPrinter = { ...settings.macroDisplayByPrinter };
          delete macroDisplayByPrinter[p.id];
          const patch: Partial<Settings> = { printers, macroDisplayByPrinter };
          const nextDraft: Settings = { ...draft, printers, macroDisplayByPrinter };
          if (settings.activePrinterId === p.id) {
            const next = printers[0];
            patch.activePrinterId = next.id;
            patch.primaryUrl = next.url;
            patch.tailscaleUrl = next.tailscaleUrl;
            patch.cameraUrl = next.cameraUrl;
            patch.connectionMode = next.connectionMode;
            nextDraft.activePrinterId = next.id;
            nextDraft.primaryUrl = next.url;
            nextDraft.tailscaleUrl = next.tailscaleUrl;
            nextDraft.cameraUrl = next.cameraUrl;
            nextDraft.connectionMode = next.connectionMode;
          }
          setDraft(nextDraft);
          update(patch);
        },
      },
    ]);
  };

  const saveEditedPrinter = async (printer: PrinterEntry): Promise<boolean> => {
    const entry: PrinterEntry = {
      ...printer,
      name: printer.name.trim() || 'Snapmaker U1',
      url: normalizeMoonrakerUrl(printer.url),
      tailscaleUrl: normalizeMoonrakerUrl(printer.tailscaleUrl),
      cameraUrl: printer.cameraUrl.trim() || '/webcam/webrtc',
    };

    if (alertPrinterConnectionError(
      validatePrinterConnectionTarget(entry.connectionMode, entry.url, entry.tailscaleUrl)
    )) {
      return false;
    }

    const printers = draft.printers.map((p) => (p.id === entry.id ? entry : p));
    const patch: Partial<Settings> = { printers };
    const nextDraft: Settings = { ...draft, printers };

    if (draft.activePrinterId === entry.id) {
      patch.primaryUrl = entry.url;
      patch.tailscaleUrl = entry.tailscaleUrl;
      patch.cameraUrl = entry.cameraUrl;
      patch.connectionMode = entry.connectionMode;
      nextDraft.primaryUrl = entry.url;
      nextDraft.tailscaleUrl = entry.tailscaleUrl;
      nextDraft.cameraUrl = entry.cameraUrl;
      nextDraft.connectionMode = entry.connectionMode;
    }

    setDraft(nextDraft);
    await update(patch);
    setEditingPrinterId(null);
    return true;
  };

  const setNotificationMode = (mode: Settings['notificationMode']) => {
    const patch: Partial<Settings> = { notificationMode: mode };
    if (mode === 'ntfy') {
      patch.ntfyServer = draft.ntfyServer.trim() || 'https://ntfy.sh';
      if (!draft.ntfyTopic.trim()) patch.ntfyTopic = generateNtfyTopic();
    }
    set(patch);
  };

  const randomizeNtfyTopic = () => set({ ntfyTopic: generateNtfyTopic() });

  const updateDashboardSection = (key: keyof DashboardSections, value: boolean) => {
    update({
      dashboard: {
        ...settings.dashboard,
        controls: key === 'pandaBreath' && value ? true : settings.dashboard.controls,
        [key]: value,
      },
    });
  };

  const testNotifications = async () => {
    if (draft.notificationMode === 'off') {
      Alert.alert('Notifications off', 'Choose Local only or ntfy first.');
      return;
    }

    if (draft.notificationMode === 'ntfy') {
      const topic = draft.ntfyTopic.trim() || generateNtfyTopic();
      const server = draft.ntfyServer.trim() || 'https://ntfy.sh';
      const patch: Partial<Settings> = {};
      if (topic !== draft.ntfyTopic.trim()) patch.ntfyTopic = topic;
      if (server !== draft.ntfyServer.trim()) patch.ntfyServer = server;
      if (Object.keys(patch).length) set(patch);

      const ok = await sendNtfy(
        server,
        topic,
        'Helix test',
        'Printer alerts are working.',
        3,
        'printer'
      );
      Alert.alert(ok ? 'Sent' : 'Failed', ok ? 'Check ntfy.' : 'Check server URL and topic.');
      return;
    }

    const ok = await notifyLocal('Helix test', 'Local printer alerts are working.');
    Alert.alert(ok ? 'Sent' : 'Failed', ok ? 'Local notification works.' : 'Check notification permission.');
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Connection')}</Text>
          <Text style={styles.connInfo}>
            {connection.toUpperCase()} — {visibleActiveUrl || 'no URL'} (klippy: {klippyState})
          </Text>
          <TouchableOpacity style={styles.smallBtn} onPress={reconnect}>
            <Text style={styles.smallBtnText}>{t('Reconnect now')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Printers')}</Text>
          {settings.printers.map((p) => (
            <View key={p.id} style={styles.printerRow}>
              <TouchableOpacity style={styles.printerMain} onPress={() => switchPrinter(p)}>
                <MaterialCommunityIcons
                  name={
                    p.id === settings.activePrinterId ? 'radiobox-marked' : 'radiobox-blank'
                  }
                  size={18}
                  color={p.id === settings.activePrinterId ? colors.primary : colors.subtext}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.printerName}>{p.name}</Text>
                  <Text style={styles.printerUrl} numberOfLines={1}>
                    {printerConnectionUrl(p) || t('No URL set')}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.printerIconBtn}
                onPress={() => setEditingPrinterId(p.id)}
                accessibilityLabel={`Edit ${p.name}`}
              >
                <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.subtext} />
              </TouchableOpacity>
              {settings.printers.length > 1 && (
                <TouchableOpacity style={styles.printerIconBtn} onPress={() => removePrinter(p)}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.subtext} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          {addingPrinter ? (
            <View style={styles.addForm}>
              <TextInput
                style={styles.fieldInput}
                value={newName}
                onChangeText={setNewName}
                placeholder={t('Name')}
                placeholderTextColor={colors.subtext}
              />
              <TextInput
                style={styles.fieldInput}
                value={newUrl}
                onChangeText={setNewUrl}
                placeholder={
                  newConnectionMode === 'tailscale'
                    ? 'LAN URL optional'
                    : 'http://192.168.1.x:7125'
                }
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                keyboardType="url"
              />
              <TextInput
                style={styles.fieldInput}
                value={newTailscaleUrl}
                onChangeText={setNewTailscaleUrl}
                placeholder={
                  newConnectionMode === 'tailscale'
                    ? 'http://100.x.y.z:7125'
                    : 'Tailscale URL optional'
                }
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                keyboardType="url"
              />
              <ConnectionModeSelector value={newConnectionMode} onChange={setNewConnectionMode} />
              <TouchableOpacity
                style={[styles.smallBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  const url = normalizeMoonrakerUrl(newUrl);
                  const tailscaleUrl = normalizeMoonrakerUrl(newTailscaleUrl);
                  if (alertPrinterConnectionError(
                    validatePrinterConnectionTarget(newConnectionMode, url, tailscaleUrl)
                  )) {
                    return;
                  }
                  const entry: PrinterEntry = {
                    id: `p${Date.now()}`,
                    name: newName.trim() || `Snapmaker ${settings.printers.length + 1}`,
                    url,
                    tailscaleUrl,
                    cameraUrl: '/webcam/webrtc',
                    connectionMode: newConnectionMode,
                  };
                  const printers = [...settings.printers, entry];
                  update({
                    printers,
                    activePrinterId: entry.id,
                    primaryUrl: entry.url,
                    tailscaleUrl: entry.tailscaleUrl,
                    cameraUrl: entry.cameraUrl,
                    connectionMode: entry.connectionMode,
                  });
                  setDraft({
                    ...draft,
                    printers,
                    activePrinterId: entry.id,
                    primaryUrl: entry.url,
                    tailscaleUrl: entry.tailscaleUrl,
                    cameraUrl: entry.cameraUrl,
                    connectionMode: entry.connectionMode,
                  });
                  setNewName('');
                  setNewUrl('');
                  setNewTailscaleUrl('');
                  setNewConnectionMode('lan');
                  setAddingPrinter(false);
                }}
              >
                <Text style={[styles.smallBtnText, { color: '#fff' }]}>{t('Add printer')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.smallBtn} onPress={() => setAddingPrinter(true)}>
              <Text style={styles.smallBtnText}>+ {t('Add printer')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <PrinterEditorModal
          printer={editingPrinter}
          onClose={() => setEditingPrinterId(null)}
          onSave={saveEditedPrinter}
        />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Dashboard sections')}</Text>
          <View style={styles.sectionGrid}>
            {SECTION_LABELS.map(({ key, label }) => (
              <DashboardSectionTile
                key={key}
                label={t(label)}
                value={settings.dashboard[key]}
                onChange={(v) => updateDashboardSection(key, v)}
              />
            ))}
          </View>
        </View>

        <MacroDisplayCard />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Theme')}</Text>
          <Text style={styles.fieldLabel}>{t('Accent color')}</Text>
          <View style={styles.swatchRow}>
            {ACCENTS.map((a) => (
              <TouchableOpacity
                key={a.hex}
                style={[
                  styles.swatch,
                  { backgroundColor: a.hex },
                  draft.accentColor === a.hex && styles.swatchActive,
                ]}
                onPress={() => setLive({ accentColor: a.hex })}
              >
                {draft.accentColor === a.hex && (
                  <MaterialCommunityIcons name="check" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>{t('Language')}</Text>
          <View style={styles.langRow}>
            {LANGUAGES.map((l) => (
              <TouchableOpacity
                key={l.code}
                style={[
                  styles.langChip,
                  draft.language === l.code && { backgroundColor: colors.primary },
                ]}
                onPress={() => setLive({ language: l.code })}
              >
                <Text
                  style={[styles.langText, draft.language === l.code && { color: '#fff' }]}
                >
                  {l.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>{t('Temperature units')}</Text>
          <View style={styles.modeRow}>
            {(['c', 'f'] as const).map((unit) => {
              const active = draft.temperatureUnit === unit;
              return (
                <TouchableOpacity
                  key={unit}
                  style={[styles.modeBtn, active && { backgroundColor: colors.primary }]}
                  onPress={() => setLive({ temperatureUnit: unit })}
                >
                  <Text style={[styles.modeText, active && { color: '#fff' }]}>
                    {unit === 'c' ? '\u00B0C' : '\u00B0F'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <SpoolmanCard activeUrl={activeUrl} />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('ACE units')}</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => set({ aceUnits: Math.max(1, draft.aceUnits - 1) })}
            >
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepValue}>{draft.aceUnits}</Text>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => set({ aceUnits: Math.min(4, draft.aceUnits + 1) })}
            >
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Notifications')}</Text>
          <View style={styles.modeRow}>
            {NOTIFICATION_MODES.map((mode) => {
              const active = draft.notificationMode === mode.value;
              return (
                <TouchableOpacity
                  key={mode.value}
                  style={[styles.modeBtn, active && { backgroundColor: colors.primary }]}
                  onPress={() => setNotificationMode(mode.value)}
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

          {draft.notificationMode === 'ntfy' && (
            <View style={styles.ntfyFields}>
              <Text style={styles.fieldLabel}>ntfy server</Text>
              <TextInput
                style={styles.fieldInput}
                value={draft.ntfyServer}
                onChangeText={(v) => set({ ntfyServer: v })}
                placeholder="https://ntfy.sh"
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Text style={styles.fieldLabel}>ntfy topic</Text>
              <View style={styles.topicRow}>
                <TextInput
                  style={[styles.fieldInput, styles.topicInput]}
                  value={draft.ntfyTopic}
                  onChangeText={(v) => set({ ntfyTopic: v })}
                  placeholder="helix-random-topic"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.iconBtn} onPress={randomizeNtfyTopic}>
                  <MaterialCommunityIcons name="dice-5-outline" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.divider} />
          <Text style={styles.cardTitle}>{t('Notify on')}</Text>
          <Toggle
            label={t('Print complete')}
            value={draft.notifyPrintComplete}
            onChange={(v) => set({ notifyPrintComplete: v })}
          />
          <Toggle
            label={t('Print failed')}
            value={draft.notifyPrintFailed}
            onChange={(v) => set({ notifyPrintFailed: v })}
          />
          <Toggle
            label={t('Print paused')}
            value={draft.notifyPrintPaused}
            onChange={(v) => set({ notifyPrintPaused: v })}
          />
          <Toggle
            label={t('Filament runout')}
            value={draft.notifyFilamentRunout}
            onChange={(v) => set({ notifyFilamentRunout: v })}
          />
          <Toggle
            label={t('Filament swap complete')}
            value={draft.notifySwapComplete}
            onChange={(v) => set({ notifySwapComplete: v })}
          />
          <Toggle
            label={t('Printer error')}
            value={draft.notifyPrinterError}
            onChange={(v) => set({ notifyPrinterError: v })}
          />
          <Toggle
            label={t('Printer disconnected')}
            value={draft.notifyPrinterDisconnected}
            onChange={(v) => set({ notifyPrinterDisconnected: v })}
          />
          <Toggle
            label={t('Temperature warning')}
            value={draft.notifyTempWarning}
            onChange={(v) => set({ notifyTempWarning: v })}
          />
          <TouchableOpacity style={styles.smallBtn} onPress={testNotifications}>
            <Text style={styles.smallBtnText}>{t('Send test notification')}</Text>
          </TouchableOpacity>
        </View>

        {dirty && (
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
            onPress={save}
          >
            <Text style={styles.saveText}>{t('Save & Apply')}</Text>
          </TouchableOpacity>
        )}

        <AboutCard />
      </ScrollView>
      <ThemedDialog
        visible={saveDialogOpen}
        placement="center"
        title={t('Saved')}
        message={t('Settings applied. Connection will use the new URLs.')}
        icon="check-circle-outline"
        onClose={() => setSaveDialogOpen(false)}
        actions={[
          {
            text: t('OK'),
            icon: 'check',
            variant: 'primary',
            onPress: () => setSaveDialogOpen(false),
          },
        ]}
      />
    </KeyboardAvoidingView>
  );
}

// shows the Spoolman server the PRINTER is configured with (it lives in
// moonraker.conf, not in app settings) and lets you set/change it without
// touching the printer — same upload+restart flow as the Spoolman tab.
function SpoolmanCard({ activeUrl }: { activeUrl: string }) {
  const { settings } = useSettings();
  const [current, setCurrent] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  // spoolman config lives per-printer (in each moonraker.conf); in a farm you
  // point every printer at the SAME spoolman server so they share inventory,
  // but each printer tracks its own active spool. this card always acts on
  // whichever printer is currently selected.
  const activePrinter = settings.printers.find((p) => p.id === settings.activePrinterId);

  useEffect(() => {
    if (!activeUrl) return;
    api
      .serverConfig(activeUrl)
      .then((c) => {
        setCurrent(c?.config?.spoolman?.server ?? null);
      })
      .catch(() => setCurrent(null))
      .finally(() => setChecked(true));
  }, [activeUrl]);

  const apply = async () => {
    const server = normalizeBaseUrl(input);
    if (!server) return;
    setBusy(true);
    try {
      await uploadConfigFile(
        activeUrl,
        'extended/moonraker',
        'spoolman.cfg',
        `# Spoolman filament tracking (written by Helix)\n[spoolman]\nserver: ${server}\nsync_rate: 5\n`
      );
      await restartMoonraker(activeUrl);
      await new Promise((r) => setTimeout(r, 8000));
      setCurrent(server);
      Alert.alert(t('Saved'), t('Printer now reports filament usage to this Spoolman server.'));
    } catch (e: unknown) {
      Alert.alert(t('Error'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        Spoolman{activePrinter && settings.printers.length > 1 ? ` — ${activePrinter.name}` : ''}
      </Text>
      <Text style={styles.connInfo}>
        {!checked
          ? '…'
          : current
            ? `${t('Connected to')} ${current}`
            : t('Not configured on this printer')}
      </Text>
      <Field
        label={t('Spoolman server URL')}
        value={input}
        onChange={setInput}
        placeholder="http://192.168.1.x:7912"
      />
      <TouchableOpacity
        style={[
          styles.smallBtn,
          { backgroundColor: colors.primary },
          (busy || !input.trim()) && { opacity: 0.5 },
        ]}
        disabled={busy || !input.trim()}
        onPress={apply}
      >
        <Text style={[styles.smallBtnText, { color: '#fff' }]}>
          {busy ? t('Configuring…') : t('Apply to printer')}
        </Text>
      </TouchableOpacity>
      <Text style={styles.note}>
        {t('The Spoolman address is stored on the printer itself, so every device using it stays in sync.')}
      </Text>
    </View>
  );
}

function PrinterEditorModal({
  printer,
  onClose,
  onSave,
}: {
  printer: PrinterEntry | null;
  onClose: () => void;
  onSave: (printer: PrinterEntry) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [tailscaleUrl, setTailscaleUrl] = useState('');
  const [cameraUrl, setCameraUrl] = useState('');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('lan');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!printer) return;
    setName(printer.name);
    setUrl(printer.url);
    setTailscaleUrl(printer.tailscaleUrl);
    setCameraUrl(printer.cameraUrl);
    setConnectionMode(printer.connectionMode);
  }, [printer]);

  if (!printer) return null;

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        ...printer,
        name,
        url,
        tailscaleUrl,
        cameraUrl,
        connectionMode,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleRow}>
              <View style={styles.modalIcon}>
                <MaterialCommunityIcons name="printer-3d" size={20} color={colors.primary} />
              </View>
              <Text style={styles.modalTitle}>{t('Edit printer')}</Text>
            </View>
            <TouchableOpacity style={styles.printerIconBtn} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color={colors.subtext} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
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
              LAN only never uses Tailscale. Tailscale only never falls back to Wi-Fi. Auto tries
              LAN, then Tailscale.
            </Text>
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.secondaryAction} onPress={onClose} disabled={saving}>
              <Text style={styles.secondaryActionText}>{t('Cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryAction, saving && { opacity: 0.5 }]}
              onPress={save}
              disabled={saving}
            >
              <MaterialCommunityIcons name="content-save-outline" size={17} color="#fff" />
              <Text style={styles.primaryActionText}>
                {saving ? t('Saving...') : t('Save printer')}
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
            style={[styles.modeBtn, active && { backgroundColor: colors.primary }]}
            onPress={() => onChange(mode.value)}
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
  );
}

function DashboardSectionTile({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.sectionTile}
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <Text style={styles.sectionTileText} numberOfLines={2}>
        {label}
      </Text>
      <View pointerEvents="none" style={styles.sectionSwitchWrap}>
        <Switch
          value={value}
          trackColor={{ false: colors.card, true: colors.primary }}
          thumbColor="#fff"
        />
      </View>
    </TouchableOpacity>
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
  onChange: (v: string) => void;
  placeholder?: string;
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

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.cardAlt, true: colors.primary }}
        thumbColor="#fff"
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
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  connInfo: {
    color: colors.subtext,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
  },
  fieldInput: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  note: {
    color: colors.subtext,
    fontSize: 11,
    fontStyle: 'italic',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  stepBtn: {
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  stepValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    minWidth: 24,
    textAlign: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  toggleLabel: {
    color: colors.text,
    fontSize: 14,
  },
  smallBtn: {
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  smallBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  printerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  printerMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  printerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  printerUrl: {
    color: colors.subtext,
    fontSize: 11,
  },
  printerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addForm: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sectionTile: {
    width: '48%',
    minHeight: 64,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    padding: spacing.sm,
  },
  sectionTileText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    minHeight: 30,
  },
  sectionSwitchWrap: {
    alignSelf: 'flex-start',
    marginTop: 'auto',
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchActive: {
    borderWidth: 2,
    borderColor: '#fff',
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  langChip: {
    backgroundColor: colors.cardAlt,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  langText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
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
  },
  modeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  ntfyFields: {
    gap: 6,
    marginTop: spacing.md,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  topicInput: {
    flex: 1,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  saveBtn: {
    borderRadius: 10,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  saveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '88%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  modalTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  modalContent: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  primaryAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
});
