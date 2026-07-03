import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DashboardSections, PrinterEntry, Settings, useSettings } from '../../hooks/useSettings';
import { useMoonraker } from '../../hooks/useMoonraker';
import { generateNtfyTopic, notifyLocal, sendNtfy } from '../../services/notifications';
import { LANGUAGES, t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';
import {
  api,
  normalizeBaseUrl,
  normalizeMoonrakerUrl,
  restartMoonraker,
  uploadConfigFile,
} from '../../services/moonraker';

const REPO_URL = 'https://github.com/FatBoy721/Helix';
const BUG_URL = `${REPO_URL}/issues/new`;
const RELEASE_API_URL = 'https://api.github.com/repos/FatBoy721/Helix/releases/latest';
const APK_URL = `${REPO_URL}/releases/download/latest/helix.apk`;

interface GitHubRelease {
  body?: string;
  html_url?: string;
  assets?: { name: string; browser_download_url: string }[];
}

function buildCommit(): string {
  const extra = Constants.expoConfig?.extra as { buildCommit?: string } | undefined;
  return extra?.buildCommit?.toLowerCase() ?? '';
}

function releaseCommit(body?: string): string {
  return body?.match(/\b[0-9a-f]{40}\b/i)?.[0]?.toLowerCase() ?? '';
}

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

export default function SettingsScreen() {
  const { settings, loaded, update } = useSettings();
  const { connection, activeUrl, klippyState, reconnect } = useMoonraker();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [addingPrinter, setAddingPrinter] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  useEffect(() => {
    if (loaded && !draft) setDraft(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (!draft) return <View style={styles.screen} />;

  const currentBuild = buildCommit();
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });

  // Save button only appears when a draft-managed field actually differs
  // from what's stored — it used to just sit there permanently
  const DRAFT_KEYS: (keyof Settings)[] = [
    'primaryUrl',
    'tailscaleUrl',
    'cameraUrl',
    'notificationMode',
    'ntfyServer',
    'ntfyTopic',
    'aceUnits',
    'notifyPrintComplete',
    'notifyPrintFailed',
    'notifyPrintPaused',
    'notifyFilamentRunout',
    'notifySwapComplete',
    'notifyPrinterError',
    'notifyPrinterDisconnected',
    'notifyTempWarning',
  ];
  const dirty = DRAFT_KEYS.some((k) => draft[k] !== settings[k]);

  // theme + language apply instantly, no Save needed
  const setLive = (patch: Partial<Settings>) => {
    setDraft({ ...draft, ...patch });
    update(patch);
  };

  const save = async () => {
    const primaryUrl = normalizeMoonrakerUrl(draft.primaryUrl);
    const tailscaleUrl = normalizeMoonrakerUrl(draft.tailscaleUrl);
    const normalizedDraft = { ...draft, primaryUrl, tailscaleUrl };
    // keep the active printer entry in sync with the edited URL fields
    const printers = settings.printers.map((p) =>
      p.id === settings.activePrinterId
        ? { ...p, url: primaryUrl, tailscaleUrl, cameraUrl: draft.cameraUrl }
        : p
    );
    setDraft(normalizedDraft);
    await update({ ...normalizedDraft, printers, activePrinterId: settings.activePrinterId });
    Alert.alert(t('Saved'), t('Settings applied. Connection will use the new URLs.'));
  };

  const switchPrinter = (p: PrinterEntry) => {
    setDraft({ ...draft, primaryUrl: p.url, tailscaleUrl: p.tailscaleUrl, cameraUrl: p.cameraUrl });
    update({
      activePrinterId: p.id,
      primaryUrl: p.url,
      tailscaleUrl: p.tailscaleUrl,
      cameraUrl: p.cameraUrl,
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
          const patch: Partial<Settings> = { printers };
          if (settings.activePrinterId === p.id) {
            const next = printers[0];
            patch.activePrinterId = next.id;
            patch.primaryUrl = next.url;
            patch.tailscaleUrl = next.tailscaleUrl;
            patch.cameraUrl = next.cameraUrl;
            setDraft({
              ...draft,
              primaryUrl: next.url,
              tailscaleUrl: next.tailscaleUrl,
              cameraUrl: next.cameraUrl,
            });
          }
          update(patch);
        },
      },
    ]);
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

  const checkForUpdates = async () => {
    if (checkingUpdates) return;
    setCheckingUpdates(true);
    try {
      const res = await fetch(RELEASE_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);

      const release = (await res.json()) as GitHubRelease;
      const latest = releaseCommit(release.body);
      const current = buildCommit();
      const downloadUrl =
        release.assets?.find((a) => a.name === 'helix.apk')?.browser_download_url ?? APK_URL;

      if (latest && current && current !== 'dev' && latest === current) {
        Alert.alert('Up to date', `Helix is already on build ${latest.slice(0, 7)}.`);
        return;
      }

      Alert.alert(
        latest ? `Update available: ${latest.slice(0, 7)}` : 'Latest APK available',
        current && current !== 'dev'
          ? `Installed build: ${current.slice(0, 7)}`
          : 'Open the latest APK download?',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Download APK',
            onPress: () => Linking.openURL(downloadUrl).catch(() => Linking.openURL(`${REPO_URL}/releases/latest`)),
          },
        ]
      );
    } catch (e: any) {
      Alert.alert('Update check failed', e?.message ?? 'Could not reach GitHub releases.');
    } finally {
      setCheckingUpdates(false);
    }
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
            {connection.toUpperCase()} — {activeUrl || 'no URL'} (klippy: {klippyState})
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
                    {p.url}
                  </Text>
                </View>
              </TouchableOpacity>
              {settings.printers.length > 1 && (
                <TouchableOpacity onPress={() => removePrinter(p)}>
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
                placeholder="http://192.168.1.x:7125"
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                keyboardType="url"
              />
              <TouchableOpacity
                style={[styles.smallBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (!newUrl.trim()) return;
                  const url = normalizeMoonrakerUrl(newUrl);
                  const entry: PrinterEntry = {
                    id: `p${Date.now()}`,
                    name: newName.trim() || `Snapmaker ${settings.printers.length + 1}`,
                    url,
                    tailscaleUrl: '',
                    cameraUrl: '/webcam/webrtc',
                  };
                  const printers = [...settings.printers, entry];
                  update({
                    printers,
                    activePrinterId: entry.id,
                    primaryUrl: entry.url,
                    tailscaleUrl: entry.tailscaleUrl,
                    cameraUrl: entry.cameraUrl,
                  });
                  setDraft({
                    ...draft,
                    printers,
                    activePrinterId: entry.id,
                    primaryUrl: entry.url,
                    tailscaleUrl: entry.tailscaleUrl,
                    cameraUrl: entry.cameraUrl,
                  });
                  setNewName('');
                  setNewUrl('');
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Dashboard sections')}</Text>
          {SECTION_LABELS.map(({ key, label }) => (
            <Toggle
              key={key}
              label={t(label)}
              value={settings.dashboard[key]}
              onChange={(v) => update({ dashboard: { ...settings.dashboard, [key]: v } })}
            />
          ))}
        </View>

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
        </View>

        <Field
          label={t('Printer URL (LAN)')}
          value={draft.primaryUrl}
          onChange={(v) => set({ primaryUrl: v })}
          placeholder="http://192.168.1.17:7125"
        />
        <Field
          label="Printer URL (Tailscale, optional)"
          value={draft.tailscaleUrl}
          onChange={(v) => set({ tailscaleUrl: v })}
          placeholder="http://100.x.y.z:7125"
        />
        <Text style={styles.note}>
          App tries LAN first, then falls back to Tailscale automatically after 2 failed attempts.
        </Text>
        <Field
          label="Camera stream (path or full URL)"
          value={draft.cameraUrl}
          onChange={(v) => set({ cameraUrl: v })}
          placeholder="/webcam/webrtc"
        />
        <Text style={styles.note}>
          /webcam/webrtc = realtime (default). /webcam/stream.mjpg = MJPEG fallback. Path form
          follows the active printer host — works on LAN and Tailscale.
        </Text>

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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('About')}</Text>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={checkForUpdates}
            disabled={checkingUpdates}
          >
            <MaterialCommunityIcons name="update" size={20} color={colors.text} />
            <Text style={styles.linkText}>
              {checkingUpdates ? 'Checking for updates...' : 'Check for updates'}
            </Text>
            <MaterialCommunityIcons name="download-outline" size={16} color={colors.subtext} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => Linking.openURL(REPO_URL).catch(() => {})}
          >
            <MaterialCommunityIcons name="github" size={20} color={colors.text} />
            <Text style={styles.linkText}>GitHub - Helix</Text>
            <MaterialCommunityIcons name="open-in-new" size={16} color={colors.subtext} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => {
              const body = encodeURIComponent(
                `**App version:** ${Constants.expoConfig?.version ?? '?'}\n**Platform:** ${Platform.OS}\n\n**What happened:**\n\n**Steps to reproduce:**\n`
              );
              Linking.openURL(`${BUG_URL}?title=${encodeURIComponent('[Bug] ')}&body=${body}`).catch(
                () => {}
              );
            }}
          >
            <MaterialCommunityIcons name="bug-outline" size={20} color={colors.text} />
            <Text style={styles.linkText}>{t('Report a bug')}</Text>
            <MaterialCommunityIcons name="open-in-new" size={16} color={colors.subtext} />
          </TouchableOpacity>
          <Text style={styles.version}>
            Helix v{Constants.expoConfig?.version ?? '1.0.0'}
            {currentBuild && currentBuild !== 'dev' ? ` (${currentBuild.slice(0, 7)})` : ''}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// shows the Spoolman server the PRINTER is configured with (it lives in
// moonraker.conf, not in app settings) and lets you set/change it without
// touching the printer — same upload+restart flow as the Spoolman tab.
function SpoolmanCard({ activeUrl }: { activeUrl: string }) {
  const [current, setCurrent] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!activeUrl) return;
    api
      .serverConfig(activeUrl)
      .then((c) => {
        const cur = c?.config?.spoolman?.server ?? null;
        setCurrent(cur);
        if (cur) setInput(cur);
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
    } catch (e: any) {
      Alert.alert(t('Error'), String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Spoolman</Text>
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

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
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
  addForm: {
    gap: spacing.sm,
    marginTop: spacing.sm,
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
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  linkText: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
  },
  version: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: spacing.sm,
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
});
