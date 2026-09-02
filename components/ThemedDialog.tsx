// Confirms and alerts, in the chosen modal system.
//
// Shape is derived from consequence and content: destructive confirmations use
// red Focus, forms use neutral Focus, and acknowledgement-only dialogs use
// Layer. Deriving it here keeps the system consistent at every call site.
//
// The `placement` prop is kept for source compatibility but no longer decides
// anything; an irreversible action shouldn't be able to opt into looking casual.
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { alpha, COCKPIT as P } from './dashboard/shared';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface DialogAction {
  text: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  icon?: IconName;
  /** @deprecated Shape now follows the content and actions. */
  placement?: 'bottom' | 'center';
  /**
   * Override the derived shape. 'auto' (default) sends anything carrying a
   * danger action to Focus. Pass 'layer' for a destructive action that is
   * recoverable — cancelling a print loses the print, not the machine — so it
   * keeps the red button without taking over the whole screen.
   */
  shape?: 'auto' | 'layer' | 'focus';
  onClose: () => void;
  actions: DialogAction[];
  children?: React.ReactNode;
}

function ActionButton({ action, big }: { action: DialogAction; big?: boolean }) {
  const variant = action.variant ?? 'secondary';
  const fg = variant === 'primary' ? P.onAccent : variant === 'danger' ? '#FFFFFF' : P.text;
  const bg = variant === 'primary' ? P.accentFill : variant === 'danger' ? P.danger : P.surfaceAlt;

  return (
    <Pressable
      onPress={action.onPress}
      disabled={action.disabled}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: bg, height: big ? 62 : 52 },
        action.disabled && { opacity: 0.5 },
        pressed && { opacity: 0.78 },
      ]}
    >
      {action.icon ? (
        <MaterialCommunityIcons name={action.icon} size={big ? 22 : 18} color={fg} />
      ) : null}
      <Text style={[styles.actionText, { color: fg, fontSize: big ? 16 : 14 }]} numberOfLines={1}>
        {action.text}
      </Text>
    </Pressable>
  );
}

export default function ThemedDialog({
  visible,
  title,
  message,
  icon,
  shape = 'auto',
  onClose,
  actions,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const danger = actions.some((action) => action.variant === 'danger');
  const confirmation = actions.length > 1;
  const form = children != null;
  // An explicit shape wins over the derivation, so a destructive-but-
  // recoverable action can stay a Layer card instead of taking the screen.
  const focus =
    shape === 'focus' || (shape === 'auto' && (danger || confirmation || form));
  const orderedActions = focus
    ? [...actions].sort((a, b) => {
        const priority = (action: DialogAction) =>
          action.variant === 'danger' || action.variant === 'primary' ? 0 : 1;
        return priority(a) - priority(b);
      })
    : actions;

  if (focus) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <KeyboardAvoidingView
          style={[danger ? styles.focus : styles.focusForm, { paddingTop: insets.top }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {danger ? <View pointerEvents="none" style={styles.focusTint} /> : null}
          <ScrollView
            contentContainerStyle={styles.focusBody}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios' && form}
          >
            {!form ? (
              <View
                style={[
                  styles.focusIcon,
                  { backgroundColor: alpha(danger ? P.danger : P.accent, 0.16) },
                ]}
              >
                <MaterialCommunityIcons
                  name={icon ?? (danger ? 'alert-octagon-outline' : 'help-circle-outline')}
                  size={44}
                  color={danger ? P.danger : P.accent}
                />
              </View>
            ) : null}
            <Text style={styles.focusTitle}>{title}</Text>
            {message ? <Text style={styles.focusMessage}>{message}</Text> : null}
            {children}
          </ScrollView>

          {/* Stacked and full-width: a row of small buttons puts the
              destructive one under your thumb by accident. */}
          <View style={[styles.focusActions, { paddingBottom: 16 + insets.bottom }]}>
            {orderedActions.map((action) => (
              <ActionButton key={action.text} action={action} big />
            ))}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={styles.centreWrap} pointerEvents="box-none">
          <View style={styles.card}>
            <View style={styles.iconBadge}>
              <MaterialCommunityIcons
                name={icon ?? 'information-outline'}
                size={26}
                color={P.accent}
              />
            </View>
            <Text style={styles.title}>{title}</Text>

            {message ? <Text style={styles.message}>{message}</Text> : null}

            {children}

            <View style={[styles.actions, actions.length > 2 && styles.actionsStacked]}>
              {actions.map((action) => (
                <ActionButton key={action.text} action={action} />
              ))}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: alpha('#000000', 0.74) },

  // Focus — irreversible actions get the whole screen.
  focus: { flex: 1, backgroundColor: P.bg },
  focusForm: { flex: 1, backgroundColor: P.bg },
  focusTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: alpha(P.danger, 0.1),
  },
  focusBody: {
    flexGrow: 1,
    padding: 26,
    gap: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusIcon: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusTitle: {
    color: P.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -1,
    textAlign: 'center',
  },
  focusMessage: {
    color: P.dim,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
  },
  focusActions: { paddingHorizontal: 22, gap: 9 },

  // Layer — everything else.
  centreWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    padding: 22,
    gap: 13,
    alignItems: 'center',
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: alpha(P.accent, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: P.text,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  message: { color: P.dim, fontSize: 13, fontWeight: '600', lineHeight: 19, textAlign: 'center' },

  actions: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', paddingTop: 4 },
  actionsStacked: { flexDirection: 'column' },
  action: {
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 16,
  },
  actionText: { fontWeight: '800', flexShrink: 1 },
});
