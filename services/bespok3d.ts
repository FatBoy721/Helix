import { NativeModules, Platform } from 'react-native';

interface Bespok3dNativeModule {
  probe(config: { host: string }): Promise<Bespok3dProbe>;
  preflightU1(config: { host: string; password: string }): Promise<Bespok3dU1Preflight>;
  prepareU1Enrollment(): Promise<Bespok3dPreparedEnrollment>;
  enrollU1(config: Bespok3dPreparedEnrollment & {
    host: string;
    password: string;
    sshHostKeySha256: string;
    label: string;
  }): Promise<Bespok3dU1EnrollmentResult>;
  requestAccess(config: {
    host: string;
    label: string;
    publicKey?: string;
  }): Promise<Bespok3dPendingAccess>;
  checkAccess(config: Bespok3dCredentials & { host: string }): Promise<Bespok3dAccessStatus>;
  helixScreenState(config: Pick<Bespok3dCredentials, 'token' | 'certificatePem'> & {
    host: string;
  }): Promise<Bespok3dHelixScreenState>;
  configureHelixScreen(config: Pick<Bespok3dCredentials, 'token' | 'certificatePem'> & {
    host: string;
    selected: Bespok3dScreenUi;
  }): Promise<Bespok3dHelixScreenState>;
  plugins(config: Pick<Bespok3dCredentials, 'token' | 'certificatePem'> & {
    host: string;
  }): Promise<Bespok3dPluginCatalog>;
  installPlugins(config: Pick<Bespok3dCredentials, 'token' | 'certificatePem'> & {
    host: string;
    pluginIds: string[];
    varsJson: string;
  }): Promise<Bespok3dPluginInstallResult>;
  installBundledHelixScreen(
    config: Pick<Bespok3dCredentials, 'token' | 'certificatePem'> & { host: string },
  ): Promise<Bespok3dPluginInstallResult>;
}

const nativeModule = NativeModules.HelixBespok3d as Bespok3dNativeModule | undefined;

export interface Bespok3dProbe {
  version: string;
  license: 'AGPL-3.0-or-later';
  source: 'https://github.com/Bespok3d/daemon';
  /** TOFU certificate observed during the read-only probe. */
  certificatePem: string;
  /** Colon-separated SHA-256 fingerprint shown during cross-client approval. */
  certificateSha256: string;
}

export interface Bespok3dCredentials {
  identity: string;
  token: string;
  certificatePem: string;
  certificateSha256: string;
}

export interface Bespok3dU1Preflight {
  firmware: 'stock' | 'extended';
  model: string;
  overlayActive: boolean;
  workspacePresent: boolean;
  daemonRunning: boolean;
  printState: string;
  eligible: boolean;
  reason: string | null;
  /** First-contact SSH host-key fingerprint to show before enrollment mutates the printer. */
  sshHostKeySha256: string;
}

export interface Bespok3dPreparedEnrollment {
  identity: string;
  token: string;
}

export interface Bespok3dU1EnrollmentResult extends Bespok3dCredentials {
  daemonVersion: string;
  jinniVersion: string;
  completedSteps: string[];
}

export type Bespok3dPendingAccess = Bespok3dCredentials;

export type Bespok3dAccessStatus =
  | { granted: false; version?: undefined; printerUuid?: undefined }
  | { granted: true; version: string; printerUuid: string };

export type Bespok3dScreenUi = 'snapmaker' | 'helixscreen';

export type Bespok3dHelixScreenState =
  | { installed: false; selected: null }
  | { installed: true; selected: Bespok3dScreenUi };

export interface Bespok3dPluginConfigField {
  key: string;
  label: string;
  type: string;
  defaultValue: string | null;
  required: boolean;
  options: string[];
  hint: string;
  onValue: string;
  offValue: string;
}

export interface Bespok3dPlugin {
  id: string;
  title: string;
  version: string;
  tagline: string;
  category: string;
  dependencies: string[];
  config: Bespok3dPluginConfigField[];
}

export interface Bespok3dPluginCatalog {
  plugins: Bespok3dPlugin[];
  installed: Record<string, string>;
}

export interface Bespok3dPluginInstallResult {
  ok: boolean;
  installedIds: string[];
  failures: Record<string, string>;
}

export type Bespok3dPluginVars = Record<string, Record<string, string>>;

export class Bespok3dError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'Bespok3dError';
    this.code = code;
  }
}

export function isBespok3dAvailable(): boolean {
  return Platform.OS === 'android' && !!nativeModule;
}

/** Accepts a saved printer URL or a bare host and returns only its LAN hostname. */
export function bespok3dHost(value: string): string {
  const clean = value.trim();
  if (!clean) throw new Bespok3dError('bad-config', 'Printer address is required.');
  try {
    const parsed = new URL(clean.includes('://') ? clean : `http://${clean}`);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (!host) throw new Error('missing host');
    return host;
  } catch {
    throw new Bespok3dError('bad-config', 'Printer address is invalid.');
  }
}

function requireNative(): Bespok3dNativeModule {
  if (!nativeModule) {
    throw new Bespok3dError(
      'unavailable',
      'Bespok3d management needs the Android build of Helix.',
    );
  }
  return nativeModule;
}

