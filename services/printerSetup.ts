import type { DiscoveredPrinter } from './printerDiscovery';
import { printerProfile } from './printerProfiles';
import type { PrinterEntry } from './settingsMigration';

/** Builds the editable settings entry used after selecting a network result. */
export function printerEntryFromDiscovery(
  printer: DiscoveredPrinter,
  id: string,
  fallbackName = 'Printer'
): PrinterEntry {
  return {
    id,
    name: printer.name || fallbackName,
    url: printer.moonrakerUrl,
    tailscaleUrl: '',
    cameraUrl: printer.cameraUrl || printerProfile(printer.kind).defaultCameraPath,
    connectionMode: 'lan',
    kind: printer.kind,
    serialNumber: printer.serial ?? '',
  };
}
