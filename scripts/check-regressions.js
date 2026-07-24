const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

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
  DEFAULT_SETTINGS,
  STORAGE_VERSION,
  migrateSettings,
} = require(path.join('..', 'services', 'settingsMigration.ts'));
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
  buildManualFilamentSlotCommand,
  fileUrl,
  isTailscaleUrl,
  normalizeBaseUrl,
  normalizeMoonrakerUrl,
  printerConnectionUrl,
  resolveCameraUrl,
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

test('holds unstable live ETA early and retains byte-progress fallback', () => {
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
      liveRemainingSeconds: null,
      source: 'm73',
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
