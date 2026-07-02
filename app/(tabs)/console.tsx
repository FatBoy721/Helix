import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
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
  const { consoleLines, sendGcode, clearConsole, connection } = useMoonraker();
  const [input, setInput] = useState('');

  const data = useMemo(() => [...consoleLines].reverse(), [consoleLines]);

  const send = () => {
    const cmd = input.trim();
    if (!cmd) return;
    setInput('');
    sendGcode(cmd);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
          placeholder={t('Send G-code…')}
          placeholderTextColor={colors.subtext}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: colors.primary },
            connection !== 'connected' && { opacity: 0.4 },
          ]}
          onPress={send}
          disabled={connection !== 'connected'}
        >
          <Text style={styles.sendText}>{t('Send')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearBtn} onPress={clearConsole}>
          <Text style={styles.clearText}>{t('Clear')}</Text>
        </TouchableOpacity>
      </View>
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
});
