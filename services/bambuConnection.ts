export type BambuConnectFailureReason =
  | 'unavailable'
  | 'bad-config'
  | 'unreachable'
  | 'wrong-access-code'
  | 'wrong-serial'
  | 'unknown';

const NATIVE_CONNECT_REASONS: Record<string, BambuConnectFailureReason> = {
  'bad-config': 'bad-config',
  'wrong-serial': 'wrong-serial',
  'wrong-access-code': 'wrong-access-code',
  'connect-failed': 'unreachable',
  'tls-setup-failed': 'unreachable',
  'probe-timeout': 'unreachable',
  'probe-disconnected': 'unreachable',
  'subscribe-failed': 'unknown',
  'camera-failed': 'unreachable',
};

/** Turns a native bridge rejection into stable UI-facing connection semantics. */
export function classifyBambuConnectionFailure(error: unknown): {
  reason: BambuConnectFailureReason;
  message: string;
} {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message : String(error);
  return {
    reason: NATIVE_CONNECT_REASONS[code] ?? 'unknown',
    message,
  };
}

/** Actionable copy shared by add/edit printer connection checks. */
export function bambuConnectionFailureMessage(
  reason: BambuConnectFailureReason,
  fallback: string
): string {
  switch (reason) {
    case 'wrong-serial':
      return 'The serial number does not match this printer.';
    case 'wrong-access-code':
      return 'The printer rejected the LAN access code.';
    case 'bad-config':
      return 'Enter the printer IP, serial number, and LAN access code.';
    case 'unavailable':
      return 'Bambu connection testing requires the Android build of Helix.';
    case 'unreachable':
      return 'Could not reach the printer. Check its IP, Wi-Fi, and LAN Only Mode.';
    default:
      return fallback || 'The printer did not accept the connection.';
  }
}
