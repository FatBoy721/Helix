const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Repo root, resolved off this script's own location rather than the working
// directory, so the asset checks below pass wherever the suite is run from.
const REPO_ROOT = path.dirname(require.resolve('../package.json'));

require.extensions['.ts'] = function loadTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

const {
  countSelectedMacros,
  filterMacrosForDisplay,
  getMacroDisplay,
  normalizeMacroDisplay,
  normalizeMacroDisplayByPrinter,
  setMacroDisplayForPrinter,
  toggleMacroInDisplay,
} = require(path.join('..', 'services', 'macroDisplay.ts'));
const {
  buildSettingsSavePatch,
  hasDraftChanges,
} = require(path.join('..', 'services', 'settingsDraft.ts'));
const {
  bespok3dCredentialStorageKey,
  createEnrolledBespok3dCredentialRecord,
  createPreparedBespok3dCredentialRecord,
  normalizeBespok3dCredentialRecord,
} = require(path.join('..', 'services', 'bespok3dCredentials.ts'));
const {
  DEFAULT_SETTINGS,
  STORAGE_VERSION,
  migrateSettings,
} = require(path.join('..', 'services', 'settingsMigration.ts'));
const {
  buildSettingsBackup,
  parseSettingsBackup,
} = require(path.join('..', 'services', 'settingsBackup.ts'));
const {
  buildBugReportUrl,
  compareReleaseVersions,
  isCurrentRelease,
  isReleaseUpdateAvailable,
  releaseCommit,
  releaseDownloadUrl,
} = require(path.join('..', 'services', 'updateCheck.ts'));
const {
  calculatePrintEtas,
  parseLatestM73,
  smoothRemainingEstimate,
} = require(path.join('..', 'services', 'printEta.ts'));
const {
  historyFailureMessage,
  terminalPrintStateForHistory,
  withQueryParameter,
} = require(path.join('..', 'services', 'notificationEvents.ts'));
const {
  displayTemperature,
  formatTemperature,
  inputTemperatureToCelsius,
  normalizeTemperatureUnit,
} = require(path.join('..', 'services', 'temperature.ts'));
const {
  cacheBustUrl,
  cameraSnapshotFileName,
} = require(path.join('..', 'services', 'cameraSnapshot.ts'));
const {
  findMachineChamberTemperatureSource,
  findPandaBreathTemperatureSource,
} = require(path.join('..', 'services', 'chamberTemperature.ts'));
const {
  buildAiMonitoringCommand,
  buildManualFilamentSlotCommand,
  fileUrl,
  helixdLanBaseUrl,
  helixdRemoteBaseUrl,
  helixdRemoteMoonrakerUrl,
  isTailscaleUrl,
  normalizeBaseUrl,
  normalizeMoonrakerUrl,
  printerConnectionUrl,
  resolveCameraUrl,
  resolveScreenApiUrl,
  resolveSnapshotUrl,
  thumbnailUrl,
  validatePrinterConnectionTarget,
  wsUrl,
} = require(path.join('..', 'services', 'moonraker.ts'));
const {
  FILAMENT_MAIN_TYPES,
  FILAMENT_SUB_TYPES,
  MAIN_TYPE_PATTERN,
  subtypesForMainType,
} = require(path.join('..', 'services', 'filamentMaterials.ts'));
const {
  FILAMENT_TEMP_CATALOG,
  filamentTempRange,
  filamentTempTarget,
} = require(path.join('..', 'services', 'filamentCatalog.ts'));
const {
  deriveMainType,
  resolveProfileValues,
} = require(path.join('..', 'services', 'filamentProfiles.ts'));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('normalizes invalid macro display to show all', () => {
  assert.deepEqual(normalizeMacroDisplay(undefined), { mode: 'all', selected: [] });
  assert.deepEqual(normalizeMacroDisplay({ mode: 'wat' }), { mode: 'all', selected: [] });
});

test('normalizes selected macros by trimming, deduping, and sorting', () => {
  assert.deepEqual(
    normalizeMacroDisplay({
      mode: 'selected',
      selected: [' HOME ', '', 'PRINT_START', 'HOME', 42, null],
    }),
    { mode: 'selected', selected: ['HOME', 'PRINT_START'] }
  );
});

test('normalizes per-printer macro display map and ignores bad entries', () => {
  assert.deepEqual(
    normalizeMacroDisplayByPrinter({
      p1: { mode: 'selected', selected: ['B', 'A', 'A'] },
      p2: null,
      p3: [],
    }),
    { p1: { mode: 'selected', selected: ['A', 'B'] } }
  );
});

test('returns default display when active printer has no saved choice', () => {
  assert.deepEqual(
    getMacroDisplay({
      activePrinterId: 'missing',
      macroDisplayByPrinter: { p1: { mode: 'selected', selected: ['HOME'] } },
    }),
    { mode: 'all', selected: [] }
  );
});

test('sets macro display for active printer without mutating existing map', () => {
  const current = { p1: { mode: 'selected', selected: ['HOME'] } };
  const next = setMacroDisplayForPrinter(current, 'p2', {
    mode: 'selected',
    selected: ['PRINT_END', 'PRINT_START', 'PRINT_END'],
  });

  assert.deepEqual(current, { p1: { mode: 'selected', selected: ['HOME'] } });
  assert.deepEqual(next, {
    p1: { mode: 'selected', selected: ['HOME'] },
    p2: { mode: 'selected', selected: ['PRINT_END', 'PRINT_START'] },
  });
});

test('filters only selected macros while preserving printer order', () => {
  assert.deepEqual(
    filterMacrosForDisplay(['HOME', 'BED_MESH_CALIBRATE', 'PRINT_START'], {
      mode: 'selected',
      selected: ['PRINT_START', 'HOME', 'STALE_MACRO'],
    }),
    ['HOME', 'PRINT_START']
  );
});

test('show all mode leaves macros unchanged', () => {
  const macros = ['HOME', 'PRINT_START'];
  assert.equal(filterMacrosForDisplay(macros, { mode: 'all', selected: [] }), macros);
});

test('toggle selects and deselects macros in selected mode', () => {
  const afterSelect = toggleMacroInDisplay({ mode: 'all', selected: [] }, 'HOME');
  assert.deepEqual(afterSelect, { mode: 'selected', selected: ['HOME'] });

  const afterDeselect = toggleMacroInDisplay(afterSelect, 'HOME');
  assert.deepEqual(afterDeselect, { mode: 'selected', selected: [] });
});

test('counts only macros that still exist on the printer', () => {
  assert.equal(
    countSelectedMacros(['HOME', 'PRINT_START'], {
      mode: 'selected',
      selected: ['HOME', 'STALE_MACRO'],
    }),
    1
  );
  assert.equal(countSelectedMacros([], { mode: 'selected', selected: ['STALE_MACRO'] }), 1);
});

function settings(overrides = {}) {
  return {
    primaryUrl: 'http://192.168.1.17:7125',
    tailscaleUrl: '',
    cameraUrl: '/webcam/webrtc',
    connectionMode: 'lan',
    notificationMode: 'local',
    ntfyServer: 'https://ntfy.sh',
    ntfyTopic: '',
    aceUnits: 1,
    notifyPrintComplete: true,
    notifyPrintFailed: true,
    notifyPrintPaused: true,
    notifyPrintCancelled: true,
    notifyPrintProgress: false,
    notifyFilamentRunout: true,
    notifySwapComplete: true,
    notifyPrinterError: true,
    notifyPrinterDisconnected: true,
    notifyTempWarning: true,
    activePrinterId: 'p1',
    printers: [
      {
        id: 'p1',
        name: 'Snapmaker U1',
        url: 'http://192.168.1.17:7125',
        tailscaleUrl: '',
        cameraUrl: '/webcam/webrtc',
        connectionMode: 'lan',
      },
      {
        id: 'p2',
        name: 'Backup',
        url: 'http://192.168.1.99:7125',
        tailscaleUrl: '',
        cameraUrl: '/webcam/webrtc',
        connectionMode: 'lan',
      },
    ],
    dashboard: { macros: true },
    macroDisplayByPrinter: { p1: { mode: 'selected', selected: ['HOME'] } },
    ...overrides,
  };
}

test('settings backup file JSON round-trips through migration', () => {
  const original = migrateSettings(settings());
  const restored = parseSettingsBackup(buildSettingsBackup(original));
  assert.deepEqual(restored, original);
});

test('settings backup import rejects invalid and unrelated JSON files', () => {
  assert.throws(
    () => parseSettingsBackup('not json'),
    /does not contain valid JSON/,
  );
  assert.throws(
    () => parseSettingsBackup('{"hello":"world"}'),
    /does not look like a Helix settings backup/,
  );
});

test('dirty check only watches draft-managed settings fields', () => {
  assert.equal(
    hasDraftChanges(
      settings({ dashboard: { macros: false } }),
      settings({ dashboard: { macros: true } })
    ),
    false
  );
  assert.equal(hasDraftChanges(settings({ ntfyTopic: 'new' }), settings()), true);
});

test('settings save patch does not overwrite live-only settings', () => {
  const draft = settings({
    primaryUrl: '192.168.1.50',
    tailscaleUrl: '100.64.0.50',
    cameraUrl: '/webcam/snapshot',
    connectionMode: 'tailscale',
    ntfyTopic: 'printer-alerts',
    dashboard: { macros: false },
    macroDisplayByPrinter: { p1: { mode: 'selected', selected: ['PRINT_START'] } },
  });
  const stored = settings({
    dashboard: { macros: true },
    macroDisplayByPrinter: { p1: { mode: 'selected', selected: ['HOME'] } },
  });

  const patch = buildSettingsSavePatch(draft, stored, {
    primaryUrl: 'http://192.168.1.50:7125',
    tailscaleUrl: 'http://100.64.0.50:7125',
  });

  assert.equal(Object.hasOwn(patch, 'dashboard'), false);
  assert.equal(Object.hasOwn(patch, 'macroDisplayByPrinter'), false);
  assert.equal(patch.primaryUrl, 'http://192.168.1.50:7125');
  assert.equal(patch.tailscaleUrl, 'http://100.64.0.50:7125');
  assert.equal(patch.cameraUrl, '/webcam/snapshot');
  assert.equal(patch.connectionMode, 'tailscale');
  assert.equal(patch.ntfyTopic, 'printer-alerts');
  assert.deepEqual(patch.printers[0], {
    id: 'p1',
    name: 'Snapmaker U1',
    url: 'http://192.168.1.50:7125',
    tailscaleUrl: 'http://100.64.0.50:7125',
    cameraUrl: '/webcam/snapshot',
    connectionMode: 'tailscale',
  });
  assert.equal(patch.printers[1].url, 'http://192.168.1.99:7125');
});

test('settings migration starts first launch without a prefilled printer', () => {
  const migrated = migrateSettings({});

  assert.equal(migrated.settingsVersion, STORAGE_VERSION);
  assert.equal(migrated.activePrinterId, '');
  assert.equal(migrated.primaryUrl, '');
  assert.equal(migrated.connectionMode, 'lan');
  assert.equal(migrated.dashboard.pandaBreath, false);
  assert.equal(migrated.temperatureUnit, 'c');
  assert.equal(migrated.aiDetectionSensitivity, 'low');
  assert.deepEqual(migrated.printers, []);
});

test('settings migration normalizes legacy single-printer settings', () => {
  const migrated = migrateSettings({
    primaryUrl: '192.168.1.50',
    tailscaleUrl: '100.64.0.50',
    cameraUrl: '/webcam/snapshot',
  });

  assert.equal(migrated.primaryUrl, 'http://192.168.1.50:7125');
  assert.equal(migrated.tailscaleUrl, 'http://100.64.0.50:7125');
  assert.equal(migrated.cameraUrl, '/webcam/snapshot');
  assert.deepEqual(migrated.printers[0], {
    id: 'p1',
    name: 'Snapmaker U1',
    url: 'http://192.168.1.50:7125',
    tailscaleUrl: 'http://100.64.0.50:7125',
    cameraUrl: '/webcam/snapshot',
    connectionMode: 'lan',
    kind: 'snapmaker-u1',
  });
});

test('settings migration resets legacy broken camera defaults', () => {
  assert.equal(
    migrateSettings({ cameraUrl: 'http://192.168.1.17/webcam/stream' }).cameraUrl,
    DEFAULT_SETTINGS.cameraUrl
  );
  assert.equal(
    migrateSettings({ cameraUrl: '/webcam/stream.mjpg' }).cameraUrl,
    DEFAULT_SETTINGS.cameraUrl
  );
});

test('settings migration preserves dashboard defaults and valid notification mode', () => {
  const migrated = migrateSettings({
    dashboard: { macros: false },
    notificationMode: 'ntfy',
    ntfyTopic: 'printer-alerts',
  });

  assert.equal(migrated.dashboard.macros, false);
  assert.equal(migrated.dashboard.camera, true);
  assert.equal(migrated.dashboard.pandaBreath, false);
  assert.equal(migrated.notificationMode, 'ntfy');
});

test('settings migration normalizes temperature unit', () => {
  assert.equal(migrateSettings({ temperatureUnit: 'f' }).temperatureUnit, 'f');
  assert.equal(migrateSettings({ temperatureUnit: 'wat' }).temperatureUnit, 'c');
});

test('settings migration accepts only firmware-supported AI sensitivity values', () => {
  assert.equal(migrateSettings({ aiDetectionSensitivity: 'high' }).aiDetectionSensitivity, 'high');
  assert.equal(migrateSettings({ aiDetectionSensitivity: 'medium' }).aiDetectionSensitivity, 'low');
});

test('temperature unit helpers convert display and input values', () => {
  assert.equal(normalizeTemperatureUnit('f'), 'f');
  assert.equal(normalizeTemperatureUnit('bad'), 'c');
  assert.equal(displayTemperature(100, 'f'), 212);
  assert.equal(Math.round(inputTemperatureToCelsius('212', 'f')), 100);
  assert.equal(inputTemperatureToCelsius('60', 'c'), 60);
  assert.equal(formatTemperature(100, 'f', 0), '212\u00B0F');
  assert.equal(formatTemperature(100, 'c', 0), '100\u00B0C');
});

test('settings migration infers ntfy mode from existing ntfy topic', () => {
  const migrated = migrateSettings({ notificationMode: 'wat', ntfyTopic: 'printer-alerts' });
  assert.equal(migrated.notificationMode, 'ntfy');
});

test('settings migration falls back to first printer when active ID is invalid', () => {
  const migrated = migrateSettings({
    activePrinterId: 'missing',
    printers: [
      {
        id: 'p2',
        name: 'Garage',
        url: '192.168.1.60',
        tailscaleUrl: '100.64.0.60',
        cameraUrl: '/cam',
        connectionMode: 'auto',
      },
    ],
  });

  assert.equal(migrated.activePrinterId, 'p2');
  assert.equal(migrated.primaryUrl, 'http://192.168.1.60:7125');
  assert.equal(migrated.tailscaleUrl, 'http://100.64.0.60:7125');
  assert.equal(migrated.cameraUrl, '/cam');
  assert.equal(migrated.connectionMode, 'auto');
});

test('settings migration preserves Tailscale-only printer without LAN URL', () => {
  const migrated = migrateSettings({
    activePrinterId: 'p1',
    primaryUrl: '',
    tailscaleUrl: '100.115.155.101',
    connectionMode: 'tailscale',
    printers: [
      {
        id: 'p1',
        name: 'Remote',
        url: '',
        tailscaleUrl: '100.115.155.101',
        cameraUrl: '/webcam/webrtc',
        connectionMode: 'tailscale',
      },
    ],
  });

  assert.equal(migrated.activePrinterId, 'p1');
  assert.equal(migrated.primaryUrl, '');
  assert.equal(migrated.tailscaleUrl, 'http://100.115.155.101:7125');
  assert.equal(migrated.printers[0].url, '');
  assert.equal(migrated.printers[0].tailscaleUrl, 'http://100.115.155.101:7125');
  assert.equal(migrated.connectionMode, 'tailscale');
});

test('settings migration preserves active printer using the old prefilled default URL', () => {
  const migrated = migrateSettings({
    activePrinterId: 'p1',
    primaryUrl: 'http://192.168.1.17:7125',
    printers: [
      {
        id: 'p1',
        name: 'Mine',
        url: 'http://192.168.1.17:7125',
        tailscaleUrl: '',
        cameraUrl: DEFAULT_SETTINGS.cameraUrl,
        connectionMode: 'lan',
      },
      {
        id: 'p2',
        name: 'Buddy',
        url: '192.168.1.77',
        tailscaleUrl: '',
        cameraUrl: '/webcam/webrtc',
        connectionMode: 'lan',
      },
    ],
  });

  assert.equal(migrated.activePrinterId, 'p1');
  assert.equal(migrated.primaryUrl, 'http://192.168.1.17:7125');
  assert.equal(migrated.printers[0].url, 'http://192.168.1.17:7125');
});

test('settings migration normalizes saved macro display by printer', () => {
  const migrated = migrateSettings({
    macroDisplayByPrinter: {
      p1: { mode: 'selected', selected: [' HOME ', 'HOME', 'PRINT_START'] },
      p2: { mode: 'wat', selected: ['IGNORED_MODE_BUT_VALID_NAME'] },
    },
  });

  assert.deepEqual(migrated.macroDisplayByPrinter, {
    p1: { mode: 'selected', selected: ['HOME', 'PRINT_START'] },
    p2: { mode: 'all', selected: ['IGNORED_MODE_BUT_VALID_NAME'] },
  });
});

