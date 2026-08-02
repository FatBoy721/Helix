import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  DashboardSections,
  PrinterEntry,
  Settings,
  useSettings,
} from '../../hooks/useSettings';
import { useMoonraker } from '../../hooks/useMoonraker';
import AboutCard from '../../components/settings/AboutCard';
import BackupCard from '../../components/settings/BackupCard';
import MacroDisplayCard from '../../components/settings/MacroDisplayCard';
import PrinterEditorModal from '../../components/settings/PrinterEditorModal';
import ThemedDialog from '../../components/ThemedDialog';
import { buildSettingsSavePatch, hasDraftChanges } from '../../services/settingsDraft';
import {
  clearStoredFcmDeviceToken,
  configureFcmForPrinter,
  generateNtfyTopic,
  notifyLocal,
  registerFcmDeviceToken,
  sendFcmTestNotification,
  sendNtfy,
} from '../../services/notifications';
import { LANGUAGES, t } from '../../services/i18n';
import { colors, spacing } from '../../components/settings/cockpitTheme';
import { useThemedAlert } from '../../hooks/useThemedAlert';
import { COCKPIT, type IconName } from '../../components/dashboard/shared';
import {
  AttentionPanel,
  IndexRow,
  ScreenTitle,
  SectionHeader,
  type Commit,
} from '../../components/settings/nova';
import {
  api,
  applyConfigIfChanged,
  isTailscaleUrl,
  normalizeBaseUrl,
  normalizeMoonrakerUrl,
  printerConnectionUrl,
} from '../../services/moonraker';
import { getMakerWorldCookies } from '../../services/nativeSlicer';

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

// Only sections the redesigned dashboard actually renders. The old UI had
// actions / homeDock / controls panels; they were deleted in the ui-refresh
// redesign, so their toggles gated nothing — keeping them here just confused
// the "X of N shown" count and made live toggles look broken. Panda Breath is
// rebuilt as its own section, so it stays.
const SECTION_LABELS: { key: keyof DashboardSections; label: string }[] = [
  { key: 'progress', label: 'Progress' },
  { key: 'estop', label: 'Emergency stop' },
  { key: 'temps', label: 'Temperatures' },
  { key: 'camera', label: 'Camera' },
  { key: 'gui', label: 'GUI screen' },
  { key: 'filaments', label: 'Filaments' },
  { key: 'pandaBreath', label: 'Panda Breath' },
  { key: 'macros', label: 'Macros' },
];

// The notify-on toggles, in display order. Used both to render the list and to
// work out whether Notifications is holding unapplied changes.
const NOTIFY_KEYS = [
  'notifyPrintComplete',
  'notifyPrintFailed',
  'notifyPrintPaused',
  'notifyPrintCancelled',
  'notifyPrintProgress',
  'notifyFilamentRunout',
  'notifySwapComplete',
  'notifyPrinterError',
  'notifyPrinterDisconnected',
  'notifyTempWarning',
] as const satisfies readonly (keyof Settings)[];

const NOTIFICATION_MODES: {
  value: Settings['notificationMode'];
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}[] = [
  { value: 'off', label: 'Off', icon: 'bell-off-outline' },
  { value: 'local', label: 'Local only', icon: 'cellphone' },
  { value: 'ntfy', label: 'ntfy', icon: 'broadcast' },
  { value: 'fcm', label: 'Firebase push', icon: 'cloud-upload-outline' },
];

type RestartService = 'klippy' | 'moonraker';

