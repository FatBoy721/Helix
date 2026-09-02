import { useCallback, useEffect, useRef, useState } from 'react';

import { materialStationToAceUnits, type AceUnit } from '../services/aceModel';
import {
  fetchMaterialStation,
  hasFlashForgeCredentials,
  type FlashForgeError,
  type MaterialStation,
} from '../services/flashforgeApi';
import { useMoonraker } from './useMoonraker';
import { useSettings } from './useSettings';

// The FlashForge material station has no push channel — unlike Moonraker's
// WebSocket it has to be polled. Slots only change when someone loads filament,
// so this is deliberately slow.
const POLL_INTERVAL_MS = 10_000;

interface MaterialStationState {
  /** ACE-shaped units, so the existing lane UI renders these unchanged. */
  units: AceUnit[];
  /** True once the printer has confirmed it has a material station. */
  detected: boolean;
  /** Last failure, cleared on the next success. */
  error: FlashForgeError | null;
}

const IDLE: MaterialStationState = { units: [], detected: false, error: null };

// Home and the ACE tab both want the station, and the AD5X's Wi-Fi is fragile
// enough that polling it twice as often is worth avoiding. Callers within this
// window share one request.
const SHARED_WINDOW_MS = 4000;
let cachedKey = '';
let cachedAt = 0;
let cachedResult: Awaited<ReturnType<typeof fetchMaterialStation>> | null = null;
let inFlight: Promise<Awaited<ReturnType<typeof fetchMaterialStation>>> | null = null;

async function sharedFetchMaterialStation(
  baseUrl: string,
  credentials: { serialNumber: string; checkCode: string },
  signal?: AbortSignal
) {
  const key = `${baseUrl}|${credentials.serialNumber}`;
  if (cachedResult && cachedKey === key && Date.now() - cachedAt < SHARED_WINDOW_MS) {
    return cachedResult;
  }
  if (inFlight && cachedKey === key) return inFlight;

  cachedKey = key;
  inFlight = fetchMaterialStation(baseUrl, credentials, signal).then((result) => {
    cachedResult = result;
    cachedAt = Date.now();
    inFlight = null;
    return result;
  });
  return inFlight;
}

/**
 * Reads the AD5X material station over FlashForge's REST API.
 *
 * Only the FlashForge profile polls; every other machine returns idle so this
 * costs nothing. A single failed poll keeps the last known slots on screen
 * rather than blanking the UI — the AD5X's Wi-Fi drops often enough that
 * flickering would otherwise be constant.
 */
export function useMaterialStation(): MaterialStationState & { refresh: () => void } {
  const { settings } = useSettings();
  const { activeUrl, connection } = useMoonraker();
  const [state, setState] = useState<MaterialStationState>(IDLE);
  const [nonce, setNonce] = useState(0);

  const activePrinter = settings.printers.find(
    (printer) => printer.id === settings.activePrinterId
  );
  const isFlashForge = activePrinter?.kind === 'flashforge-ad5x';
  // Follow the route Moonraker actually connected through. In Auto mode the
  // saved LAN URL may be dead while Tailscale is healthy; independently
  // choosing the LAN URL here made printer control work remotely while the IFS
  // still appeared unavailable.
  const baseUrl = isFlashForge && connection === 'connected' ? activeUrl : '';
  const serialNumber = activePrinter?.serialNumber ?? '';
  const checkCode = activePrinter?.checkCode ?? '';
  const credentialed = hasFlashForgeCredentials({ serialNumber, checkCode });

  // Keeps the last good reading across failed polls without making it a
  // dependency of the polling effect.
  const lastStation = useRef<MaterialStation | null>(null);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!isFlashForge || !baseUrl) {
      lastStation.current = null;
      setState(IDLE);
      return;
    }

    if (!credentialed) {
      lastStation.current = null;
      setState({ units: [], detected: false, error: 'missing-credentials' });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      const result = await sharedFetchMaterialStation(
        baseUrl,
        { serialNumber, checkCode },
        controller.signal
      );
      if (cancelled) return;

      if (result.ok) {
        lastStation.current = result.value;
        setState({
          units: materialStationToAceUnits(result.value),
          detected: true,
          error: null,
        });
        return;
      }

      setState({
        // Hold the previous slots so a dropped packet doesn't clear the screen.
        units: materialStationToAceUnits(lastStation.current),
        detected: lastStation.current != null,
        error: result.error,
      });
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [isFlashForge, baseUrl, credentialed, serialNumber, checkCode, nonce]);

  return { ...state, refresh };
}
