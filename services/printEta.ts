import { fileUrl } from './moonraker';

const DEFAULT_SCAN_BYTES = 128 * 1024;
const MIN_LIVE_SAMPLE_SECONDS = 120;
const MIN_PROGRESS = 0.01;
const MIN_PACE_FACTOR = 0.25;
const MAX_PACE_FACTOR = 4;

export interface M73Estimate {
  progress: number | null;
  remainingSeconds: number | null;
}

export interface CapturedM73Estimate extends M73Estimate {
  printDurationAtCapture: number;
}

export interface PrintEtaResult {
  slicerRemainingSeconds: number | null;
  liveRemainingSeconds: number | null;
  source: 'm73' | 'fallback' | 'none';
}

function finiteNonNegative(value: unknown): number | null {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function parseLatestM73(gcode: string): M73Estimate | null {
  let progress: number | null = null;
  let remainingSeconds: number | null = null;
  let found = false;

  for (const rawLine of gcode.split(/\r?\n/)) {
    const command = rawLine.split(';', 1)[0].trim();
    if (!/^M73(?:\s|$)/i.test(command)) continue;
    found = true;

    const progressMatch = command.match(/(?:^|\s)P(-?\d+(?:\.\d+)?)(?=\s|$)/i);
    const remainingMatch = command.match(/(?:^|\s)R(-?\d+(?:\.\d+)?)(?=\s|$)/i);
    if (progressMatch) {
      progress = clamp(Number(progressMatch[1]) / 100, 0, 1);
    }
    if (remainingMatch) {
      remainingSeconds = Math.max(0, Number(remainingMatch[1]) * 60);
    }
  }

  return found ? { progress, remainingSeconds } : null;
}

export async function fetchLatestM73(
  baseUrl: string,
  filename: string,
  filePosition: number,
  signal?: AbortSignal,
  scanBytes = DEFAULT_SCAN_BYTES
): Promise<M73Estimate | null> {
  const position = Math.floor(finiteNonNegative(filePosition) ?? 0);
  if (!baseUrl || !filename || position <= 0) return null;

  const end = position - 1;
  const start = Math.max(0, end - Math.max(1024, Math.floor(scanBytes)) + 1);
  const response = await fetch(fileUrl(baseUrl, 'gcodes', filename), {
    headers: { Range: `bytes=${start}-${end}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`M73 scan failed with HTTP ${response.status}`);
  }
  if (response.status !== 206) return null;
  return parseLatestM73(await response.text());
}

export function calculatePrintEtas(input: {
  printDuration: number;
  slicerTotalSeconds: number | null;
  m73: CapturedM73Estimate | null;
  fallbackProgress: number;
}): PrintEtaResult {
  const printDuration = finiteNonNegative(input.printDuration) ?? 0;
  const slicerTotal = finiteNonNegative(input.slicerTotalSeconds);
  const fallbackProgress = clamp(finiteNonNegative(input.fallbackProgress) ?? 0, 0, 1);
  const capturedRemaining = finiteNonNegative(input.m73?.remainingSeconds);
  const captureDuration = finiteNonNegative(input.m73?.printDurationAtCapture) ?? printDuration;
  const elapsedSinceCapture = Math.max(0, printDuration - captureDuration);
  const m73Remaining =
    capturedRemaining == null ? null : Math.max(0, capturedRemaining - elapsedSinceCapture);
  const m73Progress =
    input.m73?.progress == null
      ? null
      : clamp(finiteNonNegative(input.m73.progress) ?? 0, 0, 1);

  const slicerRemaining =
    m73Remaining ??
    (slicerTotal == null ? null : Math.max(0, slicerTotal - printDuration));

  if (
    m73Remaining != null &&
    slicerRemaining != null &&
    printDuration >= MIN_LIVE_SAMPLE_SECONDS
  ) {
    let predictedElapsed: number | null = null;
    if (slicerTotal != null && slicerTotal > slicerRemaining) {
      predictedElapsed = slicerTotal - slicerRemaining;
    } else if (m73Progress != null && m73Progress >= MIN_PROGRESS && m73Progress < 1) {
      predictedElapsed = m73Remaining * m73Progress / (1 - m73Progress);
    }

    if (predictedElapsed != null && predictedElapsed >= MIN_LIVE_SAMPLE_SECONDS) {
      const paceFactor = clamp(
        printDuration / predictedElapsed,
        MIN_PACE_FACTOR,
        MAX_PACE_FACTOR
      );
      return {
        slicerRemainingSeconds: slicerRemaining,
        liveRemainingSeconds: slicerRemaining * paceFactor,
        source: 'm73',
      };
    }
  }

  if (printDuration >= MIN_LIVE_SAMPLE_SECONDS && fallbackProgress >= MIN_PROGRESS) {
    return {
      slicerRemainingSeconds: slicerRemaining,
      liveRemainingSeconds: Math.max(0, printDuration / fallbackProgress - printDuration),
      source: 'fallback',
    };
  }

  return {
    slicerRemainingSeconds: slicerRemaining,
    liveRemainingSeconds: null,
    source: m73Remaining != null ? 'm73' : 'none',
  };
}

export function smoothRemainingEstimate(
  previous: number | null,
  next: number | null,
  elapsedPrintSeconds: number
): number | null {
  if (next == null || !Number.isFinite(next)) return null;
  if (previous == null || !Number.isFinite(previous)) return Math.max(0, next);

  const projected = Math.max(0, previous - Math.max(0, elapsedPrintSeconds));
  const correction = next - projected;
  const maxCorrection = Math.max(15, projected * 0.03);
  return Math.max(0, projected + clamp(correction, -maxCorrection, maxCorrection));
}
