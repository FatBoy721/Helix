import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { TextInput } from 'react-native';
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
  const [input, setInput] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpFilter, setHelpFilter] = useState('');

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

  const send = () => {
    const cmd = input.trim();
    if (!cmd) return;
    setInput('');
    const helpMatch = cmd.match(/^\/help(?:\s+(.+))?$/i);
    if (helpMatch) {
      setHelpFilter(helpMatch[1]?.trim() ?? '');
      setHelpOpen(true);
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
          style={styles.helpBtn}
          onPress={() => {
            setHelpFilter('');
            setHelpOpen(true);
          }}
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
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setHelpOpen(false)}>
          <View style={styles.helpSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.helpHeader}>
              <View style={styles.helpTitleWrap}>
                <Text style={styles.helpTitle}>{t('Printer commands')}</Text>
                <Text style={styles.helpSubtitle}>{t('Type /help or /help BED in the console.')}</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setHelpOpen(false)}>
                <Text style={styles.closeText}>X</Text>
              </TouchableOpacity>
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
        </TouchableOpacity>
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
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
    justifyContent: 'flex-end',
  },
  helpSheet: {
    maxHeight: '76%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
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
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
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
