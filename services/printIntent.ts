// What Helix just sent to print, held until the printer asks about it.
//
// A zmod printer answers a print start with a material-selection prompt, which
// arrives over the websocket well after the HTTP call that started the job and
// is handled app-wide rather than by the screen that sent it. This carries the
// slot mapping across that gap so the prompt can be answered with the user's
// choice instead of the printer's guess.
//
// Deliberately a module-level value rather than context: the prompt can land
// after the sending screen has unmounted (Helix navigates Home on send).
// crabcore

export type PrintIntent = {
  /** Name the file was uploaded as. Matched against the prompt by basename. */
  filename: string;
  /** 0-based G-code tool → 0-based Helix slot. */
  toolToSlot: Readonly<Record<number, number>>;
  /**
   * Bed levelling, for machines that take it on the print macro rather than a
   * preferences command. Undefined leaves the printer's own value alone.
   */
  autoLevel?: boolean;
  /** When it was staged, so a stale intent cannot answer a later prompt. */
  stagedAt: number;
};

/**
 * How long a staged intent stays answerable. A prompt normally follows within
 * a second or two; anything much later is a different job — most likely one
 * started from the printer's own screen, which the operator should answer.
 */
export const PRINT_INTENT_TTL_MS = 120_000;

let pending: PrintIntent | null = null;
const listeners = new Set<() => void>();

/**
 * Notified whenever an intent is staged.
 *
 * The prompt and the intent race: a print sent from the native preview screen
 * stages its intent only once Android hands control back to the RN app, which
 * can be after the printer has already asked. Without this the prompt would sit
 * on screen with an answer sitting right beside it.
 */
export function subscribePrintIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPrintIntent(intent: Omit<PrintIntent, 'stagedAt'>): void {
  pending = { ...intent, stagedAt: Date.now() };
  for (const listener of [...listeners]) listener();
}

/** The staged intent, or null when absent or expired. Does not consume it. */
export function peekPrintIntent(now = Date.now()): PrintIntent | null {
  if (!pending) return null;
  if (now - pending.stagedAt > PRINT_INTENT_TTL_MS) {
    pending = null;
    return null;
  }
  return pending;
}

export function clearPrintIntent(): void {
  pending = null;
}