test('settings migration recovers from corrupt saved value types', () => {
  const migrated = migrateSettings({
    primaryUrl: 42,
    tailscaleUrl: false,
    cameraUrl: null,
    dashboard: { camera: 'yes', macros: false },
    printers: [
      null,
      {
        id: 42,
        name: null,
        url: 99,
        tailscaleUrl: false,
        cameraUrl: 5,
      },
    ],
    notifyPrintComplete: 'yes',
    notifyPrintPaused: false,
    aceUnits: '2',
    ntfyServer: 10,
    ntfyTopic: 20,
    accentColor: null,
    language: false,
  });

  assert.equal(migrated.primaryUrl, '');
  assert.equal(migrated.tailscaleUrl, '');
  assert.equal(migrated.cameraUrl, DEFAULT_SETTINGS.cameraUrl);
  assert.equal(migrated.dashboard.camera, true);
  assert.equal(migrated.dashboard.macros, false);
  assert.deepEqual(migrated.printers, []);
  assert.equal(migrated.notifyPrintComplete, true);
  assert.equal(migrated.notifyPrintPaused, false);
  assert.equal(migrated.notifyPrintCancelled, true);
  assert.equal(migrated.notifyPrintProgress, false);
  assert.equal(migrated.aceUnits, DEFAULT_SETTINGS.aceUnits);
  assert.equal(migrated.ntfyServer, DEFAULT_SETTINGS.ntfyServer);
  assert.equal(migrated.ntfyTopic, DEFAULT_SETTINGS.ntfyTopic);
  assert.equal(migrated.accentColor, DEFAULT_SETTINGS.accentColor);
  assert.equal(migrated.language, DEFAULT_SETTINGS.language);
});

test('settings migration defaults filamentSlotSubtypes and preserves valid saved values', () => {
  assert.deepEqual(migrateSettings({}).filamentSlotSubtypes, ['Basic', 'Basic', 'Basic', 'Basic']);
  assert.deepEqual(
    migrateSettings({ filamentSlotSubtypes: ['CF', '  Silk  ', '', undefined] }).filamentSlotSubtypes,
    ['CF', 'Silk', 'Basic', 'Basic']
  );
});

test('normalizes base URLs without forcing Moonraker port', () => {
  assert.equal(normalizeBaseUrl('192.168.1.17'), 'http://192.168.1.17');
  assert.equal(normalizeBaseUrl(' https://printer.local/ '), 'https://printer.local');
  assert.equal(normalizeBaseUrl(''), '');
});

test('normalizes Moonraker URLs with default HTTP port 7125', () => {
  assert.equal(normalizeMoonrakerUrl('192.168.1.17'), 'http://192.168.1.17:7125');
  assert.equal(normalizeMoonrakerUrl('http://192.168.1.17/'), 'http://192.168.1.17:7125');
  assert.equal(normalizeMoonrakerUrl('https://printer.local/'), 'https://printer.local');
  assert.equal(normalizeMoonrakerUrl('http://100.115.155.101:80'), 'http://100.115.155.101:7125');
});

test('derives the AD5X helixd origin without hardcoding a remote host', () => {
  assert.equal(helixdLanBaseUrl('http://192.168.1.83:7125'), 'http://192.168.1.83');
  assert.equal(helixdLanBaseUrl('http://192.168.1.83/fluidd/'), 'http://192.168.1.83');
  assert.equal(helixdLanBaseUrl('not a valid host'), '');
});

test('accepts helixd serve_url only while its backend is running', () => {
  const live = {
    backend_state: 'Running',
    dns_name: 'renamed-printer.example.ts.net',
    serve_url: 'https://renamed-printer.example.ts.net/',
  };
  assert.equal(helixdRemoteBaseUrl(live), 'https://renamed-printer.example.ts.net');
  assert.equal(helixdRemoteBaseUrl({ ...live, backend_state: 'Stopped' }), '');
  assert.equal(helixdRemoteBaseUrl({ ...live, serve_url: '' }), '');
  assert.equal(helixdRemoteBaseUrl({ ...live, serve_url: 'javascript:alert(1)' }), '');
  assert.equal(
    helixdRemoteMoonrakerUrl(helixdRemoteBaseUrl(live)),
    'http://renamed-printer.example.ts.net:7125'
  );
  assert.equal(helixdRemoteMoonrakerUrl('https://ordinary.example.com'), '');
});

test('detects Tailscale hosts and IPs', () => {
  assert.equal(isTailscaleUrl('http://100.115.155.101:7125'), true);
  assert.equal(isTailscaleUrl('printer.tailnet.ts.net'), true);
  assert.equal(isTailscaleUrl('http://192.168.1.17:7125'), false);
});

test('chooses visible printer URL from connection mode', () => {
  const printer = {
    url: 'http://192.168.1.17:7125',
    tailscaleUrl: 'http://100.115.155.101:7125',
  };

  assert.equal(
    printerConnectionUrl({ ...printer, connectionMode: 'lan' }),
    'http://192.168.1.17:7125'
  );
  assert.equal(
    printerConnectionUrl({ ...printer, connectionMode: 'tailscale' }),
    'http://100.115.155.101:7125'
  );
  assert.equal(
    printerConnectionUrl({ url: '', tailscaleUrl: '100.115.155.101', connectionMode: 'tailscale' }),
    'http://100.115.155.101:7125'
  );
  assert.equal(
    printerConnectionUrl({ url: '192.168.1.17', tailscaleUrl: '100.115.155.101', connectionMode: 'auto' }),
    'http://192.168.1.17:7125'
  );
});

test('validates required URLs for each printer connection mode', () => {
  assert.equal(validatePrinterConnectionTarget('lan', '', ''), 'missing-printer-url');
  assert.equal(validatePrinterConnectionTarget('tailscale', '', ''), 'missing-tailscale-url');
  assert.equal(validatePrinterConnectionTarget('tailscale', '', 'http://100.115.155.101:7125'), null);
  assert.equal(validatePrinterConnectionTarget('auto', '', ''), 'missing-printer-url');
  assert.equal(validatePrinterConnectionTarget('auto', '', 'http://100.115.155.101:7125'), null);
});

test('builds websocket URL from active Moonraker URL', () => {
  assert.equal(wsUrl('http://192.168.1.17:7125'), 'ws://192.168.1.17:7125/websocket');
  assert.equal(wsUrl('https://printer.tailnet.ts.net'), 'wss://printer.tailnet.ts.net/websocket');
});

test('prefers U1 cavity sensor over Panda Breath for machine chamber temperature', () => {
  const source = findMachineChamberTemperatureSource({
    'heater_generic panda_breath': { temperature: 48, target: 50 },
    'temperature_sensor cavity': { temperature: 42 },
  });

  assert.equal(source.key, 'temperature_sensor cavity');
  assert.equal(source.label, 'Cavity');
  assert.equal(source.data.temperature, 42);
});

test('does not use Panda Breath as the machine chamber temperature source', () => {
  assert.equal(
    findMachineChamberTemperatureSource({
      'heater_generic panda_breath': { temperature: 48, target: 50 },
    }),
    null
  );
});

test('finds Panda Breath as its own temperature source', () => {
  const source = findPandaBreathTemperatureSource({
    'temperature_sensor cavity': { temperature: 42 },
    'heater_generic panda_breath': { temperature: 48, target: 50 },
  });

  assert.equal(source.key, 'heater_generic panda_breath');
  assert.equal(source.label, 'Panda Breath');
  assert.equal(source.data.temperature, 48);
  assert.equal(source.data.target, 50);
});

test('resolves camera paths against active printer host on port 80', () => {
  assert.equal(
    resolveCameraUrl('/webcam/webrtc', 'http://192.168.1.17:7125'),
    'http://192.168.1.17/webcam/webrtc'
  );
  assert.equal(
    resolveCameraUrl('webcam/snapshot', 'http://100.115.155.101:7125'),
    'http://100.115.155.101/webcam/snapshot'
  );
  assert.equal(
    resolveCameraUrl('http://camera.local/stream', 'http://192.168.1.17:7125'),
    'http://camera.local/stream'
  );
  assert.equal(
    resolveCameraUrl('/webcam/?action=stream', 'https://renamed-printer.example.ts.net'),
    'https://renamed-printer.example.ts.net/webcam/?action=stream'
  );
  assert.equal(
    resolveScreenApiUrl('https://renamed-printer.example.ts.net'),
    'https://renamed-printer.example.ts.net'
  );
});

test('resolves snapshot URL from explicit value or webcam stream', () => {
  assert.equal(
    resolveSnapshotUrl('/custom/snapshot', '/webcam/webrtc', 'http://192.168.1.17:7125'),
    'http://192.168.1.17/custom/snapshot'
  );
  assert.equal(
    resolveSnapshotUrl(undefined, '/webcam/webrtc', 'http://192.168.1.17:7125'),
    'http://192.168.1.17/webcam/snapshot.jpg'
  );
  assert.equal(resolveSnapshotUrl(undefined, '/screen/', 'http://192.168.1.17:7125'), '');
});

test('builds encoded file and thumbnail URLs', () => {
  assert.equal(
    fileUrl('http://printer:7125', 'gcodes', 'folder/test file.gcode'),
    'http://printer:7125/server/files/gcodes/folder/test%20file.gcode'
  );
  assert.equal(
    thumbnailUrl('http://printer:7125', 'folder/test file.gcode', '.thumbs/preview 300.png'),
    'http://printer:7125/server/files/gcodes/folder/.thumbs/preview%20300.png'
  );
});

test('buildAiMonitoringCommand explicitly arms U1 spaghetti and bed checks', () => {
  assert.equal(
    buildAiMonitoringCommand(true),
    'DEFECT_DETECTION_CONFIG MAIN_ENABLE=1 CLEAN_BED_ENABLE=1 NOODLE_ENABLE=1 SENSITIVITY=low'
  );
  assert.equal(
    buildAiMonitoringCommand(true, 'high'),
    'DEFECT_DETECTION_CONFIG MAIN_ENABLE=1 CLEAN_BED_ENABLE=1 NOODLE_ENABLE=1 SENSITIVITY=high'
  );
  assert.equal(
    buildAiMonitoringCommand(false),
    'DEFECT_DETECTION_CONFIG MAIN_ENABLE=0'
  );
});

test('slicer offers AI Monitoring with the promised behavior and applies it before print', () => {
  const dialog = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'PrintPreprocessDialog.tsx'),
    'utf8'
  );
  const slicer = fs.readFileSync(
    path.join(REPO_ROOT, 'app', '(tabs)', 'slicer.tsx'),
    'utf8'
  );
  const settingsScreen = fs.readFileSync(
    path.join(REPO_ROOT, 'app', '(tabs)', 'settings.tsx'),
    'utf8'
  );
  const settingsHook = fs.readFileSync(
    path.join(REPO_ROOT, 'hooks', 'useSettings.tsx'),
    'utf8'
  );
  const nativeSlicer = fs.readFileSync(
    path.join(REPO_ROOT, 'services', 'nativeSlicer.ts'),
    'utf8'
  );

  assert.match(dialog, />AI Monitoring</);
  assert.match(dialog, /Detects spaghetti failures and build-plate obstructions/);
  assert.match(slicer, /const \[aiMonitoring, setAiMonitoring\] = useState\(true\)/);
  assert.match(slicer, /buildAiMonitoringCommand\(aiMonitoring, settings\.aiDetectionSensitivity\)/);
  assert.match(settingsScreen, /<LabeledSensitivitySlider/);
  assert.match(settingsScreen, /spaghetti failures and build-plate/);
  assert.match(settingsScreen, /liveActivePrinter\?\.kind === 'snapmaker-u1'/);
  assert.match(settingsScreen, /measureInWindow/);
  assert.match(settingsScreen, /updatePosition\(event\.nativeEvent\.pageX\)/);
  assert.match(nativeSlicer, /setAiDetectionSensitivity\?\.\(value\)/);
  assert.match(settingsHook, /setNativeAiDetectionSensitivity\(migrated\.aiDetectionSensitivity\)/);
  assert.match(settingsHook, /setNativeAiDetectionSensitivity\(next\.aiDetectionSensitivity\)/);
});

test('buildManualFilamentSlotCommand rejects out-of-range and non-integer channels', () => {
  for (const bad of [-1, 4, 1.5, NaN, Infinity, '0', null]) {
    assert.throws(
      () => buildManualFilamentSlotCommand(bad, {}),
      { message: /channel/i },
      `expected channel ${String(bad)} to be rejected`
    );
  }
});

test('buildManualFilamentSlotCommand accepts channel bounds 0 through 3', () => {
  for (const ok of [0, 1, 2, 3]) {
    const cmd = buildManualFilamentSlotCommand(ok, {});
    assert.match(cmd, new RegExp(`CONFIG_EXTRUDER=${ok}\\b`));
  }
});

test('buildManualFilamentSlotCommand applies vendor/material/subtype defaults on empty info', () => {
  const cmd = buildManualFilamentSlotCommand(0, {});
  assert.equal(
    cmd,
    'SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=0 VENDOR="Generic" FILAMENT_TYPE=PLA FILAMENT_SUBTYPE="Basic" COLOR_NUMS=1 COLORS=FFFFFF MULTI_MODE=0 ALPHA=255 FORCE=1'
  );
});

test('buildManualFilamentSlotCommand quotes vendor and subtype but not material', () => {
  const cmd = buildManualFilamentSlotCommand(2, {
    VENDOR: 'SUNLU',
    MAIN_TYPE: 'PETG',
    SUB_TYPE: 'Matte',
    RGB_1: 0x1a2b3c,
    ALPHA: 220,
  });
  assert.equal(
    cmd,
    'SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=2 VENDOR="SUNLU" FILAMENT_TYPE=PETG FILAMENT_SUBTYPE="Matte" COLOR_NUMS=1 COLORS=1A2B3C MULTI_MODE=0 ALPHA=220 FORCE=1'
  );
});

test('buildManualFilamentSlotCommand preserves spaces in vendor and subtype', () => {
  const cmd = buildManualFilamentSlotCommand(1, { VENDOR: 'Bambu Lab', SUB_TYPE: 'High Speed' });
  assert.match(cmd, /VENDOR="Bambu Lab"/);
  assert.match(cmd, /FILAMENT_SUBTYPE="High Speed"/);
});

test('buildManualFilamentSlotCommand rejects quote, backslash, and newline in text fields', () => {
  for (const bad of ['has"quote', 'back\\slash', 'new\nline', 'car\rriage']) {
    assert.throws(() => buildManualFilamentSlotCommand(0, { VENDOR: bad }), { message: /vendor/i });
    assert.throws(() => buildManualFilamentSlotCommand(0, { SUB_TYPE: bad }), { message: /subtype/i });
    assert.throws(() => buildManualFilamentSlotCommand(0, { MAIN_TYPE: bad }), { message: /material/i });
  }
});

test('buildManualFilamentSlotCommand rejects MAIN_TYPE with spaces or symbols outside [A-Za-z0-9._+-]', () => {
  for (const bad of ['PLA CF', 'PLA/CF', 'PLA#', 'PLA CF+', 'PETG HF']) {
    assert.throws(() => buildManualFilamentSlotCommand(0, { MAIN_TYPE: bad }), { message: /material/i });
  }
});

test('buildManualFilamentSlotCommand accepts MAIN_TYPE with hyphen, plus, dot, and underscore', () => {
  for (const ok of ['PLA', 'PLA-CF', 'PETG.HF', 'PA6_GF', 'PLA+', 'PEI-1010']) {
    assert.doesNotThrow(() => buildManualFilamentSlotCommand(0, { MAIN_TYPE: ok }));
  }
});

test('buildManualFilamentSlotCommand clamps RGB color to 24-bit range and pads to six hex digits', () => {
  assert.match(buildManualFilamentSlotCommand(0, { RGB_1: 0 }), /COLORS=000000/);
  assert.match(buildManualFilamentSlotCommand(0, { RGB_1: 0xff }), /COLORS=0000FF/);
  assert.match(buildManualFilamentSlotCommand(0, { RGB_1: 0xffffff }), /COLORS=FFFFFF/);
  assert.match(buildManualFilamentSlotCommand(0, { RGB_1: 0x1000000 }), /COLORS=FFFFFF/);
  assert.match(buildManualFilamentSlotCommand(0, { RGB_1: -42 }), /COLORS=000000/);
  assert.match(buildManualFilamentSlotCommand(0, { RGB_1: 0x2196f3 }), /COLORS=2196F3/);
  assert.match(buildManualFilamentSlotCommand(0, { RGB_1: 0.99 }), /COLORS=000000/);
});

test('buildManualFilamentSlotCommand falls back to FFFFFF color when RGB_1 is missing or non-finite', () => {
  for (const bad of [undefined, NaN, Infinity, 'blue', {}]) {
    assert.match(buildManualFilamentSlotCommand(0, { RGB_1: bad }), /COLORS=FFFFFF/);
  }
});

