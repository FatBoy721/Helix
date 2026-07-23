export type TerminalPrintState = 'complete' | 'cancelled' | 'error' | '';

export function terminalPrintStateForHistory(status: unknown): TerminalPrintState {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (normalized === 'completed') return 'complete';
  if (normalized === 'cancelled') return 'cancelled';
  if (
    normalized === 'error' ||
    normalized === 'failed' ||
    normalized === 'interrupted' ||
    normalized === 'klippy_shutdown' ||
    normalized === 'klippy_disconnect'
  ) {
    return 'error';
  }
  return '';
}

export function historyFailureMessage(job: unknown): string {
  if (!job || typeof job !== 'object') return '';
  const value = job as Record<string, unknown>;
  const candidates = [value.message, value.error, value.error_message];
  return candidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
  )?.trim() ?? '';
}

export function withQueryParameter(url: string, key: string, value: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
