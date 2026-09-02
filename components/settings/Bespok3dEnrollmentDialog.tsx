import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PrinterEntry } from '../../hooks/useSettings';
import {
  configureBespok3dHelixScreen,
  enrollBespok3dU1,
  getBespok3dHelixScreenState,
  installBundledBespok3dHelixScreen,
  installBespok3dPlugins,
  listBespok3dPlugins,
  preflightBespok3dU1,
  prepareBespok3dU1Enrollment,
  type Bespok3dPlugin,
  type Bespok3dPluginCatalog,
  type Bespok3dPluginConfigField,
  type Bespok3dPluginInstallResult,
  type Bespok3dPluginVars,
  type Bespok3dHelixScreenState,
  type Bespok3dScreenUi,
  type Bespok3dU1Preflight,
} from '../../services/bespok3d';
import {
  createEnrolledBespok3dCredentialRecord,
  createPreparedBespok3dCredentialRecord,
  type Bespok3dEnrolledCredentialRecord,
} from '../../services/bespok3dCredentials';
import {
  readBespok3dCredentialRecord,
  writeBespok3dCredentialRecord,
} from '../../services/bespok3dSecureStore';
import { printerConnectionUrl } from '../../services/moonraker';
import ThemedDialog, { type DialogAction } from '../ThemedDialog';
import { alpha, COCKPIT } from '../dashboard/shared';

type Stage =
  | 'password'
  | 'checking'
  | 'review'
  | 'installing'
  | 'complete'
  | 'helixscreen-confirm'
  | 'helixscreen-installing'
  | 'plugin-loading'
  | 'plugins'
  | 'plugin-installing'
  | 'plugin-result'
  | 'error';

interface Props {
  visible: boolean;
  printer: PrinterEntry | null;
  onClose: () => void;
}