test('buildManualFilamentSlotCommand clamps ALPHA to the 0-255 byte range', () => {
  assert.match(buildManualFilamentSlotCommand(0, { ALPHA: 0 }), /ALPHA=0\b/);
  assert.match(buildManualFilamentSlotCommand(0, { ALPHA: 255 }), /ALPHA=255\b/);
  assert.match(buildManualFilamentSlotCommand(0, { ALPHA: 300 }), /ALPHA=255\b/);
  assert.match(buildManualFilamentSlotCommand(0, { ALPHA: -10 }), /ALPHA=0\b/);
  assert.match(buildManualFilamentSlotCommand(0, { ALPHA: 0.9 }), /ALPHA=0\b/);
});

test('buildManualFilamentSlotCommand falls back to ALPHA=255 when ALPHA is missing or non-finite', () => {
  for (const bad of [undefined, NaN, Infinity, 'full', {}]) {
    assert.match(buildManualFilamentSlotCommand(0, { ALPHA: bad }), /ALPHA=255\b/);
  }
});

test('buildManualFilamentSlotCommand trims surrounding whitespace from text fields', () => {
  const cmd = buildManualFilamentSlotCommand(0, { VENDOR: '  SUNLU  ', MAIN_TYPE: '  PLA  ', SUB_TYPE: '  Silk  ' });
  assert.match(cmd, /VENDOR="SUNLU"/);
  assert.match(cmd, /FILAMENT_TYPE=PLA\b/);
  assert.match(cmd, /FILAMENT_SUBTYPE="Silk"/);
});

test('every catalog MAIN_TYPE preset passes the firmware MAIN_TYPE regex and command builder', () => {
  assert.ok(FILAMENT_MAIN_TYPES.length >= 40, 'MAIN_TYPE catalog should cover the firmware polymers');
  for (const main of FILAMENT_MAIN_TYPES) {
    assert.match(main, MAIN_TYPE_PATTERN, `MAIN_TYPE ${main} must match the firmware pattern`);
    assert.doesNotThrow(
      () => buildManualFilamentSlotCommand(0, { MAIN_TYPE: main }),
      `MAIN_TYPE ${main} must be accepted by the command builder`
    );
  }
});

test('filament MAIN_TYPE presets are unique, trimmed, and exclude the non-firmware SUPPORT entry', () => {
  const lower = FILAMENT_MAIN_TYPES.map((m) => m.toLowerCase());
  assert.equal(new Set(lower).size, lower.length, 'MAIN_TYPE presets must be unique');
  for (const m of FILAMENT_MAIN_TYPES) {
    assert.equal(m, m.trim(), `MAIN_TYPE ${m} must not carry surrounding whitespace`);
  }
  assert.equal(FILAMENT_MAIN_TYPES.includes('SUPPORT'), false, 'SUPPORT is not a real firmware material');
  assert.equal(FILAMENT_MAIN_TYPES.includes('PLA'), true);
  assert.equal(FILAMENT_MAIN_TYPES.includes('PETG'), true);
  assert.equal(FILAMENT_MAIN_TYPES.includes('PA6'), true);
});

test('filament SUB_TYPE presets include the firmware temp-affecting subtypes', () => {
  for (const sub of ['Basic', 'CF', 'GF', 'Silk', 'Matte', 'HF']) {
    assert.equal(FILAMENT_SUB_TYPES.includes(sub), true, `expected ${sub} in SUB_TYPE presets`);
  }
});

test('every curated MAIN_TYPE has a subtype list starting with Basic and using only known tokens', () => {
  const allowed = new Set([
    'Basic', 'Plus', 'Silk', 'Matte', 'HF', 'HS', 'SnapSpeed',
    'CF', 'GF', 'AF', 'PTFE', 'Wood', 'ESD', 'AERO', 'rCF', 'Marble',
    '95A', 'High Speed',
  ]);
  for (const main of FILAMENT_MAIN_TYPES) {
    const subs = subtypesForMainType(main);
    assert.ok(subs.length >= 1, `${main} must expose at least Basic`);
    assert.equal(subs[0], 'Basic', `${main} subtype list must start with Basic`);
    for (const sub of subs) {
      assert.ok(allowed.has(sub), `${main}: unknown subtype token ${sub}`);
    }
  }
});

test('subtypesForMainType falls back to Basic for an unknown MAIN_TYPE', () => {
  assert.deepEqual([...subtypesForMainType('NOPE')], ['Basic']);
});

test('curated subtypes include firmware-tuned finishes absent from the chemistry catalog', () => {
  assert.ok(subtypesForMainType('PLA').includes('Matte'), 'PLA must offer Matte (firmware -5C)');
  assert.ok(subtypesForMainType('TPU').includes('95A'), 'TPU must offer 95A (firmware 95A HF)');
  assert.ok(subtypesForMainType('PLA').includes('CF'), 'PLA must offer CF (catalog PLA-CF)');
  assert.equal(subtypesForMainType('PVA').includes('CF'), false, 'soluble support stays Basic-only');
});

test('bundled temp catalog covers every MAIN_TYPE the editor exposes', () => {
  for (const main of FILAMENT_MAIN_TYPES) {
    const range = filamentTempRange(main);
    assert.ok(range, `${main} must have a bundled temp range`);
    assert.ok(range.nozzleMax >= range.nozzleMin, `${main} temp range is inverted`);
  }
});

test('slicer temp floor uses material temps, not the old 220C PLA cliff', () => {
  // PEEK/PEKK/PEI-1010/PPSU must slice HOT, not at the PLA fallback.
  assert.ok(filamentTempTarget('PEEK') >= 390, `PEEK target ${filamentTempTarget('PEEK')} must be >= 390`);
  assert.ok(filamentTempTarget('PEKK') >= 380);
  assert.ok(filamentTempTarget('PEI-1010') >= 370);
  assert.ok(filamentTempTarget('PPSU') >= 360);
  // PLA still lands in a sane PLA range.
  assert.ok(filamentTempTarget('PLA') >= 210 && filamentTempTarget('PLA') <= 245);
  // Unknown MAIN_TYPE falls back to 220.
  assert.equal(filamentTempTarget('NOPE'), 220);
});

test('deriveMainType parses base polymer from compound display strings', () => {
  assert.equal(deriveMainType('PEEK'), 'PEEK');
  assert.equal(deriveMainType('PLA CF'), 'PLA');
  assert.equal(deriveMainType('PA-CF'), 'PA');
  assert.equal(deriveMainType('PA6-CF'), 'PA6');
  assert.equal(deriveMainType('PEI-1010 CF'), 'PEI-1010');
  assert.equal(deriveMainType('PETG HF'), 'PETG');
  assert.equal(deriveMainType('Empty'), 'PLA');
  assert.equal(deriveMainType(''), 'PLA');
});

test('resolveProfileValues falls back to the catalog floor when no firmware flow_temp exists', () => {
  // No firmware profile -> use bundled catalog target (the safety fix).
  assert.equal(resolveProfileValues({}, 'PEEK').nozzleTemp, filamentTempTarget('PEEK'));
  assert.ok(resolveProfileValues({}, 'PEEK').nozzleTemp >= 390, 'PEEK must not slice at 220C');
  // Firmware flow_temp wins when present.
  assert.equal(resolveProfileValues({ flow_temp: 220 }, 'PLA').nozzleTemp, 220);
  // Unknown mainType with no profile -> 220 floor.
  assert.equal(resolveProfileValues({}, 'NOPE').nozzleTemp, 220);
});

test('parses the latest Orca M73 progress and remaining time', () => {
  assert.deepEqual(
    parseLatestM73([
      '; M73 P99 R1 is only a comment',
      'M73 P10 R90',
      'G1 X10 Y10',
      'M73 P12 R88.5',
      'M73 P13',
    ].join('\n')),
    { progress: 0.13, remainingSeconds: 5310 }
  );
  assert.equal(parseLatestM73('G1 X0 Y0\n; M73 P50 R10'), null);
});

test('uses M73 remaining time and adjusts it for observed printer pace', () => {
  assert.deepEqual(
    calculatePrintEtas({
      printDuration: 660,
      slicerTotalSeconds: 3600,
      m73: {
        progress: 0.2,
        remainingSeconds: 3000,
        printDurationAtCapture: 600,
      },
      fallbackProgress: 0.5,
    }),
    {
      slicerRemainingSeconds: 2940,
      liveRemainingSeconds: 2940,
      source: 'm73',
    }
  );

  assert.deepEqual(
    calculatePrintEtas({
      printDuration: 900,
      slicerTotalSeconds: 3600,
      m73: {
        progress: 0.17,
        remainingSeconds: 3000,
        printDurationAtCapture: 900,
      },
      fallbackProgress: 0.5,
    }),
    {
      slicerRemainingSeconds: 3000,
      liveRemainingSeconds: 4500,
      source: 'm73',
    }
  );
});

test('prefers a printer-reported countdown even before progress is stable', () => {
  assert.deepEqual(
    calculatePrintEtas({
      printDuration: 30,
      slicerTotalSeconds: 3600,
      m73: null,
      fallbackProgress: 0,
      printerRemainingSeconds: 44 * 60,
    }),
    {
      slicerRemainingSeconds: 44 * 60,
      liveRemainingSeconds: 44 * 60,
      source: 'printer',
    }
  );
  assert.equal(
    calculatePrintEtas({
      printDuration: 3600,
      slicerTotalSeconds: 3600,
      m73: null,
      fallbackProgress: 1,
      printerRemainingSeconds: 0,
    }).liveRemainingSeconds,
    0
  );
});

test('shows slicer timing early and retains byte-progress fallback', () => {
  assert.deepEqual(
    calculatePrintEtas({
      printDuration: 60,
      slicerTotalSeconds: 3600,
      m73: {
        progress: 0.02,
        remainingSeconds: 3540,
        printDurationAtCapture: 60,
      },
      fallbackProgress: 0.02,
    }),
    {
      slicerRemainingSeconds: 3540,
      liveRemainingSeconds: 3540,
      source: 'm73',
    }
  );
  assert.deepEqual(
    calculatePrintEtas({
      printDuration: 60,
      slicerTotalSeconds: 3600,
      m73: null,
      fallbackProgress: 0,
    }),
    {
      slicerRemainingSeconds: 3540,
      liveRemainingSeconds: 3540,
      source: 'slicer',
    }
  );
  assert.deepEqual(
    calculatePrintEtas({
      printDuration: 600,
      slicerTotalSeconds: 3600,
      m73: null,
      fallbackProgress: 0.25,
    }),
    {
      slicerRemainingSeconds: 3000,
      liveRemainingSeconds: 1800,
      source: 'fallback',
    }
  );
});

test('smooths large ETA corrections while preserving normal countdown', () => {
  assert.equal(smoothRemainingEstimate(1200, 1800, 10), 1225.7);
  assert.equal(smoothRemainingEstimate(1200, 1190, 10), 1190);
  assert.equal(smoothRemainingEstimate(null, 900, 0), 900);
});

test('normalizes Moonraker history terminal states and failure messages', () => {
  assert.equal(terminalPrintStateForHistory('completed'), 'complete');
  assert.equal(terminalPrintStateForHistory('cancelled'), 'cancelled');
  assert.equal(terminalPrintStateForHistory('interrupted'), 'error');
  assert.equal(terminalPrintStateForHistory('klippy_shutdown'), 'error');
  assert.equal(terminalPrintStateForHistory('in_progress'), '');
  assert.equal(historyFailureMessage({ error_message: ' Heater failed ' }), 'Heater failed');
});

test('appends webhook query parameters without breaking existing queries', () => {
  assert.equal(
    withQueryParameter('https://example.com/hook', 'event', 'complete'),
    'https://example.com/hook?event=complete'
  );
  assert.equal(
    withQueryParameter('https://example.com/hook?token=abc', '-event', 'print failed'),
    'https://example.com/hook?token=abc&-event=print%20failed'
  );
});

test('extracts release commits and compares installed build', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(releaseCommit(`Build ${commit}`), commit);
  assert.equal(isCurrentRelease(commit.toUpperCase(), commit), true);
  assert.equal(isCurrentRelease('dev', commit), false);
});

test('compares installed native version with GitHub release tags', () => {
  assert.equal(compareReleaseVersions('1.2.4', 'v1.2.4'), 0);
  assert.equal(compareReleaseVersions('1.2.3', 'v1.2.4'), -1);
  assert.equal(compareReleaseVersions('1.3.0', 'v1.2.4'), 1);
  assert.equal(compareReleaseVersions('1.2', 'v1.2.0'), 0);
  assert.equal(compareReleaseVersions('dev', 'v1.2.4'), null);
});

test('uses semantic version before commit fallback for update availability', () => {
  const oldCommit = '0123456789abcdef0123456789abcdef01234567';
  const newCommit = 'abcdef0123456789abcdef0123456789abcdef01';
  assert.equal(isReleaseUpdateAvailable({
    installedVersion: '1.2.4',
    releaseTag: 'v1.2.4',
    currentCommit: oldCommit,
    latestCommit: newCommit,
  }), false);
  assert.equal(isReleaseUpdateAvailable({
    installedVersion: '1.2.3',
    releaseTag: 'v1.2.4',
  }), true);
  assert.equal(isReleaseUpdateAvailable({
    installedVersion: '',
    releaseTag: '',
    currentCommit: oldCommit,
    latestCommit: newCommit,
  }), null);
  assert.equal(isReleaseUpdateAvailable({
    installedVersion: '',
    releaseTag: '',
    currentCommit: oldCommit,
    latestCommit: oldCommit,
  }), false);
});

test('only returns a direct APK release asset', () => {
  assert.equal(
    releaseDownloadUrl({
      html_url: 'https://github.com/FatBoy721/Helix/releases/tag/v1',
      assets: [
        { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt' },
        { name: 'HELIX.APK', browser_download_url: 'https://example.com/helix.apk' },
      ],
    }),
    'https://example.com/helix.apk'
  );
  assert.equal(
    releaseDownloadUrl({
      html_url: 'https://github.com/FatBoy721/Helix/releases/tag/v1',
      assets: [{ name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt' }],
    }),
    ''
  );
});

test('builds bug report URL with version platform and build', () => {
  const url = buildBugReportUrl({
    version: '1.0.0',
    platform: 'android',
    buildCommit: 'ABCDEF',
  });

  assert.match(url, /^https:\/\/github\.com\/FatBoy721\/Helix\/issues\/new\?/);
  assert.match(decodeURIComponent(url), /\*\*App version:\*\* 1\.0\.0/);
  assert.match(decodeURIComponent(url), /\*\*Platform:\*\* android/);
  assert.match(decodeURIComponent(url), /\*\*Build:\*\* abcdef/);
});

test('builds camera snapshot cache-bust URL and filename', () => {
  assert.equal(cacheBustUrl('http://printer/webcam/snapshot', 123), 'http://printer/webcam/snapshot?n=123');
  assert.equal(cacheBustUrl('http://printer/webcam/snapshot?x=1', 123), 'http://printer/webcam/snapshot?x=1&n=123');
  assert.equal(
    cameraSnapshotFileName(new Date('2026-07-03T12:34:56.789Z')),
    'helix-camera-2026-07-03T12-34-56-789Z.jpg'
  );
});

test('camera lifecycle uses continuous U1 video with a bounded snapshot fallback', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'CameraFeed.tsx'),
    'utf8'
  );
  const transport = fs.readFileSync(
    path.join(REPO_ROOT, 'hooks', 'usePrinterTransport.tsx'),
    'utf8'
  );
  assert.match(source, /Math\.max\(Date\.now\(\), previous \+ 1\)/);
  assert.doesNotMatch(source, /tick \|\| Date\.now\(\)/);
  assert.match(source, /const streamPaused = paused \|\| !screenFocused \|\| !appActive/);
  assert.match(source, /LIVE_PREVIEW_TIMEOUT_MS = 4_000/);
  assert.match(source, /parsed\.pathname = '\/webcam\/stream\.mjpg'/);
  assert.match(source, /buildPlayerHtml\(mjpegBridgeUrl \?\? url, isSnapshot\)/);
  assert.match(source, /readySent = true;[\s\S]*ReactNativeWebView\.postMessage/);
  assert.match(source, /setSnapshotFallbackKey\(playerKey\)/);
  assert.match(source, /\|\| useSnapshotFallback/);
  assert.match(source, /window\.addEventListener\('pagehide', stopPlayer\)/);
  assert.match(transport, /key={`moonraker:\$\{printer\?\.id \?\? 'none'\}`}/);
});

test('AD5X dashboard prefers Moonraker advertised camera endpoints', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'hooks', 'useDashboardModel.ts'),
    'utf8'
  );
  const transport = fs.readFileSync(
    path.join(REPO_ROOT, 'hooks', 'useMoonraker.tsx'),
    'utf8'
  );
  assert.match(source, /activePrinter\?\.kind === 'flashforge-ad5x'/);
  assert.match(source, /advertised && preferAdvertised/);
  assert.match(source, /proxyUrl \|\| activeUrl/);
  assert.match(transport, /const primary = normalizeMoonrakerUrl\(activePrinter\.url/);
  assert.match(transport, /const tailscale = helixdRemoteMoonrakerUrl\(tailscaleProxy\)/);
});

