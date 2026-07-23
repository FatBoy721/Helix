import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { SettingsProvider, useSettings } from '../hooks/useSettings';
import { MoonrakerProvider } from '../hooks/useMoonraker';
import FirstRunSetup from '../components/FirstRunSetup';
import {
  configureFcmForPrinter,
  getConfiguredFcmDeviceToken,
  initNotifications,
  registerFcmDeviceToken,
  subscribeToFcmAnnouncements,
} from '../services/notifications';
import { printerConnectionUrl } from '../services/moonraker';
import { getSharedMakerWorldLink, getSharedModelFile } from '../services/nativeSlicer';
import { setPendingModel } from '../services/pendingModel';
import { colors } from '../constants/theme';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.card,
    border: colors.border,
    text: colors.text,
    primary: colors.primary,
  },
};

export default function RootLayout() {
  useEffect(() => {
    initNotifications();
  }, []);

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const { settings, loaded } = useSettings();
  const router = useRouter();
  const activePrinter = settings.printers.find((printer) => printer.id === settings.activePrinterId);
  const activePrinterId = activePrinter?.id ?? '';
  const activePrinterUrl = activePrinter ? printerConnectionUrl(activePrinter) : '';

  useEffect(() => {
    if (!loaded || settings.notificationMode !== 'fcm') return;
    let cancelled = false;

    (async () => {
      const token = await registerFcmDeviceToken();
      if (!token || cancelled) return;

      await subscribeToFcmAnnouncements();
      if (!activePrinterUrl || !activePrinterId || cancelled) return;

      const configuredRegistration = await getConfiguredFcmDeviceToken();
      if (configuredRegistration === `${activePrinterId}:${token}` || cancelled) return;

      await configureFcmForPrinter(activePrinterUrl, activePrinterId, { sendTest: false });
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    activePrinterId,
    activePrinterUrl,
    loaded,
    settings.notificationMode,
  ]);

  useEffect(() => {
    getSharedMakerWorldLink().then((shared) => {
      if (shared.hasMakerWorldUrl) {
        router.replace('/slicer');
      }
    }).catch(() => {});

    // Open-with / share file — import before tabs mount when possible.
    getSharedModelFile()
      .then((file) => {
        if (!file) return;
        setPendingModel(file);
        router.replace('/slicer');
      })
      .catch(() => {});
  }, [router]);

  return (
    <>
      <MoonrakerProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="makerworld-login" options={{ presentation: 'modal' }} />
            <Stack.Screen name="makerworld-download" options={{ presentation: 'modal' }} />
          </Stack>
        </ThemeProvider>
      </MoonrakerProvider>
      <FirstRunSetup visible={loaded && settings.printers.length === 0} />
    </>
  );
}
