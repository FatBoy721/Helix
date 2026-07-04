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
  migrateSettings,
} = require(path.join('..', 'services', 'settingsMigration.ts'));
const {
  buildBugReportUrl,
  isCurrentRelease,
  releaseCommit,
  releaseDownloadUrl,
} = require(path.join('..', 'services', 'updateCheck.ts'));
const {
  cacheBustUrl,
  cameraSnapshotFileName,
} = require(path.join('..', 'services', 'cameraSnapshot.ts'));
const {
  fileUrl,
  isTailscaleUrl,
  normalizeBaseUrl,
  normalizeMoonrakerUrl,
  resolveCameraUrl,
  resolveSnapshotUrl,
  thumbnailUrl,
  wsUrl,
} = require(path.join('..', 'services', 'moonraker.ts'));

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
    notificationMode: 'local',
    ntfyServer: 'https://ntfy.sh',
    ntfyTopic: '',
    aceUnits: 1,
    notifyPrintComplete: true,
    notifyPrintFailed: true,
    notifyPrintPaused: true,
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
      },
      {
        id: 'p2',
        name: 'Backup',
        url: 'http://192.168.1.99:7125',
        tailscaleUrl: '',
        cameraUrl: '/webcam/webrtc',
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
  assert.equal(patch.ntfyTopic, 'printer-alerts');
  assert.deepEqual(patch.printers[0], {
    id: 'p1',
    name: 'Snapmaker U1',
    url: 'http://192.168.1.50:7125',
    tailscaleUrl: 'http://100.64.0.50:7125',
    cameraUrl: '/webcam/snapshot',
  });
  assert.equal(patch.printers[1].url, 'http://192.168.1.99:7125');
});

test('settings migration seeds first-launch printer defaults', () => {
  const migrated = migrateSettings({});

  assert.equal(migrated.settingsVersion, 4);
  assert.equal(migrated.activePrinterId, 'p1');
  assert.deepEqual(migrated.printers, [
    {
      id: 'p1',
      name: 'Snapmaker U1',
      url: DEFAULT_SETTINGS.primaryUrl,
      tailscaleUrl: '',
      cameraUrl: DEFAULT_SETTINGS.cameraUrl,
    },
  ]);
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
  assert.equal(migrated.notificationMode, 'ntfy');
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
      },
    ],
  });

  assert.equal(migrated.activePrinterId, 'p2');
  assert.equal(migrated.primaryUrl, 'http://192.168.1.60:7125');
  assert.equal(migrated.tailscaleUrl, 'http://100.64.0.60:7125');
  assert.equal(migrated.cameraUrl, '/cam');
});

test('settings migration chooses configured printer when legacy primary is still default', () => {
  const migrated = migrateSettings({
    activePrinterId: 'p1',
    primaryUrl: DEFAULT_SETTINGS.primaryUrl,
    printers: [
      {
        id: 'p1',
        name: 'Default',
        url: DEFAULT_SETTINGS.primaryUrl,
        tailscaleUrl: '',
        cameraUrl: DEFAULT_SETTINGS.cameraUrl,
      },
      {
        id: 'p2',
        name: 'Configured',
        url: '192.168.1.77',
        tailscaleUrl: '',
        cameraUrl: '/webcam/webrtc',
      },
    ],
  });

  assert.equal(migrated.activePrinterId, 'p2');
  assert.equal(migrated.primaryUrl, 'http://192.168.1.77:7125');
  assert.equal(migrated.printers[1].url, 'http://192.168.1.77:7125');
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

  assert.equal(migrated.primaryUrl, DEFAULT_SETTINGS.primaryUrl);
  assert.equal(migrated.tailscaleUrl, '');
  assert.equal(migrated.cameraUrl, DEFAULT_SETTINGS.cameraUrl);
  assert.equal(migrated.dashboard.camera, true);
  assert.equal(migrated.dashboard.macros, false);
  assert.deepEqual(migrated.printers[0], {
    id: 'p1',
    name: 'Snapmaker 1',
    url: DEFAULT_SETTINGS.primaryUrl,
    tailscaleUrl: '',
    cameraUrl: DEFAULT_SETTINGS.cameraUrl,
  });
  assert.equal(migrated.notifyPrintComplete, true);
  assert.equal(migrated.notifyPrintPaused, false);
  assert.equal(migrated.aceUnits, DEFAULT_SETTINGS.aceUnits);
  assert.equal(migrated.ntfyServer, DEFAULT_SETTINGS.ntfyServer);
  assert.equal(migrated.ntfyTopic, DEFAULT_SETTINGS.ntfyTopic);
  assert.equal(migrated.accentColor, DEFAULT_SETTINGS.accentColor);
  assert.equal(migrated.language, DEFAULT_SETTINGS.language);
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

test('builds websocket URL from active Moonraker URL', () => {
  assert.equal(wsUrl('http://192.168.1.17:7125'), 'ws://192.168.1.17:7125/websocket');
  assert.equal(wsUrl('https://printer.tailnet.ts.net'), 'wss://printer.tailnet.ts.net/websocket');
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
    'http://192.168.1.17/webcam/snapshot'
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

test('extracts release commits and compares installed build', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(releaseCommit(`Build ${commit}`), commit);
  assert.equal(isCurrentRelease(commit.toUpperCase(), commit), true);
  assert.equal(isCurrentRelease('dev', commit), false);
});

test('chooses APK release asset before falling back to release page', () => {
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
    'https://github.com/FatBoy721/Helix/releases/tag/v1'
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