const {
  DEFAULT_PRINTER_KIND,
  MANUAL_PRINTER_KIND,
  PRINTER_PROFILES,
  bambuBedForSerial,
  detectPrinterKind,
  normalizePrinterKind,
  printerProfile,
  resolveBedProfile,
  resolveMachineProfile,
} = require(path.join('..', 'services', 'printerProfiles.ts'));
const {
  printerEntryFromDiscovery,
} = require(path.join('..', 'services', 'printerSetup.ts'));

test('network discovery produces the same editable printer entry everywhere', () => {
  const discovered = {
    ip: '192.168.1.83',
    moonrakerUrl: 'http://192.168.1.83:7125',
    name: '',
    serial: 'SN123',
    machineType: 'AD5X',
    kind: 'flashforge-ad5x',
    cameraUrl: '',
    cameraName: null,
  };
  assert.deepEqual(printerEntryFromDiscovery(discovered, 'p1', 'Printer 1'), {
    id: 'p1',
    name: 'Printer 1',
    url: 'http://192.168.1.83:7125',
    tailscaleUrl: '',
    cameraUrl: '/webcam/?action=stream',
    connectionMode: 'lan',
    kind: 'flashforge-ad5x',
    serialNumber: 'SN123',
  });
});

test('detects the Snapmaker U1 from PAXX product_info', () => {
  assert.equal(detectPrinterKind({ machineType: 'U1' }), 'snapmaker-u1');
  assert.equal(detectPrinterKind({ machineType: 'Snapmaker u1' }), 'snapmaker-u1');
  assert.equal(detectPrinterKind({ serial: '811234567' }), 'snapmaker-u1');
});

test('detects the FlashForge Klipper mod, which exposes no product_info', () => {
  assert.equal(detectPrinterKind({ hostname: 'flashforge' }), 'flashforge-ad5x');
  assert.equal(detectPrinterKind({ hostname: 'FlashForge-AD5X' }), 'flashforge-ad5x');
  assert.equal(detectPrinterKind({ machineType: 'AD5X' }), 'flashforge-ad5x');
  assert.equal(detectPrinterKind({ deviceName: 'Adventurer 5X' }), 'flashforge-ad5x');
});

test('falls back to the generic Klipper profile for unknown machines', () => {
  assert.equal(detectPrinterKind({}), 'generic-klipper');
  assert.equal(detectPrinterKind({ hostname: 'voron' }), 'generic-klipper');
  assert.equal(DEFAULT_PRINTER_KIND, 'generic-klipper');
});

test('U1 identity wins over an unrelated hostname', () => {
  assert.equal(
    detectPrinterKind({ machineType: 'U1', hostname: 'flashforge' }),
    'snapmaker-u1'
  );
});

test('printer profiles describe toolheads and material slots', () => {
  assert.equal(printerProfile('snapmaker-u1').toolheads, 4);
  assert.equal(printerProfile('flashforge-ad5x').toolheads, 1);
  assert.equal(printerProfile('flashforge-ad5x').materialSlots, 4);
  assert.equal(printerProfile('generic-klipper').materialSlots, 0);
  // Unknown kinds must resolve rather than throw.
  assert.equal(printerProfile('nonsense').kind, DEFAULT_PRINTER_KIND);
  assert.equal(normalizePrinterKind(undefined), DEFAULT_PRINTER_KIND);
});

test('camera fallbacks stay host-relative so the stream follows the printer', () => {
  assert.equal(printerProfile('snapmaker-u1').defaultCameraPath, '/webcam/webrtc');
  // Matches the [webcam video] section zmod ships on the AD5X.
  assert.equal(printerProfile('flashforge-ad5x').defaultCameraPath, '/webcam/?action=stream');
  assert.equal(printerProfile('generic-klipper').defaultCameraPath, '');

  // A relative fallback must survive resolveCameraUrl unchanged apart from the host.
  assert.equal(
    resolveCameraUrl(printerProfile('flashforge-ad5x').defaultCameraPath, 'http://192.168.1.83:7125'),
    'http://192.168.1.83/webcam/?action=stream'
  );
});

test('settings migration assumes pre-v12 printers are U1s', () => {
  const migrated = migrateSettings({
    activePrinterId: 'p1',
    printers: [{ id: 'p1', name: 'Mine', url: 'http://192.168.1.17:7125' }],
  });

  assert.equal(migrated.printers[0].kind, 'snapmaker-u1');
  assert.equal(MANUAL_PRINTER_KIND, 'snapmaker-u1');
});

test('settings migration keeps an explicitly saved printer kind', () => {
  const migrated = migrateSettings({
    activePrinterId: 'p1',
    printers: [
      { id: 'p1', name: 'AD5X', url: 'http://192.168.1.83:7125', kind: 'flashforge-ad5x' },
    ],
  });

  assert.equal(migrated.printers[0].kind, 'flashforge-ad5x');
});

test('settings migration keeps a URL-less FlashForge AD5X printer', () => {
  // The AD5X editor hides the URL/Tailscale/camera/connection fields, so a
  // manually-added AD5X has no URL until discovery fills one in. Migration
  // must not silently delete it (regression: "added but never appeared").
  const migrated = migrateSettings({
    activePrinterId: 'p1',
    printers: [
      {
        id: 'p1',
        name: 'AD5X',
        url: '',
        tailscaleUrl: '',
        kind: 'flashforge-ad5x',
        serialNumber: 'SN123',
        checkCode: 'ABCD1234',
      },
    ],
  });

  assert.equal(migrated.printers.length, 1);
  assert.equal(migrated.printers[0].id, 'p1');
  assert.equal(migrated.printers[0].kind, 'flashforge-ad5x');
  assert.equal(migrated.printers[0].serialNumber, 'SN123');
  assert.equal(migrated.printers[0].checkCode, 'ABCD1234');
});

test('settings migration still drops a URL-less non-AD5X printer', () => {
  // U1/generic entries can't be saved without a URL (editor validates it), so a
  // URL-less one is corrupt/legacy junk and should still be filtered out.
  const migrated = migrateSettings({
    activePrinterId: 'p1',
    printers: [{ id: 'p1', name: 'Broken', url: '', tailscaleUrl: '', kind: 'snapmaker-u1' }],
  });

  assert.equal(migrated.printers.length, 0);
});

const {
  FLASHFORGE_API_PORT,
  flashforgeApiUrl,
  hasFlashForgeCredentials,
  normalizeSlotColor,
  normalizeSlotMaterial,
  parseMaterialStation,
} = require(path.join('..', 'services', 'flashforgeApi.ts'));

// Captured verbatim from Parallel-7/FlashForgeEmulator running in AD5X mode.
const AD5X_DETAIL = {
  hasMatlStation: true,
  matlStationInfo: {
    currentSlot: 1,
    currentLoadSlot: 0,
    slotCnt: 4,
    slotInfos: [
      { slotId: 1, hasFilament: true, materialName: 'PLA', materialColor: '#FF0000' },
      { slotId: 2, hasFilament: true, materialName: 'PLA', materialColor: '#00FF00' },
      { slotId: 3, hasFilament: false, materialName: '', materialColor: '' },
      { slotId: 4, hasFilament: false, materialName: '', materialColor: '' },
    ],
    stateAction: 0,
    stateStep: 0,
  },
};

test('derives the FlashForge API URL from a Moonraker URL', () => {
  assert.equal(FLASHFORGE_API_PORT, 8898);
  assert.equal(flashforgeApiUrl('http://192.168.1.83:7125'), 'http://192.168.1.83:8898');
  assert.equal(flashforgeApiUrl('192.168.1.83'), 'http://192.168.1.83:8898');
  assert.equal(flashforgeApiUrl('http://192.168.1.83/some/path'), 'http://192.168.1.83:8898');
  assert.equal(flashforgeApiUrl(''), '');
});

test('requires both FlashForge credentials', () => {
  assert.equal(hasFlashForgeCredentials({ serialNumber: 'S', checkCode: 'C' }), true);
  assert.equal(hasFlashForgeCredentials({ serialNumber: 'S', checkCode: '  ' }), false);
  assert.equal(hasFlashForgeCredentials({ serialNumber: '', checkCode: 'C' }), false);
  assert.equal(hasFlashForgeCredentials(undefined), false);
});

test('normalizes material slot colours and rejects junk', () => {
  assert.equal(normalizeSlotColor('#FF0000'), '#ff0000');
  assert.equal(normalizeSlotColor('00FF00'), '#00ff00');
  assert.equal(normalizeSlotColor('#f0a'), '#ff00aa');
  assert.equal(normalizeSlotColor(''), '');
  assert.equal(normalizeSlotColor('red'), '');
  assert.equal(normalizeSlotColor(null), '');
});

test('parses the AD5X material station into zero-based slots', () => {
  const station = parseMaterialStation(AD5X_DETAIL);

  assert.equal(station.slots.length, 4);
  // Wire slotIds are 1-based; Helix's filament arrays are 0-based.
  assert.deepEqual(station.slots[0], {
    index: 0,
    loaded: true,
    material: 'PLA',
    colorHex: '#ff0000',
  });
  assert.deepEqual(station.slots[2], {
    index: 2,
    loaded: false,
    material: '',
    colorHex: '',
  });
  assert.equal(station.activeSlot, 0);
  // currentLoadSlot 0 is the "nothing loading" sentinel, not slot zero.
  assert.equal(station.loadingSlot, null);
});

test('treats a loading slot as one-based too', () => {
  const station = parseMaterialStation({
    hasMatlStation: true,
    matlStationInfo: { ...AD5X_DETAIL.matlStationInfo, currentSlot: 4, currentLoadSlot: 2 },
  });

  assert.equal(station.activeSlot, 3);
  assert.equal(station.loadingSlot, 1);
});

test('returns no material station for printers without one', () => {
  assert.equal(parseMaterialStation({ hasMatlStation: false }), null);
  assert.equal(parseMaterialStation({}), null);
  assert.equal(parseMaterialStation(null), null);
});

test('tolerates slot entries missing their slotId', () => {
  const station = parseMaterialStation({
    matlStationInfo: { slotInfos: [{ hasFilament: true, materialName: 'PETG' }] },
  });

  assert.equal(station.slots[0].index, 0);
  assert.equal(station.slots[0].material, 'PETG');
  assert.equal(station.activeSlot, null);
});

test('settings keep FlashForge credentials only when set', () => {
  const migrated = migrateSettings({
    activePrinterId: 'p1',
    printers: [
      {
        id: 'p1',
        name: 'AD5X',
        url: 'http://192.168.1.83:7125',
        kind: 'flashforge-ad5x',
        serialNumber: 'SNMQRE9605619',
        checkCode: '7c160a97',
      },
      { id: 'p2', name: 'U1', url: 'http://192.168.1.17:7125', kind: 'snapmaker-u1' },
    ],
  });

  assert.equal(migrated.printers[0].serialNumber, 'SNMQRE9605619');
  assert.equal(migrated.printers[0].checkCode, '7c160a97');
  assert.equal('serialNumber' in migrated.printers[1], false);
  assert.equal('checkCode' in migrated.printers[1], false);
});

// Captured verbatim from a real AD5X on firmware 3.1.5 (zmod 1.7.1-49).
// Differs from the emulator: empty slots carry the "?" sentinel, and an
// unloaded slot still remembers its last material/colour.
const AD5X_REAL_DETAIL = {
  hasMatlStation: true,
  matlStationInfo: {
    currentLoadSlot: 0,
    currentSlot: 0,
    slotCnt: 4,
    slotInfos: [
      { hasFilament: false, materialColor: '#FEF043', materialName: 'PLA', slotId: 1 },
      { hasFilament: true, materialColor: '#FEF043', materialName: 'PLA', slotId: 2 },
      { hasFilament: false, materialColor: '', materialName: '?', slotId: 3 },
      { hasFilament: false, materialColor: '', materialName: '?', slotId: 4 },
    ],
    stateAction: 0,
    stateStep: 0,
  },
};

test('treats the firmware "?" material sentinel as unknown', () => {
  assert.equal(normalizeSlotMaterial('?'), '');
  assert.equal(normalizeSlotMaterial('PLA'), 'PLA');
  assert.equal(normalizeSlotMaterial(' PETG '), 'PETG');
  assert.equal(normalizeSlotMaterial(undefined), '');
});

test('parses a real AD5X material station payload', () => {
  const station = parseMaterialStation(AD5X_REAL_DETAIL);

  assert.equal(station.slots.length, 4);
  // Slot 2 (index 1) is the only one actually loaded.
  assert.deepEqual(station.slots[1], {
    index: 1,
    loaded: true,
    material: 'PLA',
    colorHex: '#fef043',
  });
  // Unloaded but remembered: keep the metadata, flag it as not loaded.
  assert.equal(station.slots[0].loaded, false);
  assert.equal(station.slots[0].material, 'PLA');
  assert.equal(station.slots[0].colorHex, '#fef043');
  // "?" must never reach the UI.
  assert.equal(station.slots[2].material, '');
  assert.equal(station.slots[3].material, '');
  // currentSlot 0 means nothing selected, not slot index 0.
  assert.equal(station.activeSlot, null);
  assert.equal(station.loadingSlot, null);
});

const {
  materialStationToAceUnits,
} = require(path.join('..', 'services', 'aceModel.ts'));

test('maps a FlashForge material station onto one ACE-style unit', () => {
  const units = materialStationToAceUnits(parseMaterialStation(AD5X_REAL_DETAIL));

  assert.equal(units.length, 1);
  const unit = units[0];
  assert.equal(unit.connected, true);
  assert.equal(unit.active, true);
  // The AD5X has no dryer; don't invent one.
  assert.equal(unit.dryer.active, false);
  assert.equal(unit.temp, undefined);
  assert.equal(unit.humidity, undefined);
  assert.equal(unit.lanes.length, 4);

  assert.equal(unit.lanes[1].status, 'loaded');
  assert.equal(unit.lanes[1].material, 'PLA');
  assert.equal(unit.lanes[1].colorHex, '#fef043');

  // Remembered-but-unloaded: keeps its metadata, reports EMPTY.
  assert.equal(unit.lanes[0].status, 'empty');
  assert.equal(unit.lanes[0].material, 'PLA');

  // Genuinely empty slots carry no material at all (the "?" was stripped).
  assert.equal(unit.lanes[2].status, 'empty');
  assert.equal(unit.lanes[2].material, undefined);
  assert.equal(unit.lanes[2].colorHex, undefined);
});

test('a slot being loaded shows as busy', () => {
  const station = parseMaterialStation({
    hasMatlStation: true,
    matlStationInfo: { ...AD5X_REAL_DETAIL.matlStationInfo, currentLoadSlot: 3 },
  });
  const lanes = materialStationToAceUnits(station)[0].lanes;

  assert.equal(lanes[2].status, 'busy');
  assert.equal(lanes[1].status, 'loaded');
});

test('no material station yields no units', () => {
  assert.deepEqual(materialStationToAceUnits(null), []);
});

test('always renders four lanes even when the printer reports fewer', () => {
  const units = materialStationToAceUnits({
    slots: [{ index: 0, loaded: true, material: 'PLA', colorHex: '#ffffff' }],
    activeSlot: 0,
    loadingSlot: null,
  });

  assert.equal(units[0].lanes.length, 4);
  assert.equal(units[0].lanes[0].status, 'loaded');
  assert.equal(units[0].lanes[3].status, 'empty');
});

const {
  dashboardSectionAvailable,
  getDashboardSections,
  normalizeDashboardByPrinter,
  setDashboardForPrinter,
} = require(path.join('..', 'services', 'dashboardSections.ts'));

test('dashboard sections fall back to the global set for uncustomised printers', () => {
  const s = migrateSettings({
    activePrinterId: 'p1',
    dashboard: { gui: false, macros: true },
    printers: [{ id: 'p1', name: 'U1', url: 'http://192.168.1.17:7125' }],
  });

  const sections = getDashboardSections(s);
  assert.equal(sections.gui, false);
  assert.equal(sections.macros, true);
  // Unspecified keys still come from defaults, not undefined.
  assert.equal(sections.camera, true);
});

test('bambu never offers or renders the unsupported printer screen', () => {
  const s = migrateSettings({
    activePrinterId: 'p1s',
    dashboard: { gui: true },
    printers: [
      { id: 'p1s', name: 'P1S', url: 'http://192.168.1.50', kind: 'bambu-lan' },
      { id: 'u1', name: 'U1', url: 'http://192.168.1.17:7125', kind: 'snapmaker-u1' },
    ],
  });

  assert.equal(getDashboardSections(s).gui, false);
  assert.equal(dashboardSectionAvailable('bambu-lan', 'gui'), false);
  assert.equal(dashboardSectionAvailable('bambu-lan', 'camera'), true);
  assert.equal(
    getDashboardSections({ ...s, activePrinterId: 'u1' }).gui,
    true
  );
});

test('hiding a section on one printer leaves the others alone', () => {
  const s = migrateSettings({
    activePrinterId: 'ad5x',
    dashboard: { gui: true },
    printers: [
      { id: 'u1', name: 'U1', url: 'http://192.168.1.17:7125' },
      { id: 'ad5x', name: 'AD5X', url: 'http://192.168.1.83:7125', kind: 'flashforge-ad5x' },
    ],
  });

  const byPrinter = setDashboardForPrinter(
    s.dashboardByPrinter,
    'ad5x',
    { ...getDashboardSections(s), gui: false },
    s.dashboard
  );

  // AD5X hides the GUI card...
  assert.equal(getDashboardSections({ ...s, dashboardByPrinter: byPrinter }).gui, false);
  // ...while the U1 keeps it.
  assert.equal(
    getDashboardSections({ ...s, activePrinterId: 'u1', dashboardByPrinter: byPrinter }).gui,
    true
  );
});

