import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ThemedDialog from '../ThemedDialog';
import { colors, spacing } from './cockpitTheme';
import { useSettings } from '../../hooks/useSettings';
import { pickSettingsBackup, shareSettingsBackup } from '../../services/settingsBackup';
import { t } from '../../services/i18n';

export default function BackupCard({ onImported }: { onImported?: () => void }) {
  const { settings, update } = useSettings();
  const [importing, setImporting] = useState(false);
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
    if (importing) return;
    setImporting(true);
    try {
      const imported = await pickSettingsBackup();
      if (!imported) return;
      await update(imported);
      onImported?.();
      setResultDialog({
        title: t('Settings restored'),
        message: t('Printers, connection and notification settings were imported. MakerWorld needs a fresh login.'),
      });
    } catch (e: any) {
      setResultDialog({
        title: t('Import failed'),
        message: e?.message ?? 'Could not import the backup file.',
      });
    } finally {
      setImporting(false);
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
          style={[styles.linkRow, importing && styles.linkRowDisabled]}
          onPress={runImport}
          disabled={importing}
        >
          <MaterialCommunityIcons name="file-import-outline" size={20} color={colors.text} />
          <Text style={styles.linkText}>
            {importing ? t('Opening backup…') : t('Import settings')}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.subtext} />
        </TouchableOpacity>
      </View>

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
  linkRowDisabled: {
    opacity: 0.55,
  },
});
