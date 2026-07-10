import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ThemedDialog from '../ThemedDialog';
import { colors, spacing } from '../../constants/theme';
import { useSettings } from '../../hooks/useSettings';
import { parseSettingsBackup, shareSettingsBackup } from '../../services/settingsBackup';
import { t } from '../../services/i18n';

export default function BackupCard({ onImported }: { onImported?: () => void }) {
  const { settings, update } = useSettings();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [resultDialog, setResultDialog] = useState<{ title: string; message: string } | null>(null);

  const exportSettings = async () => {
    try {
      await shareSettingsBackup(settings);
    } catch (e: any) {
      setResultDialog({
        title: t('Export failed'),
        message: e?.message ?? 'Could not share the backup file.',
      });
    }
  };

  const runImport = async () => {
    try {
      const imported = parseSettingsBackup(importText);
      await update(imported);
      onImported?.();
      setImportOpen(false);
      setImportText('');
      setImportError(null);
      setResultDialog({
        title: t('Settings restored'),
        message: t('Printers, connection and notification settings were imported. MakerWorld needs a fresh login.'),
      });
    } catch (e: any) {
      setImportError(e?.message ?? 'Import failed.');
    }
  };

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('Backup')}</Text>
        <Text style={styles.hint}>
          {t('Save your printers and settings to a file, or restore them after a reinstall.')}
        </Text>
        <TouchableOpacity style={styles.linkRow} onPress={exportSettings}>
          <MaterialCommunityIcons name="export-variant" size={20} color={colors.text} />
          <Text style={styles.linkText}>{t('Export settings')}</Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.subtext} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => {
            setImportError(null);
            setImportText('');
            setImportOpen(true);
          }}
        >
          <MaterialCommunityIcons name="import" size={20} color={colors.text} />
          <Text style={styles.linkText}>{t('Import settings')}</Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.subtext} />
        </TouchableOpacity>
      </View>

      <ThemedDialog
        visible={importOpen}
        placement="center"
        title={t('Import settings')}
        icon="import"
        onClose={() => setImportOpen(false)}
        actions={[
          { text: t('Cancel'), onPress: () => setImportOpen(false) },
          {
            text: t('Import'),
            icon: 'check',
            variant: 'primary',
            onPress: runImport,
          },
        ]}
      >
        <Text style={styles.hint}>
          {t('Open your backup file, copy everything, and paste it here.')}
        </Text>
        <TextInput
          style={styles.importInput}
          value={importText}
          onChangeText={(v) => {
            setImportText(v);
            if (importError) setImportError(null);
          }}
          placeholder='{"kind":"helix-settings-backup", ...}'
          placeholderTextColor={colors.subtext}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        {importError ? <Text style={styles.errorText}>{importError}</Text> : null}
      </ThemedDialog>

      <ThemedDialog
        visible={!!resultDialog}
        placement="center"
        title={resultDialog?.title ?? ''}
        message={resultDialog?.message}
        icon="information-outline"
        onClose={() => setResultDialog(null)}
        actions={[{ text: t('OK'), variant: 'primary', onPress: () => setResultDialog(null) }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  hint: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.xs,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  linkText: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
  },
  importInput: {
    minHeight: 110,
    maxHeight: 180,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: 12,
    padding: spacing.sm,
    textAlignVertical: 'top',
    marginTop: spacing.xs,
  },
  errorText: {
    color: colors.warning,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