test('per-printer dashboard map drops malformed entries', () => {
  const template = DEFAULT_SETTINGS.dashboard;
  const map = normalizeDashboardByPrinter(
    { p1: { camera: false }, p2: null, p3: [], '': { camera: false } },
    template
  );

  assert.deepEqual(Object.keys(map), ['p1']);
  assert.equal(map.p1.camera, false);
  assert.equal(map.p1.temps, template.temps);
});

test('settings migration seeds an empty per-printer dashboard map', () => {
  const migrated = migrateSettings({ dashboard: { gui: false } });
  assert.deepEqual(migrated.dashboardByPrinter, {});
  // The global set still carries the user's choice as the template.
  assert.equal(migrated.dashboard.gui, false);
});

const {
  applyBambuReport,
  bambuFilamentWriteLocation,
  bambuTrays,
  genericBambuFilamentId,
  isBambuTrayLoaded,
  mergeBambuState,
  resolveBambuFilamentEditIdentity,
} = require(path.join('..', 'services', 'bambuReport.ts'));
const {
  bambuActiveSlot,
  bambuAmsHealth,
  bambuHmsFaults,
  bambuStatus,
} = require(path.join('..', 'services', 'bambuAdapter.ts'));
const {
  bambuFanPercent,
  buildBambuCalibrationOption,
  buildBambuFanCommand,
  buildBambuTemperatureCommand,
} = require(path.join('..', 'services', 'bambuControls.ts'));

// A real pushall response from a P1S, with identifiers redacted. Captured by
// android/app/src/test/.../BambuLiveConnectionTest.kt — regenerate it with
// BAMBU_DUMP_DIR set rather than editing this by hand.
const BAMBU_P1S_REPORT = require('./fixtures/bambu-p1s-report.json');

function bambuStateFromFixture() {
  return applyBambuReport({}, BAMBU_P1S_REPORT).state;
}

test('bambu full dumps and deltas are told apart by msg, not by size', () => {
  const full = applyBambuReport({}, BAMBU_P1S_REPORT);
  assert.equal(full.isFullState, true);

  const delta = applyBambuReport(full.state, {
    print: { bed_temper: 41.5, command: 'push_status', msg: 1, sequence_id: '10856' },
  });
  assert.equal(delta.isFullState, false);
  // The delta carried four fields; everything else must survive it.
  assert.equal(delta.state.bed_temper, 41.5);
  assert.equal(delta.state.total_layer_num, BAMBU_P1S_REPORT.print.total_layer_num);
  assert.ok(delta.state.ams, 'a bed_temper delta must not wipe out the AMS');
});

test('bambu reports without a print section leave state untouched', () => {
  const state = bambuStateFromFixture();
  const after = applyBambuReport(state, { info: { command: 'get_version', module: [] } });
  assert.equal(after.isFullState, false);
  assert.equal(after.state, state);
});

test('bambu state merge replaces arrays instead of blending them', () => {
  const merged = mergeBambuState(
    { ams: { ams: [{ id: '0' }, { id: '1' }] }, keep: 1 },
    { ams: { ams: [{ id: '0' }] } }
  );
  assert.equal(merged.ams.ams.length, 1);
  assert.equal(merged.keep, 1);
});

test('bambu status maps onto the klipper shape the dashboard reads', () => {
  const status = bambuStatus(bambuStateFromFixture());

  // FINISH is a completed print, not an idle machine.
  assert.equal(status.print_stats.state, 'complete');
  assert.equal(status.print_stats.filename, '14min44s, Bambu PLA Basic, A1');
  assert.equal(status.print_stats.info.current_layer, 192);
  assert.equal(status.print_stats.info.total_layer, 192);
  assert.equal(status.display_status.progress, 1);
  assert.equal(status.virtual_sdcard.is_active, false);

  // Read from the fixture rather than hardcoded, so recapturing it on a warmer
  // or cooler printer does not fail the suite.
  assert.equal(status.extruder.temperature, BAMBU_P1S_REPORT.print.nozzle_temper);
  assert.equal(status.extruder.target, BAMBU_P1S_REPORT.print.nozzle_target_temper);
  assert.equal(status.heater_bed.temperature, BAMBU_P1S_REPORT.print.bed_temper);
  assert.equal(status.toolhead.extruder, 'extruder');
  assert.equal(status.fan.speed, 0);
  assert.deepEqual(status.bambu.fans, { part: 0, aux: 0, chamber: 0 });
  assert.deepEqual(status.bambu.hms_faults, []);
});

test('bambu skip-object state keeps only valid unique printer IDs', () => {
  const state = bambuStateFromFixture();
  const status = bambuStatus({ ...state, s_obj: [42, '77', 42, -1, 'bad', 2.5] });
  assert.deepEqual(status.bambu.skipped_object_ids, [42, 77]);

  const mqttSource = fs.readFileSync(path.join(REPO_ROOT, 'services', 'bambuMqtt.ts'), 'utf8');
  assert.match(mqttSource, /command: 'skip_objects'/);
  assert.match(mqttSource, /obj_list: ids/);
  assert.match(mqttSource, /normalizedBambuJobName\(uploaded\.remoteName\) !== active/);

  const heroSource = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'dashboard', 'parts', 'Hero.tsx'),
    'utf8'
  );
  assert.match(heroSource, /activePrintObjects\.length > 1/);
  assert.match(heroSource, /selectedSkipIds\.length >= activePrintObjects\.length/);
  assert.match(heroSource, /Selected objects will stop printing permanently/);
});

test('bambu HMS faults preserve all four code groups and use exact descriptions', () => {
  const [fault] = bambuHmsFaults({
    hms: [{ attr: 0x03008003, code: 0x00010001 }],
    print_error: 0,
  });

  assert.equal(fault.code, '0300-8003-0001-0001');
  assert.equal(fault.summary, 'Spaghetti was detected by AI print monitoring.');
  assert.equal(fault.severity, 'warning');
  assert.equal(
    fault.helpUrl,
    'https://wiki.bambulab.com/en/hms/home'
  );
});

test('bambu fault parsing keeps unknown codes honest and filters cancel echoes', () => {
  const faults = bambuHmsFaults({
    hms: [
      { attr: '0x07010000', code: '0x00018099' },
      { attr: 0x03000000, code: 0x0000400c },
      { attr: 'not-a-code', code: 1 },
    ],
    print_error: 0x05004001,
  });

  assert.deepEqual(faults.map((fault) => fault.code), [
    '0500-4001',
    '0701-0000-0001-8099',
  ]);
  assert.equal(faults[1].summary, 'AMS or filament system fault.');
  assert.equal(faults[0].source, 'print_error');
});

test('bambu climate commands are bounded and use the documented fan channels', () => {
  assert.equal(buildBambuTemperatureCommand('nozzle', 220), 'M104 T0 S220');
  assert.equal(buildBambuTemperatureCommand('bed', 65), 'M140 S65');
  assert.equal(buildBambuFanCommand('part', 100), 'M106 P1 S255');
  assert.equal(buildBambuFanCommand('aux', 50), 'M106 P2 S128');
  assert.equal(buildBambuFanCommand('chamber', 0), 'M106 P3 S0');
  assert.throws(() => buildBambuTemperatureCommand('nozzle', 301), RangeError);
  assert.throws(() => buildBambuTemperatureCommand('bed', -1), RangeError);
  assert.throws(() => buildBambuFanCommand('part', 101), RangeError);
  assert.equal(bambuFanPercent('15'), 100);
  assert.equal(bambuFanPercent(7.5), 50);
  assert.equal(bambuFanPercent(undefined), undefined);
});