export default function Bespok3dEnrollmentDialog({ visible, printer, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('password');
  const [password, setPassword] = useState('');
  const [preflight, setPreflight] = useState<Bespok3dU1Preflight | null>(null);
  const [enrolled, setEnrolled] = useState<Bespok3dEnrolledCredentialRecord | null>(null);
  const [catalog, setCatalog] = useState<Bespok3dPluginCatalog | null>(null);
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
  const [pluginVars, setPluginVars] = useState<Bespok3dPluginVars>({});
  const [pluginResult, setPluginResult] = useState<Bespok3dPluginInstallResult | null>(null);
  const [helixScreen, setHelixScreen] = useState<Bespok3dHelixScreenState | null>(null);
  const [screenBusy, setScreenBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    if (!visible || !printer) return () => { live = false; };
    setPassword('');
    setPreflight(null);
    setEnrolled(null);
    setCatalog(null);
    setSelectedPlugins([]);
    setPluginVars({});
    setPluginResult(null);
    setHelixScreen(null);
    setScreenBusy(false);
    setError('');
    setStage('password');
    readBespok3dCredentialRecord(printer.id)
      .then((record) => {
        if (!live || record?.status !== 'enrolled') return;
        setEnrolled(record);
        setStage('complete');
      })
      .catch(() => {});
    return () => { live = false; };
  }, [printer, visible]);

  useEffect(() => {
    let live = true;
    if (!visible || !printer || !enrolled || enrolled.printerId !== printer.id) {
      return () => { live = false; };
    }
    getBespok3dHelixScreenState(printerConnectionUrl(printer), enrolled)
      .then((state) => { if (live) setHelixScreen(state); })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { live = false; };
  }, [enrolled, printer, visible]);

  const busy = stage === 'checking'
    || stage === 'installing'
    || stage === 'helixscreen-installing'
    || stage === 'plugin-loading'
    || stage === 'plugin-installing'
    || screenBusy;
  const close = () => {
    if (busy) return;
    setPassword('');
    onClose();
  };

  const checkPrinter = async () => {
    if (!printer || !password) return;
    setStage('checking');
    setError('');
    try {
      const result = await preflightBespok3dU1(printerConnectionUrl(printer), password);
      if (!result.eligible) throw new Error(result.reason || 'This printer cannot be enrolled.');
      setPreflight(result);
      setStage('review');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStage('error');
    }
  };

  const install = async () => {
    if (!printer || !preflight || !password) return;
    setStage('installing');
    setError('');
    try {
      const existing = await readBespok3dCredentialRecord(printer.id);
      const prepared = existing?.status === 'prepared'
        && existing.sshHostKeySha256 === preflight.sshHostKeySha256
        ? existing
        : createPreparedBespok3dCredentialRecord(
            printer.id,
            preflight.sshHostKeySha256,
            'Helix Android',
            await prepareBespok3dU1Enrollment(),
          );
      // Persist before mutation so the exact same identity survives an app or Wi-Fi interruption.
      await writeBespok3dCredentialRecord(prepared);
      const result = await enrollBespok3dU1(
        printerConnectionUrl(printer),
        password,
        preflight.sshHostKeySha256,
        prepared.label,
        prepared,
      );
      const completed = createEnrolledBespok3dCredentialRecord(prepared, result);
      await writeBespok3dCredentialRecord(completed);
      setEnrolled(completed);
      setPassword('');
      setStage('complete');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStage('error');
    }
  };

  const loadPlugins = async () => {
    if (!printer || !enrolled) return;
    setStage('plugin-loading');
    setError('');
    setPluginResult(null);
    try {
      const nextCatalog = await listBespok3dPlugins(printerConnectionUrl(printer), enrolled);
      const defaults: Bespok3dPluginVars = {};
      nextCatalog.plugins.forEach((plugin) => {
        const values: Record<string, string> = {};
        plugin.config.forEach((field) => {
          if (field.defaultValue !== null) values[field.key] = field.defaultValue;
        });
        defaults[plugin.id] = values;
      });
      setCatalog(nextCatalog);
      setSelectedPlugins([]);
      setPluginVars(defaults);
      setStage('plugins');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStage('complete');
    }
  };

  const installSelectedPlugins = async () => {
    if (!printer || !enrolled || selectedPlugins.length === 0) return;
    setStage('plugin-installing');
    setError('');
    try {
      const selectedVars = Object.fromEntries(
        selectedPlugins.map((pluginId) => [pluginId, pluginVars[pluginId] ?? {}]),
      );
      const result = await installBespok3dPlugins(
        printerConnectionUrl(printer),
        enrolled,
        selectedPlugins,
        selectedVars,
      );
      setPluginResult(result);
      setStage('plugin-result');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStage('plugins');
    }
  };

  const togglePlugin = (pluginId: string) => {
    setSelectedPlugins((current) => current.includes(pluginId)
      ? current.filter((id) => id !== pluginId)
      : [...current, pluginId]);
  };

  const setPluginVar = (pluginId: string, key: string, value: string) => {
    setPluginVars((current) => ({
      ...current,
      [pluginId]: { ...(current[pluginId] ?? {}), [key]: value },
    }));
  };

  const switchScreen = async (selected: Bespok3dScreenUi) => {
    if (
      !printer
      || !enrolled
      || enrolled.printerId !== printer.id
      || screenBusy
      || helixScreen?.selected === selected
    ) return;
    setScreenBusy(true);
    setError('');
    try {
      const state = await configureBespok3dHelixScreen(
        printerConnectionUrl(printer),
        enrolled,
        selected,
      );
      setHelixScreen(state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setScreenBusy(false);
    }
  };

  const installHelixScreen = async () => {
    if (
      !printer
      || !enrolled
      || enrolled.printerId !== printer.id
      || helixScreen?.installed !== false
    ) return;
    setStage('helixscreen-installing');
    setError('');
    try {
      const result = await installBundledBespok3dHelixScreen(
        printerConnectionUrl(printer),
        enrolled,
      );
      if (!result.ok) {
        const details = Object.entries(result.failures)
          .map(([pluginId, reason]) => `${pluginId}: ${reason}`)
          .join('\n');
        throw new Error(details || 'Bespok3d could not install HelixScreen.');
      }
      const state = await getBespok3dHelixScreenState(printerConnectionUrl(printer), enrolled);
      if (!state.installed) throw new Error('Bespok3d did not report HelixScreen as installed.');
      setHelixScreen(state);
      setStage('complete');
    } catch (reason) {
      try {
        setHelixScreen(
          await getBespok3dHelixScreenState(printerConnectionUrl(printer), enrolled),
        );
      } catch {
        // Best-effort refresh; preserve the original installation failure below.
      }
      setError(reason instanceof Error ? reason.message : String(reason));
      setStage('complete');
    }
  };

  const actions: DialogAction[] = (() => {
    if (stage === 'password') return [
      {
        text: 'Check printer',
        icon: 'shield-check-outline',
        variant: 'primary',
        disabled: !password,
        onPress: checkPrinter,
      },
      { text: 'Cancel', onPress: close },
    ];
    if (stage === 'review') return [
      {
        text: 'Install & reboot U1',
        icon: 'download-lock-outline',
        variant: 'danger',
        onPress: install,
      },
      { text: 'Cancel', onPress: close },
    ];
    if (stage === 'complete') {
      if (helixScreen?.installed === false) return [
        {
          text: 'Install HelixScreen',
          icon: 'monitor-arrow-down-variant',
          variant: 'primary',
          onPress: () => { setError(''); setStage('helixscreen-confirm'); },
        },
        { text: 'Choose plugins', icon: 'puzzle-outline', onPress: loadPlugins },
        { text: 'Done', icon: 'check', onPress: close },
      ];
      return [
        { text: 'Choose plugins', icon: 'puzzle-outline', variant: 'primary', onPress: loadPlugins },
        { text: 'Done', icon: 'check', onPress: close },
        {
          text: 'Check or reinstall',
          onPress: () => {
            setEnrolled(null);
            setStage('password');
          },
        },
      ];
    }
    if (stage === 'helixscreen-confirm') return [
      {
        text: 'Install HelixScreen',
        icon: 'download-lock-outline',
        variant: 'danger',
        onPress: installHelixScreen,
      },
      { text: 'Cancel', onPress: () => setStage('complete') },
    ];
    if (stage === 'plugins') return [
      {
        text: selectedPlugins.length > 0
          ? `Install selected (${selectedPlugins.length})`
          : 'Select plugins to install',
        icon: 'download-outline',
        variant: 'primary',
        disabled: selectedPlugins.length === 0,
        onPress: installSelectedPlugins,
      },
      { text: 'Back', onPress: () => { setError(''); setStage('complete'); } },
    ];
    if (stage === 'plugin-result') return [
      { text: 'Back to plugins', icon: 'refresh', variant: 'primary', onPress: loadPlugins },
      { text: 'Done', onPress: close },
    ];
    if (stage === 'error') return [
      { text: 'Try again', icon: 'refresh', variant: 'primary', onPress: () => setStage('password') },
      { text: 'Close', onPress: close },
    ];
    const busyText = stage === 'checking'
      ? 'Checking…'
      : stage === 'helixscreen-installing'
        ? 'Installing HelixScreen…'
        : stage === 'plugin-loading'
          ? 'Loading plugins…'
          : 'Installing…';
    return [{ text: busyText, disabled: true, onPress: () => {} }];
  })();

  const title = stage === 'plugin-result'
    ? (pluginResult?.ok ? 'Plugins installed' : 'Plugin install results')
    : ({
        password: 'Set up Bespok3d',
        checking: 'Checking your U1',
        review: 'Confirm U1 enrollment',
        installing: 'Installing Bespok3d',
        complete: 'Bespok3d is ready',
        'helixscreen-confirm': 'Install HelixScreen?',
        'helixscreen-installing': 'Installing HelixScreen',
        'plugin-loading': 'Loading plugin catalog',
        plugins: 'Choose Bespok3d plugins',
        'plugin-installing': 'Installing selected plugins',
        error: 'Enrollment stopped safely',
      } satisfies Record<Exclude<Stage, 'plugin-result'>, string>)[stage];

  return (
    <ThemedDialog
      visible={visible}
      title={title}
      icon="cube-outline"
      shape={stage === 'review' || stage === 'helixscreen-confirm' ? 'focus' : 'auto'}
      onClose={close}
      actions={actions}
    >
      <View style={styles.body}>
        {stage === 'password' ? (
          <>
            {enrolled ? <Text style={styles.note}>Checking again will not remove your saved access.</Text> : null}
            <Text style={styles.copy}>
              Helix will first perform a read-only safety check. Enter the stock U1 SSH password.
            </Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="SSH password"
              placeholderTextColor={COCKPIT.dim}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              editable={!busy}
              onSubmitEditing={checkPrinter}
            />
            <Text style={styles.note}>The password is used for this run only and is never saved.</Text>
          </>
        ) : null}

        {stage === 'checking'
          || stage === 'installing'
          || stage === 'helixscreen-installing'
          || stage === 'plugin-loading'
          || stage === 'plugin-installing' ? (
          <View style={styles.progress}>
            <ActivityIndicator size="large" color={COCKPIT.accent} />
            <Text style={styles.copy}>
              {stage === 'checking'
                ? 'Confirming stock firmware, printer identity, idle state, and SSH host key…'
                : stage === 'installing'
                  ? 'Verifying the signed package, rebooting if needed, reconnecting, and installing. This can take several minutes. Keep Helix open and stay on this Wi-Fi.'
                  : stage === 'helixscreen-installing'
                    ? 'Verifying the HelixScreen package and uploading it to your U1. Keep Helix open, stay on this Wi-Fi, and do not start a print.'
                  : stage === 'plugin-loading'
                    ? 'Checking the signed official catalog and reading what is installed on your U1…'
                    : 'Downloading and verifying each selected package, then applying them together. Keep Helix open and do not start a print.'}
            </Text>
          </View>
        ) : null}

        {stage === 'review' && preflight ? (
          <>
            <Fact label="Printer" value={preflight.model} />
            <Fact label="Print state" value={preflight.printState} />
            <Fact label="SSH host key" value={preflight.sshHostKeySha256} mono />
            <View style={styles.warning}>
              <Text style={styles.warningTitle}>This changes the printer</Text>
              <Text style={styles.warningText}>
                The U1 may reboot. Helix will install the official signed Bespok3d daemon and startup hooks. Do not power off the printer or leave this network.
              </Text>
            </View>
          </>
        ) : null}

        {stage === 'helixscreen-confirm' ? (
          <>
            <Text style={styles.copy}>
              Helix will upload the bundled 42 MB touchscreen package to this U1 through its paired Bespok3d connection.
            </Text>
            <View style={styles.warning}>
              <Text style={styles.warningTitle}>This changes the printer touchscreen</Text>
              <Text style={styles.warningText}>
                Installation restarts the display service, but keeps the stock Snapmaker screen selected. After it finishes, you can deliberately switch to HelixScreen or return to stock at any time. Do not install while printing.
              </Text>
            </View>
          </>
        ) : null}

        {stage === 'complete' && enrolled ? (
          <>
            <Fact label="Printer" value={printer?.name || 'Snapmaker U1'} />
            <Fact label="Daemon" value={enrolled.daemonVersion} />
            <Fact label="U1 adapter" value={enrolled.jinniVersion} />
            <Fact label="Certificate" value={enrolled.certificateSha256} mono />
            {helixScreen?.installed ? (
              <View style={styles.screenCard}>
                <View style={styles.screenHeading}>
                  <View style={styles.screenCopy}>
                    <Text style={styles.screenTitle}>Printer touchscreen</Text>
                    <Text style={styles.screenHint}>
                      Switches only the U1 display. Klipper and printer settings stay unchanged.
                    </Text>
                  </View>
                  {screenBusy ? <ActivityIndicator size="small" color={COCKPIT.accent} /> : null}
                </View>
                <View style={styles.optionList}>
                  <ScreenChoice
                    label="Stock Snapmaker"
                    selected={helixScreen.selected === 'snapmaker'}
                    disabled={screenBusy}
                    onPress={() => switchScreen('snapmaker')}
                  />
                  <ScreenChoice
                    label="HelixScreen"
                    selected={helixScreen.selected === 'helixscreen'}
                    disabled={screenBusy}
                    onPress={() => switchScreen('helixscreen')}
                  />
                </View>
              </View>
            ) : helixScreen?.installed === false ? (
              <View style={styles.screenCard}>
                <View style={styles.screenHeading}>
                  <MaterialCommunityIcons name="monitor-arrow-down-variant" size={24} color={COCKPIT.accent} />
                  <View style={styles.screenCopy}>
                    <Text style={styles.screenTitle}>HelixScreen is available</Text>
                    <Text style={styles.screenHint}>
                      Install it from Helix, then choose between HelixScreen and the stock Snapmaker interface.
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.screenCard}>
                <View style={styles.screenHeading}>
                  <ActivityIndicator size="small" color={COCKPIT.accent} />
                  <Text style={styles.screenHint}>Checking touchscreen options…</Text>
                </View>
              </View>
            )}
            <Text style={styles.note}>Access credentials are stored in Android secure storage.</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : null}

        {stage === 'plugins' && catalog ? (
          <>
            <Text style={styles.note}>
              Nothing is installed until you check it and press Install selected. Packages come from the signed official catalog.
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.pluginList}>
              {catalog.plugins.map((plugin) => (
                <PluginChoice
                  key={plugin.id}
                  plugin={plugin}
                  installedVersion={catalog.installed[plugin.id]}
                  selected={selectedPlugins.includes(plugin.id)}
                  values={pluginVars[plugin.id] ?? {}}
                  onToggle={() => togglePlugin(plugin.id)}
                  onChange={(key, value) => setPluginVar(plugin.id, key, value)}
                />
              ))}
            </View>
          </>
        ) : null}

        {stage === 'plugin-result' && pluginResult ? (
          <View style={styles.resultList}>
            {pluginResult.installedIds.map((pluginId) => (
              <ResultRow key={pluginId} ok text={`${pluginId} installed`} />
            ))}
            {Object.entries(pluginResult.failures).map(([pluginId, reason]) => (
              <ResultRow key={pluginId} ok={false} text={`${pluginId}: ${reason}`} />
            ))}
            {pluginResult.installedIds.length === 0 && Object.keys(pluginResult.failures).length === 0 ? (
              <Text style={styles.note}>The selected plugins were already current.</Text>
            ) : null}
          </View>
        ) : null}

        {stage === 'error' ? (
          <>
            <Text style={styles.error}>{error || 'Enrollment did not finish.'}</Text>
            <Text style={styles.note}>
              The installer is safe to run again. It rechecks the printer and reuses the securely stored identity.
            </Text>
          </>
        ) : null}
      </View>
    </ThemedDialog>
  );
}