export default function SettingsScreen() {
  const { showAlert, alertDialog } = useThemedAlert();
  const { settings, loaded, update } = useSettings();
  const { connection, activeUrl, klippyState, reconnect } = useMoonraker();
  const [draft, setDraft] = useState<Settings | null>(null);
  // Non-null while the Add printer modal is open: a blank entry the modal
  // fills in, so adding looks and behaves exactly like editing.
  const [newPrinter, setNewPrinter] = useState<PrinterEntry | null>(null);
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  // null = the index. Nova's whole bet: one screen at a time, so a Save button
  // always governs exactly what's in front of you.
  const [section, setSection] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PrinterEntry | null>(null);
  const [pendingRestart, setPendingRestart] = useState<RestartService | null>(null);
  const [restartingService, setRestartingService] = useState<RestartService | null>(null);

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
  const activeConnectionName = isTailscaleUrl(visibleActiveUrl) ? 'Tailscale' : 'LAN';

  const confirmServiceRestart = async () => {
    const service = pendingRestart;
    if (!service || !visibleActiveUrl || restartingService) return;

    setPendingRestart(null);
    setRestartingService(service);
    try {
      if (service === 'klippy') await api.restartKlippy(visibleActiveUrl);
      else await api.restartMoonraker(visibleActiveUrl);

      const name = service === 'klippy' ? 'Klippy' : 'Moonraker';
      showAlert({
        title: `${name} restart requested`,
        message: `${name} accepted the restart request over ${activeConnectionName}. Helix will reconnect automatically when it is available again.`,
        icon: 'restart',
      });
    } catch (error) {
      const name = service === 'klippy' ? 'Klippy' : 'Moonraker';
      showAlert({
        title: `${name} restart failed`,
        message: error instanceof Error ? error.message : String(error),
        icon: 'alert-circle-outline',
      });
    } finally {
      setRestartingService(null);
    }
  };

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
    // Was a native platform alert, which ignored the theme entirely. Now the same
    // Focus treatment as every other destructive confirm.
    setPendingRemoval(p);
  };

  const confirmRemovePrinter = (p: PrinterEntry) => {
    setPendingRemoval(null);
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
  };

  const saveEditedPrinter = async (printer: PrinterEntry): Promise<boolean> => {
    const printers = draft.printers.map((p) => (p.id === printer.id ? printer : p));
    const patch: Partial<Settings> = { printers };
    const nextDraft: Settings = { ...draft, printers };

    if (draft.activePrinterId === printer.id) {
      patch.primaryUrl = printer.url;
      patch.tailscaleUrl = printer.tailscaleUrl;
      patch.cameraUrl = printer.cameraUrl;
      patch.connectionMode = printer.connectionMode;
      nextDraft.primaryUrl = printer.url;
      nextDraft.tailscaleUrl = printer.tailscaleUrl;
      nextDraft.cameraUrl = printer.cameraUrl;
      nextDraft.connectionMode = printer.connectionMode;
    }

    setDraft(nextDraft);
    await update(patch);
    return true;
  };

  const saveNewPrinter = async (printer: PrinterEntry): Promise<boolean> => {
    const printers = [...settings.printers, printer];
    const patch: Partial<Settings> = {
      printers,
      activePrinterId: printer.id,
      primaryUrl: printer.url,
      tailscaleUrl: printer.tailscaleUrl,
      cameraUrl: printer.cameraUrl,
      connectionMode: printer.connectionMode,
    };
    setDraft({ ...draft, ...patch });
    await update(patch);
    return true;
  };

  const setNotificationMode = (mode: Settings['notificationMode']) => {
    const patch: Partial<Settings> = { notificationMode: mode };
    if (mode === 'ntfy') {
      patch.ntfyServer = draft.ntfyServer.trim() || 'https://ntfy.sh';
      if (!draft.ntfyTopic.trim()) patch.ntfyTopic = generateNtfyTopic();
    }
    if (mode === 'off') clearStoredFcmDeviceToken().catch(() => {});
    if (mode === 'fcm') registerFcmDeviceToken().catch(() => {});
    set(patch);
  };

  const randomizeNtfyTopic = () => set({ ntfyTopic: generateNtfyTopic() });

  const updateDashboardSection = (key: keyof DashboardSections, value: boolean) => {
    update({
      dashboard: {
        ...settings.dashboard,
        [key]: value,
      },
    });
  };

  const testNotifications = async () => {
    const report = (message: string) => {
      if (Platform.OS === 'android') {
        ToastAndroid.show(message, ToastAndroid.LONG);
      } else {
        showAlert({ title: 'Notifications', message, icon: 'bell-alert-outline' });
      }
    };

    if (draft.notificationMode === 'off') {
      report(t('Choose a notification mode first.'));
      return;
    }

    if (draft.notificationMode === 'ntfy') {
      const topic = draft.ntfyTopic.trim() || generateNtfyTopic();
      const server = draft.ntfyServer.trim() || 'https://ntfy.sh';
      const patch: Partial<Settings> = {};
      if (topic !== draft.ntfyTopic.trim()) patch.ntfyTopic = topic;
      if (server !== draft.ntfyServer.trim()) patch.ntfyServer = server;
      if (Object.keys(patch).length) set(patch);

      const ok = await sendNtfy(server, topic, 'Helix test', 'Printer alerts are working.', 3, 'printer');
      report(ok ? t('Test sent. Check your notification tray.') : t('Test failed. Check the ntfy settings.'));
      return;
    }

    if (draft.notificationMode === 'fcm') {
      const configured = activeUrl && settings.activePrinterId
        ? await configureFcmForPrinter(activeUrl, settings.activePrinterId)
        : await sendFcmTestNotification();
      report(configured ? t('Test sent. Check your notification tray.') : t('Test failed. Check Firebase setup.'));
      return;
    }

    const ok = await notifyLocal('Helix test', 'Local printer alerts are working.');
    report(ok ? t('Test sent. Check your notification tray.') : t('Test failed. Check notification permission.'));
  };

  // Only these fields go through the draft, so only these can be "changed but
  // not applied". Everything else on this screen writes immediately.
  const notificationsDirty =
    draft.notificationMode !== settings.notificationMode ||
    draft.ntfyServer !== settings.ntfyServer ||
    draft.ntfyTopic !== settings.ntfyTopic ||
    NOTIFY_KEYS.some((key) => draft[key] !== settings[key]);
  const filamentDirty = draft.aceUnits !== settings.aceUnits;

  const attention = [
    notificationsDirty
      ? { key: 'notifications', title: t('Notifications'), icon: 'bell-outline' as IconName }
      : null,
    filamentDirty
      ? { key: 'filament', title: 'Filament & ACE', icon: 'palette-swatch' as IconName }
      : null,
  ].filter(Boolean) as { key: string; title: string; icon: IconName }[];

  const online = connection === 'connected';
  const activePrinter = draft.printers.find((p) => p.id === draft.activePrinterId);
  const sectionsOn = SECTION_LABELS.filter(({ key }) => settings.dashboard[key]).length;
  const notifyOn = NOTIFY_KEYS.filter((key) => draft[key]).length;
  const accentName = ACCENTS.find((a) => a.hex === draft.accentColor)?.name ?? 'Custom';
  const languageName = LANGUAGES.find((l) => l.code === draft.language)?.label ?? draft.language;

  const SECTIONS: {
    key: string;
    title: string;
    icon: IconName;
    commit: Commit;
    summary: string;
    dirty?: boolean;
    warn?: boolean;
  }[] = [
    {
      key: 'connection',
      title: t('Connection'),
      icon: 'lan-connect',
      commit: 'instant',
      summary: online
        ? `${t('Connected')} · klippy ${klippyState}`
        : `${connection.toUpperCase()} — ${visibleActiveUrl || t('no URL')}`,
      warn: !online,
    },
    {
      key: 'printers',
      title: t('Printers'),
      icon: 'printer-3d',
      commit: 'instant',
      summary:
        draft.printers.length === 1
          ? activePrinter?.name ?? t('No printer')
          : `${draft.printers.length} ${t('printers')} · ${activePrinter?.name ?? ''}`,
    },
    {
      key: 'dashboard',
      title: t('Dashboard sections'),
      icon: 'view-dashboard-outline',
      commit: 'instant',
      summary: `${sectionsOn} ${t('of')} ${SECTION_LABELS.length} ${t('sections shown')}`,
    },
    {
      key: 'appearance',
      title: t('Appearance'),
      icon: 'palette-outline',
      commit: 'live',
      summary: `${accentName} · ${languageName} · ${draft.temperatureUnit === 'c' ? '°C' : '°F'}`,
    },
    {
      key: 'notifications',
      title: t('Notifications'),
      icon: 'bell-outline',
      commit: 'draft',
      summary:
        draft.notificationMode === 'off'
          ? t('Off')
          : `${NOTIFICATION_MODES.find((m) => m.value === draft.notificationMode)?.label ?? ''} · ${notifyOn}/${NOTIFY_KEYS.length}`,
      dirty: notificationsDirty,
    },
    {
      key: 'filament',
      title: 'Filament & ACE',
      icon: 'palette-swatch',
      commit: 'draft',
      summary: `${draft.aceUnits} ACE ${draft.aceUnits === 1 ? 'unit' : 'units'} · Spoolman`,
      dirty: filamentDirty,
    },
    {
      key: 'integrations',
      title: 'MakerWorld',
      icon: 'cloud-outline',
      commit: 'instant',
      summary: t('Log in to import shared models'),
    },
    {
      key: 'about',
      title: t('Backup & About'),
      icon: 'information-outline',
      commit: 'instant',
      summary: t('Export, import, updates'),
    },
  ];

  const current = SECTIONS.find((s) => s.key === section) ?? null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {current === null ? (
            <>
              <ScreenTitle title={t('Settings')} online={online} />

              <AttentionPanel
                items={attention}
                onOpen={setSection}
                onSave={save}
                onDiscard={() => setDraft(settings)}
              />

              <View style={styles.indexCard}>
                {SECTIONS.map((s, i) => (
                  <IndexRow
                    key={s.key}
                    icon={s.icon}
                    title={s.title}
                    summary={s.summary}
                    dirty={s.dirty}
                    warn={s.warn}
                    first={i === 0}
                    onPress={() => setSection(s.key)}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              <SectionHeader
                title={current.title}
                commit={current.commit}
                onBack={() => setSection(null)}
              />

              {section === 'connection' ? (
                <View style={styles.card}>
                  <Text style={styles.connInfo}>
                    {connection.toUpperCase()} — {visibleActiveUrl || 'no URL'} (klippy: {klippyState})
                  </Text>
                  <TouchableOpacity style={styles.connectionBtn} onPress={reconnect}>
                    <MaterialCommunityIcons name="lan-connect" size={18} color={colors.text} />
                    <Text style={styles.smallBtnText}>{t('Reconnect now')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.connectionBtn,
                      (!visibleActiveUrl || restartingService !== null) && styles.disabledBtn,
                    ]}
                    disabled={!visibleActiveUrl || restartingService !== null}
                    onPress={() => setPendingRestart('klippy')}
                  >
                    <MaterialCommunityIcons name="restart" size={18} color={colors.warning} />
                    <Text style={styles.smallBtnText}>
                      {restartingService === 'klippy' ? 'Restarting Klippy…' : 'Restart Klippy'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.connectionBtn,
                      (!visibleActiveUrl || restartingService !== null) && styles.disabledBtn,
                    ]}
                    disabled={!visibleActiveUrl || restartingService !== null}
                    onPress={() => setPendingRestart('moonraker')}
                  >
                    <MaterialCommunityIcons name="server" size={18} color={colors.warning} />
                    <Text style={styles.smallBtnText}>
                      {restartingService === 'moonraker'
                        ? 'Restarting Moonraker…'
                        : 'Restart Moonraker'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.connectionRoute}>
                    Commands use the active {activeConnectionName} address shown above.
                  </Text>
                </View>
              ) : null}

              {section === 'printers' ? (
                <View style={styles.card}>
                  {settings.printers.map((p) => (
                    <View key={p.id} style={styles.printerRow}>
                      <TouchableOpacity style={styles.printerMain} onPress={() => switchPrinter(p)}>
                        <MaterialCommunityIcons
                          name={p.id === settings.activePrinterId ? 'radiobox-marked' : 'radiobox-blank'}
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
                  <TouchableOpacity
                    style={styles.smallBtn}
                    onPress={() =>
                      setNewPrinter({
                        id: `p${Date.now()}`,
                        name: `Snapmaker ${settings.printers.length + 1}`,
                        url: '',
                        tailscaleUrl: '',
                        cameraUrl: '/webcam/webrtc',
                        connectionMode: 'lan',
                      })
                    }
                  >
                    <Text style={styles.smallBtnText}>+ {t('Add printer')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {section === 'dashboard' ? (
                <View style={styles.card}>
                  <View style={styles.sectionGrid}>
                    {SECTION_LABELS.map(({ key, label }) => (
                      <DashboardSectionTile
                        key={key}
                        label={t(label)}
                        value={settings.dashboard[key]}
                        onChange={(v) => updateDashboardSection(key, v)}
                      />
                    ))}
                    <DashboardSectionTile
                      label={t('Confirm emergency stop')}
                      value={settings.estopConfirm}
                      onChange={(v) => update({ estopConfirm: v })}
                    />
                  </View>
                </View>
              ) : null}

              {section === 'appearance' ? (
                <>
                  <View style={styles.card}>
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
                          <Text style={[styles.langText, draft.language === l.code && { color: '#fff' }]}>
                            {l.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
                      {t('Temperature units')}
                    </Text>
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
                              {unit === 'c' ? '°C' : '°F'}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <MacroDisplayCard />
                </>
              ) : null}

              {section === 'notifications' ? (
                <View style={styles.card}>
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
                    label={t('Print cancelled')}
                    value={draft.notifyPrintCancelled}
                    onChange={(v) => set({ notifyPrintCancelled: v })}
                  />
                  <Toggle
                    label={t('Print progress (every 10%)')}
                    value={draft.notifyPrintProgress}
                    onChange={(v) => set({ notifyPrintProgress: v })}
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
              ) : null}

              {section === 'filament' ? (
                <>
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
                  <SpoolmanCard activeUrl={activeUrl} />
                </>
              ) : null}

              {section === 'integrations' ? <MakerWorldCard /> : null}

              {section === 'about' ? (
                <>
                  {/* Import replaces saved settings behind the draft's back — drop
                      the draft so it re-seeds from the imported values. */}
                  <BackupCard onImported={() => setDraft(null)} />
                  <AboutCard />
                </>
              ) : null}

              {/* The Save button exists only on the screen it governs, and says
                  "now" because the change isn't live until it's pressed. */}
              {current.commit === 'draft' && dirty ? (
                <TouchableOpacity style={styles.saveBtn} onPress={save}>
                  <MaterialCommunityIcons name="check" size={19} color={COCKPIT.onAccent} />
                  <Text style={styles.saveText}>{t('Save & Apply now')}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <PrinterEditorModal
        printer={editingPrinter}
        onClose={() => setEditingPrinterId(null)}
        onSave={saveEditedPrinter}
      />
      <PrinterEditorModal
        mode="add"
        printer={newPrinter}
        onClose={() => setNewPrinter(null)}
        onSave={saveNewPrinter}
      />

      <ThemedDialog
        visible={pendingRestart !== null}
        title={pendingRestart === 'klippy' ? 'Restart Klippy?' : 'Restart Moonraker?'}
        message={
          pendingRestart === 'klippy'
            ? `This reloads Klipper and will stop any active print. Send the request over ${activeConnectionName}?`
            : `Helix and the printer screen may disconnect briefly while Moonraker restarts. Send the request over ${activeConnectionName}?`
        }
        icon="restart-alert"
        onClose={() => setPendingRestart(null)}
        actions={[
          {
            text: pendingRestart === 'klippy' ? 'Restart Klippy' : 'Restart Moonraker',
            icon: 'restart',
            variant: pendingRestart === 'klippy' ? 'danger' : 'primary',
            onPress: confirmServiceRestart,
          },
          { text: t('Cancel'), onPress: () => setPendingRestart(null) },
        ]}
      />

      {/* Destructive, so it takes the Focus treatment like the e-stop. */}
      <ThemedDialog
        visible={pendingRemoval !== null}
        title={t('Remove printer?')}
        message={
          pendingRemoval
            ? `${pendingRemoval.name} will be removed from Helix. The printer itself is untouched.`
            : undefined
        }
        icon="trash-can-outline"
        onClose={() => setPendingRemoval(null)}
        actions={[
          {
            text: t('Remove'),
            icon: 'trash-can-outline',
            variant: 'danger',
            onPress: () => pendingRemoval && confirmRemovePrinter(pendingRemoval),
          },
          { text: t('Cancel'), onPress: () => setPendingRemoval(null) },
        ]}
      />

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
      {alertDialog}
    </KeyboardAvoidingView>
  );
}

function MakerWorldCard() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getMakerWorldCookies()
        .then((c) => active && setAuthed(c.hasAuth))
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>MakerWorld</Text>
      <Text style={styles.connInfo}>
        Log in once to import shared MakerWorld models in the Slicer tab.
      </Text>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Account</Text>
        <Text style={{ color: authed ? colors.success : colors.warning, fontSize: 13, fontWeight: '700' }}>
          {authed ? 'Logged in' : 'Not logged in'}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.smallBtn, { flexDirection: 'row', justifyContent: 'center', gap: 6 }]}
        onPress={() => router.push('/makerworld-login')}
      >
        <MaterialCommunityIcons name="login" size={16} color={colors.text} />
        <Text style={styles.smallBtnText}>{authed ? 'Re-login' : 'Log in to MakerWorld'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// shows the Spoolman server the PRINTER is configured with (it lives in
// moonraker.conf, not in app settings) and lets you set/change it without
// touching the printer — same upload+restart flow as the Spoolman tab.
function SpoolmanCard({ activeUrl }: { activeUrl: string }) {
  const { settings } = useSettings();
  const { showAlert, alertDialog } = useThemedAlert();
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
      const changed = await applyConfigIfChanged(
        activeUrl,
        'extended/moonraker',
        'spoolman.cfg',
        `# Spoolman filament tracking (written by Helix)\n[spoolman]\nserver: ${server}\nsync_rate: 5\n`
      );
      if (changed) await new Promise((r) => setTimeout(r, 8000));
      setCurrent(server);
      showAlert({
        title: t('Saved'),
        message: t('Printer now reports filament usage to this Spoolman server.'),
        icon: 'check-circle-outline',
      });
    } catch (e: unknown) {
      showAlert({
        title: t('Error'),
        message: e instanceof Error ? e.message : String(e),
        icon: 'alert-circle-outline',
      });
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
      {alertDialog}
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
    <View style={styles.sectionTile}>
      <Pressable
        style={styles.sectionTileLabel}
        onPress={() => onChange(!value)}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        accessibilityLabel={label}
      >
        <Text style={styles.sectionTileText} numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.card, true: colors.primary }}
        thumbColor="#fff"
      />
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
  safe: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  indexCard: {
    borderRadius: COCKPIT.radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
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
  connectionBtn: {
    minHeight: 44,
    marginTop: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  connectionRoute: {
    color: colors.subtext,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  disabledBtn: {
    opacity: 0.45,
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
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  sectionTileLabel: {
    flex: 1,
  },
  sectionTileText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    minHeight: 30,
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
    height: 56,
    borderRadius: 999,
    backgroundColor: COCKPIT.accentFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  saveText: {
    color: COCKPIT.onAccent,
    fontSize: 15,
    fontWeight: '800',
  },
});