test('bambu calibration uses only the common BambuStudio option bits', () => {
  assert.equal(buildBambuCalibrationOption({ bedLeveling: true }), 1 << 1);
  assert.equal(buildBambuCalibrationOption({ vibration: true }), 1 << 2);
  assert.equal(buildBambuCalibrationOption({ motorNoise: true }), 1 << 3);
  assert.equal(
    buildBambuCalibrationOption({ bedLeveling: true, vibration: true, motorNoise: true }),
    14
  );
  assert.throws(() => buildBambuCalibrationOption({}), /at least one/i);

  const mqttSource = fs.readFileSync(path.join(REPO_ROOT, 'services', 'bambuMqtt.ts'), 'utf8');
  assert.match(mqttSource, /command: 'calibration'/);
  assert.match(mqttSource, /option: buildBambuCalibrationOption\(options\)/);

  const toolsSource = fs.readFileSync(path.join(REPO_ROOT, 'app', '(tabs)', 'tools.tsx'), 'utf8');
  assert.match(toolsSource, /tool\.key === ["']bambuCalibration["']/);
  assert.match(toolsSource, /\(!connected \|\| !bambuIdle\)/);
  assert.match(toolsSource, /The printer must be empty and unobstructed/);
});

test('bambu print states map to klipper equivalents', () => {
  const state = bambuStateFromFixture();
  const stateFor = (gcodeState) => bambuStatus({ ...state, gcode_state: gcodeState }).print_stats.state;

  assert.equal(stateFor('IDLE'), 'standby');
  assert.equal(stateFor('RUNNING'), 'printing');
  assert.equal(stateFor('PAUSE'), 'paused');
  assert.equal(stateFor('FAILED'), 'error');
  // Heating and levelling read as busy, not asleep.
  assert.equal(stateFor('PREPARE'), 'printing');
  // An unknown state must not crash or claim the printer is running.
  assert.equal(stateFor('SOMETHING_NEW'), 'standby');
});

test('bambu remaining time is exposed in seconds', () => {
  const state = { ...bambuStateFromFixture(), mc_remaining_time: 44 };
  assert.equal(bambuStatus(state).print_stats.info.remaining_time, 44 * 60);
});

test('bambu chamber temperature only appears when the printer has a reading', () => {
  const state = bambuStateFromFixture();
  assert.ok(bambuStatus({ ...state, chamber_temper: 32 })['temperature_sensor chamber']);
  // The P-series reports 0 when it has no real sensor; that must not render.
  assert.equal(bambuStatus({ ...state, chamber_temper: 0 })['temperature_sensor chamber'], undefined);
});

test('bambu enumerates one AMS unit as four trays', () => {
  const state = bambuStateFromFixture();
  const trays = bambuTrays(state);

  assert.equal(trays.length, 4);
  assert.deepEqual(trays.map((entry) => entry.index), [0, 1, 2, 3]);
  // Filament sitting in a tray is not the same as filament in the hotend:
  // this capture has a loaded slot 0 but tray_now 255.
  assert.equal(isBambuTrayLoaded(state, 0), true);
  assert.equal(isBambuTrayLoaded(state, 1), false);
  assert.equal(bambuActiveSlot(state), null);
});

test('bambu without an AMS exposes one honest external spool', () => {
  const state = JSON.parse(JSON.stringify(bambuStateFromFixture()));
  state.ams = { ...state.ams, ams: [], ams_exist_bits: '0', tray_exist_bits: '0' };
  state.vt_tray = {
    ...state.vt_tray,
    tray_info_idx: 'GFL99',
    tray_type: 'PLA',
    tray_color: '3366CCFF',
    nozzle_temp_min: '190',
    nozzle_temp_max: '240',
  };

  const idle = bambuStatus(state).print_task_config;
  assert.equal(idle.bambu_filament_source, 'external');
  assert.deepEqual(idle.filament_exist, [null], 'the idle side holder has no occupancy sensor');
  assert.deepEqual(idle.filament_type, ['PLA']);
  assert.deepEqual(idle.filament_color_rgba, ['3366CCFF']);
  assert.equal(idle.filament_exist.length, 1, 'no AMS must not grow four fake bays');

  state.ams.tray_now = '254';
  assert.deepEqual(bambuStatus(state).print_task_config.filament_exist, [true]);
});

test('bambu filament write locations preserve AMS and use the captured external address', () => {
  assert.deepEqual(bambuFilamentWriteLocation('ams', 0), { unit: 0, tray: 0 });
  assert.deepEqual(bambuFilamentWriteLocation('ams', 5), { unit: 1, tray: 1 });
  assert.deepEqual(bambuFilamentWriteLocation('external', 0), {
    unit: 255,
    tray: 254,
    slot: 0,
  });
  assert.throws(() => bambuFilamentWriteLocation('external', 1), /only has channel 0/);

  const mqttSource = fs.readFileSync(
    path.join(REPO_ROOT, 'services', 'bambuMqtt.ts'),
    'utf8'
  );
  assert.match(mqttSource, /slot_id: setting\.slot/);
});

test('bambu filament edits use occupancy rather than treating a blank preset id as empty', () => {
  assert.deepEqual(resolveBambuFilamentEditIdentity(true, '', 'PLA'), {
    ok: true,
    filamentId: 'GFL99',
  });
  assert.deepEqual(resolveBambuFilamentEditIdentity(true, ' P1234567 ', 'PLA'), {
    ok: true,
    filamentId: 'P1234567',
  });
  assert.deepEqual(resolveBambuFilamentEditIdentity(false, 'GFL99', 'PLA'), {
    ok: false,
    reason: 'empty',
  });
});

test('bambu filament edits only fall back to official generic material ids', () => {
  assert.equal(genericBambuFilamentId(' pla '), 'GFL99');
  assert.equal(genericBambuFilamentId('PETG'), 'GFG99');
  assert.equal(genericBambuFilamentId('ABS'), 'GFB99');
  assert.equal(genericBambuFilamentId('TPU'), 'GFU99');
  assert.deepEqual(resolveBambuFilamentEditIdentity(true, '', 'PEEK'), {
    ok: false,
    reason: 'unsupported-material',
  });
});

test('bambu AMS humidity and temperature are surfaced', () => {
  const unit = BAMBU_P1S_REPORT.print.ams.ams[0];
  const health = bambuAmsHealth(bambuStateFromFixture());

  assert.equal(health.length, 1);
  assert.equal(health[0].unit, 0);
  assert.equal(health[0].humidity, Number(unit.humidity));
  assert.equal(health[0].temperature, Number(unit.temp));
});

test('bambu maps a real loaded AMS tray onto print_task_config', () => {
  const tray = BAMBU_P1S_REPORT.print.ams.ams[0].tray[0];
  const slots = bambuStatus(bambuStateFromFixture()).print_task_config;

  assert.deepEqual(slots.filament_exist, [true, false, false, false]);
  assert.equal(slots.filament_type[0], tray.tray_type);
  // resolveFilamentSlots parses 8-digit RGBA, so it is passed through as-is.
  assert.equal(slots.filament_color_rgba[0], tray.tray_color);
  // This spool was configured by hand: tray_sub_brands is empty, and joining a
  // blank subtype must not leave trailing whitespace in the slot label.
  assert.equal(slots.filament_sub_type[0], '');
  // Empty slots must claim nothing at all.
  assert.equal(slots.filament_type[1], '');
});

test('bambu treats a hand-configured slot as generic, not Bambu', () => {
  // tray_is_bbl_bits is "1" on this real capture even though the slot was set
  // by hand to Generic PETG (tray_info_idx GFG99) and its RFID tag is zeroed.
  // The tag is the only trustworthy signal for a genuine spool.
  const report = BAMBU_P1S_REPORT.print;
  assert.equal(report.ams.tray_is_bbl_bits, '1');
  assert.equal(report.ams.ams[0].tray[0].tag_uid, '0000000000000000');
  assert.equal(bambuStatus(bambuStateFromFixture()).print_task_config.filament_vendor[0], 'Generic');
});

test('bambu recognises a genuine RFID-read spool as Bambu', () => {
  const state = bambuStateFromFixture();
  state.ams.ams[0].tray[0].tag_uid = 'A1B2C3D4E5F60708';
  assert.equal(bambuStatus(state).print_task_config.filament_vendor[0], 'Bambu');
});

test('bambu strips a repeated base type out of the sub-brand', () => {
  const state = bambuStateFromFixture();
  state.ams.ams[0].tray[0].tray_type = 'PLA';
  state.ams.ams[0].tray[0].tray_sub_brands = 'PLA Basic';
  // "PLA Basic" against type "PLA" must not render as "PLA PLA Basic".
  assert.equal(bambuStatus(state).print_task_config.filament_sub_type[0], 'Basic');
});

test('bambu ignores stale filament details on an unloaded tray', () => {
  // The printer leaves the last spool's values behind after an unload, so
  // tray_exist_bits is the only trustworthy signal.
  const state = bambuStateFromFixture();
  state.ams.tray_exist_bits = '0';
  const slots = bambuStatus(state).print_task_config;

  assert.deepEqual(slots.filament_exist, [false, false, false, false]);
  assert.equal(slots.filament_type[0], '');
  assert.equal(slots.filament_color_rgba[0], '');
});

test('bambu indexes trays globally across multiple AMS units', () => {
  const ams = {
    ams: [
      { id: '0', tray: [{ id: '0' }, { id: '1' }, { id: '2' }, { id: '3' }] },
      { id: '1', tray: [{ id: '0' }, { id: '1' }, { id: '2' }, { id: '3' }] },
    ],
    tray_exist_bits: '10', // hex: tray 4, the first slot of the second unit
    tray_is_bbl_bits: '0',
    tray_now: '4',
  };
  const state = { ...bambuStateFromFixture(), ams };

  assert.deepEqual(bambuTrays(state).map((entry) => entry.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(isBambuTrayLoaded(state, 4), true);
  assert.equal(bambuActiveSlot(state), 4);
  assert.equal(bambuStatus(state).print_task_config.filament_exist.length, 8);
});

test('bambu native preview receives physical AMS occupancy, not a fake logical-tool mask', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'app', '(tabs)', 'slicer.tsx'), 'utf8');

  // Logical tool 0 belongs in initialTool only. Replacing the loaded mask with
  // `1` makes an empty AMS lane 1 the sole candidate and hides real loaded
  // lanes 2-4 from the native preprocessing sheet.
  assert.doesNotMatch(source, /bambu\s*\?\s*1\s*:\s*toolLoad\.nativeLoadedToolMask/);
  assert.match(
    source,
    /bambu\s*\?\s*0\s*:\s*toolLoad\.selectedTool,\s*toolLoad\.nativeLoadedToolMask,/s,
  );
});

test('bambu-lan is a known printer kind with one head and an AMS', () => {
  const profile = printerProfile('bambu-lan');
  assert.equal(profile.toolheads, 1);
  assert.equal(profile.materialSlots, 4);
  // The camera URL is created per session by the transport, so there is no
  // static path to fall back on.
  assert.equal(profile.defaultCameraPath, '');
});

test('an unknown kind still falls back rather than throwing', () => {
  assert.equal(normalizePrinterKind('bambu-lan'), 'bambu-lan');
  assert.equal(normalizePrinterKind('nonsense'), 'generic-klipper');
});

const {
  PROMPT_DISMISS_GCODE,
  isPromptLine,
  reducePromptLine,
  visiblePrompt,
} = require(path.join('..', 'services', 'klipperPrompt.ts'));

// Captured verbatim from a real FlashForge AD5X (zmod) accepting a print.
// This is the exact run that left Helix reporting "sent" while the printer sat
// waiting for someone to answer it.
const AD5X_PROMPT_LINES = [
  '// action:prompt_end',
  '// action:prompt_begin Select print materials',
  '// action:prompt_text 1+Mini+Turtle.gcode | Extruder: None (2)',
  '// action:prompt_button_group_start',
  '// action:prompt_button Leveling Off|SET_ZCOLOR SILENT=0 FILENAME="1+Mini+Turtle.gcode" LEVELING=1| |808080',
  '// action:prompt_button Auto select colors|SET_ZCOLOR SILENT=0 AUTO_ASSIGN=1 FILENAME="1+Mini+Turtle.gcode" LEVELING=0| |202020',
  '// action:prompt_button_group_end',
  '// action:prompt_footer_button Start print|PRINT_ZCOLOR LEVELING=0 FILENAME="1+Mini+Turtle.gcode" ALLOWED_TOOL_COUNT=4 T0=2 T1=2 T2=2 T3=2|red',
  '// action:prompt_footer_button Cancel|RESPOND TYPE=command MSG=action:prompt_end',
  '// action:prompt_show',
];

function foldPrompt(lines) {
  return lines.reduce((state, line) => reducePromptLine(state, line), null);
}

test('parses a real AD5X material prompt into a renderable dialog', () => {
  const prompt = visiblePrompt(foldPrompt(AD5X_PROMPT_LINES));
  assert.ok(prompt, 'prompt should be visible after prompt_show');
  assert.equal(prompt.title, 'Select print materials');
  assert.deepEqual(prompt.text, ['1+Mini+Turtle.gcode | Extruder: None (2)']);
  assert.equal(prompt.buttons.length, 4);

  // The button that actually starts the print — the whole point of rendering this.
  const start = prompt.buttons.find((b) => b.label === 'Start print');
  assert.ok(start, 'the Start print button must survive parsing');
  assert.equal(start.footer, true);
  assert.match(start.gcode, /^PRINT_ZCOLOR /);
  assert.match(start.gcode, /FILENAME="1\+Mini\+Turtle\.gcode"/);

  // Pipe characters inside the text must not be read as field separators.
  assert.equal(prompt.buttons.filter((b) => !b.footer).length, 2);
});

test('a prompt stays hidden until prompt_show arrives', () => {
  // Everything except the final show — a half-composed prompt must not flash up.
  const composing = foldPrompt(AD5X_PROMPT_LINES.slice(0, -1));
  assert.ok(composing, 'state should exist while composing');
  assert.equal(visiblePrompt(composing), null);
});

test('prompt_end closes an open prompt', () => {
  const open = foldPrompt(AD5X_PROMPT_LINES);
  assert.ok(visiblePrompt(open));
  assert.equal(reducePromptLine(open, '// action:prompt_end'), null);
});

test('a second prompt_begin replaces a half-built prompt rather than merging', () => {
  const stale = foldPrompt(AD5X_PROMPT_LINES.slice(0, 6));
  const fresh = reducePromptLine(stale, '// action:prompt_begin Filament runout');
  assert.equal(fresh.prompt.title, 'Filament runout');
  assert.deepEqual(fresh.prompt.text, []);
  assert.deepEqual(fresh.prompt.buttons, []);
});

test('ordinary console output leaves the prompt state untouched', () => {
  const open = foldPrompt(AD5X_PROMPT_LINES);
  for (const noise of ['// H1 > command H1 ok. 7913595', 'ok', '!! Unknown command:"FOO"', '']) {
    assert.equal(reducePromptLine(open, noise), open, `\`${noise}\` should be inert`);
  }
  // ...and cannot conjure a prompt out of nothing.
  assert.equal(reducePromptLine(null, '// H1 > command H1 ok.'), null);
});

test('directives arriving with no open prompt do not crash or half-open one', () => {
  for (const orphan of [
    '// action:prompt_show',
    '// action:prompt_text stray',
    '// action:prompt_button A|G1',
    '// action:prompt_end',
  ]) {
    assert.equal(reducePromptLine(null, orphan), null, orphan);
  }
});

test('buttons with no gcode are dropped instead of rendering dead controls', () => {
  const begun = reducePromptLine(null, '// action:prompt_begin T');
  const withDead = reducePromptLine(begun, '// action:prompt_button Broken|');
  assert.deepEqual(withDead.prompt.buttons, []);
  const withGood = reducePromptLine(withDead, '// action:prompt_button Fine|G28');
  assert.equal(withGood.prompt.buttons.length, 1);
});

test('isPromptLine only matches prompt directives', () => {
  assert.equal(isPromptLine('// action:prompt_begin X'), true);
  assert.equal(isPromptLine('// action:prompt_show'), true);
  // Klipper has other action: verbs that are not prompts.
  assert.equal(isPromptLine('// action:pause'), false);
  assert.equal(isPromptLine('ok'), false);
});

// On connect Helix folds Moonraker's gcode_store to recover a prompt raised
// before it joined — otherwise the printer waits on a dialog nobody can see.
test('replaying the response buffer recovers a still-open prompt', () => {
  const buffer = [
    '// Z-Offset: 0.0000 _PRINT_FILE',
    'File opened:1+Mini+Turtle.gcode Size:659160',
    ...AD5X_PROMPT_LINES,
  ];
  const prompt = visiblePrompt(foldPrompt(buffer));
  assert.ok(prompt, 'an open prompt must survive a replay');
  assert.equal(prompt.title, 'Select print materials');
});

test('replaying a buffer whose prompt already closed recovers nothing', () => {
  // The dangerous case: a stale prompt in the buffer must not resurrect as a
  // dialog over a printer that has moved on.
  const buffer = [...AD5X_PROMPT_LINES, '// action:prompt_end', 'ok'];
  assert.equal(foldPrompt(buffer), null);
});

const {
  applyToolSlots,
  autoAnswerGcode,
  macroFilename,
  macroTargetsFile,
  zmodCommitButton,
} = require(path.join('..', 'services', 'zmodPrintPrompt.ts'));
const {
  PRINT_INTENT_TTL_MS,
  clearPrintIntent,
  peekPrintIntent,
  setPrintIntent,
  subscribePrintIntent,
} = require(path.join('..', 'services', 'printIntent.ts'));

// The commit macro exactly as the AD5X emitted it.
const AD5X_COMMIT =
  'PRINT_ZCOLOR LEVELING=0 FILENAME="1+Mini+Turtle.gcode" ALLOWED_TOOL_COUNT=4 T0=2 T1=2 T2=2 T3=2';

test('lane arguments are rewritten from Helix 0-based slots to 1-based lanes', () => {
  // Helix slot 0 is lane 1, slot 3 is lane 4 — the T0-T3 / T1-T4 offset.
  const out = applyToolSlots(AD5X_COMMIT, { 0: 0, 1: 1, 2: 2, 3: 3 });
  assert.match(out, /T0=1 T1=2 T2=3 T3=4/);
  // Everything else must survive untouched.
  assert.match(out, /^PRINT_ZCOLOR LEVELING=0 FILENAME="1\+Mini\+Turtle\.gcode" ALLOWED_TOOL_COUNT=4 /);
});

test('ALLOWED_TOOL_COUNT is not mistaken for a lane argument', () => {
  const out = applyToolSlots(AD5X_COMMIT, { 0: 0 });
  assert.match(out, /ALLOWED_TOOL_COUNT=4/, 'the tool count must not be rewritten');
});

test('unmapped tools keep the printer own proposal', () => {
  // Mapping only tool 0 leaves T1..T3 exactly as the printer sent them, which
  // is what tapping its button unchanged would have done.
  const out = applyToolSlots(AD5X_COMMIT, { 0: 3 });
  assert.match(out, /T0=4 T1=2 T2=2 T3=2/);
});

test('a nonsense slot is ignored rather than sent as a bad lane', () => {
  for (const bad of [{ 0: -1 }, { 0: NaN }, { 0: undefined }, {}]) {
    assert.match(applyToolSlots(AD5X_COMMIT, bad), /T0=2/, JSON.stringify(bad));
  }
});

test('the commit button and its filename are recognised', () => {
  const prompt = visiblePrompt(foldPrompt(AD5X_PROMPT_LINES));
  const commit = zmodCommitButton(prompt);
  assert.ok(commit);
  assert.equal(macroFilename(commit.gcode), '1+Mini+Turtle.gcode');
  assert.equal(macroTargetsFile(commit.gcode, 'gcodes/1+Mini+Turtle.gcode'), true);
  assert.equal(macroTargetsFile(commit.gcode, 'something-else.gcode'), false);
});

test('auto-answer only fires for a zmod material prompt about our own file', () => {
  const prompt = visiblePrompt(foldPrompt(AD5X_PROMPT_LINES));
  const answer = autoAnswerGcode(prompt, '1+Mini+Turtle.gcode', { 0: 1 });
  assert.match(answer, /^PRINT_ZCOLOR /);
  assert.match(answer, /T0=2/);

  // A different job — the operator answers that one.
  assert.equal(autoAnswerGcode(prompt, 'other.gcode', { 0: 1 }), null);
});

test('a prompt that is not a material selection is never auto-answered', () => {
  // A runout prompt has no PRINT_ZCOLOR button and must reach the operator.
  const runout = visiblePrompt(
    foldPrompt([
      '// action:prompt_begin Filament runout',
      '// action:prompt_text Load filament and resume',
      '// action:prompt_footer_button Resume|RESUME',
      '// action:prompt_show',
    ])
  );
  assert.equal(zmodCommitButton(runout), null);
  assert.equal(autoAnswerGcode(runout, 'anything.gcode', { 0: 0 }), null);
});

// The native preview screen uploads and starts the print itself, so its intent
// is only staged once Android hands control back to RN — often after the
// printer has already asked. Subscribers re-decide when that happens.
test('staging an intent notifies subscribers so a waiting prompt gets answered', () => {
  clearPrintIntent();
  let fired = 0;
  const unsubscribe = subscribePrintIntent(() => { fired += 1; });

  setPrintIntent({ filename: 'late.gcode', toolToSlot: {} });
  assert.equal(fired, 1, 'a staged intent must notify');

  unsubscribe();
  setPrintIntent({ filename: 'later.gcode', toolToSlot: {} });
  assert.equal(fired, 1, 'unsubscribing must actually detach');
  clearPrintIntent();
});

// The native sheet already rewrote the G-code so each tool is its physical
// slot, so its intent carries no mapping and the printer's own proposal stands
// — identical to tapping the printer's own "Start print".
test('an empty mapping answers the prompt without altering any lane', () => {
  const prompt = visiblePrompt(foldPrompt(AD5X_PROMPT_LINES));
  const answer = autoAnswerGcode(prompt, '1+Mini+Turtle.gcode', {});
  assert.ok(answer, 'an empty mapping should still auto-answer');
  assert.equal(answer, zmodCommitButton(prompt).gcode, 'lanes must be untouched');
});

test('a staged print intent expires rather than answering a later job', () => {
  clearPrintIntent();
  assert.equal(peekPrintIntent(), null);

  setPrintIntent({ filename: 'a.gcode', toolToSlot: { 0: 1 } });
  const staged = peekPrintIntent();
  assert.equal(staged.filename, 'a.gcode');

  // Just past the window: a prompt this late belongs to a different print,
  // most likely one started at the printer.
  assert.equal(peekPrintIntent(staged.stagedAt + PRINT_INTENT_TTL_MS + 1), null);
  assert.equal(peekPrintIntent(), null, 'an expired intent is dropped, not retried');
  clearPrintIntent();
});

const {
  applicablePrefs,
  buildPreprocessChecks,
  prefCopyFor,
  toolChipLabel,
  toolLabel,
} = require(path.join('..', 'services', 'printPreprocess.ts'));
const { applyLeveling, ifsOffPrintGcode } = require(path.join('..', 'services', 'zmodPrintPrompt.ts'));

// SET_ZCOLOR SILENT=2 is what zmod's own "Hide color selection, print without
// IFS" button sends — the material prompt never appears, every T-command is
// ignored, and the external side spool feeds the print. Nothing is persisted.
test('the IFS-off start is zmod\'s own external-spool macro', () => {
  assert.equal(
    ifsOffPrintGcode('1+Mini+Turtle.gcode', true),
    'SET_ZCOLOR FILENAME="1+Mini+Turtle.gcode" SILENT=2 LEVELING=1'
  );
  assert.match(ifsOffPrintGcode('a.gcode', false), /LEVELING=0$/);
  // The filename is quoted, so a path with a space survives the trip.
  assert.match(
    ifsOffPrintGcode('gcodes/my print.gcode', false),
    /FILENAME="gcodes\/my print\.gcode"/
  );
});

test('tool labels follow the machine naming', () => {
  // U1/generic: tools are T0–T3 feeding plain "lanes".
  assert.equal(toolLabel(0, 'tool'), 'T0');
  assert.equal(toolChipLabel(0, 'tool'), 'T0');
  // AD5X/Bambu: the feeds themselves are named Lane 1–4.
  assert.equal(toolLabel(1, 'lane'), 'Lane 2');
  // The chip is a 26–34px circle — "Lane 2" would never fit, so it shows the number.
  assert.equal(toolChipLabel(1, 'lane'), '2');
});

// A file tool re-routed onto another feed — the one check whose wording names
// both the tool and the lane.
const REROUTED_LANES = [0, 1, 2, 3].map((index) => ({
  index,
  color: '#ffffff',
  material: 'PLA',
  status: index === 1 ? 'loaded' : 'empty',
}));
const REROUTED_TOOLS = [
  { fileTool: 0, assigned: 1, grams: 1, lane: REROUTED_LANES[1], source: 'auto' },
];

test('check wording follows the machine naming', () => {
  const base = {
    connected: true,
    printerBusy: false,
    printerName: 'Printer',
    tools: REROUTED_TOOLS,
    lanes: REROUTED_LANES,
  };
  const detail = (naming) =>
    buildPreprocessChecks({ ...base, ...(naming ? { naming } : {}) })
      .find((check) => check.key === 'filament').detail;

  // The default and the explicit U1 wording are the pre-naming strings.
  assert.equal(detail('tool'), 'T0 to lane 2 — your own lanes were empty');
  assert.equal(detail(undefined), 'T0 to lane 2 — your own lanes were empty');
  assert.equal(detail('lane'), 'Lane 1 to Lane 2 — your own Lanes were empty');
});

test('the AD5X and Bambu name their feeds lanes, everything else tools', () => {
  assert.equal(resolveMachineProfile({ kind: 'flashforge-ad5x' }).laneNaming, 'lane');
  assert.equal(resolveMachineProfile({ kind: 'bambu-lan' }).laneNaming, 'lane');
  assert.equal(resolveMachineProfile({ kind: 'snapmaker-u1' }).laneNaming, 'tool');
  assert.equal(resolveMachineProfile({ kind: 'generic-klipper' }).laneNaming, 'tool');
  assert.equal(resolveMachineProfile(null).laneNaming, 'tool');
});

test('the AD5X offers only bed levelling and its material station', () => {
  const keys = prefCopyFor({ printerKind: 'flashforge-ad5x', multicolor: false })
    .map(({ key }) => key);
  assert.deepEqual(keys, ['autoLevel', 'ifs']);
  // Single vs multi colour must not change what is on offer.
  assert.deepEqual(
    prefCopyFor({ printerKind: 'flashforge-ad5x', multicolor: true }).map(({ key }) => key),
    ['autoLevel', 'ifs']
  );
  // The U1 keeps its PAXX toggles and never shows IFS.
  const u1 = prefCopyFor({ printerKind: 'snapmaker-u1', multicolor: true }).map(({ key }) => key);
  assert.deepEqual(u1, ['autoLevel', 'flowCal', 'timelapse']);
  const bambu = prefCopyFor({ printerKind: 'bambu-lan', multicolor: false }).map(({ key }) => key);
  assert.deepEqual(bambu, ['autoLevel', 'timelapse']);
  const bambuCalibration = prefCopyFor({ printerKind: 'bambu-lan', multicolor: false })
    .find(({ key }) => key === 'autoLevel');
  assert.equal(bambuCalibration.label, 'Bed & vibration calibration');
  assert.match(bambuCalibration.hint, /Probe the bed and tune vibration/);
});

// The dialog can swap printers with the toggles already set. A time-lapse left
// on from the U1 would inject TIMELAPSE_* macros the AD5X does not have, and
// the print dies on "Unknown command" — so anything not offered is dropped.
test('preferences the target printer does not offer are dropped at send', () => {
  const all = { autoLevel: true, flowCal: true, timelapse: true, ifs: true };

  const ad5x = applicablePrefs(all, { printerKind: 'flashforge-ad5x', multicolor: true });
  assert.equal(ad5x.autoLevel, true);
  assert.equal(ad5x.ifs, true);
  assert.equal(ad5x.timelapse, false, 'the AD5X has no TIMELAPSE macros');
  assert.equal(ad5x.flowCal, false, 'flow calibration is PAXX-only');

  const u1 = applicablePrefs(all, { printerKind: 'snapmaker-u1', multicolor: true });
  assert.equal(u1.timelapse, true);
  assert.equal(u1.flowCal, true);
  assert.equal(u1.ifs, false, 'the U1 has no IFS');

  const bambu = applicablePrefs(all, { printerKind: 'bambu-lan', multicolor: false });
  assert.equal(bambu.autoLevel, true);
  assert.equal(bambu.flowCal, false, 'the P1S has no per-print flow calibration');
  assert.equal(bambu.timelapse, true);
  assert.equal(bambu.ifs, false);

  const slicerSource = fs.readFileSync(path.join(REPO_ROOT, 'app', '(tabs)', 'slicer.tsx'), 'utf8');
  const mqttModuleSource = fs.readFileSync(
    path.join(
      REPO_ROOT,
      'android',
      'app',
      'src',
      'main',
      'java',
      'org',
      'crabcore',
      'u1control',
      'bambu',
      'BambuMqttModule.kt'
    ),
    'utf8'
  );
  assert.match(slicerSource, /vibrationCalibration: requestedPrefs\.autoLevel/);
  assert.match(
    mqttModuleSource,
    /vibrationCalibration = config\.getBoolean\("vibrationCalibration"\)/
  );

  // Every key is always present, so callers never read undefined.
  for (const key of ['autoLevel', 'flowCal', 'timelapse', 'ifs']) {
    assert.equal(typeof ad5x[key], 'boolean', key);
  }
});

// The AD5X takes levelling as an argument of its print macro, not as a
// preferences command — its own prompt offers LEVELING=1 and LEVELING=0.
test('bed levelling is applied to the AD5X print macro', () => {
  const prompt = visiblePrompt(foldPrompt(AD5X_PROMPT_LINES));
  const on = autoAnswerGcode(prompt, '1+Mini+Turtle.gcode', {}, true);
  const off = autoAnswerGcode(prompt, '1+Mini+Turtle.gcode', {}, false);
  assert.match(on, /LEVELING=1/);
  assert.match(off, /LEVELING=0/);

  // Undefined leaves the printer's own value untouched.
  assert.equal(applyLeveling('PRINT_ZCOLOR LEVELING=0 X=1', undefined), 'PRINT_ZCOLOR LEVELING=0 X=1');
  // And it must not maul a similarly-named argument.
  assert.match(applyLeveling('PRINT_ZCOLOR AUTO_LEVELING_MODE=3 LEVELING=0', true), /AUTO_LEVELING_MODE=3/);
});

test('the dismiss command is the one the printer itself offers as Cancel', () => {
  const prompt = visiblePrompt(foldPrompt(AD5X_PROMPT_LINES));
  const cancel = prompt.buttons.find((b) => b.label === 'Cancel');
  assert.equal(cancel.gcode, PROMPT_DISMISS_GCODE);
});

// Every bed the app can render, as [label, bed]. The A-series beds hang off the
// serial lookup, so iterating the profile table alone would miss their geometry.
function everyBed() {
  const beds = Object.entries(PRINTER_PROFILES).map(([kind, p]) => [kind, p.bed]);
  beds.push(['bambu-lan a1-mini', bambuBedForSerial('03000A421900555')]);
  beds.push(['bambu-lan a1', bambuBedForSerial('03900A421900555')]);
  return beds;
}

test('an A1 mini gets its own 180mm plate, not the 256 one', () => {
  // Real Bambu serials: 030 prefixes an A1 mini, 039 an A1, 01P a P1S.
  const mini = bambuBedForSerial('03000A421900555');
  assert.equal(mini.sizeX, 180);
  assert.equal(mini.sizeY, 180);
  assert.equal(mini.modelAsset, 'bambu_a1_mini_bed.stl');

  const p1s = bambuBedForSerial('01P00C611300996');
  assert.equal(p1s.sizeX, 256);
  assert.equal(p1s.modelAsset, 'bambu_x1_bed.stl');
});

test('a full-size A1 gets its official 256mm Z travel', () => {
  const a1 = bambuBedForSerial('03900A421900555');
  assert.equal(a1.sizeX, 256);
  assert.equal(a1.sizeY, 256);
  assert.equal(a1.height, 256);
  assert.equal(a1.modelAsset, 'bambu_x1_bed.stl');
});

// A miss here has to be harmless: unknown Bambus get the common 256mm plate
// with the conservative P1/X1 250mm height.
test('an unknown or missing Bambu serial falls back to the 256mm plate', () => {
  for (const serial of [null, undefined, '', '   ', 'nonsense', 'BL-P001', 42]) {
    const bed = bambuBedForSerial(serial);
    assert.equal(bed.sizeX, 256, `serial ${String(serial)} should fall back to 256`);
    assert.equal(bed.height, 250, `serial ${String(serial)} should keep conservative Z`);
    assert.equal(bed.modelAsset, 'bambu_x1_bed.stl');
  }
});

test('bambu serial matching ignores case and surrounding whitespace', () => {
  assert.equal(bambuBedForSerial('  03000a421900555  ').sizeX, 180);
  assert.equal(bambuBedForSerial('  03900a421900555  ').height, 256);
});

test('resolveBedProfile routes each kind to the right bed', () => {
  assert.equal(resolveBedProfile({ kind: 'snapmaker-u1' }).sizeX, 270);
  assert.equal(resolveBedProfile({ kind: 'flashforge-ad5x' }).sizeX, 220);
  assert.equal(resolveBedProfile({ kind: 'generic-klipper' }).sizeX, 220);
  // Only Bambu consults the serial; the others ignore it entirely.
  assert.equal(
    resolveBedProfile({ kind: 'snapmaker-u1', serialNumber: '03000A421900555' }).sizeX,
    270
  );
  assert.equal(
    resolveBedProfile({ kind: 'bambu-lan', serialNumber: '03000A421900555' }).sizeX,
    180
  );
  assert.equal(resolveBedProfile({ kind: 'bambu-lan' }).sizeX, 256);
  // A missing or unsaved printer must still produce a usable bed.
  assert.ok(resolveBedProfile(null).sizeX > 0);
  assert.ok(resolveBedProfile(undefined).sizeX > 0);
  assert.ok(resolveBedProfile({}).sizeX > 0);
});

test('resolveMachineProfile pairs each bed with its own slice profile', () => {
  const u1 = resolveMachineProfile({ kind: 'snapmaker-u1' });
  assert.equal(u1.bed.sizeX, 270);
  assert.equal(u1.sliceProfileAsset, 'snapmaker_u1.json');

  const ad5x = resolveMachineProfile({ kind: 'flashforge-ad5x' });
  assert.equal(ad5x.bed.sizeX, 220);
  assert.equal(ad5x.sliceProfileAsset, 'flashforge_ad5x.json');

  const p1s = resolveMachineProfile({ kind: 'bambu-lan', serialNumber: ' 01p00c611300996 ' });
  assert.equal(p1s.sliceProfileAsset, 'bambu_p1s.json');
  assert.deepEqual(p1s.printPrefs, ['autoLevel', 'timelapse']);

  const a1 = resolveMachineProfile({ kind: 'bambu-lan', serialNumber: ' 03900a421900555 ' });
  assert.equal(a1.bed.height, 256);
  assert.equal(a1.sliceProfileAsset, 'bambu_a1.json');
  assert.deepEqual(a1.printPrefs, ['autoLevel', 'timelapse']);

  // Unknown Bambu models and generic Klipper keep the engine defaults and
  // cannot upload. A1 mini remains blocked until it gets its own machine profile.
  assert.equal(resolveMachineProfile({ kind: 'bambu-lan' }).sliceProfileAsset, null);
  assert.equal(
    resolveMachineProfile({ kind: 'bambu-lan', serialNumber: '03000A421900555' }).sliceProfileAsset,
    null
  );
  assert.equal(resolveMachineProfile({ kind: 'generic-klipper' }).sliceProfileAsset, null);
});

// The whole point of the slice profile is that no machine gets another's start
// G-code. Two printers sharing an asset would silently reintroduce that.
test('no two printer kinds share a slice profile asset', () => {
  const assets = Object.values(PRINTER_PROFILES)
    .map((profile) => profile.sliceProfileAsset)
    .filter((asset) => asset !== null);
  assert.equal(new Set(assets).size, assets.length, `duplicate slice profiles: ${assets}`);
});

test('every declared slice profile is bundled and carries machine G-code', () => {
  const dir = path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'assets', 'orca_profiles', 'printer');
  for (const [kind, profile] of Object.entries(PRINTER_PROFILES)) {
    const asset = profile.sliceProfileAsset;
    if (asset === null) continue;
    const file = path.join(dir, asset);
    assert.ok(fs.existsSync(file), `${kind} declares slice profile ${asset}, which is not bundled`);

    // HelixSliceRunner.readMachineProfile requires both templates; a profile
    // missing them would slice with empty start/end G-code and no warning.
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of ['machine_start_gcode', 'machine_end_gcode']) {
      assert.ok(
        typeof parsed[key] === 'string' && parsed[key].trim().length > 0,
        `${kind} slice profile ${asset} has no ${key}`
      );
    }
  }
});

