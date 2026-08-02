import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../services/i18n';
import { colors, spacing, withAlpha } from '../constants/theme';

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
  const insets = useSafeAreaInsets();
  const shotRef = useRef<ViewShot>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{
    title: string;
    message: string;
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  } | null>(null);
  const showAlert = setAlert;

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
    <Modal visible animationType="fade" transparent onRequestClose={alert ? () => setAlert(null) : onClose}>
      <View style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} />
        <View
          style={[
            styles.deckLayer,
            { paddingBottom: 18 + insets.bottom },
            alert && styles.deckLayerBack,
          ]}
        >
          <View style={styles.grabber} />
          <View style={styles.deckHead}>
            <Text style={styles.deckDepth}>LAYER 1</Text>
            <Text style={styles.deckTitle}>{t('Spool label')}</Text>
          </View>

          <ScrollView contentContainerStyle={styles.deckBody}>
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
          </ScrollView>

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

        {alert ? (
          <View style={styles.alertLayer}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setAlert(null)} />
            <View style={styles.alertCard}>
              <View style={styles.alertIcon}>
                <MaterialCommunityIcons name={alert.icon} size={26} color={colors.primary} />
              </View>
              <Text style={styles.alertTitle}>{alert.title}</Text>
              <Text style={styles.alertMessage}>{alert.message}</Text>
              <Pressable style={styles.alertAction} onPress={() => setAlert(null)}>
                <Text style={styles.alertActionText}>{t('OK')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  deckLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '82%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  deckLayerBack: {
    transform: [{ scale: 0.94 }, { translateY: -14 }],
    opacity: 0.5,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    backgroundColor: colors.border,
  },
  deckHead: { paddingHorizontal: 18, paddingTop: 12, gap: 3 },
  deckDepth: { color: colors.subtext, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  deckTitle: { color: colors.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.5 },
  deckBody: { padding: 18 },
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
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  btn: {
    flex: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.cardAlt,
    borderRadius: 999,
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
  alertLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.74)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
  },
  alertCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 22,
    gap: 13,
    alignItems: 'center',
  },
  alertIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: withAlpha(colors.primary, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  alertMessage: {
    color: colors.subtext,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    textAlign: 'center',
  },
  alertAction: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  alertActionText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
