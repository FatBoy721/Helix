// Renders the dialog a printer is blocking on.
//
// Klipper's action:prompt protocol lets firmware ask the operator a question
// mid-command — a FlashForge AD5X (zmod) raises "Select print materials" on
// every print start. The command that raised it does not proceed until a client
// answers, so before Helix rendered these a print would upload, report success,
// and then quietly never begin.
//
// Mounted once, app-wide (see app/_layout.tsx): a prompt can be raised by the
// printer at any moment, including from a job someone started elsewhere, so it
// cannot belong to one screen.
// crabcore

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import ThemedDialog, { type DialogAction } from './ThemedDialog';
import { COCKPIT as P } from './dashboard/shared';
import { useMoonraker } from '../hooks/useMoonraker';
import type { KlipperPrompt, KlipperPromptButton } from '../services/klipperPrompt';
import { clearPrintIntent, peekPrintIntent, subscribePrintIntent } from '../services/printIntent';
import { autoAnswerGcode } from '../services/zmodPrintPrompt';

/**
 * Maps Klipper's style hint onto the dialog's button variants. Klipper sends
 * primary/secondary/info/warning/error; zmod also sends bare colours, and the
 * AD5X marks its commit button `red` — which means "this is the one that acts",
 * not "this is destructive".
 */
function variantFor(button: KlipperPromptButton): DialogAction['variant'] {
  const style = (button.style ?? '').toLowerCase();
  if (style === 'error') return 'danger';
  if (style === 'primary' || style === 'red') return 'primary';
  // A footer button with no usable hint is still the commit action.
  return button.footer ? 'primary' : 'secondary';
}

export default function KlipperPromptDialog() {
  const { prompt, answerPrompt, dismissPrompt } = useMoonraker();
  // Guards a double-tap: answering twice runs the macro twice, and on a print
  // prompt that means two print starts.
  const [answering, setAnswering] = useState(false);

  // Re-runs the decision when an intent is staged after the prompt has already
  // arrived, which is the normal order for a print sent from the native preview.
  const [intentTick, setIntentTick] = useState(0);
  useEffect(() => subscribePrintIntent(() => setIntentTick((n) => n + 1)), []);

  // A zmod material prompt for the print Helix just sent is answered from the
  // slot the user already chose, rather than asked again. Anything else — a
  // runout, or a prompt for a job started at the printer — falls through to the
  // dialog for the operator.
  //
  // Held in a ref rather than useMemo: the answer is consumed (it clears the
  // intent), so a recomputation would return null and flash the dialog back up
  // mid-dismiss. React may drop a useMemo at any time; a ref it may not.
  const decisionRef = useRef<{ prompt: KlipperPrompt | null; tick: number; gcode: string | null }>({
    prompt: null,
    tick: -1,
    gcode: null,
  });
  if (decisionRef.current.prompt !== prompt || decisionRef.current.tick !== intentTick) {
    const intent = prompt ? peekPrintIntent() : null;
    decisionRef.current = {
      prompt,
      tick: intentTick,
      gcode:
        prompt && intent
          ? autoAnswerGcode(prompt, intent.filename, intent.toolToSlot, intent.autoLevel)
          : null,
    };
  }
  const autoAnswer = decisionRef.current.gcode;

  // Fires once per prompt: re-running would start the print twice.
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!prompt) {
      firedRef.current = null;
      return;
    }
    if (!autoAnswer || firedRef.current === autoAnswer) return;
    firedRef.current = autoAnswer;
    clearPrintIntent();
    void answerPrompt(autoAnswer);
  }, [autoAnswer, prompt, answerPrompt]);

  const onAnswer = useCallback(
    async (gcode: string) => {
      if (answering) return;
      setAnswering(true);
      try {
        await answerPrompt(gcode);
      } finally {
        setAnswering(false);
      }
    },
    [answering, answerPrompt]
  );

  const onClose = useCallback(async () => {
    if (answering) return;
    setAnswering(true);
    try {
      await dismissPrompt();
    } finally {
      setAnswering(false);
    }
  }, [answering, dismissPrompt]);

  // Rendering an auto-answered prompt would flash the dialog for a frame before
  // the effect above dismisses it.
  if (!prompt || autoAnswer) return null;

  // Footer buttons are the commit row and belong in the dialog's action bar.
  // Inline choices are rendered as body rows so a long list of colour or tool
  // options cannot push the commit button off screen.
  const footer = prompt.buttons.filter((button) => button.footer);
  const inline = prompt.buttons.filter((button) => !button.footer);

  const actions: DialogAction[] = footer.length
    ? footer.map((button) => ({
        text: button.label,
        variant: variantFor(button),
        disabled: answering,
        onPress: () => { void onAnswer(button.gcode); },
      }))
    : // A prompt with no footer is informational; give it a way out.
      [{ text: 'Dismiss', variant: 'secondary', disabled: answering, onPress: () => { void onClose(); } }];

  return (
    <ThemedDialog
      visible
      title={prompt.title || 'Printer'}
      shape="layer"
      onClose={() => { void onClose(); }}
      actions={actions}
    >
      <View style={styles.body}>
        {prompt.text.map((paragraph, index) => (
          <Text key={`text-${index}`} style={styles.text}>
            {paragraph}
          </Text>
        ))}

        {inline.map((button, index) => (
          <Text
            key={`choice-${index}`}
            style={[styles.choice, answering && styles.choiceDisabled]}
            onPress={() => { if (!answering) void onAnswer(button.gcode); }}
          >
            {button.label}
          </Text>
        ))}
      </View>
    </ThemedDialog>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10 },
  text: { color: P.dim, fontSize: 14, lineHeight: 20 },
  choice: {
    color: P.text,
    fontSize: 15,
    fontWeight: '600',
    backgroundColor: P.surfaceAlt,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  choiceDisabled: { opacity: 0.5 },
});
