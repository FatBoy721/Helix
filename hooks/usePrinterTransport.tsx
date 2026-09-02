// Picks the transport for the active printer.
//
// Helix spoke Moonraker to everything until Bambu arrived; Bambu speaks MQTT
// and nothing else. Both providers fill the same MoonrakerContext, so this is
// the only place in the app that knows there is more than one protocol.
//
// Remounting on a change of transport is deliberate: swapping printers must
// tear the old socket down and start the new one with empty state, and keying
// the subtree is the least error-prone way to guarantee that.
// crabcore

import React from 'react';

import { BambuProvider } from './useBambu';
import { MoonrakerProvider } from './useMoonraker';
import { useSettings } from './useSettings';

export function PrinterProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const printer = settings.printers.find((p) => p.id === settings.activePrinterId);

  if (printer?.kind === 'bambu-lan') {
    return <BambuProvider key={`bambu:${printer.id}`}>{children}</BambuProvider>;
  }

  return (
    <MoonrakerProvider key={`moonraker:${printer?.id ?? 'none'}`}>
      {children}
    </MoonrakerProvider>
  );
}