test('only the AD5X slice profile opts into Klipper compatibility rewriting', () => {
  const dir = path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'assets', 'orca_profiles', 'printer');
  const ad5x = JSON.parse(fs.readFileSync(path.join(dir, 'flashforge_ad5x.json'), 'utf8'));
  const u1 = JSON.parse(fs.readFileSync(path.join(dir, 'snapmaker_u1.json'), 'utf8'));

  assert.equal(ad5x.gcode_flavor, 'klipper');
  assert.equal(ad5x.helix_translate_marlin_machine_limits, true);
  assert.equal(ad5x.helix_strip_m486, true);
  assert.notEqual(u1.helix_translate_marlin_machine_limits, true);
  assert.notEqual(u1.helix_strip_m486, true);
});

// print_task_config and SET_PRINT_PREFERENCES are PAXX firmware. Claiming them
// on any other machine makes printing fail with "Printer rejected the selected
// print preferences", because the read-back can never match.
const {
  canUseReportedFilamentSlots,
  materialStationSlots,
  unavailableMaterialStationSlots,
} = require(path.join('..', 'services', 'filamentSlots.ts'));

test('Bambu keeps its last AMS report during reconnect without changing Moonraker safety', () => {
  assert.equal(canUseReportedFilamentSlots('disconnected', 'bambu-lan'), true);
  assert.equal(canUseReportedFilamentSlots('connecting', 'bambu-lan'), true);
  assert.equal(canUseReportedFilamentSlots('disconnected', 'snapmaker-u1'), false);
  assert.equal(canUseReportedFilamentSlots('connected', 'snapmaker-u1'), true);
});

// An AD5X publishes no print_task_config, so the slicer's Moonraker-derived
// lanes fell back to saved manual settings and offered spools from another
// printer. These come off FlashForge's REST API instead.
test('AD5X lanes are read from the material station, not saved settings', () => {
  const units = [{
    lanes: [
      { index: 0, status: 'loaded', material: 'PLA', brand: 'Numaker', colorHex: '#11AA33' },
      { index: 1, status: 'empty' },
      { index: 2, status: 'drying', material: 'PETG', brand: 'Hobby Lobby', colorHex: '#2244FF' },
      { index: 3, status: 'loaded', material: 'TPU', brand: 'Hobby Lobby', colorHex: '#FF8800' },
    ],
  }];
  const slots = materialStationSlots(units);

  assert.equal(slots.length, 4);
  assert.equal(slots[0].material, 'PLA');
  assert.equal(slots[0].brand, 'Numaker');
  assert.equal(slots[0].status, 'loaded');
  assert.equal(slots[1].status, 'empty');
  // A drying lane cannot feed a print, and the slot UI has no drying state.
  assert.equal(slots[2].status, 'busy');
  assert.equal(slots[3].material, 'TPU');
  // Every slot is the machine speaking, so nothing is attributed to settings.
  assert.ok(slots.every((slot) => slot.source === 'printer'));
});

test('a silent material station falls back rather than blanking the lanes', () => {
  // Null is the signal to keep the existing behaviour; four empty lanes would
  // look like the printer had nothing loaded.
  assert.equal(materialStationSlots([]), null);
  assert.equal(materialStationSlots([{ lanes: [] }]), null);
});

test('lanes missing from the station still produce four usable slots', () => {
  // The station can report fewer than four; the UI always renders four.
  const slots = materialStationSlots([{ lanes: [{ index: 0, status: 'loaded', material: 'PLA' }] }]);
  assert.equal(slots.length, 4);
  assert.equal(slots[0].status, 'loaded');
  for (const index of [1, 2, 3]) {
    assert.equal(slots[index].status, 'empty', `slot ${index}`);
    assert.equal(typeof slots[index].color, 'string');
  }
});

test('an unavailable AD5X station never falls back to cached manual filament', () => {
  const slots = unavailableMaterialStationSlots();
  assert.equal(slots.length, 4);
  assert.ok(slots.every((slot) => slot.status === 'unknown'));
  assert.ok(slots.every((slot) => slot.material === '' && slot.mainType === ''));
  assert.ok(slots.every((slot) => slot.source === 'printer'));
});

test('only the Snapmaker U1 claims PAXX print preferences', () => {
  for (const [kind, profile] of Object.entries(PRINTER_PROFILES)) {
    assert.equal(
      profile.supportsPrintPreferences,
      kind === 'snapmaker-u1',
      `${kind} should ${kind === 'snapmaker-u1' ? '' : 'not '}claim print preferences`
    );
  }
  assert.equal(resolveMachineProfile({ kind: 'snapmaker-u1' }).supportsPrintPreferences, true);
  assert.equal(resolveMachineProfile({ kind: 'flashforge-ad5x' }).supportsPrintPreferences, false);
  assert.equal(resolveMachineProfile({ kind: 'bambu-lan' }).supportsPrintPreferences, false);
  assert.equal(resolveMachineProfile(null).supportsPrintPreferences, false);
});

test('every printer kind declares a usable build volume', () => {
  for (const [kind, profile] of Object.entries(PRINTER_PROFILES)) {
    const { sizeX, sizeY, height } = profile.bed;
    for (const [axis, value] of Object.entries({ sizeX, sizeY, height })) {
      assert.ok(
        Number.isFinite(value) && value > 0,
        `${kind} bed ${axis} must be a positive number, got ${value}`
      );
    }
  }
});

test('the AD5X slices and previews against its own 220mm bed, not the U1 270', () => {
  const ad5x = printerProfile('flashforge-ad5x').bed;
  assert.equal(ad5x.sizeX, 220);
  assert.equal(ad5x.sizeY, 220);
  assert.equal(ad5x.height, 220);
  assert.notEqual(ad5x.sizeX, printerProfile('snapmaker-u1').bed.sizeX);
});

// A bed mesh that is named but not shipped fails silently at runtime — the
// renderer catches the missing asset and falls back to a bare rectangle, so
// nothing crashes and nobody notices the plate stopped being drawn.
test('every declared bed mesh is actually bundled in the APK assets', () => {
  const bedDir = path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'assets', 'bed');
  for (const [kind, bed] of everyBed()) {
    if (bed.modelAsset === null) continue;
    assert.ok(
      fs.existsSync(path.join(bedDir, bed.modelAsset)),
      `${kind} declares bed mesh ${bed.modelAsset}, which is missing from assets/bed/`
    );
  }
});

