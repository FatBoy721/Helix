import React, { useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { t } from '../services/i18n';
import { colors, spacing } from '../constants/theme';

interface Props {
  onScanned: (spoolId: number) => void;
  onClose: () => void;
}

// accepts Spoolman's own label format plus the obvious fallbacks:
//   web+spoolman:s-42   |   https://.../spool/42   |   42
export function parseSpoolQr(data: string): number | null {
  const s = data.trim();
  let m = s.match(/^web\+spoolman:s-(\d+)$/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/\/spool\/(\d+)\b/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/^(\d+)$/);
  if (m) return parseInt(m[1], 10);
  return null;
}

export default function SpoolScanner({ onScanned, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [badScan, setBadScan] = useState(false);
  // barcode events fire repeatedly per frame — latch after the first hit
  const handledRef = useRef(false);

  const handleScan = ({ data }: { data: string }) => {
    if (handledRef.current) return;
    const id = parseSpoolQr(data);
    if (id != null) {
      handledRef.current = true;
      onScanned(id);
    } else {
      setBadScan(true);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        {!permission?.granted ? (
          <View style={styles.permBox}>
            <MaterialCommunityIcons name="camera-outline" size={40} color={colors.subtext} />
            <Text style={styles.permTitle}>{t('Camera access needed')}</Text>
            <Text style={styles.permText}>
              {t('Helix needs the camera to scan the QR label on your spool.')}
            </Text>
            <TouchableOpacity
              style={[styles.permBtn, { backgroundColor: colors.primary }]}
              onPress={requestPermission}
            >
              <Text style={styles.permBtnText}>{t('Allow camera')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleScan}
          />
        )}

        <View style={styles.overlay} pointerEvents="box-none">
          <Text style={styles.hint}>
            {badScan ? t('Not a Spoolman QR code — try another label') : t('Point at a spool label')}
          </Text>
        </View>

        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <MaterialCommunityIcons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 60,
    alignItems: 'center',
  },
  hint: {
    color: '#fff',
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(30,30,30,0.8)',
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  permTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  permText: {
    color: colors.subtext,
    fontSize: 13,
    textAlign: 'center',
  },
  permBtn: {
    marginTop: spacing.md,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  permBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
});
