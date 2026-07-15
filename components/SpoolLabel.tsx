import React, { useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { t } from '../services/i18n';
import { colors, spacing } from '../constants/theme';
import { useThemedAlert } from '../hooks/useThemedAlert';

interface Props {
  spoolId: number;
  title: string;
  material?: string;
  colorHex?: string;
  onClose: () => void;
}

// same QR payload format Spoolman's own label generator uses, so labels made
// here scan fine in KlipperScreen etc. and vice versa
export function spoolQrValue(id: number): string {
  return `web+spoolman:s-${id}`;
}

export default function SpoolLabel({ spoolId, title, material, colorHex, onClose }: Props) {
  const shotRef = useRef<ViewShot>(null);
  const [busy, setBusy] = useState(false);
  const { showAlert, alertDialog } = useThemedAlert();

  const capture = async (): Promise<string | null> => {
    try {
      const uri = await shotRef.current?.capture?.();
      return uri ?? null;
    } catch (e: any) {
      showAlert({
        title: t('Error'),
        message: String(e?.message ?? e),
        icon: 'alert-circle-outline',
      });
      return null;
    }
  };

  const saveToGallery = async () => {
    setBusy(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        showAlert({
          title: t('Error'),
          message: t('Photo library permission denied'),
          icon: 'image-off-outline',
        });
        return;
      }
      const uri = await capture();
      if (!uri) return;
      await MediaLibrary.saveToLibraryAsync(uri);
      showAlert({
        title: t('Saved'),
        message: t('Label saved to your gallery — print it from there.'),
        icon: 'check-circle',
      });
    } catch (e: any) {
      showAlert({
        title: t('Error'),
        message: String(e?.message ?? e),
        icon: 'alert-circle-outline',
      });
    } finally {
      setBusy(false);
    }
  };

  // The share sheet lets users send the generated label to print or file apps.
  const share = async () => {
    setBusy(true);
    try {
      const uri = await capture();
      if (!uri) return;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png' });
      }
    } catch (e: any) {
      showAlert({
        title: t('Error'),
        message: String(e?.message ?? e),
        icon: 'alert-circle-outline',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal visible animationType="fade" transparent onRequestClose={onClose}>
        <View style={styles.wrap}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('Spool label')}</Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color={colors.subtext} />
            </TouchableOpacity>
          </View>

          {/* White label background preserves print contrast. */}
          <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }} style={styles.label}>
            <QRCode value={spoolQrValue(spoolId)} size={140} backgroundColor="#FFFFFF" />
            <View style={styles.labelText}>
              <Text style={styles.labelTitle} numberOfLines={2}>
                {title}
              </Text>
              <View style={styles.labelMetaRow}>
                {colorHex ? (
                  <View style={[styles.labelDot, { backgroundColor: `#${colorHex.replace('#', '')}` }]} />
                ) : null}
                <Text style={styles.labelMeta}>
                  {[material, `#${spoolId}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          </ViewShot>

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary }, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={saveToGallery}
            >
              <MaterialCommunityIcons name="download" size={16} color="#fff" />
              <Text style={styles.btnTextLight}>{t('Save PNG')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={share}
            >
              <MaterialCommunityIcons name="share-variant" size={16} color={colors.text} />
              <Text style={styles.btnText}>{t('Share / Print')}</Text>
            </TouchableOpacity>
          </View>
        </View>
        </View>
      </Modal>
      {alertDialog}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: 14,
    padding: spacing.lg,
    alignSelf: 'stretch',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  label: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  labelText: {
    flex: 1,
  },
  labelTitle: {
    color: '#111',
    fontSize: 16,
    fontWeight: '700',
  },
  labelMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  labelDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  labelMeta: {
    color: '#444',
    fontSize: 13,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingVertical: spacing.md,
  },
  btnText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  btnTextLight: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});
