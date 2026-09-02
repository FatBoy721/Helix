// Answering zmod's "Select print materials" prompt on Helix's behalf.
//
// A FlashForge AD5X running zmod raises a Klipper prompt on every print start
// asking which IFS lane feeds each tool in the G-code. Helix already asked the
// same question in its own print dialog, so making the operator answer twice is
// just friction — worse, the printer's proposed mapping is its own guess, not
// the slot the user picked.
//
// So Helix answers it: take the printer's own commit macro, rewrite the lane
// arguments from the mapping Helix already holds, and send it back.
//
// Indexing, which is the whole reason this file exists:
//   * The FlashForge wire numbers lanes from 1 (flashforgeApi normalises to 0).
//   * Helix stores slots 0-based everywhere.
//   * zmod's macro takes `T<tool>=<lane>` where <tool> is 0-based and <lane> is
//     1-based — confirmed by its own button labels, which render tool 0 as
//     "1 -> 2" for lane 2.
// So a Helix slot index s becomes lane s + 1.
// crabcore

import type { KlipperPrompt, KlipperPromptButton } from './klipperPrompt';

/** 0-based G-code tool → 0-based Helix slot. */
export type ToolSlotMap = Readonly<Record<number, number>>;

/** Lane arguments: `T0=2`, preceded by start-of-string or whitespace. */
const TOOL_ARG = /(^|\s)T(\d+)=(-?\d+)/g;
const FILENAME_ARG = /FILENAME\s*=\s*(?:"([^"]*)"|(\S+))/i;

/**
 * The button that actually starts the print, or null when this prompt is not a
 * zmod material selection (a runout or calibration prompt must still be shown
 * to the operator rather than silently answered).
 */
export function zmodCommitButton(prompt: KlipperPrompt): KlipperPromptButton | null {
  return prompt.buttons.find((button) => /^\s*PRINT_ZCOLOR\b/i.test(button.gcode)) ?? null;
}

/** The file a macro invocation names, unquoted. */
export function macroFilename(gcode: string): string | null {
  const match = FILENAME_ARG.exec(gcode);
  if (!match) return null;
  const value = match[1] ?? match[2] ?? '';
  return value.trim() || null;
}

/** Basename, lowercased — the printer's path and Helix's upload name can differ. */
function fileKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.trim().toLowerCase();
}

/** True when a prompt's macro refers to the same file Helix just sent. */
export function macroTargetsFile(gcode: string, filename: string): boolean {
  const target = macroFilename(gcode);
  if (!target || !filename.trim()) return false;
  return fileKey(target) === fileKey(filename);
}

/**
 * Rewrites the lane arguments of [gcode] from [toolToSlot].
 *
 * Only arguments already present are touched: the macro declares which tools it
 * cares about, and inventing a `T4=` for a machine with four lanes would be a
 * guess about firmware we have not verified. Tools with no mapping keep the
 * printer's own proposal, which is the same value tapping the button would send.
 */
export function applyToolSlots(gcode: string, toolToSlot: ToolSlotMap): string {
  return gcode.replace(TOOL_ARG, (whole, lead: string, tool: string, lane: string) => {
    const slot = toolToSlot[Number(tool)];
    if (typeof slot !== 'number' || !Number.isFinite(slot) || slot < 0) return whole;
    return `${lead}T${tool}=${slot + 1}`;
  });
}

/**
 * Sets `LEVELING=` from the user's preference.
 *
 * The AD5X has no SET_PRINT_PREFERENCES macro — bed levelling reaches it only
 * as this argument, which is why the printer's own prompt carries a "Leveling
 * Off" button that differs from its commit button by exactly this flag. Passing
 * undefined leaves the printer's own value alone.
 */
export function applyLeveling(gcode: string, autoLevel?: boolean): string {
  if (autoLevel === undefined) return gcode;
  return gcode.replace(/(^|\s)LEVELING=(-?\d+)/gi, `$1LEVELING=${autoLevel ? 1 : 0}`);
}

/**
 * The G-code that starts this print with Helix's mapping applied, or null when
 * the prompt is not a zmod material selection for [filename].
 *
 * Returning null is the signal to show the dialog instead: an unrecognised
 * prompt, or one about a different file, is the operator's to answer.
 */
export function autoAnswerGcode(
  prompt: KlipperPrompt,
  filename: string,
  toolToSlot: ToolSlotMap,
  autoLevel?: boolean
): string | null {
  const commit = zmodCommitButton(prompt);
  if (!commit) return null;
  if (!macroTargetsFile(commit.gcode, filename)) return null;
  return applyLeveling(applyToolSlots(commit.gcode, toolToSlot), autoLevel);
}

/**
 * Starts [filename] without the material station — zmod's per-print IFS-off
 * path. Its own UI button "Hide color selection, print without IFS" sends
 * exactly this: SILENT=2 skips the material-selection prompt entirely, and the
 * print runs from the external side spool with every T-command in the G-code
 * ignored. Nothing is persisted; the next print asks again.
 *
 * There is no per-tool variant of this: PRINT_ZCOLOR rejects slot 0, so an
 * external spool can never be mapped in as one lane among several — IFS-off is
 * all-or-nothing.
 */
export function ifsOffPrintGcode(filename: string, autoLevel: boolean): string {
  return `SET_ZCOLOR FILENAME="${filename}" SILENT=2 LEVELING=${autoLevel ? 1 : 0}`;
}
