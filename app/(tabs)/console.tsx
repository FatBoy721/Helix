import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConsoleLine, useMoonraker } from '../../hooks/useMoonraker';
import { t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function lineColor(line: ConsoleLine): string {
  if (line.type === 'command') return colors.primary;
  if (line.type === 'error' || line.text.startsWith('!!')) return colors.danger;
  if (line.text.startsWith('//')) return colors.subtext;
  return colors.text;
}

export default function ConsoleScreen() {
  const { consoleLines, sendGcode, clearConsole, connection, gcodeHelp } = useMoonraker();
  const helpButtonRef = useRef<View>(null);
  const [input, setInput] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpFilter, setHelpFilter] = useState('');
  const [helpAnchor, setHelpAnchor] = useState({ x: 0, y: 0, width: 38, height: 48 });
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();

  const data = useMemo(() => [...consoleLines].reverse(), [consoleLines]);
  const helpCommands = useMemo(
    () =>
      Object.entries(gcodeHelp)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([name, help]) => {
          const f = helpFilter.trim().toLowerCase();
          return !f || name.toLowerCase().includes(f) || String(help).toLowerCase().includes(f);
        }),
    [gcodeHelp, helpFilter]
  );

  const openHelp = (filter = '') => {
    setHelpFilter(filter);
    helpButtonRef.current?.measureInWindow((x, y, width, height) => {
      setHelpAnchor({ x, y, width, height });
      setHelpOpen(true);
    });
  };

  const send = () => {
    const cmd = input.trim();
    if (!cmd) return;
    setInput('');
    const helpMatch = cmd.match(/^\/help(?:\s+(.+))?$/i);
    if (helpMatch) {
      openHelp(helpMatch[1]?.trim() ?? '');
      return;
    }
    sendGcode(cmd);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={data}
        inverted
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Text style={[styles.line, { color: lineColor(item) }]} selectable>
            {item.type === 'command' ? '> ' : ''}
            {item.text}
          </Text>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {connection === 'connected' ? t('Console output appears here') : t('Not connected')}
          </Text>
        }
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={t('Printer command…')}
          placeholderTextColor={colors.subtext}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
        />
        <TouchableOpacity
          ref={helpButtonRef}
          style={styles.helpBtn}
          onPress={() => openHelp()}
        >
          <Text style={styles.helpBtnText}>?</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: colors.primary },
            connection !== 'connected' && { opacity: 0.4 },
          ]}
          onPress={send}
          disabled={connection !== 'connected'}
        >
          <Text style={styles.sendText}>{t('Enter')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearBtn} onPress={clearConsole}>
          <Text style={styles.clearText}>{t('Clear')}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={helpOpen} transparent animationType="fade" onRequestClose={() => setHelpOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setHelpOpen(false)} />
          <View
            pointerEvents="none"
            style={[
              styles.helpMirror,
              {
                left: helpAnchor.x,
                top: helpAnchor.y + insets.top,
                width: helpAnchor.width,
                height: helpAnchor.height,
              },
            ]}
          >
            <Text style={styles.helpBtnText}>?</Text>
          </View>
          <View
            style={[
              styles.helpSheet,
              {
                left: Math.max(18, window.width - Math.min(window.width - 36, 460) - 18),
                bottom: Math.max(insets.bottom + 12, window.height - helpAnchor.y - insets.top + 8),
                width: Math.min(window.width - 36, 460),
                maxHeight: Math.min(520, window.height * 0.62),
              },
            ]}
          >
            <View style={styles.helpHeader}>
              <View style={styles.helpTitleWrap}>
                <Text style={styles.helpTitle}>{t('Printer commands')}</Text>
                <Text style={styles.helpSubtitle}>{t('Type /help or /help BED in the console.')}</Text>
              </View>
            </View>

            <TextInput
              style={styles.helpSearch}
              placeholder={t('Search commands…')}
              placeholderTextColor={colors.subtext}
              value={helpFilter}
              onChangeText={setHelpFilter}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <ScrollView style={styles.helpList} keyboardShouldPersistTaps="handled">
              {helpCommands.length > 0 ? (
                helpCommands.map(([name, help]) => (
                  <View key={name} style={styles.helpRow}>
                    <Text style={styles.helpCommand} selectable>
                      {name}
                    </Text>
                    {help ? (
                      <Text style={styles.helpDescription} selectable>
                        {String(help)}
                      </Text>
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={styles.helpEmpty}>
                  {Object.keys(gcodeHelp).length
                    ? t('No matching commands')
                    : t('Connect to a ready printer to load command help.')}
                </Text>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: spacing.md,
  },
  line: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 16,
  },
  empty: {
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.xl,
    transform: [{ scaleY: -1 }],
  },
  inputRow: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: MONO,
    fontSize: 13,
  },
  helpBtn: {
    width: 38,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpBtnText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  sendBtn: {
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  sendText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  clearBtn: {
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  clearText: {
    color: colors.subtext,
    fontSize: 13,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  helpMirror: {
    position: 'absolute',
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpSheet: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  helpHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  helpTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  helpTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
  },
  helpSubtitle: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  helpSearch: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: MONO,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  helpList: {
    flexGrow: 0,
  },
  helpRow: {
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  helpCommand: {
    color: colors.primary,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: '800',
  },
  helpDescription: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  helpEmpty: {
    color: colors.subtext,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontSize: 13,
    fontWeight: '700',
  },
});