function PluginChoice({
  plugin,
  installedVersion,
  selected,
  values,
  onToggle,
  onChange,
}: {
  plugin: Bespok3dPlugin;
  installedVersion?: string;
  selected: boolean;
  values: Record<string, string>;
  onToggle: () => void;
  onChange: (key: string, value: string) => void;
}) {
  const isInstalled = installedVersion === plugin.version;
  const versionLabel = isInstalled
    ? `Installed · v${installedVersion}`
    : installedVersion
      ? `Update v${installedVersion} → v${plugin.version}`
      : `Available · v${plugin.version}`;
  return (
    <View style={[styles.plugin, selected && styles.pluginSelected]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected || isInstalled }}
        onPress={onToggle}
        style={styles.pluginHeader}
      >
        <MaterialCommunityIcons
          name={isInstalled ? 'check-circle' : selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
          size={25}
          color={isInstalled ? COCKPIT.success : selected ? COCKPIT.accent : COCKPIT.dim}
        />
        <View style={styles.pluginText}>
          <View style={styles.pluginTitleLine}>
            <Text style={styles.pluginTitle}>{plugin.title}</Text>
            <Text style={styles.pluginCategory}>{plugin.category}</Text>
          </View>
          <Text style={styles.pluginVersion}>{versionLabel}</Text>
          {plugin.tagline ? <Text style={styles.pluginTagline}>{plugin.tagline}</Text> : null}
          {plugin.dependencies.length > 0 ? (
            <Text style={styles.pluginDependency}>Also needs: {plugin.dependencies.join(', ')}</Text>
          ) : null}
        </View>
      </Pressable>
      {selected && plugin.config.length > 0 ? (
        <View style={styles.configList}>
          {plugin.config.map((field) => (
            <PluginConfigField
              key={field.key}
              field={field}
              value={values[field.key] ?? field.defaultValue ?? ''}
              onChange={(value) => onChange(field.key, value)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PluginConfigField({
  field,
  value,
  onChange,
}: {
  field: Bespok3dPluginConfigField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === 'toggle') {
    return (
      <View style={styles.configRow}>
        <View style={styles.configText}>
          <Text style={styles.configLabel}>{field.label}</Text>
          {field.hint ? <Text style={styles.configHint}>{field.hint}</Text> : null}
        </View>
        <Switch
          value={value === field.onValue}
          onValueChange={(enabled) => onChange(enabled ? field.onValue : field.offValue)}
          trackColor={{ false: COCKPIT.border, true: alpha(COCKPIT.accent, 0.5) }}
          thumbColor={value === field.onValue ? COCKPIT.accent : COCKPIT.dim}
        />
      </View>
    );
  }
  if (field.type === 'select' && field.options.length > 0) {
    return (
      <View style={styles.configBlock}>
        <Text style={styles.configLabel}>{field.label}</Text>
        <View style={styles.optionList}>
          {field.options.map((option) => (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              style={[styles.option, value === option && styles.optionSelected]}
            >
              <Text style={[styles.optionText, value === option && styles.optionTextSelected]}>{option}</Text>
            </Pressable>
          ))}
        </View>
        {field.hint ? <Text style={styles.configHint}>{field.hint}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.configBlock}>
      <Text style={styles.configLabel}>{field.label}{field.required ? ' *' : ''}</Text>
      <TextInput
        style={styles.configInput}
        value={value}
        onChangeText={onChange}
        keyboardType={field.type === 'number' || field.type === 'http-port' ? 'number-pad' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {field.hint ? <Text style={styles.configHint}>{field.hint}</Text> : null}
    </View>
  );
}

function ResultRow({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={styles.resultRow}>
      <MaterialCommunityIcons
        name={ok ? 'check-circle' : 'alert-circle'}
        size={20}
        color={ok ? COCKPIT.success : COCKPIT.danger}
      />
      <Text style={styles.resultText}>{text}</Text>
    </View>
  );
}

function ScreenChoice({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected, disabled && styles.optionDisabled]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, mono && styles.mono]} selectable={mono}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { alignSelf: 'stretch', gap: 12 },
  copy: { color: COCKPIT.text, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  note: { color: COCKPIT.dim, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COCKPIT.border,
    backgroundColor: COCKPIT.surfaceAlt,
    color: COCKPIT.text,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  progress: { alignItems: 'center', gap: 16, paddingVertical: 16 },
  fact: { borderRadius: 12, backgroundColor: COCKPIT.surfaceAlt, padding: 12, gap: 4 },
  factLabel: { color: COCKPIT.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  factValue: { color: COCKPIT.text, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  mono: { fontFamily: 'monospace', fontSize: 10 },
  warning: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: alpha(COCKPIT.danger, 0.52),
    backgroundColor: alpha(COCKPIT.danger, 0.12),
    padding: 14,
    gap: 6,
  },
  warningTitle: { color: COCKPIT.danger, fontSize: 14, fontWeight: '900' },
  warningText: { color: COCKPIT.text, fontSize: 12, lineHeight: 18 },
  error: { color: COCKPIT.danger, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  screenCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COCKPIT.border,
    backgroundColor: COCKPIT.surfaceAlt,
    padding: 14,
    gap: 12,
  },
  screenHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  screenCopy: { flex: 1, gap: 4 },
  screenTitle: { color: COCKPIT.text, fontSize: 14, fontWeight: '900' },
  screenHint: { color: COCKPIT.dim, fontSize: 11, lineHeight: 16 },
  pluginList: { alignSelf: 'stretch', gap: 10 },
  plugin: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COCKPIT.border,
    backgroundColor: COCKPIT.surfaceAlt,
    overflow: 'hidden',
  },
  pluginSelected: { borderColor: alpha(COCKPIT.accent, 0.75) },
  pluginHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 14 },
  pluginText: { flex: 1, gap: 4 },
  pluginTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pluginTitle: { flex: 1, color: COCKPIT.text, fontSize: 15, fontWeight: '800' },
  pluginCategory: {
    color: COCKPIT.dim,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  pluginVersion: { color: COCKPIT.accent, fontSize: 11, fontWeight: '800' },
  pluginTagline: { color: COCKPIT.dim, fontSize: 12, lineHeight: 17 },
  pluginDependency: { color: COCKPIT.warn, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  configList: { borderTopWidth: 1, borderTopColor: COCKPIT.border, padding: 14, gap: 14 },
  configRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  configBlock: { gap: 7 },
  configText: { flex: 1, gap: 3 },
  configLabel: { color: COCKPIT.text, fontSize: 13, fontWeight: '800' },
  configHint: { color: COCKPIT.dim, fontSize: 10, lineHeight: 15 },
  configInput: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COCKPIT.border,
    backgroundColor: COCKPIT.bg,
    color: COCKPIT.text,
    paddingHorizontal: 12,
  },
  optionList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COCKPIT.border,
    backgroundColor: COCKPIT.bg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionSelected: { borderColor: COCKPIT.accent, backgroundColor: alpha(COCKPIT.accent, 0.16) },
  optionDisabled: { opacity: 0.6 },
  optionText: { color: COCKPIT.dim, fontSize: 11, fontWeight: '800' },
  optionTextSelected: { color: COCKPIT.accent },
  resultList: { alignSelf: 'stretch', gap: 10 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderRadius: 12,
    backgroundColor: COCKPIT.surfaceAlt,
    padding: 12,
  },
  resultText: { flex: 1, color: COCKPIT.text, fontSize: 12, lineHeight: 18 },
});
