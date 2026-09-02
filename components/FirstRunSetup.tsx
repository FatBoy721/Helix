import React, { useState } from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '../constants/theme';
import { useSettings, type PrinterEntry } from '../hooks/useSettings';
import { t } from '../services/i18n';
import type { DiscoveredPrinter } from '../services/printerDiscovery';
import { printerEntryFromDiscovery } from '../services/printerSetup';
import { MANUAL_PRINTER_KIND } from '../services/printerProfiles';
import PrinterIcon from './PrinterIcon';
import PrinterDiscoveryDialog from './settings/PrinterDiscoveryDialog';
import PrinterEditorModal from './settings/PrinterEditorModal';

function blankPrinter(): PrinterEntry {
  return {
    id: `p${Date.now()}`,
    name: '',
    url: '',
    tailscaleUrl: '',
    cameraUrl: '/webcam/webrtc',
    connectionMode: 'lan',
    kind: MANUAL_PRINTER_KIND,
  };
}

export default function FirstRunSetup({ visible }: { visible: boolean }) {
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettings();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [printerDraft, setPrinterDraft] = useState<PrinterEntry | null>(null);

  const reviewDiscoveredPrinter = (printer: DiscoveredPrinter) => {
    setDiscoveryOpen(false);
    setPrinterDraft(printerEntryFromDiscovery(printer, `p${Date.now()}`));
  };

  const savePrinter = async (printer: PrinterEntry): Promise<boolean> => {
    await update({
      printers: [printer],
      activePrinterId: printer.id,
      primaryUrl: printer.url,
      tailscaleUrl: printer.tailscaleUrl,
      cameraUrl: printer.cameraUrl,
      connectionMode: printer.connectionMode,
    });
    return true;
  };

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View style={styles.screen}>
        <View style={styles.scrim} />
        <View style={[styles.deck, { paddingBottom: 18 + insets.bottom }]}>
          <View style={styles.grabber} />
          <View style={styles.deckHead}>
            <Text style={styles.depth}>LAYER 1</Text>
            <Text style={styles.title}>{t('Welcome to Helix')}</Text>
          </View>

          <View style={styles.content}>
            <Image source={require('../assets/icon.png')} style={styles.logo} />
            <Text style={styles.copy}>
              Add your printer now. You can add more printers later from Settings.
            </Text>

            <SetupChoice
              icon="radar"
              title="Discover on Wi-Fi"
              detail="Automatically find Snapmaker U1 and zmod FlashForge AD5X printers on this network."
              onPress={() => setDiscoveryOpen(true)}
            />
            <SetupChoice
              icon="printer-3d"
              title="Add printer manually"
              detail="Choose Snapmaker U1, FlashForge AD5X, Bambu Lab, or another Klipper printer."
              onPress={() => setPrinterDraft(blankPrinter())}
            />

            <View style={styles.bambuNote}>
              <MaterialCommunityIcons name="information-outline" size={18} color={colors.primary} />
              <Text style={styles.noteText}>
                Bambu printers are added manually because LAN mode does not advertise them through
                Moonraker discovery. You will need the printer IP, serial number, and LAN access code.
              </Text>
            </View>
          </View>
        </View>

        <PrinterDiscoveryDialog
          visible={discoveryOpen}
          existingPrinters={settings.printers}
          onClose={() => setDiscoveryOpen(false)}
          onSelect={reviewDiscoveredPrinter}
        />
        <PrinterEditorModal
          mode="add"
          printer={printerDraft}
          onClose={() => setPrinterDraft(null)}
          onSave={savePrinter}
        />
      </View>
    </Modal>
  );
}

function SetupChoice({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.choice} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.choiceIcon}>
        {icon === 'printer-3d' ? (
          <PrinterIcon size={24} color={colors.primary} />
        ) : (
          <MaterialCommunityIcons name={icon} size={25} color={colors.primary} />
        )}
      </View>
      <View style={styles.choiceCopy}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceDetail}>{detail}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  deck: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
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
  depth: {
    color: colors.subtext,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  title: { color: colors.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  content: { padding: 18, gap: spacing.md },
  logo: { width: 74, height: 74, borderRadius: 19, alignSelf: 'center' },
  copy: { color: colors.subtext, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  choice: {
    minHeight: 88,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  choiceIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceCopy: { flex: 1, gap: 4 },
  choiceTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  choiceDetail: { color: colors.subtext, fontSize: 12, lineHeight: 17 },
  bambuNote: {
    padding: 12,
    borderRadius: 11,
    backgroundColor: colors.cardAlt,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  noteText: { flex: 1, color: colors.subtext, fontSize: 11, lineHeight: 16 },
});