// The renderer shifts each mesh by (sizeX/2, sizeY/2) — Orca's convention that
// the plate is authored about the centre of the printable area. If a mesh were
// authored some other way it would land off the bed, so pin the assumption.
test('bed meshes are authored about the centre of the printable area', () => {
  const bedDir = path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'assets', 'bed');
  for (const [kind, bed] of everyBed()) {
    const asset = bed.modelAsset;
    if (asset === null) continue;

    const buffer = fs.readFileSync(path.join(bedDir, asset));
    assert.ok(buffer.length >= 84, `${kind} bed mesh ${asset} is too short to be a binary STL`);
    const triangles = buffer.readUInt32LE(80);
    assert.equal(
      buffer.length,
      84 + triangles * 50,
      `${kind} bed mesh ${asset} is not binary STL — the native loader only parses binary`
    );

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < triangles; i += 1) {
      const base = 84 + i * 50 + 12; // skip the per-facet normal
      for (let v = 0; v < 3; v += 1) {
        const x = buffer.readFloatLE(base + v * 12);
        const y = buffer.readFloatLE(base + v * 12 + 4);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    // The plate is a little larger than the printable area and carries a grab
    // handle off the front, so the fit is loose rather than exact: it must
    // cover the bed without ballooning past it.
    const { sizeX, sizeY } = bed;
    assert.ok(
      maxX - minX >= sizeX && maxX - minX <= sizeX * 1.25,
      `${kind} bed mesh spans ${(maxX - minX).toFixed(1)}mm in X, which does not match a ${sizeX}mm bed`
    );
    assert.ok(
      maxY - minY >= sizeY && maxY - minY <= sizeY * 1.25,
      `${kind} bed mesh spans ${(maxY - minY).toFixed(1)}mm in Y, which does not match a ${sizeY}mm bed`
    );
  }
});

test('bambu chamber light is presented as a klipper LED', () => {
  const state = bambuStateFromFixture();
  // The dashboard finds the light by this key shape and reads color_data.
  const on = bambuStatus({ ...state, lights_report: [{ node: 'chamber_light', mode: 'on' }] });
  assert.deepEqual(on['neopixel chamber_light'].color_data, [[1, 1, 1]]);

  const off = bambuStatus({ ...state, lights_report: [{ node: 'chamber_light', mode: 'off' }] });
  assert.deepEqual(off['neopixel chamber_light'].color_data, [[0, 0, 0]]);

  // A printer that reports no chamber light must not grow a dead toggle.
  assert.equal(bambuStatus({ ...state, lights_report: [] })['neopixel chamber_light'], undefined);
});

const {
  bambuConnectionFailureMessage,
  classifyBambuConnectionFailure,
} = require(path.join('..', 'services', 'bambuConnection.ts'));

test('Bambu setup connection failures stay actionable and stable', () => {
  assert.deepEqual(classifyBambuConnectionFailure({ code: 'wrong-serial', message: 'TLS failed' }), {
    reason: 'wrong-serial',
    message: 'TLS failed',
  });
  assert.equal(
    bambuConnectionFailureMessage('wrong-serial', 'TLS failed'),
    'The serial number does not match this printer.'
  );
  assert.equal(
    bambuConnectionFailureMessage('wrong-access-code', 'not authorized'),
    'The printer rejected the LAN access code.'
  );
  assert.equal(classifyBambuConnectionFailure({ code: 'probe-timeout' }).reason, 'unreachable');
  assert.equal(
    bambuConnectionFailureMessage('unknown', 'Printer returned an unusual reply'),
    'Printer returned an unusual reply'
  );
});

test('Bambu setup probes read-only status and Home exposes offline reconnect', () => {
  const editor = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'settings', 'PrinterEditorModal.tsx'),
    'utf8'
  );
  const dashboard = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'dashboard', 'Dashboard.tsx'),
    'utf8'
  );
  assert.match(editor, /await probeBambuStatus\(/);
  assert.match(editor, /Test connection/);
  assert.doesNotMatch(editor, /startBambuProjectFile|uploadBambuPrintArtifact/);
  assert.match(dashboard, /connection === 'disconnected'/);
  assert.match(dashboard, /accessibilityLabel=\{t\('Reconnect now'\)\}/);
});

test('AD5X editor exposes every connection mode and Tailscale-only never falls back to LAN', () => {
  const editor = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'settings', 'PrinterEditorModal.tsx'),
    'utf8'
  );
  const moonrakerHook = fs.readFileSync(
    path.join(REPO_ROOT, 'hooks', 'useMoonraker.tsx'),
    'utf8'
  );
  const materialStationHook = fs.readFileSync(
    path.join(REPO_ROOT, 'hooks', 'useMaterialStation.ts'),
    'utf8'
  );

  assert.match(editor, /effectiveConnectionMode: ConnectionMode = isBambu \? 'lan' : connectionMode/);
  assert.match(editor, /!isBambu \? \([\s\S]*Printer URL \(Tailscale/);
  assert.match(editor, /!isBambu \? \([\s\S]*Connection mode/);
  assert.equal(
    [...moonrakerHook.matchAll(/if \(mode === 'tailscale'\) \{\s*if \(tailscale\) urls\.push\(tailscale\);\s*return urls;\s*\}/g)].length,
    2
  );
  assert.match(moonrakerHook, /const delay = completedCycle[\s\S]*: 0;/);
  assert.match(moonrakerHook, /if \(!completedCycle\) setConnection\('connecting'\)/);
  assert.match(
    moonrakerHook,
    /const autoFailover = current\.connectionMode === 'auto' && urls\.length > 1;/
  );
  assert.match(moonrakerHook, /autoFailover \? 3000 : 7000/);
  assert.match(
    moonrakerHook,
    /generationRef\.current \+= 1;[\s\S]{0,400}scheduleReconnect\(\);/
  );
  assert.match(
    materialStationHook,
    /connection === 'connected' \? activeUrl : ''/
  );
});

test('Bambu without AMS stays one external spool through Home, Slice, and print start', () => {
  const dashboardModel = fs.readFileSync(
    path.join(REPO_ROOT, 'hooks', 'useDashboardModel.ts'),
    'utf8'
  );
  const dashboardModules = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'dashboard', 'parts', 'Modules.tsx'),
    'utf8'
  );
  const slicerParts = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'slicer', 'parts.tsx'),
    'utf8'
  );
  const slicer = fs.readFileSync(
    path.join(REPO_ROOT, 'app', '(tabs)', 'slicer.tsx'),
    'utf8'
  );

  assert.match(dashboardModel, /bambu_filament_source === 'external'[\s\S]*slots\.slice\(0, 1\)/);
  assert.match(dashboardModules, /externalSpool \? t\('External Spool'\)/);
  assert.match(slicerParts, /externalSpool[\s\S]*t\('External Spool'\)/);
  assert.match(slicer, /const slotCount = [^\n]*bambu_filament_source === 'external' \? 1 : 4/);
  assert.match(slicer, /toolToLane: \{ 0: bambuExternalSpool \? -1 : targetLane \}/);
  assert.match(slicer, /useAms: !bambuExternalSpool/);
});

test('Bambu external spool does not turn back into fake AMS lanes in the final dialog', () => {
  const dialog = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'PrintPreprocessDialog.tsx'),
    'utf8'
  );
  const editor = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'dashboard', 'parts', 'FilamentEditor.tsx'),
    'utf8'
  );
  const slicer = fs.readFileSync(
    path.join(REPO_ROOT, 'app', '(tabs)', 'slicer.tsx'),
    'utf8'
  );

  assert.match(dialog, /if \(externalSpool\) return pool\.slice\(0, 1\)\.map\(asLane\)/);
  assert.match(dialog, /const canRemap = !externalSpool/);
  assert.match(dialog, /externalSpool \? 'EXT' : toolChipLabel/);
  assert.match(slicer, /externalSpool=\{bambuExternalSpool\}/);
  assert.match(editor, /resolved\?\.color \|\| colors\[slot\]/);
  assert.match(editor, /resolved\?\.mainType \|\| materials\[slot\]/);
  assert.match(editor, /externalSpool \? filamentPositionLabel/);
});

test('Bespok3d enrollment credentials fail closed and stay scoped to one printer', () => {
  const credentials = {
    identity: 'helix-12345678-1234-1234-1234-123456789abc',
    token: 'a'.repeat(64),
  };
  const prepared = createPreparedBespok3dCredentialRecord(
    'u1-living-room',
    `SHA256:${'A'.repeat(43)}`,
    'Helix Android',
    credentials
  );
  assert.equal(bespok3dCredentialStorageKey(prepared.printerId), 'helix.bespok3d.u1-living-room');
  assert.deepEqual(normalizeBespok3dCredentialRecord({ ...prepared, ignored: 'not persisted' }), prepared);
  assert.equal(normalizeBespok3dCredentialRecord({ ...prepared, token: 'short' }), null);
  assert.equal(normalizeBespok3dCredentialRecord({ ...prepared, printerId: '../other-printer' }), null);
  assert.throws(() => bespok3dCredentialStorageKey('../other-printer'));

  const enrolled = createEnrolledBespok3dCredentialRecord(prepared, {
    ...credentials,
    certificatePem: '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n',
    certificateSha256: Array(32).fill('AA').join(':'),
    daemonVersion: '0.12.24',
    jinniVersion: '0.1.10',
    completedSteps: ['verify'],
  });
  assert.equal(enrolled.status, 'enrolled');
  assert.equal(enrolled.daemonVersion, '0.12.24');
  assert.equal(enrolled.completedSteps, undefined);
});

test('Bespok3d enrollment lives under Tools, stays U1-only, and saves before mutation', () => {
  const settingsSource = fs.readFileSync(
    path.join(REPO_ROOT, 'app', '(tabs)', 'settings.tsx'),
    'utf8'
  );
  const toolsSource = fs.readFileSync(
    path.join(REPO_ROOT, 'app', '(tabs)', 'tools.tsx'),
    'utf8'
  );
  const dialogSource = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'settings', 'Bespok3dEnrollmentDialog.tsx'),
    'utf8'
  );
  assert.match(toolsSource, /title: 'Plugins'/);
  assert.match(toolsSource, /activePrinter\?\.kind === 'snapmaker-u1'/);
  assert.match(toolsSource, /<Bespok3dEnrollmentDialog/);
  assert.doesNotMatch(settingsSource, /<Bespok3dEnrollmentDialog|Set up Bespok3d on/);
  assert.match(dialogSource, /await writeBespok3dCredentialRecord\(prepared\);[\s\S]*await enrollBespok3dU1\(/);
  assert.match(dialogSource, /secureTextEntry/);
  assert.match(dialogSource, /The password is used for this run only and is never saved/);
});

test('HelixScreen install is absent-only, confirmed, pinned native, and read back as stock', () => {
  const dialogSource = fs.readFileSync(
    path.join(REPO_ROOT, 'components', 'settings', 'Bespok3dEnrollmentDialog.tsx'),
    'utf8'
  );
  const nativeSource = fs.readFileSync(
    path.join(
      REPO_ROOT,
      'android',
      'app',
      'src',
      'main',
      'java',
      'org',
      'crabcore',
      'u1control',
      'bespok3d',
      'Bespok3dClient.kt'
    ),
    'utf8'
  );

  assert.match(dialogSource, /if \(helixScreen\?\.installed === false\) return \[/);
  assert.match(dialogSource, /setStage\('helixscreen-confirm'\)/);
  assert.match(
    dialogSource,
    /await installBundledBespok3dHelixScreen\([\s\S]*await getBespok3dHelixScreenState\(/,
  );
  assert.match(dialogSource, /keeps the stock Snapmaker screen selected/);
  assert.match(nativeSource, /verifyBundledHelixScreenPackage\(bytes\)/);
  assert.match(nativeSource, /mapOf\("SCREEN_UI" to "snapmaker"\)/);
  assert.match(
    nativeSource,
    /helixScreenState\(host, token, certificatePem\)[\s\S]*state\.selected == "snapmaker"/,
  );
});

// The A1 profile was originally produced by copying the P1S one, and its
// filament block came along unchanged: P1S bed temps, P1S fan curve, the P1S
// high-flow extruder variant, and the P1S chamber-heater command on a machine
// with no chamber. BambuPrintUpload ships this file verbatim as the uploaded
// project's settings, so these are the values the printer is told about.
// Regenerated 2026-08-14 from the official BambuStudio A1 presets.
test('Bambu A1 profile carries A1 filament values, not the P1S ones it was copied from', () => {
  const profileDir = path.join(
    REPO_ROOT,
    'android',
    'app',
    'src',
    'main',
    'assets',
    'orca_profiles',
    'printer',
  );
  const a1 = JSON.parse(fs.readFileSync(path.join(profileDir, 'bambu_a1.json'), 'utf8'));
  const p1s = JSON.parse(fs.readFileSync(path.join(profileDir, 'bambu_p1s.json'), 'utf8'));

  // Lanes are [PLA Basic, PETG HF, PLA Basic, PETG HF].
  assert.deepEqual(a1.filament_type, ['PLA', 'PETG', 'PLA', 'PETG']);

  // Bed: the A1 runs PLA 10C hotter than the enclosed P1S does.
  assert.deepEqual(a1.hot_plate_temp, ['65', '70', '65', '70']);
  assert.deepEqual(a1.hot_plate_temp_initial_layer, ['65', '70', '65', '70']);
  assert.deepEqual(a1.textured_plate_temp, ['65', '70', '65', '70']);
  assert.deepEqual(p1s.hot_plate_temp, ['55', '70', '55', '70']);

  // Cooling: the open-frame A1 runs a gentler fan than the enclosed P1S.
  assert.deepEqual(a1.fan_min_speed, ['60', '30', '60', '30']);
  assert.deepEqual(a1.fan_max_speed, ['80', '50', '80', '50']);
  assert.deepEqual(a1.pre_start_fan_time, ['2', '2', '2', '2']);

  // The A1 hotend has no high-flow variant.
  assert.ok(
    a1.filament_extruder_variant.every((variant) => variant === 'Direct Drive Standard'),
    'A1 filament_extruder_variant must not carry the P1S high-flow entries',
  );

  // M142 sets the P1S chamber/aux heater. The A1 has no chamber.
  a1.filament_start_gcode.forEach((gcode, lane) => {
    assert.ok(!gcode.includes('M142'), `A1 lane ${lane} must not drive a chamber heater`);
  });
  assert.ok(
    p1s.filament_start_gcode.some((gcode) => gcode.includes('M142')),
    'P1S startup is expected to keep its chamber heater command',
  );

  // Preset identity must name the A1, not the machine it was copied from.
  assert.equal(a1.print_settings_id, '0.20mm Standard @BBL A1');
  assert.ok(
    a1.filament_settings_id.every((id) => id.endsWith('@BBL A1')),
    'A1 filament preset names must not say P1S',
  );

  // P1S presets carry two entries per filament (standard + high flow); the A1's
  // carry one, so its per-filament arrays are one-per-lane.
  ['nozzle_temperature', 'filament_max_volumetric_speed', 'filament_flow_ratio'].forEach((key) => {
    assert.equal(a1[key].length, 4, `${key} should hold one value per lane on the A1`);
    assert.equal(p1s[key].length, 8, `${key} is expected to stay dual-variant on the P1S`);
  });

  // The artifact builder refuses a profile that lost its bulk or its identity.
  assert.ok(Object.keys(a1).length >= 500);
  assert.equal(a1.printer_model, 'Bambu Lab A1');
});

// A multi-day print showing a bare "5:00 PM" reads as five hours away when it
// is really five days. useDashboardModel's live ETA used to format the clock
// itself and lost the day; it now shares finishClock with the pre-print dialog.
const { finishClock } = require(path.join('..', 'services', 'printEta.ts'));

test('finish clock names the day for prints that end after today', () => {
  const HOUR = 3600;
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Seconds from now until 9am on the Nth day from today, so the assertions do
  // not depend on what time the suite happens to run.
  const secondsUntilDayAt9am = (dayOffset) =>
    (midnight + dayOffset * 86_400_000 + 9 * HOUR * 1000 - Date.now()) / 1000;

  const today = finishClock(60);
  assert.doesNotMatch(today, /tomorrow|\d{1,2}\/|[A-Z][a-z]{2}\b/, 'today stays a bare time');

  assert.match(finishClock(secondsUntilDayAt9am(1)), /tomorrow$/);

  // Two to six days out reads as a weekday name.
  for (const offset of [2, 3, 6]) {
    const label = finishClock(secondsUntilDayAt9am(offset));
    const expected = new Date(midnight + offset * 86_400_000).toLocaleDateString(undefined, {
      weekday: 'short',
    });
    assert.ok(
      label.endsWith(expected),
      `${offset} days out should end with ${expected}, got ${label}`
    );
    assert.doesNotMatch(label, /tomorrow/);
  }

  // A week or more stops being unambiguous as a weekday, so it becomes a date.
  const farOff = finishClock(secondsUntilDayAt9am(9));
  const farDate = new Date(midnight + 9 * 86_400_000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  assert.ok(farOff.endsWith(farDate), `nine days out should end with ${farDate}, got ${farOff}`);
});

test('finish clock keeps the time itself intact and refuses negative input', () => {
  const label = finishClock(0);
  const expected = new Date().toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  assert.equal(label, expected);
  // A countdown that has overshot must not read as finishing yesterday.
  assert.equal(finishClock(-500), expected);
});
