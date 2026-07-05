export const DRAFT_SETTING_KEYS = [
  'primaryUrl',
  'tailscaleUrl',
  'cameraUrl',
  'connectionMode',
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
] as const;

export type DraftSettingKey = (typeof DRAFT_SETTING_KEYS)[number];

export interface PrinterEntryLike {
  id: string;
  url: string;
  tailscaleUrl: string;
  cameraUrl: string;
  connectionMode: string;
}

export interface DraftManagedSettings {
  primaryUrl: string;
  tailscaleUrl: string;
  cameraUrl: string;
  connectionMode: string;
  notificationMode: string;
  ntfyServer: string;
  ntfyTopic: string;
  aceUnits: number;
  notifyPrintComplete: boolean;
  notifyPrintFailed: boolean;
  notifyPrintPaused: boolean;
  notifyFilamentRunout: boolean;
  notifySwapComplete: boolean;
  notifyPrinterError: boolean;
  notifyPrinterDisconnected: boolean;
  notifyTempWarning: boolean;
}

export function hasDraftChanges<T extends DraftManagedSettings>(draft: T, settings: T): boolean {
  return DRAFT_SETTING_KEYS.some((key) => draft[key] !== settings[key]);
}

export function buildSettingsSavePatch<
  TSettings extends DraftManagedSettings & {
    activePrinterId: string;
    printers: PrinterEntryLike[];
  },
>(
  draft: TSettings,
  settings: TSettings,
  normalized: { primaryUrl: string; tailscaleUrl: string }
): Pick<TSettings, DraftSettingKey> & {
  activePrinterId: string;
  printers: TSettings['printers'];
} {
  const patch: Partial<Record<DraftSettingKey, unknown>> & {
    activePrinterId?: string;
    printers?: TSettings['printers'];
  } = {};

  for (const key of DRAFT_SETTING_KEYS) {
    patch[key] = draft[key];
  }

  patch.primaryUrl = normalized.primaryUrl;
  patch.tailscaleUrl = normalized.tailscaleUrl;
  patch.connectionMode = draft.connectionMode;
  patch.activePrinterId = settings.activePrinterId;
  patch.printers = settings.printers.map((printer) =>
    printer.id === settings.activePrinterId
      ? {
          ...printer,
          url: normalized.primaryUrl,
          tailscaleUrl: normalized.tailscaleUrl,
          cameraUrl: draft.cameraUrl,
          connectionMode: draft.connectionMode,
        }
      : printer
  ) as TSettings['printers'];

  return patch as Pick<TSettings, DraftSettingKey> & {
    activePrinterId: string;
    printers: TSettings['printers'];
  };
}
