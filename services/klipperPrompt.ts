// Klipper's `action:prompt_*` dialog protocol.
//
// A printer can ask the operator a question mid-command by emitting a run of
// G-code responses that a client is expected to render as a dialog and answer
// by running the chosen button's G-code. Mainsail and Fluidd implement this;
// Helix did not, which is why a FlashForge AD5X (zmod) would accept a print,
// open "Select print materials", and then sit there forever while Helix
// reported the job as sent.
//
// The wire format, one directive per G-code response line:
//
//   // action:prompt_begin <title>
//   // action:prompt_text <paragraph>
//   // action:prompt_button_group_start
//   // action:prompt_button <label>|<gcode>|<style>|<colour>
//   // action:prompt_button_group_end
//   // action:prompt_footer_button <label>|<gcode>|<style>
//   // action:prompt_show
//   // action:prompt_end
//
// Only `prompt_show` makes a prompt visible: everything between `prompt_begin`
// and `prompt_show` is the printer composing it. `prompt_end` closes it, and is
// also what a client sends back to dismiss one.
// crabcore

/** A dismiss command a client sends to close a prompt it is showing. */
export const PROMPT_DISMISS_GCODE = 'RESPOND TYPE=command MSG=action:prompt_end';

export interface KlipperPromptButton {
  label: string;
  /** G-code to run when tapped. Empty for a malformed button, which is dropped. */
  gcode: string;
  /**
   * Klipper's style hint — primary/secondary/info/warning/error. Free-form in
   * practice: zmod sends `primary`, and sometimes an empty field followed by a
   * hex colour.
   */
  style: string | null;
  /** Trailing hex colour some firmwares append. Not part of stock Klipper. */
  color: string | null;
  /** Footer buttons are the commit/cancel row rather than an inline choice. */
  footer: boolean;
}

export interface KlipperPrompt {
  title: string;
  /** Paragraphs, in emission order. */
  text: string[];
  buttons: KlipperPromptButton[];
}

/** A prompt still being composed; only surfaced to the UI once shown. */
export interface PromptBuildState {
  prompt: KlipperPrompt;
  visible: boolean;
}

const PREFIX = /^\s*(?:\/\/)?\s*action:\s*/i;

/**
 * True when [line] is any prompt directive. Used to keep the parser off the
 * hot path for ordinary console chatter.
 */
export function isPromptLine(line: string): boolean {
  return PREFIX.test(line) && /^prompt_/i.test(line.replace(PREFIX, ''));
}

function splitFields(rest: string): string[] {
  return rest.split('|').map((field) => field.trim());
}

function parseButton(rest: string, footer: boolean): KlipperPromptButton | null {
  const [label, gcode, style, color] = splitFields(rest);
  // A button with nothing to run is not actionable — rendering it would give
  // the operator a control that silently does nothing.
  if (!label || !gcode) return null;
  return {
    label,
    gcode,
    style: style || null,
    color: color || null,
    footer,
  };
}

const EMPTY: KlipperPrompt = { title: '', text: [], buttons: [] };

/**
 * Folds one G-code response line into the prompt being assembled.
 *
 * Returns the next state, or null when there is no prompt (either none was
 * open, or this line closed it). Non-prompt lines pass [state] straight back so
 * callers can pipe every response through without pre-filtering.
 */
export function reducePromptLine(
  state: PromptBuildState | null,
  line: string
): PromptBuildState | null {
  if (!PREFIX.test(line)) return state;
  const body = line.replace(PREFIX, '').trim();
  const match = /^(prompt_[a-z_]+)\s*(.*)$/is.exec(body);
  if (!match) return state;

  const directive = match[1].toLowerCase();
  const rest = match[2].trim();

  switch (directive) {
    case 'prompt_begin':
      // Always starts a fresh prompt, discarding any half-built one — a printer
      // that reboots mid-compose must not leave a stale dialog fused to the new.
      return { prompt: { ...EMPTY, title: rest, text: [], buttons: [] }, visible: false };

    case 'prompt_end':
      return null;

    case 'prompt_show':
      // A show with no begin is noise from a firmware talking to another client.
      if (!state) return null;
      return { ...state, visible: true };

    case 'prompt_text':
      if (!state) return null;
      return { ...state, prompt: { ...state.prompt, text: [...state.prompt.text, rest] } };

    case 'prompt_button':
    case 'prompt_footer_button': {
      if (!state) return null;
      const button = parseButton(rest, directive === 'prompt_footer_button');
      if (!button) return state;
      return {
        ...state,
        prompt: { ...state.prompt, buttons: [...state.prompt.buttons, button] },
      };
    }

    // Grouping only affects desktop layout; Helix stacks buttons in one column,
    // so these are accepted and ignored rather than treated as unknown.
    case 'prompt_button_group_start':
    case 'prompt_button_group_end':
      return state;

    default:
      return state;
  }
}

/** The prompt to render, or null while none is open or still being composed. */
export function visiblePrompt(state: PromptBuildState | null): KlipperPrompt | null {
  return state?.visible ? state.prompt : null;
}