function asBespok3dError(error: unknown): Bespok3dError {
  if (error instanceof Bespok3dError) return error;
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof record.code === 'string' ? record.code : 'unknown';
  const message = typeof record.message === 'string'
    ? record.message
    : 'Bespok3d could not reach this printer.';
  return new Bespok3dError(code, message);
}

/** Read-only detection through the daemon's public AGPL source-offer endpoint. */
export async function probeBespok3d(printerAddress: string): Promise<Bespok3dProbe> {
  try {
    return await requireNative().probe({ host: bespok3dHost(printerAddress) });
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/**
 * Read-only stock-U1 enrollment check. The SSH password is passed directly to
 * native code and is never included in the result or persisted by this service.
 */
export async function preflightBespok3dU1(
  printerAddress: string,
  password: string,
): Promise<Bespok3dU1Preflight> {
  try {
    if (!password) throw new Bespok3dError('bad-config', 'SSH password is required.');
    return await requireNative().preflightU1({
      host: bespok3dHost(printerAddress),
      password,
    });
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/**
 * Generates the identity and token before any printer mutation. The UI must put
 * this value in SecureStore before calling enroll so a disconnected run can retry.
 */
export async function prepareBespok3dU1Enrollment(): Promise<Bespok3dPreparedEnrollment> {
  try {
    return await requireNative().prepareU1Enrollment();
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/**
 * Runs the signed stock-U1 enrollment recipe after preflight fingerprint confirmation.
 * No screen calls this yet; the UI and explicit destructive confirmation are a later phase.
 */
export async function enrollBespok3dU1(
  printerAddress: string,
  password: string,
  sshHostKeySha256: string,
  label: string,
  credentials: Bespok3dPreparedEnrollment,
): Promise<Bespok3dU1EnrollmentResult> {
  try {
    if (!password) throw new Bespok3dError('bad-config', 'SSH password is required.');
    return await requireNative().enrollU1({
      host: bespok3dHost(printerAddress),
      password,
      sshHostKeySha256: sshHostKeySha256.trim(),
      label: label.trim(),
      ...credentials,
    });
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/**
 * Creates a pending phone identity. The returned token and certificate are
 * secrets and must be placed in SecureStore by the UI phase, never AsyncStorage.
 */
export async function requestBespok3dAccess(
  printerAddress: string,
  label: string,
  publicKey?: string,
): Promise<Bespok3dPendingAccess> {
  try {
    return await requireNative().requestAccess({
      host: bespok3dHost(printerAddress),
      label: label.trim(),
      publicKey: publicKey?.trim(),
    });
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/** A 401 is the normal "still waiting for desktop approval" result. */
export async function checkBespok3dAccess(
  printerAddress: string,
  credentials: Bespok3dCredentials,
): Promise<Bespok3dAccessStatus> {
  try {
    return await requireNative().checkAccess({
      host: bespok3dHost(printerAddress),
      ...credentials,
    });
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/** Reads the signature-verified official catalog and the printer's live installed set. */
export async function listBespok3dPlugins(
  printerAddress: string,
  credentials: Bespok3dCredentials,
): Promise<Bespok3dPluginCatalog> {
  try {
    return await requireNative().plugins({
      host: bespok3dHost(printerAddress),
      token: credentials.token,
      certificatePem: credentials.certificatePem,
    });
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/** Reads the persisted selection for the locally installed HelixScreen UI plugin. */
export async function getBespok3dHelixScreenState(
  printerAddress: string,
  credentials: Bespok3dCredentials,
): Promise<Bespok3dHelixScreenState> {
  try {
    return await requireNative().helixScreenState({
      host: bespok3dHost(printerAddress),
      token: credentials.token,
      certificatePem: credentials.certificatePem,
    });
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/** Switches only the U1 touchscreen between the stock GUI and HelixScreen. */
export async function configureBespok3dHelixScreen(
  printerAddress: string,
  credentials: Bespok3dCredentials,
  selected: Bespok3dScreenUi,
): Promise<Bespok3dHelixScreenState> {
  try {
    return await requireNative().configureHelixScreen({
      host: bespok3dHost(printerAddress),
      token: credentials.token,
      certificatePem: credentials.certificatePem,
      selected,
    });
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/** Installs the exact HelixScreen package embedded in and signed with this APK. */
export async function installBundledBespok3dHelixScreen(
  printerAddress: string,
  credentials: Bespok3dCredentials,
): Promise<Bespok3dPluginInstallResult> {
  try {
    return await requireNative().installBundledHelixScreen({
      host: bespok3dHost(printerAddress),
      token: credentials.token,
      certificatePem: credentials.certificatePem,
    });
  } catch (error) {
    throw asBespok3dError(error);
  }
}

/** Installs only the explicitly selected ids; native code verifies every package before upload. */
export async function installBespok3dPlugins(
  printerAddress: string,
  credentials: Bespok3dCredentials,
  pluginIds: string[],
  vars: Bespok3dPluginVars,
): Promise<Bespok3dPluginInstallResult> {
  try {
    if (pluginIds.length === 0) {
      throw new Bespok3dError('bad-config', 'Select at least one Bespok3d plugin.');
    }
    return await requireNative().installPlugins({
      host: bespok3dHost(printerAddress),
      token: credentials.token,
      certificatePem: credentials.certificatePem,
      pluginIds,
      varsJson: JSON.stringify(vars),
    });
  } catch (error) {
    throw asBespok3dError(error);
  }
}
